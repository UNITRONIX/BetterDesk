/**
 * BetterDesk Console - CDAP Devices List
 * Renders the CDAP device directory with live status, type filters, and search.
 */
(function () {
    'use strict';

    const REFRESH_INTERVAL = 10000; // 10s
    let _allDevices = [];
    let _gatewayEnabled = false;
    let _activeTypeFilter = '';
    let _searchQuery = '';
    let _refreshTimer = null;

    // ── Device type icons ────────────────────────────────────────────────

    const TYPE_ICONS = {
        scada: 'precision_manufacturing',
        iot: 'sensors',
        os_agent: 'computer',
        network: 'router',
        camera: 'videocam',
        desktop: 'desktop_windows',
        custom: 'developer_board'
    };

    // ── Initialization ───────────────────────────────────────────────────

    function init() {
        bindEvents();
        loadGatewayStatus();
        loadDevices();
        _refreshTimer = setInterval(function () {
            loadGatewayStatus();
            loadDevices();
        }, REFRESH_INTERVAL);
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
                filterBtns.forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                _activeTypeFilter = btn.dataset.type || '';
                renderDevices();
            });
        });

        // CDAP enable/disable toggle buttons
        var toggleBtn = document.getElementById('cdap-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', function () {
                toggleCDAP(false);
            });
        }
        var enableBtn = document.getElementById('cdap-enable-btn');
        if (enableBtn) {
            enableBtn.addEventListener('click', function () {
                toggleCDAP(true);
            });
        }
    }

    function toggleCDAP(enable) {
        var csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';
        var headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        fetch('/api/cdap/toggle', {
            method: 'POST',
            credentials: 'same-origin',
            headers: headers,
            body: JSON.stringify({ enabled: enable })
        })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            if (data.success) {
                var msg = enable ? _i18n('cdap.enabled_restart') : _i18n('cdap.disabled_restart');
                if (data.restartRequired && window.BetterDeskRestart) {
                    window.BetterDeskRestart.handle(data.restartRequired);
                }
                if (window.BetterDesk && window.BetterDesk.notify) {
                    window.BetterDesk.notify(msg, 'info');
                } else if (window.parent !== window && window.parent.BetterDesk && window.parent.BetterDesk.notify) {
                    window.parent.BetterDesk.notify(msg, 'info');
                } else {
                    console.log('[CDAP]', msg);
                }
            } else {
                var errMsg = data.error || 'Failed';
                if (window.BetterDesk && window.BetterDesk.notify) {
                    window.BetterDesk.notify(errMsg, 'error');
                }
            }
        })
        .catch(function () {});
    }

    // ── Data Loading ─────────────────────────────────────────────────────

    function loadGatewayStatus() {
        fetch('/api/cdap/status', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                _gatewayEnabled = data.enabled;
                updateGatewayBanner(data);
            })
            .catch(function () { /* ignore */ });
    }

    function loadDevices() {
        var loadingEl = document.getElementById('cdap-list-loading');
        fetch('/api/cdap/devices', { credentials: 'same-origin' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (loadingEl) loadingEl.classList.add('hidden');
                if (!data) {
                    _allDevices = [];
                    renderDevices();
                    return;
                }
                _allDevices = data.devices || [];
                renderDevices();
            })
            .catch(function () {
                if (loadingEl) loadingEl.classList.add('hidden');
                _allDevices = [];
                renderDevices();
            });
    }

    // ── Gateway Banner ───────────────────────────────────────────────────

    function updateGatewayBanner(data) {
        var banner = document.getElementById('cdap-gateway-banner');
        var disabledBanner = document.getElementById('cdap-disabled-banner');
        var statusEl = document.getElementById('cdap-gw-status');
        var statusText = document.getElementById('cdap-gw-status-text');
        var connEl = document.getElementById('cdap-stat-connected');
        var portEl = document.getElementById('cdap-stat-port');
        var tlsEl = document.getElementById('cdap-stat-tls');

        if (!data.enabled) {
            if (banner) banner.classList.add('hidden');
            if (disabledBanner) disabledBanner.classList.remove('hidden');
            return;
        }

        if (banner) banner.classList.remove('hidden');
        if (disabledBanner) disabledBanner.classList.add('hidden');

        if (statusEl) {
            statusEl.className = 'cdap-gateway-status online';
        }
        if (statusText) {
            statusText.textContent = _i18n('cdap.gateway_active');
        }
        if (connEl) connEl.textContent = data.connected || 0;
        if (portEl) portEl.textContent = data.port || '—';
        if (tlsEl) tlsEl.textContent = data.tls ? 'ON' : 'OFF';
    }

    // ── Rendering ────────────────────────────────────────────────────────

    function renderDevices() {
        var grid = document.getElementById('cdap-device-grid');
        var emptyEl = document.getElementById('cdap-list-empty');
        if (!grid) return;

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

        if (filtered.length === 0 && !_gatewayEnabled) {
            grid.innerHTML = '';
            if (emptyEl) emptyEl.classList.add('hidden');
            return;
        }

        if (filtered.length === 0) {
            grid.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');

        grid.innerHTML = filtered.map(function (dev) {
            return renderDeviceCard(dev);
        }).join('');

        // Bind card clicks
        grid.querySelectorAll('.cdap-device-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var id = card.dataset.id;
                if (id) window.location.href = '/cdap/devices/' + encodeURIComponent(id);
            });
        });
    }

    function renderDeviceCard(dev) {
        var id = escapeHtml(dev.id || '');
        var name = escapeHtml(getDeviceName(dev));
        var type = getDeviceType(dev);
        var icon = TYPE_ICONS[type] || 'developer_board';
        var connected = dev.connected !== false;
        var statusClass = connected ? 'online' : 'offline';
        var statusText = connected ? _i18n('cdap.connected') : _i18n('cdap.disconnected');
        var widgetCount = countWidgets(dev);
        var uptime = formatUptime(dev.connected_at);
        var ip = escapeHtml(dev.client_ip || '—');
        var heartbeats = dev.heartbeat_count || 0;

        return '<div class="cdap-device-card ' + statusClass + '" data-id="' + id + '">' +
            '<div class="cdap-card-header">' +
                '<div class="cdap-card-icon"><span class="material-icons">' + icon + '</span></div>' +
                '<div class="cdap-card-identity">' +
                    '<div class="cdap-card-name">' + name + '</div>' +
                    '<div class="cdap-card-id">' + id + '</div>' +
                '</div>' +
                '<div class="cdap-card-status ' + statusClass + '">' +
                    '<span class="cdap-status-dot"></span>' +
                    '<span>' + statusText + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="cdap-card-meta">' +
                '<div class="cdap-card-meta-item">' +
                    '<span class="material-icons">category</span>' +
                    '<span>' + escapeHtml(type) + '</span>' +
                '</div>' +
                '<div class="cdap-card-meta-item">' +
                    '<span class="material-icons">widgets</span>' +
                    '<span>' + widgetCount + ' ' + _i18n('cdap.widgets') + '</span>' +
                '</div>' +
                (connected ? '<div class="cdap-card-meta-item">' +
                    '<span class="material-icons">schedule</span>' +
                    '<span>' + uptime + '</span>' +
                '</div>' : '') +
                '<div class="cdap-card-meta-item">' +
                    '<span class="material-icons">lan</span>' +
                    '<span>' + ip + '</span>' +
                '</div>' +
            '</div>' +
            (connected ? '<div class="cdap-card-footer">' +
                '<span class="cdap-card-hb">' +
                    '<span class="material-icons">favorite</span> ' + heartbeats +
                '</span>' +
                '<span class="material-icons cdap-card-arrow">chevron_right</span>' +
            '</div>' : '<div class="cdap-card-footer">' +
                '<span class="cdap-card-hb muted">' + _i18n('cdap.disconnected') + '</span>' +
                '<span class="material-icons cdap-card-arrow">chevron_right</span>' +
            '</div>') +
        '</div>';
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    function getDeviceName(dev) {
        if (dev.manifest) {
            try {
                var m = typeof dev.manifest === 'string' ? JSON.parse(dev.manifest) : dev.manifest;
                if (m.device && m.device.name) return m.device.name;
            } catch (e) { /* ignore */ }
        }
        return dev.id || '—';
    }

    function getDeviceType(dev) {
        if (dev.manifest) {
            try {
                var m = typeof dev.manifest === 'string' ? JSON.parse(dev.manifest) : dev.manifest;
                if (m.device && m.device.type) return m.device.type;
            } catch (e) { /* ignore */ }
        }
        return 'custom';
    }

    function countWidgets(dev) {
        if (dev.manifest) {
            try {
                var m = typeof dev.manifest === 'string' ? JSON.parse(dev.manifest) : dev.manifest;
                if (m.widgets && Array.isArray(m.widgets)) return m.widgets.length;
            } catch (e) { /* ignore */ }
        }
        return 0;
    }

    function formatUptime(connectedAt) {
        if (!connectedAt) return '—';
        var diff = Math.floor((Date.now() - new Date(connectedAt).getTime()) / 1000);
        if (diff < 60) return diff + 's';
        if (diff < 3600) return Math.floor(diff / 60) + 'm';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ' + Math.floor((diff % 3600) / 60) + 'm';
        return Math.floor(diff / 86400) + 'd ' + Math.floor((diff % 86400) / 3600) + 'h';
    }

    function _i18n(key) {
        if (typeof _ === 'function') return _(key);
        // Fallback: extract last part of key
        var parts = key.split('.');
        return parts[parts.length - 1];
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Public API ───────────────────────────────────────────────────────

    window.CDAPDevices = {
        init: init,
        refresh: function () {
            loadGatewayStatus();
            loadDevices();
        }
    };

    // Auto-init when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
