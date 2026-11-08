/**
 * Navbar notification center.
 *
 * Responsibilities:
 *  - Fetches recent notifications from /api/bd/notifications on load
 *  - Subscribes to the shared authenticated panel event stream
 *  - Renders the dropdown (a menu): one row per help request or enrollment
 *    request, with the device's OS mark, what happened, the device and the age
 *  - Marks items as read via POST /api/bd/notifications/:id/read
 *  - Updates badge counter
 *
 * Keyboard: Enter/Space or ArrowDown on the bell opens the menu and focuses the
 * first notification; ArrowUp/ArrowDown, Home and End move between items;
 * Escape closes and returns focus to the bell; Tab closes and moves on.
 *
 * Defense in depth:
 *  - All server-provided text is inserted via textContent (never innerHTML) to
 *    prevent stored-XSS from compromised agent names or help request bodies.
 *    Only icon markup from Utils (fixed names) goes through innerHTML.
 *  - CSRF token is sent with mutation requests (read / mark-all).
 */
(function () {
    'use strict';

    const MAX_ITEMS = 10;
    const state = {
        items: [],
        unreadCount: 0,
        loaded: false,
        failed: false,
    };

    let dom = null;

    function _(key, params) {
        try {
            return (window.BetterDesk && window._) ? window._(key, params) : key;
        } catch {
            return key;
        }
    }

    function csrf() {
        return (window.BetterDesk && window.BetterDesk.csrfToken) || '';
    }

    function formatTime(iso) {
        try {
            if (window.Utils && typeof Utils.formatRelativeTime === 'function') {
                return Utils.formatRelativeTime(iso, { empty: '' });
            }
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
        } catch {
            return '';
        }
    }

    function formatFullTime(iso) {
        try {
            if (window.Utils && typeof Utils.formatDate === 'function') return Utils.formatDate(iso);
            return new Date(iso).toLocaleString();
        } catch {
            return '';
        }
    }

    function looksLikeAddress(part) {
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(part) || /^[0-9a-f]*:[0-9a-f:.]*$/i.test(part);
    }

    /**
     * What a row shows, from either notification kind. Registration items
     * carry "ID · platform · address" in their message; newer servers also
     * send platform and ip as fields.
     */
    function describe(item) {
        const isRegistration = item.kind === 'registration' || String(item.id).startsWith('registration:');
        const deviceId = String(item.device_id || '');
        const title = String(item.title || '');
        const name = String(item.hostname || (title && title !== deviceId ? title : ''));

        if (isRegistration) {
            const parts = String(item.message || '').split(' · ').map(p => p.trim()).filter(Boolean);
            if (parts[0] && parts[0] === deviceId) parts.shift();
            const platform = String(item.platform || parts.find(p => !looksLikeAddress(p)) || '');
            const ip = String(item.ip || parts.find(looksLikeAddress) || '');
            return {
                kindLabel: _('notifications.kind_registration'),
                icon: 'enrollment_request',
                link: item.link || '/registrations',
                name,
                deviceId,
                platform,
                detail: [platform, ip].filter(Boolean).join(' · '),
            };
        }
        return {
            kindLabel: _('notifications.help_request'),
            icon: 'help_request',
            link: item.link || '/help-requests',
            name: name || (deviceId ? '' : title),
            deviceId,
            platform: String(item.platform || ''),
            detail: String(item.message || ''),
        };
    }

    function markHtml(view) {
        const U = window.Utils;
        if (U && view.platform && typeof U.getPlatformLogoId === 'function' && U.getPlatformLogoId(view.platform)) {
            return U.getPlatformIconHtml(view.platform);
        }
        if (U && typeof U.icon === 'function') return U.icon(view.icon);
        return '';
    }

    function updateBadge() {
        if (!dom) return;
        const count = state.unreadCount;
        // The badge is a dot; the count goes into the button's name
        const btn = document.getElementById('notif-btn');
        if (btn) {
            if (!btn.dataset.baseLabel) btn.dataset.baseLabel = btn.getAttribute('aria-label') || '';
            const label = count > 0 ? btn.dataset.baseLabel + ' (' + (count > 99 ? '99+' : count) + ')' : btn.dataset.baseLabel;
            btn.setAttribute('aria-label', label);
            btn.setAttribute('title', label);
        }
        if (dom.markAll) dom.markAll.hidden = !(count > 0);
        if (count > 0) {
            dom.badge.textContent = '';
            dom.badge.hidden = false;
            dom.badge.setAttribute('aria-hidden', 'true');
        } else {
            dom.badge.textContent = '';
            dom.badge.hidden = true;
            dom.badge.setAttribute('aria-hidden', 'true');
        }
    }

    function stateLine(text, className) {
        const p = document.createElement('p');
        p.className = className;
        p.textContent = text;
        return p;
    }

    function buildRow(item) {
        const view = describe(item);
        const row = document.createElement('a');
        row.className = 'notif-row' + (item.read ? '' : ' is-unread');
        row.href = view.link;
        row.setAttribute('role', 'menuitem');
        row.tabIndex = -1;
        row.dataset.id = String(item.id);

        const mark = document.createElement('span');
        mark.className = 'notif-row-mark';
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML = markHtml(view);

        const kind = document.createElement('span');
        kind.className = 'notif-row-kind';
        kind.textContent = view.kindLabel;

        row.appendChild(mark);
        row.appendChild(kind);

        if (view.name || view.deviceId) {
            const device = document.createElement('span');
            device.className = 'notif-row-device';
            if (view.name) {
                const name = document.createElement('span');
                name.className = 'notif-row-name';
                name.textContent = view.name;
                device.appendChild(name);
            }
            if (view.deviceId) {
                if (view.name) device.appendChild(document.createTextNode(' '));
                const id = document.createElement('span');
                id.className = 'notif-row-id';
                id.textContent = view.deviceId;
                device.appendChild(id);
            }
            row.appendChild(device);
        }

        if (view.detail) {
            const detail = document.createElement('span');
            detail.className = 'notif-row-detail';
            detail.textContent = view.detail;
            row.appendChild(detail);
        }

        const age = formatTime(item.created_at);
        if (age) {
            const time = document.createElement('time');
            time.className = 'notif-row-time';
            time.dateTime = String(item.created_at || '');
            time.title = formatFullTime(item.created_at);
            time.textContent = age;
            row.appendChild(time);
        }

        if (!item.read) {
            const unread = document.createElement('span');
            unread.className = 'sr-only';
            unread.textContent = ', ' + _('notifications.unread');
            row.appendChild(unread);
        }

        row.addEventListener('click', () => {
            if (!item.read) {
                markRead(item.id).catch(() => { /* best effort */ });
            }
        });
        return row;
    }

    function renderList() {
        if (!dom) return;
        // Re-rendering replaces the rows; keep keyboard focus on the same one
        const active = document.activeElement;
        const hadFocus = !!(active && dom.list.contains(active));
        const focusedId = hadFocus && active.dataset ? active.dataset.id : null;

        dom.list.textContent = '';

        if (state.failed && state.items.length === 0) {
            const p = stateLine(_('notifications.load_failed') + ' ', 'notif-state is-error');
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'notif-retry';
            retry.setAttribute('role', 'menuitem');
            retry.tabIndex = -1;
            retry.textContent = _('errors.try_again');
            retry.addEventListener('click', (e) => {
                e.stopPropagation();
                fetchNotifications();
            });
            p.appendChild(retry);
            dom.list.appendChild(p);
        } else if (!state.loaded) {
            dom.list.appendChild(stateLine(_('notifications.loading'), 'notif-state'));
        } else if (state.items.length === 0) {
            dom.list.appendChild(stateLine(_('notifications.empty_hint'), 'notif-state notif-empty'));
        } else {
            const ul = document.createElement('ul');
            ul.className = 'notif-rows';
            ul.setAttribute('role', 'none');
            for (const item of state.items.slice(0, MAX_ITEMS)) {
                const li = document.createElement('li');
                li.setAttribute('role', 'none');
                li.appendChild(buildRow(item));
                ul.appendChild(li);
            }
            dom.list.appendChild(ul);
        }

        if (hadFocus) {
            const same = focusedId ? dom.list.querySelector('[data-id="' + CSS.escape(focusedId) + '"]') : null;
            const target = same || menuItems()[0];
            if (target) target.focus();
        }
    }

    async function fetchNotifications() {
        try {
            const resp = await fetch('/api/bd/notifications?limit=' + MAX_ITEMS, {
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
            state.items = items;
            state.loaded = true;
            state.failed = false;
            const serverUnreadCount = Number(data.unread_count);
            state.unreadCount = Number.isFinite(serverUnreadCount) && serverUnreadCount >= 0
                ? serverUnreadCount
                : items.filter(i => !i.read).length;
            updateBadge();
            renderList();
        } catch {
            // Keep what was shown; with nothing to show, say so and offer a retry.
            state.failed = true;
            renderList();
        }
    }

    async function markRead(id) {
        if (!id) return;
        try {
            await fetch('/api/bd/notifications/' + encodeURIComponent(id) + '/read', {
                method: 'POST',
                credentials: 'same-origin',
                // The row is a link: let the request finish after navigation
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf(),
                },
            });
            const item = state.items.find(i => String(i.id) === String(id));
            if (item && !item.read) {
                item.read = true;
                state.unreadCount = Math.max(0, state.unreadCount - 1);
                updateBadge();
                renderList();
            }
        } catch {
            // Silent; user can retry.
        }
    }

    async function markAllRead() {
        try {
            const resp = await fetch('/api/bd/notifications/read-all', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrf(),
                },
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const hadFocus = document.activeElement === dom.markAll;
            state.items = state.items.map(i => ({ ...i, read: true }));
            state.unreadCount = 0;
            updateBadge();
            renderList();
            // The button hides once nothing is unread; keep focus in the menu
            if (hadFocus) {
                const first = menuItems()[0];
                if (first) first.focus();
            }
        } catch {
            if (window.Notifications && typeof Notifications.error === 'function') {
                Notifications.error(_('errors.try_again'));
            }
        }
    }

    function onHelpRequestEvent(payload) {
        try {
            // Status changes (accepted, resolved) are not new requests: reload
            // the list so they don't show up as a new unread item.
            if (payload.status && payload.status !== 'pending' && payload.status !== 'open') {
                fetchNotifications();
                return;
            }
            const item = {
                id: payload.id || Date.now(),
                kind: 'help_request',
                title: payload.hostname || payload.device_name || payload.device_id || _('notifications.help_request'),
                hostname: payload.hostname || payload.device_name || '',
                device_id: payload.device_id || '',
                message: payload.message || payload.description || '',
                icon: 'support_agent',
                link: '/help-requests',
                read: false,
                created_at: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
            };
            // Insert at top, cap list.
            const existingIndex = state.items.findIndex((entry) => String(entry.id) === String(item.id));
            if (existingIndex >= 0) {
                state.items.splice(existingIndex, 1);
            } else {
                state.unreadCount += 1;
            }
            state.items.unshift(item);
            state.loaded = true;
            if (state.items.length > MAX_ITEMS) {
                state.items = state.items.slice(0, MAX_ITEMS);
            }
            updateBadge();
            renderList();
        } catch {
            // Ignore malformed payloads.
        }
    }

    function attachPanelEvents() {
        window.addEventListener('betterdesk:panel-event', (event) => {
            const payload = event.detail || {};
            if (payload.type === 'help_request') {
                onHelpRequestEvent(payload);
            } else if (payload.type === 'registration_pending' ||
                payload.type === 'registration_changed') {
                // The API is the source of truth for read state and the
                // aggregate count; reload it instead of guessing locally.
                fetchNotifications();
            }
        });
    }

    function isOpen() {
        return !!dom && !dom.dropdown.hidden;
    }

    /** Focusable menu items in order: mark all read, the rows, retry, footer links */
    function menuItems() {
        if (!dom) return [];
        return Array.from(dom.dropdown.querySelectorAll('[role="menuitem"]'))
            .filter(el => !el.hidden && el.getClientRects().length > 0);
    }

    function focusFirst() {
        const rows = dom.list.querySelectorAll('.notif-row');
        const target = rows[0] || menuItems()[0];
        if (target) target.focus();
    }

    function toggleDropdown(open) {
        if (!dom) return;
        const willOpen = open !== undefined ? open : dom.dropdown.hidden;
        if (willOpen && window.BetterDesk && typeof window.BetterDesk.closeAllTopbarPopovers === 'function') {
            window.BetterDesk.closeAllTopbarPopovers(dom.dropdown);
        }
        dom.dropdown.hidden = !willOpen;
        dom.btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        if (willOpen) {
            renderList();
            focusFirst();
            fetchNotifications();
        }
    }

    function onMenuKeydown(e) {
        if (!isOpen()) return;
        if (e.key === 'Escape') {
            const focusInside = dom.wrapper.contains(document.activeElement);
            // Handled here only: a menu around the bell (phones) stays open
            e.preventDefault();
            e.stopPropagation();
            toggleDropdown(false);
            if (focusInside) dom.btn.focus();
            return;
        }
        if (!dom.dropdown.contains(document.activeElement)) return;
        if (e.key === 'Tab') {
            toggleDropdown(false);
            return;
        }
        const list = menuItems();
        if (!list.length) return;
        const i = list.indexOf(document.activeElement);
        let next = null;
        if (e.key === 'ArrowDown') next = list[(i + 1) % list.length];
        else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
        else if (e.key === 'Home') next = list[0];
        else if (e.key === 'End') next = list[list.length - 1];
        if (next) {
            e.preventDefault();
            next.focus();
        }
    }

    function init() {
        dom = {
            wrapper: document.querySelector('.notif-wrapper'),
            btn: document.getElementById('notif-btn'),
            badge: document.getElementById('notif-badge'),
            dropdown: document.getElementById('notif-dropdown'),
            list: document.getElementById('notif-list'),
            markAll: document.getElementById('notif-mark-all'),
        };
        if (!dom.btn || !dom.dropdown || !dom.list) {
            dom = null;
            return;
        }

        dom.btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        dom.btn.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' && !isOpen()) {
                e.preventDefault();
                toggleDropdown(true);
            }
        });

        if (dom.markAll) {
            dom.markAll.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                markAllRead();
            });
        }

        // Clicks on the menu's text or background keep it open
        dom.dropdown.addEventListener('click', (e) => {
            if (!e.target.closest('a[href]')) e.stopPropagation();
        });

        document.addEventListener('click', (e) => {
            if (!dom.wrapper.contains(e.target)) {
                toggleDropdown(false);
            }
        });

        // Capture phase, so Escape closes this menu before other top bar menus see it
        document.addEventListener('keydown', onMenuKeydown, true);

        fetchNotifications();
        attachPanelEvents();

        // Polling fallback: survives a disconnected panel event stream.
        setInterval(fetchNotifications, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
