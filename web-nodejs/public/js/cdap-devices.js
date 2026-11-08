/**
 * BetterDesk Console - CDAP Devices List
 * Renders the CDAP device table with live status, type filters, and search.
 */
(function () {
    'use strict';

    const REFRESH_INTERVAL = 10000; // 10s
    let _allDevices = [];
    let _gateway = null;          // last /api/cdap/status answer, null until known
    let _devicesState = 'loading'; // loading | ok | error
    let _devicesError = '';
    let _activeTypeFilter = '';
    let _searchQuery = '';
    let _refreshTimer = null;

    const TYPES = ['iot', 'scada', 'os_agent', 'network', 'camera', 'custom'];

    // ── Initialization ───────────────────────────────────────────────────

    function init() {
        bindEvents();
        refresh();
        _refreshTimer = setInterval(refresh, REFRESH_INTERVAL);
    }

    function refresh() {
        // Status first, so the list knows whether the gateway is off
        loadGatewayStatus().then(loadDevices);
    }

    function bindEvents() {
        var search = document.getElementById('cdap-search');
        if (search) {
            search.addEventListener('input', function () {
                _searchQuery = this.value.trim().toLowerCase();
                renderDevices();
            });
        }

        var filterBtns = document.querySelectorAll('#cdap-type-filter .filter-btn');
        filterBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                filterBtns.forEach(function (b) {
                    b.classList.remove('active');
                    b.setAttribute('aria-pressed', 'false');
                });
                btn.classList.add('active');
                btn.setAttribute('aria-pressed', 'true');
                _activeTypeFilter = btn.dataset.type || '';
                renderDevices();
            });
        });

        var toggleBtn = document.getElementById('cdap-toggle-btn');
        if (toggleBtn) {
            addIcon(toggleBtn, 'disable');
            toggleBtn.addEventListener('click', function () {
                confirmDisable();
            });
        }
        var enableBtn = document.getElementById('cdap-enable-btn');
        if (enableBtn) {
            addIcon(enableBtn, 'enable');
            enableBtn.addEventListener('click', function () {
                toggleCDAP(true, document.getElementById('cdap-enable-status'));
            });
        }
    }

    /** Put the icon of a meaning (Utils.ICONS) before a button's label */
    function addIcon(btn, meaning) {
        if (window.Utils && typeof Utils.icon === 'function' && !btn.querySelector('.material-icons')) {
            btn.insertAdjacentHTML('afterbegin', Utils.icon(meaning));
        }
    }

    function confirmDisable() {
        var connected = _gateway ? (_gateway.connected || 0) : 0;
        var ask = (window.Modal && Modal.confirm)
            ? Modal.confirm({
                title: _i18n('cdap.disable_confirm_title'),
                message: _i18n('cdap.disable_confirm_message', { count: connected }),
                confirmLabel: _i18n('cdap.toggle_disable'),
                danger: true
            })
            : Promise.resolve(false);
        ask.then(function (ok) {
            if (ok) toggleCDAP(false, document.getElementById('cdap-toggle-status'));
        });
    }

    function toggleCDAP(enable, statusEl) {
        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';
        var headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        setStatus(statusEl, _i18n('cdap.saving'), '');
        fetch('/api/cdap/toggle', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ enabled: enable })
        })
        .then(function (r) {
            return r.json().catch(function () { return { success: false, error: r.statusText || String(r.status) }; });
        })
        .then(function (data) {
            if (data.success) {
                var msg = enable ? _i18n('cdap.enabled_restart') : _i18n('cdap.disabled_restart');
                if (data.restartRequired && window.BetterDeskRestart) {
                    window.BetterDeskRestart.handle(data.restartRequired);
                }
                setStatus(statusEl, msg, 'is-ok');
                notify('success', msg);
            } else {
                var errMsg = _i18n('cdap.toggle_failed', { error: data.error || '' });
                setStatus(statusEl, errMsg, 'is-error');
            }
        })
        .catch(function (e) {
            setStatus(statusEl, _i18n('cdap.toggle_failed', { error: e.message }), 'is-error');
        });
    }

    function setStatus(el, text, cls) {
        if (!el) return;
        el.textContent = text || '';
        el.className = 'form-status' + (cls ? ' ' + cls : '');
    }

    function notify(type, msg) {
        if (window.Notifications && Notifications[type]) Notifications[type](msg);
        else if (window.parent !== window && window.parent.Notifications) window.parent.Notifications[type](msg);
    }

    // ── Data Loading ─────────────────────────────────────────────────────

    function loadGatewayStatus() {
        return fetch('/api/cdap/status', { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error(r.statusText || String(r.status));
                return r.json();
            })
            .then(function (data) {
                _gateway = data || {};
                updateGatewayBanner(_gateway);
            })
            .catch(function (e) {
                updateGatewayError(e.message);
            });
    }

    function loadDevices() {
        return fetch('/api/cdap/devices', { credentials: 'same-origin' })
            .then(function (r) {
                if (!r.ok) throw new Error(r.statusText || String(r.status));
                return r.json();
            })
            .then(function (data) {
                if (data && data.success === false) throw new Error(data.error || '');
                _allDevices = (data && data.devices) || [];
                _devicesState = 'ok';
                renderDevices();
            })
            .catch(function (e) {
                _devicesState = 'error';
                _devicesError = e.message || '';
                renderDevices();
            });
    }

    // ── Gateway state ────────────────────────────────────────────────────

    function updateGatewayBanner(data) {
        var banner = document.getElementById('cdap-gateway-banner');
        var disabledBanner = document.getElementById('cdap-disabled-banner');
        var listSection = document.getElementById('cdap-list-section');
        var danger = document.getElementById('cdap-danger-zone');
        var statusEl = document.getElementById('cdap-gw-status');
        var statusText = document.getElementById('cdap-gw-status-text');
        // The side column is about the running gateway; while it is off the main column says so
        var side = document.getElementById('cdap-side');
        if (side) side.classList.toggle('hidden', !data.enabled);

        if (!data.enabled) {
            if (banner) banner.classList.add('hidden');
            if (disabledBanner) disabledBanner.classList.remove('hidden');
            if (listSection) listSection.classList.add('hidden');
            if (danger) danger.classList.add('hidden');
            return;
        }

        if (banner) banner.classList.remove('hidden');
        if (disabledBanner) disabledBanner.classList.add('hidden');
        if (listSection) listSection.classList.remove('hidden');
        if (danger) danger.classList.remove('hidden');

        if (statusEl) statusEl.className = 'status is-good';
        if (statusText) {
            statusText.textContent = data.tls
                ? _i18n('cdap.gateway_running_tls', { port: data.port || '–' })
                : _i18n('cdap.gateway_running_plain', { port: data.port || '–' });
        }
    }

    function updateGatewayError(message) {
        var statusEl = document.getElementById('cdap-gw-status');
        var statusText = document.getElementById('cdap-gw-status-text');
        if (statusEl) statusEl.className = 'status is-danger';
        if (statusText) statusText.textContent = _i18n('cdap.gateway_status_failed', { error: message || '' });
    }

    // ── Rendering ────────────────────────────────────────────────────────

    function stateRow(text, isError) {
        var retry = isError
            ? ' <button type="button" class="btn btn-sm" id="cdap-retry">' + escapeHtml(_i18n('cdap.try_again')) + '</button>'
            : '';
        return '<tr><td colspan="7" class="state-cell' + (isError ? ' is-error' : '') + '"><span class="state-text">' + escapeHtml(text) + retry + '</span></td></tr>';
    }

    function renderDevices() {
        var tbody = document.getElementById('cdap-device-grid');
        var countEl = document.getElementById('cdap-count');
        if (!tbody) return;

        if (_devicesState === 'loading') return;
        if (_devicesState === 'error') {
            if (countEl) countEl.textContent = '';
            tbody.innerHTML = stateRow(_i18n('cdap.devices_failed', { error: _devicesError }), true);
            var retry = document.getElementById('cdap-retry');
            if (retry) retry.addEventListener('click', refresh);
            return;
        }

        var filtered = _allDevices.filter(function (dev) {
            if (_activeTypeFilter) {
                var devType = getDeviceType(dev);
                if (devType !== _activeTypeFilter) return false;
            }
            if (_searchQuery) {
                var searchable = [
                    dev.id || '',
                    getDeviceName(dev),
                    getDeviceType(dev),
                    dev.username || '',
                    dev.client_ip || ''
                ].join(' ').toLowerCase();
                if (searchable.indexOf(_searchQuery) === -1) return false;
            }
            return true;
        });

        if (countEl) {
            var connected = _allDevices.filter(function (d) { return d.connected !== false; }).length;
            countEl.textContent = !_allDevices.length ? ''
                : (filtered.length !== _allDevices.length
                    ? _i18n('cdap.count_filtered', { count: filtered.length, total: _allDevices.length })
                    : _i18n('cdap.count_devices', { count: _allDevices.length, connected: connected }));
        }

        if (filtered.length === 0) {
            tbody.innerHTML = stateRow(_allDevices.length
                ? _i18n('cdap.no_devices_match')
                : _i18n('cdap.no_devices_desc'), false);
            return;
        }

        tbody.innerHTML = filtered.map(renderDeviceRow).join('');
    }

    function renderDeviceRow(dev) {
        var rawId = dev.id || '';
        var id = escapeHtml(rawId);
        var name = escapeHtml(getDeviceName(dev));
        var type = getDeviceType(dev);
        var connected = dev.connected !== false;
        var statusText = connected ? _i18n('cdap.connected') : _i18n('cdap.disconnected');
        var href = '/cdap/devices/' + encodeURIComponent(rawId);

        // Shared data display (utils.js): status tone, type tag, address, numbers
        var uptime = connected && dev.connected_at
            ? Utils.formatDuration((Date.now() - Utils.parseDate(dev.connected_at).getTime()) / 1000) : '';
        return '<tr data-id="' + id + '">' +
            '<td><a href="' + escapeHtml(href) + '" class="cdap-device-link">' + name + '</a>' +
                (name !== id ? '<span class="cell-sub">' + Utils.valueHtml(rawId) + '</span>' : '') + '</td>' +
            '<td>' + Utils.tagHtml(typeLabel(type)) + '</td>' +
            '<td>' + Utils.statusHtml(connected ? 'good' : 'neutral', statusText) + '</td>' +
            '<td>' + Utils.valueHtml(dev.client_ip) + '</td>' +
            '<td>' + (uptime ? escapeHtml(uptime) : Utils.emptyHtml()) + '</td>' +
            '<td class="is-num">' + escapeHtml(Utils.formatNumber(countWidgets(dev))) + '</td>' +
            '<td class="is-num">' + (connected ? escapeHtml(Utils.formatNumber(dev.heartbeat_count || 0)) : Utils.emptyHtml()) + '</td>' +
        '</tr>';
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function manifestOf(dev) {
        if (!dev.manifest) return null;
        try {
            return typeof dev.manifest === 'string' ? JSON.parse(dev.manifest) : dev.manifest;
        } catch (e) { return null; }
    }

    function getDeviceName(dev) {
        var m = manifestOf(dev);
        if (m && m.device && m.device.name) return m.device.name;
        return dev.id || '–';
    }

    function getDeviceType(dev) {
        var m = manifestOf(dev);
        if (m && m.device && m.device.type) return m.device.type;
        return 'custom';
    }

    function typeLabel(type) {
        return TYPES.indexOf(type) >= 0 ? _i18n('cdap.type_' + type) : type;
    }

    function countWidgets(dev) {
        var m = manifestOf(dev);
        if (m && Array.isArray(m.widgets)) return m.widgets.length;
        return 0;
    }

    function _i18n(key, params) {
        if (typeof window._ === 'function') return window._(key, params || {});
        var parts = key.split('.');
        return parts[parts.length - 1];
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // ── Public API ───────────────────────────────────────────────────────

    window.CDAPDevices = {
        init: init,
        refresh: refresh
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
