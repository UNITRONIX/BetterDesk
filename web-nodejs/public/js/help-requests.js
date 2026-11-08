/**
 * BetterDesk Console - Help requests
 *
 * Someone pressed the help button in the desktop app. The list polls the
 * console API (which proxies the Go server) and shows the message, the
 * device, how long it has waited and who took it. Operators accept,
 * connect (web viewer or the RustDesk app) and mark requests resolved.
 */

'use strict';

(function () {
    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params || {}) : key);
    const esc = (s) => Utils.escapeHtml(String(s == null ? '' : s));
    const can = (p) => (window.Utils && typeof Utils.can === 'function' ? Utils.can(p) : true);
    const csrfToken = window.BetterDesk?.csrfToken || '';
    const POLL_INTERVAL = 5000;
    const SORT_KEY = 'betterdesk_help_requests_sort';

    // ---- State ----
    let requests = [];
    let loaded = false;
    let loadError = '';
    let activeFilter = 'open';
    let sortOrder = 'oldest';
    let signature = '';
    let renderPending = false;
    let pollTimer = null;
    // Requests changed on this page stay in view until the filter changes,
    // so the operator sees the new status next to the row they acted on.
    const touched = new Set();
    const busy = new Set();

    try {
        const saved = localStorage.getItem(SORT_KEY);
        if (saved === 'newest' || saved === 'oldest') sortOrder = saved;
    } catch (_e) { /* storage may be blocked */ }

    // ---- DOM ----
    const listEl = document.getElementById('hr-list');
    const countEl = document.getElementById('hr-count');
    const liveEl = document.getElementById('hr-live');
    const sortEl = document.getElementById('hr-sort');
    const filterButtons = document.querySelectorAll('.help-requests-page .filter-btn');
    if (sortEl) sortEl.value = sortOrder;

    // ---- API ----

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        let resp;
        try {
            resp = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
        } catch (_e) {
            return { success: false, network: true };
        }
        let data = {};
        try { data = await resp.json(); } catch (_e) { data = {}; }
        if (!resp.ok && data.success === undefined) data.success = false;
        if (resp.status === 403) data.forbidden = true;
        return data;
    }

    function failureText(result, key) {
        if (result && result.forbidden) return Utils.permissionDeniedMessage();
        if (result && result.network) return _('help_request.error_network');
        return _(key);
    }

    // ---- Fetch ----

    async function fetchRequests() {
        const data = await apiFetch('/api/help/requests');
        if (!data.success || !Array.isArray(data.requests)) {
            if (!loaded) {
                loadError = failureText(data, 'help_request.load_failed');
                render(true);
            }
            return;
        }
        const prevPending = requests.filter(r => r.status === 'pending').length;
        const next = data.requests;
        const nextSig = JSON.stringify(next);
        const firstLoad = !loaded;
        loaded = true;
        loadError = '';
        if (!firstLoad && next.filter(r => r.status === 'pending').length > prevPending) {
            playNotificationSound();
        }
        if (nextSig === signature && !firstLoad) return;
        // Keep what this page already knows about a request it just changed
        // until the server reports the same status.
        requests = next.map(r => {
            const local = requests.find(x => x.id === r.id);
            if (local && local._local && local.status !== r.status && rank(local.status) > rank(r.status)) return local;
            return r;
        });
        signature = nextSig;
        render();
    }

    function rank(status) {
        return status === 'resolved' ? 2 : (status === 'accepted' ? 1 : 0);
    }

    function playNotificationSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.5);
        } catch (_e) { /* no audio */ }
    }

    // ---- Actions ----

    function currentUserName() {
        const user = window.BetterDesk && window.BetterDesk.user;
        return (user && (user.username || user.name)) || '';
    }

    function announce(text) {
        if (!liveEl) return;
        liveEl.textContent = '';
        setTimeout(() => { liveEl.textContent = text; }, 50);
    }

    async function changeStatus(id, action) {
        const req = requests.find(r => r.id === id);
        if (!req || busy.has(id)) return;
        busy.add(id);
        render(true);
        const result = await apiFetch(`/api/help/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' });
        busy.delete(id);
        if (!result.success) {
            render(true);
            Notifications.error(failureText(result, action === 'accept' ? 'help_request.accept_failed' : 'help_request.resolve_failed'));
            return;
        }
        const me = currentUserName();
        if (action === 'accept') {
            Object.assign(req, { status: 'accepted', accepted_by: me, _local: true });
        } else {
            Object.assign(req, { status: 'resolved', resolved_by: me, _local: true });
        }
        touched.add(id);
        render(true);
        announce(action === 'accept' ? _('help_request.accepted_live') : _('help_request.resolved_live'));
        // After Accept the next step is Connect; after resolving, the row's menu
        const row = listEl.querySelector(`tr[data-id="${CSS.escape(id)}"]`);
        const next = row && (row.querySelector('[data-hr-connect]') || row.querySelector('button'));
        if (next) next.focus();
    }

    function connectWeb(deviceId) {
        window.open(`/remote/${encodeURIComponent(deviceId)}`, '_blank');
    }

    function connectApp(deviceId) {
        window.location.href = 'rustdesk://' + encodeURIComponent(deviceId);
        Notifications.info(_('help_request.app_opening'));
    }

    // ---- Render ----

    function statusLabel(req) {
        if (req.status === 'pending') return _('help_request.status_waiting');
        if (req.status === 'accepted') return _('help_request.accepted');
        if (req.status === 'resolved') return _('help_request.resolved');
        return req.status;
    }

    function statusSub(req) {
        if (req.status === 'accepted' && req.accepted_by) return _('help_request.by_name', { name: req.accepted_by });
        if (req.status === 'resolved' && req.resolved_by) return _('help_request.by_name', { name: req.resolved_by });
        return '';
    }

    function filtered() {
        const list = requests.filter(r => {
            if (touched.has(r.id)) return true;
            if (!activeFilter) return true;
            if (activeFilter === 'open') return r.status === 'pending' || r.status === 'accepted';
            return r.status === activeFilter;
        });
        list.sort((a, b) => (sortOrder === 'oldest' ? a.created_at - b.created_at : b.created_at - a.created_at));
        return list;
    }

    function actionsHtml(req, index) {
        const named = `aria-describedby="hr-msg-${index}"`;
        const isBusy = busy.has(req.id);
        const parts = [];
        if (req.status === 'pending') {
            parts.push(`<button type="button" class="btn btn-sm" data-action="accept"${isBusy ? ' disabled' : ''} ${named}>${esc(isBusy ? _('help_request.working') : _('help_request.accept'))}</button>`);
        }
        if (req.status !== 'resolved' && req.device_id && can('device.connect')) {
            const menuId = `hr-connect-${index}`;
            parts.push(`<span class="menu-anchor">
                <button type="button" class="btn btn-sm" data-hr-connect data-menu-button aria-haspopup="menu" aria-expanded="false"
                    aria-controls="${menuId}" ${named}>${esc(_('help_request.connect'))}<span class="material-icons btn-caret" aria-hidden="true">expand_more</span></button>
                <span class="menu menu-end hr-connect-menu" id="${menuId}" role="menu">
                    <button type="button" class="menu-item" role="menuitem" data-action="connect-web">
                        <span class="hr-connect-title">${esc(_('help_request.connect_web'))}</span>
                        <span class="hr-connect-desc">${esc(_('help_request.connect_web_desc'))}</span></button>
                    <button type="button" class="menu-item" role="menuitem" data-action="connect-app">
                        <span class="hr-connect-title">${esc(_('help_request.connect_app'))}</span>
                        <span class="hr-connect-desc">${esc(_('help_request.connect_app_desc'))}</span></button>
                </span>
            </span>`);
        }
        if (req.status !== 'resolved') {
            parts.push(`<button type="button" class="btn btn-sm" data-action="resolve"${isBusy ? ' disabled' : ''} ${named}>${esc(_('help_request.mark_resolved'))}</button>`);
        }
        return parts.join('');
    }

    function rowHtml(req, index, total) {
        const created = Utils.parseDate(req.created_at);
        const age = Utils.formatRelativeTime(created, { empty: _('common.not_available') });
        const full = Utils.formatDate(created, { empty: '' });
        const message = req.message
            ? `<span class="hr-message" id="hr-msg-${index}">${esc(req.message)}</span>`
            : `<span class="hr-message is-missing" id="hr-msg-${index}">${esc(_('help_request.no_message'))}</span>`;
        const deviceName = req.hostname
            ? `<span class="row-name">${esc(req.hostname)}</span>`
            : `<span class="row-name is-missing">${esc(_('help_request.no_device_name'))}</span>`;
        const sub = statusSub(req);
        const statusCls = req.status === 'pending' ? 'pending' : (req.status === 'accepted' ? 'hr-accepted' : 'hr-resolved');
        const upClass = total > 3 && index >= total - 2 ? ' menu-near-end' : '';
        return `<tr data-id="${esc(req.id)}" class="is-${esc(req.status)}${upClass}">
            <td class="col-message">${message}<span class="cell-sub phone-only">${req.hostname ? `${esc(req.hostname)} · ` : ''}<span class="mono">${esc(req.device_id)}</span> · ${esc(age)}</span></td>
            <td class="col-device">${deviceName}<span class="cell-sub mono">${esc(req.device_id)}</span></td>
            <td class="col-age"${full ? ` title="${esc(full)}"` : ''}>${esc(age)}</td>
            <td class="col-status"><span class="status ${statusCls}">${esc(statusLabel(req))}</span>${sub ? `<span class="cell-sub">${esc(sub)}</span>` : ''}</td>
            <td class="actions">${actionsHtml(req, index)}</td>
        </tr>`;
    }

    function emptyText() {
        if (activeFilter === 'open') return _('help_request.empty_open');
        if (activeFilter === 'pending') return _('help_request.empty_waiting');
        if (activeFilter === 'accepted') return _('help_request.empty_accepted');
        if (activeFilter === 'resolved') return _('help_request.empty_resolved');
        return _('help_request.empty_all');
    }

    function interacting() {
        if (listEl.querySelector('.menu.open')) return true;
        const active = document.activeElement;
        return !!(active && listEl.contains(active) && active.matches('[data-menu-button][aria-expanded="true"]'));
    }

    function render(force) {
        // Polling must not close a menu the operator has open
        if (!force && interacting()) { renderPending = true; return; }
        renderPending = false;

        if (!loaded) {
            listEl.innerHTML = loadError
                ? `<tr><td colspan="5" class="state-cell is-error">${esc(loadError)} <button type="button" class="btn btn-sm" data-action="retry">${esc(_('actions.retry'))}</button></td></tr>`
                : `<tr><td colspan="5" class="state-cell">${esc(_('help_request.loading'))}</td></tr>`;
            countEl.textContent = '';
            return;
        }

        const focusedId = document.activeElement && listEl.contains(document.activeElement)
            ? document.activeElement.closest('tr')?.dataset.id : null;
        const focusedAction = focusedId ? (document.activeElement.dataset.action || (document.activeElement.hasAttribute('data-hr-connect') ? 'connect' : '')) : '';

        const list = filtered();
        listEl.innerHTML = list.length
            ? list.map((r, i) => rowHtml(r, i, list.length)).join('')
            : `<tr><td colspan="5" class="state-cell">${esc(emptyText())}</td></tr>`;
        listEl.querySelectorAll('tr.menu-near-end .menu').forEach(m => m.classList.add('menu-up'));

        if (focusedId) {
            const row = listEl.querySelector(`tr[data-id="${CSS.escape(focusedId)}"]`);
            const sel = focusedAction === 'connect' ? '[data-hr-connect]' : (focusedAction ? `[data-action="${focusedAction}"]` : 'button');
            const el = row && (row.querySelector(sel) || row.querySelector('button'));
            if (el) el.focus({ preventScroll: true });
        }
        renderCount();
    }

    function renderCount() {
        const waiting = requests.filter(r => r.status === 'pending');
        const accepted = requests.filter(r => r.status === 'accepted').length;
        const parts = [];
        if (!waiting.length) {
            parts.push(_('help_request.count_none'));
        } else {
            const oldest = waiting.reduce((a, b) => (a.created_at <= b.created_at ? a : b));
            const age = Utils.formatRelativeTime(Utils.parseDate(oldest.created_at), { empty: '' });
            parts.push(waiting.length === 1
                ? _('help_request.count_waiting_one', { age })
                : _('help_request.count_waiting_many', { count: waiting.length, age }));
        }
        if (accepted) parts.push(_('help_request.count_accepted', { count: accepted }));
        countEl.textContent = parts.join(' ');
    }

    // ---- Events ----

    listEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'retry') {
            loadError = '';
            render(true);
            fetchRequests();
            return;
        }
        const row = btn.closest('tr[data-id]');
        if (!row) return;
        const id = row.dataset.id;
        const req = requests.find(r => r.id === id);
        if (!req) return;
        switch (action) {
            case 'accept': changeStatus(id, 'accept'); break;
            case 'resolve': changeStatus(id, 'resolve'); break;
            case 'connect-web': connectWeb(req.device_id); break;
            case 'connect-app': connectApp(req.device_id); break;
        }
    });

    // A render skipped while a menu was open runs once it closes
    document.addEventListener('click', () => {
        if (renderPending) setTimeout(() => { if (!interacting()) render(); }, 0);
    });
    document.addEventListener('keydown', (e) => {
        if (renderPending && (e.key === 'Escape' || e.key === 'Tab')) setTimeout(() => { if (!interacting()) render(); }, 0);
    });

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            activeFilter = btn.dataset.status || '';
            touched.clear();
            render(true);
        });
    });

    if (sortEl) {
        sortEl.addEventListener('change', () => {
            sortOrder = sortEl.value === 'newest' ? 'newest' : 'oldest';
            try { localStorage.setItem(SORT_KEY, sortOrder); } catch (_e) { /* ignore */ }
            render(true);
        });
    }

    // ---- Init ----

    render(true);
    fetchRequests();
    pollTimer = setInterval(fetchRequests, POLL_INTERVAL);
    window.addEventListener('beforeunload', () => {
        if (pollTimer) clearInterval(pollTimer);
    });
})();
