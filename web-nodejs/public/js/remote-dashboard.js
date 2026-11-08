/**
 * BetterDesk — RdClient operator dashboard (/remote)
 * Quick connect by ID, then the device list with folder, group and tag filters,
 * synced from the server. On phones the web viewer cannot run, so the page says
 * so up front and offers the RustDesk app (rustdesk://<id>) instead.
 */

(function () {
    'use strict';

    var REFRESH_MS = 30000;
    var VIEW_KEY = 'rd-desk-view';
    var refreshTimer = null;
    var addressBook = null;
    var lastSync = null;
    var phoneMode = null;

    function t(key, fallback) {
        if (typeof _ === 'function') {
            var v = _(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function esc(s) {
        if (s == null) return '';
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function renderBrandLogo() {
        var el = document.getElementById('rd-desk-logo');
        if (!el) return;
        var b = (window.BetterDesk && window.BetterDesk.branding) || {};
        if (b.logoType === 'svg' && b.logoSvg) {
            el.innerHTML = b.logoSvg;
            return;
        }
        if (b.logoType === 'image' && b.logoUrl) {
            el.innerHTML = '<img src="' + esc(b.logoUrl) + '" alt="">';
            return;
        }
        if (b.logoType === 'text' && b.logoText) {
            var name = document.querySelector('.rd-desk-brand-name');
            if (name) {
                name.innerHTML = esc(b.logoText) +
                    (b.logoTextAccent ? '<span class="brand-text-accent">' + esc(b.logoTextAccent) + '</span>' : '');
            }
        }
        el.hidden = true;
    }

    function renderUser() {
        var el = document.getElementById('rd-desk-user');
        var user = window.BetterDesk && window.BetterDesk.user;
        if (el && user) el.textContent = user.username || user.name || '';
    }

    function isRdClientDesktop() {
        if (window.__BETTERDESK_RDCLIENT_DESKTOP__) return true;
        return !!(window.__TAURI__ && window.__TAURI__.core && typeof window.__TAURI__.core.invoke === 'function');
    }

    // A wide table can widen the layout viewport on a phone, so the screen width counts too
    function isPhone() {
        if (window.DeviceCapabilities && window.DeviceCapabilities.isPhone()) return true;
        var fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        return !fine && window.screen && window.screen.width > 0 && window.screen.width <= 767;
    }

    function markDesktopLayout() {
        if (!isRdClientDesktop()) return;
        document.documentElement.classList.add('rd-desk-desktop');
        document.body.classList.add('rd-desk-desktop');
        var app = document.getElementById('rd-desk-app');
        if (app) app.classList.add('rd-desk-desktop');
    }

    function showConnectError(message) {
        var text = message || t('remote_dashboard.connect_failed', 'Could not open the remote session.');
        if (window.Notifications && typeof window.Notifications.error === 'function') {
            window.Notifications.error(text);
            return;
        }
        var status = document.getElementById('rd-desk-quick-status');
        if (status) {
            status.textContent = text;
            status.classList.add('is-error');
        }
    }

    function openInApp(deviceId) {
        if (!deviceId) return;
        window.location.href = 'rustdesk://' + encodeURIComponent(deviceId);
    }

    function openRemoteSession(deviceId, deviceName) {
        if (!deviceId) return;
        if (isPhone()) {
            openInApp(deviceId);
            return;
        }

        if (isRdClientDesktop()) {
            window.__TAURI__.core.invoke('open_session', {
                deviceId: deviceId,
                deviceName: deviceName || ''
            }).catch(function (err) {
                console.error('RdClient desktop session failed:', err);
                showConnectError(String(err && err.message ? err.message : err));
            });
            return;
        }

        // A viewer tab that is already open adds the session as a tab; otherwise open a new one
        if (typeof BroadcastChannel === 'undefined') {
            openViewerTab(deviceId);
            return;
        }

        var bc = new BroadcastChannel('betterdesk-remote');
        var handled = false;

        bc.onmessage = function (ev) {
            if (ev.data && ev.data.type === 'pong') {
                handled = true;
                bc.postMessage({ type: 'add-session', deviceId: deviceId, deviceName: deviceName || '' });
                bc.close();
            } else if (ev.data && ev.data.type === 'session-added') {
                handled = true;
                bc.close();
            }
        };

        bc.postMessage({ type: 'ping' });
        setTimeout(function () {
            if (!handled) {
                bc.close();
                openViewerTab(deviceId);
            }
        }, 300);
    }

    function openViewerTab(deviceId) {
        var win = window.open('/remote/' + encodeURIComponent(deviceId), '_blank');
        if (!win) {
            showConnectError(t('remote_dashboard.popup_blocked', 'The browser blocked the new tab. Allow pop-ups for this site and try again.'));
        }
    }

    function formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function updateSyncStatus(ok) {
        var statusEl = document.getElementById('rd-desk-status-text');
        if (ok) lastSync = new Date();
        if (!statusEl) return;
        statusEl.classList.toggle('is-error', !ok);
        if (ok) {
            statusEl.textContent = t('remote_dashboard.updated_at', 'Updated {time}.').replace('{time}', formatTime(lastSync));
        } else if (lastSync) {
            statusEl.textContent = t('remote_dashboard.sync_failed_since', 'Could not refresh. The list is from {time}.').replace('{time}', formatTime(lastSync));
        } else {
            statusEl.textContent = '';
        }
    }

    function readStoredView() {
        try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list'; } catch (_) { return 'list'; }
    }

    function initAddressBook() {
        if (!window.RemoteAddressBook) return null;

        return window.RemoteAddressBook.create({
            classPrefix: 'rd-desk',
            defaultView: readStoredView(),
            isPhone: isPhone,
            onViewChange: function (mode) {
                try { localStorage.setItem(VIEW_KEY, mode); } catch (_) { /* ignore */ }
            },
            ids: {
                sidebar: 'rd-desk-sidebar',
                contentRoot: 'rd-desk-app',
                foldersCustom: 'rd-desk-folders-custom',
                groups: 'rd-desk-groups',
                groupsEmpty: 'rd-desk-groups-empty',
                tags: 'rd-desk-tags',
                tagsEmpty: 'rd-desk-tags-empty',
                grid: 'rd-desk-grid',
                tableWrap: 'rd-desk-table-wrap',
                tbody: 'rd-desk-tbody',
                loading: 'rd-desk-loading',
                error: 'rd-desk-error',
                errorText: 'rd-desk-error-text',
                empty: 'rd-desk-empty',
                search: 'rd-desk-search',
                sectionTitle: 'rd-desk-section-title',
                deviceCount: 'rd-desk-count',
                countAll: 'rd-count-all',
                countUnassigned: 'rd-count-unassigned',
                viewGrid: 'rd-view-grid',
                viewList: 'rd-view-list',
                refreshBtn: 'rd-desk-refresh',
                retry: 'rd-desk-retry',
                quickId: 'rd-desk-quick-id',
                quickStatus: 'rd-desk-quick-status'
            },
            onConnect: openRemoteSession
        });
    }

    async function loadAll(silent) {
        if (!addressBook) return;
        var ok = await addressBook.loadAll(silent);
        updateSyncStatus(ok);
    }

    function populateLanguageSelect() {
        var sel = document.getElementById('rd-desk-lang');
        if (!sel || sel.options.length > 0) return;
        var langs = (window.BetterDesk && window.BetterDesk.availableLanguages) || [];
        langs.forEach(function (lang) {
            var opt = document.createElement('option');
            opt.value = lang.code;
            opt.textContent = lang.native || lang.name || lang.code;
            if (lang.code === (window.BetterDesk && window.BetterDesk.lang)) opt.selected = true;
            sel.appendChild(opt);
        });
    }

    function bindDesktopSettings() {
        if (!isRdClientDesktop()) return;
        var btn = document.getElementById('rd-desk-settings');
        if (!btn) return;
        btn.hidden = false;
        btn.addEventListener('click', function () {
            var invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
            if (invoke) invoke('open_settings').catch(function () { /* ignore */ });
        });
    }

    // Phones: say up front that the web viewer needs a larger screen and make the
    // RustDesk app the one action. Larger screens: Connect is the primary action.
    function applyPhoneMode() {
        var phone = isPhone();
        if (phone === phoneMode) return;
        phoneMode = phone;
        var note = document.getElementById('rd-phone-gate');
        var connect = document.getElementById('rd-desk-quick-btn');
        var app = document.getElementById('rd-desk-quick-app');
        if (note) note.hidden = !phone;
        if (connect) connect.hidden = phone;
        if (app) {
            app.hidden = isRdClientDesktop();
            app.classList.toggle('btn-primary', phone);
        }
        if (addressBook && addressBook.getDevices().length) addressBook.renderDevices();
    }

    function bindQuickConnect() {
        var input = document.getElementById('rd-desk-quick-id');
        document.getElementById('rd-desk-quick-btn')?.addEventListener('click', function () {
            addressBook?.quickConnect('rd-desk-quick-id');
        });
        document.getElementById('rd-desk-quick-app')?.addEventListener('click', function () {
            if (!addressBook) return;
            var id = addressBook.readQuickId('rd-desk-quick-id');
            if (!id) {
                // Shows the same "enter a device ID" message as Connect
                addressBook.quickConnect('rd-desk-quick-id');
                return;
            }
            openInApp(id);
        });
        input?.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (isPhone()) document.getElementById('rd-desk-quick-app')?.click();
            else addressBook?.quickConnect('rd-desk-quick-id');
        });
    }

    function startAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = setInterval(function () { loadAll(true); }, REFRESH_MS);
    }

    document.addEventListener('DOMContentLoaded', function () {
        markDesktopLayout();
        populateLanguageSelect();
        bindDesktopSettings();
        renderBrandLogo();
        renderUser();
        addressBook = initAddressBook();
        if (addressBook) {
            addressBook.bindUi(document.getElementById('rd-desk-app'));
        }
        applyPhoneMode();
        bindQuickConnect();
        loadAll(false);
        startAutoRefresh();
        window.addEventListener('resize', applyPhoneMode, { passive: true });
        window.addEventListener('load', applyPhoneMode);
        window.addEventListener('betterdesk:posture-change', applyPhoneMode);
    });

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) loadAll(true);
    });
})();
