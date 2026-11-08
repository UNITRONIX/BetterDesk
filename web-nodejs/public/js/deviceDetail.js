/**
 * BetterDesk Console - Device Detail Panel
 * Full workspace modal for device management.
 *
 * Usage:
 *   DeviceDetail.open(deviceId)   — opens the panel
 *   DeviceDetail.close()          — closes the panel
 *
 * Dispatches 'deviceDetail:changed' on document when device is modified.
 */

const DeviceDetail = (function () {
    'use strict';

    document.addEventListener('devices:updated', function (event) {
        const detail = event.detail || {};
        if (!device || !detail.id || device.id !== detail.id) return;

        if (typeof detail.display_name === 'string') {
            device.display_name = detail.display_name;
        }
        if (typeof detail.note === 'string') {
            device.note = detail.note;
        }
        if (Array.isArray(detail.tags)) {
            device.tags = detail.tags;
        }
        if (typeof detail.online === 'boolean' || detail.status || detail.live_status) {
            device.online = detail.online ?? device.online;
            device.status = detail.status || device.status;
            device.live_status = detail.live_status || detail.status || device.live_status;
        }

        // While editing, the fields keep what the user typed
        if (!editMode) _render();
    });

    document.addEventListener('devices:live-status', function (event) {
        const detail = event.detail || {};
        if (!device || !detail.id || device.id !== detail.id) return;
        const normalized = String(detail.status || '').toLowerCase();
        device.live_status = normalized;
        device.online = normalized === 'online';
        device.status = normalized;
        const statusBar = overlayEl?.querySelector('.device-panel-status-bar');
        if (statusBar) {
            const statusInfo = _resolveDeviceStatus(device);
            const badge = statusBar.querySelector('.device-panel-status-badge');
            if (badge) {
                badge.className = 'device-panel-status-badge status ' + statusInfo.className;
                if (statusInfo.title) badge.title = statusInfo.title;
                else badge.removeAttribute('title');
                badge.textContent = statusInfo.label;
            }
        }
    });

    document.addEventListener('devices:id-changed', function (event) {
        const detail = event.detail || {};
        if (!device || !detail.old_id || device.id !== detail.old_id) return;
        const newId = detail.new_id;
        if (!newId) return;
        device.id = newId;
        _stopRefresh();
        _startRefresh(newId);
        const titleEl = overlayEl?.querySelector('.device-panel-device-id');
        if (titleEl) titleEl.textContent = newId;
        const copyBtn = overlayEl?.querySelector('.device-panel-copy-btn[data-copy]');
        if (copyBtn) copyBtn.dataset.copy = newId;
    });

    // ──────────────────────────────────────────────────────────────────────
    // State
    // ──────────────────────────────────────────────────────────────────────
    let overlayEl = null;
    let device = null;
    let activeTab = 'overview';
    let liveView = 'services';
    // Views inside the "Live data" tab, read from the device's agent on demand
    const AGENT_TABS = ['services', 'processes', 'events', 'activity', 'files'];
    let refreshTimer = null;
    let availableTags = [];
    let availableTagsLoaded = false;
    let availabilityDay = null; // YYYY-MM-DD (browser-local)
    let availabilityData = null;
    let availabilityLoading = false;
    let connectionSessionsData = null;
    let connectionSessionsLoading = false;
    // The agent's inventory report (GET /api/inventory/:id), shown in the hardware tab:
    // { id, data } when there is one, { id, none: true } when the agent never sent one, { id, error }
    let inventoryData = null;
    let inventoryLoading = false;
    // Edit mode: the overview's name, note, folder and tags become fields; the footer is Cancel / Save
    let editMode = false;
    let editState = null;      // { name, note, folder, tags: [], tagInput }
    let editInitial = '';      // snapshot to tell whether something changed
    let editSaving = false;
    let editFolders = null;    // [{ id, name }] when the page has no folder list of its own

    // ──────────────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────────────

    /**
     * Open device detail panel for the given device ID.
     * @param {string} deviceId
     */
    function _localDayString(date) {
        const d = date || new Date();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function _shiftDay(dayStr, delta) {
        const parts = String(dayStr || '').split('-').map(Number);
        const d = new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
        d.setDate(d.getDate() + delta);
        return _localDayString(d);
    }

    async function _loadAvailability(dayStr) {
        if (!device || !device.id) return;
        availabilityLoading = true;
        availabilityDay = dayStr || availabilityDay || _localDayString();
        try {
            const data = await Utils.api(
                '/api/devices/' + encodeURIComponent(device.id) + '/availability'
                + '?day=' + encodeURIComponent(availabilityDay)
                + '&tz_offset=' + encodeURIComponent(String(new Date().getTimezoneOffset()))
            );
            availabilityData = data || null;
        } catch (err) {
            console.warn('DeviceDetail: availability load failed', err);
            availabilityData = { enabled: false, events: [], error: err.message || 'error' };
        } finally {
            availabilityLoading = false;
        }
    }

    async function _loadConnectionSessions() {
        if (!device || !device.id) return;
        connectionSessionsLoading = true;
        try {
            const data = await Utils.api(
                '/api/devices/' + encodeURIComponent(device.id) + '/connection-sessions?limit=50'
            );
            connectionSessionsData = data || null;
        } catch (err) {
            console.warn('DeviceDetail: connection sessions load failed', err);
            connectionSessionsData = { sessions: [], error: err.message || 'error' };
        } finally {
            connectionSessionsLoading = false;
        }
    }

    // options.tab: the tab to show first (the inventory page opens on 'hardware')
    async function open(deviceId, options) {
        if (!deviceId) return;
        activeTab = (options && options.tab) || 'overview';
        inventoryData = null;
        editMode = false;
        editState = null;
        liveView = 'services';
        availabilityDay = _localDayString();
        availabilityData = null;
        connectionSessionsData = null;
        _createOverlay();
        _showLoading();
        _show();
        document.body.classList.add('device-detail-open');

        try {
            device = await Utils.api('/api/devices/' + encodeURIComponent(deviceId));
            await Promise.all([
                _loadAvailability(availabilityDay),
                _loadConnectionSessions()
            ]);
            _render();
        } catch (err) {
            console.error('DeviceDetail: failed to load device', err);
            Notifications.error(err.message || _('errors.load_device_failed'));
            close();
        }

        // Auto-refresh every 15 s while panel is open
        _startRefresh(deviceId);
    }

    /**
     * Close the panel.
     */
    function close() {
        _stopRefresh();
        editMode = false;
        editState = null;
        document.body.classList.remove('device-detail-open');
        if (overlayEl) {
            if (overlayEl._escHandler) {
                document.removeEventListener('keydown', overlayEl._escHandler);
            }
            const opener = overlayEl._opener;
            if (opener && document.contains(opener) && typeof opener.focus === 'function') {
                opener.focus({ preventScroll: true });
            }
            overlayEl.classList.remove('open');
            setTimeout(() => {
                if (overlayEl) {
                    overlayEl.remove();
                    overlayEl = null;
                }
            }, 300);
        }
        device = null;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Overlay / skeleton
    // ──────────────────────────────────────────────────────────────────────

    function _createOverlay() {
        if (overlayEl) overlayEl.remove();

        overlayEl = document.createElement('div');
        overlayEl.className = 'sheet-layer device-panel-overlay';
        overlayEl.innerHTML = '<div class="sheet device-panel" id="device-panel-inner" role="dialog" aria-modal="true" aria-labelledby="device-panel-title" tabindex="-1"></div>';
        overlayEl._opener = document.activeElement;
        overlayEl._focused = false;

        // Keep Tab inside the panel while it is open
        overlayEl.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab') return;
            const panel = overlayEl.querySelector('#device-panel-inner');
            const focusable = Array.from(panel.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(el => el.offsetParent !== null);
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        });

        // Close on overlay click — skip if a modal dialog is open on top
        overlayEl.addEventListener('click', function (e) {
            if (e.target === overlayEl) {
                if (document.querySelector('.modal-overlay.open, .modal-container.open')) return;
                _requestClose();
            }
        });

        // Escape key — skip if a modal dialog is open on top
        overlayEl._escHandler = function (e) {
            if (e.key === 'Escape') {
                if (document.querySelector('.modal-overlay.open, .modal-container.open')) return;
                // In edit mode Escape leaves editing (asking first when something changed)
                if (editMode) { _cancelEdit(true); return; }
                close();
            }
        };
        document.addEventListener('keydown', overlayEl._escHandler);

        document.body.appendChild(overlayEl);
    }

    function _show() {
        requestAnimationFrame(() => {
            if (overlayEl) overlayEl.classList.add('open');
        });
    }

    function _showLoading() {
        const inner = overlayEl.querySelector('#device-panel-inner');
        inner.innerHTML = `
            <div class="device-panel-loading">
                <div class="device-panel-spinner"></div>
                <div class="device-panel-loading-text">${_('common.loading')}</div>
            </div>`;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Render
    // ──────────────────────────────────────────────────────────────────────

    function _render() {
        if (!overlayEl || !device) return;
        const inner = overlayEl.querySelector('#device-panel-inner');

        // Auto-refresh re-renders the panel; keep keyboard focus where it was
        const focusedAction = document.activeElement && inner.contains(document.activeElement)
            ? (document.activeElement.id || document.activeElement.dataset.tab || document.activeElement.dataset.liveView || document.activeElement.dataset.action || '')
            : '';

        if (editMode) _captureEditForm(inner);

        // The program search in the hardware tab keeps its text across the refresh
        const appSearch = inner.querySelector('#dp-inv-apps-search');
        const appQuery = appSearch ? appSearch.value : '';

        inner.innerHTML = _headerHTML() + _tabsHTML() + _contentHTML() + _footerHTML();
        // The agent panes were just rebuilt empty: load them again when shown
        Object.keys(_agentTabLoaded).forEach(function (k) { delete _agentTabLoaded[k]; });

        _attachEvents();
        _wireInventory(inner, appQuery);
        _bindAvailabilityControls();
        _switchTab(activeTab);
        _renderUsageChart();

        if (!overlayEl._focused) {
            overlayEl._focused = true;
            const closeBtn = inner.querySelector('.device-panel-close');
            if (closeBtn) closeBtn.focus({ preventScroll: true });
        } else if (focusedAction) {
            const again = inner.querySelector('#' + CSS.escape(focusedAction)) ||
                inner.querySelector(`[data-tab="${CSS.escape(focusedAction)}"], [data-live-view="${CSS.escape(focusedAction)}"], [data-action="${CSS.escape(focusedAction)}"]`);
            if (again) again.focus({ preventScroll: true });
        }
    }

    // ── Header ──

    function _resolveDeviceStatus(d) {
        if (d.soft_deleted) {
            return { className: 'deleted', label: _('devices.deleted_badge'), title: '' };
        }
        if (d.banned) {
            return { className: 'banned', label: _('status.banned'), title: '' };
        }
        if (d.online) {
            const tier = (d.status_tier || 'online').toLowerCase();
            if (tier === 'degraded' || tier === 'critical') {
                return { className: tier, label: _('status.' + tier), title: '' };
            }
            return { className: 'online', label: _('status.online'), title: '' };
        }
        if (d.no_signal) {
            return {
                className: 'no_signal',
                label: _('status.no_signal'),
                title: _('devices.no_signal_tooltip')
            };
        }
        return { className: 'offline', label: _('status.offline'), title: '' };
    }

    function _headerHTML() {
        const d = device;
        const platformLabel = d.platform || d.os || '-';
        const statusInfo = _resolveDeviceStatus(d);
        const statusClass = statusInfo.className;
        const statusLabel = statusInfo.label;
        const statusTitle = statusInfo.title;

        return `
        <div class="device-panel-header">
            <div class="device-panel-header-top">
                <div class="device-panel-identity">
                    <h2 class="device-panel-title" id="device-panel-title">${Utils.escapeHtml(d.display_name || d.hostname || d.note || d.id)}</h2>
                    <div class="device-panel-id-row">
                        <span class="device-panel-device-id mono">${Utils.escapeHtml(d.id)}</span>
                        <button type="button" class="device-panel-copy-btn copy-btn" data-copy="${Utils.escapeHtml(d.id)}" title="${_('actions.copy')}" aria-label="${_('actions.copy')} ${Utils.escapeHtml(d.id)}">
                            <span class="material-icons" aria-hidden="true">content_copy</span>
                        </button>
                    </div>
                </div>
                <button type="button" class="device-panel-close btn-icon" title="${_('actions.close')}" aria-label="${_('actions.close')}">
                    <span class="material-icons" aria-hidden="true">close</span>
                </button>
            </div>
            <div class="device-panel-status-bar">
                <span class="device-panel-status-badge status ${statusClass}"${statusTitle ? ` title="${Utils.escapeHtml(statusTitle)}"` : ''}>${statusLabel}</span>
                <span class="device-panel-platform-badge">
                    ${Utils.getPlatformIconHtml(d.platform || d.os)}
                    ${Utils.escapeHtml(platformLabel)}
                </span>
                ${d.username ? `<span class="device-panel-user">${Utils.escapeHtml(d.username)}</span>` : ''}
            </div>
        </div>`;
    }

    // ── Tabs ──

    function _liveViews() {
        const identity = device?.telemetry?.snapshots?.identity?.data || {};
        if (_isSupportAgent(identity)) return [];
        // Browsing files goes through a route that needs device.edit
        return AGENT_TABS.filter(id => id !== 'files' || _can('device.edit'));
    }

    function _tabsHTML() {
        // Five agent views share one "Live data" tab so the row fits the panel
        const tabs = [
            { id: 'overview', label: _('device_detail.tab_overview') },
            { id: 'hardware', label: _('device_detail.tab_hardware') },
            { id: 'metrics',  label: _('device_detail.tab_metrics') },
            { id: 'live',     label: _('device_detail.tab_live') },
            { id: 'tags',     label: _('device_detail.tab_tags') },
            { id: 'actions',  label: _('device_detail.tab_actions') }
        ].filter(tab => tab.id !== 'live' || _liveViews().length > 0)
         .filter(tab => tab.id !== 'actions' || _hasActions());
        return `<div class="device-panel-tabs" role="tablist">` +
            tabs.map(t =>
                `<button type="button" class="device-panel-tab${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}" role="tab" aria-selected="${t.id === activeTab ? 'true' : 'false'}">${t.label}</button>`
            ).join('') +
            `</div>`;
    }

    // ── Content ──

    function _contentHTML() {
        return `<div class="device-panel-content">
            ${_overviewPane()}
            ${_hardwarePane()}
            ${_metricsPane()}
            ${_livePane()}
            ${_tagsPane()}
            ${_actionsPane()}
        </div>`;
    }

    function _livePane() {
        const views = _liveViews();
        if (!views.length) return '';
        return `<div class="device-panel-tab-pane" data-pane="live">
            <div class="view-switch device-panel-live-switch" role="group" aria-label="${Utils.escapeHtml(_('device_detail.tab_live'))}">
                ${views.map(id => `<button type="button" data-live-view="${id}" aria-pressed="${id === liveView ? 'true' : 'false'}">${_('device_detail.tab_' + id)}</button>`).join('')}
            </div>
            <p class="device-panel-live-note">${Utils.escapeHtml(_('device_detail.live_note'))}</p>
            ${views.map(id => _agentPane(id)).join('')}
        </div>`;
    }

    // ── Live-agent tabs (lazy loaded) ────────────────────────────────────
    //
    // These panes are populated on first tab activation by `_loadAgentTab()`.
    // Keeping them in separate functions would duplicate 200+ lines of
    // boilerplate. Instead, each pane is a placeholder that shows an empty
    // state and a "Load" button; real data is fetched when tab is shown.

    function _agentPane(paneId) {
        return `<div class="device-panel-live-view" data-live-pane="${paneId}">
            <div class="device-panel-agent-pane" data-agent-pane="${paneId}">
                <div class="device-panel-agent-loading">${_('common.loading')}</div>
            </div>
        </div>`;
    }

    // ── Overview tab ──

    function _overviewPane() {
        const d = device;
        const snapshots = d.telemetry?.snapshots || {};
        const identity = snapshots.identity?.data || {};
        const telemetryMetrics = snapshots.metrics?.data || {};
        const currentMetrics = d.metrics || (Object.keys(telemetryMetrics).length > 0 ? {
            cpu_usage: telemetryMetrics.cpu_percent,
            memory_usage: telemetryMetrics.memory_percent,
            disk_usage: telemetryMetrics.disk_percent,
            updated_at: snapshots.metrics?.collected_at
        } : null);
        let html = `<div class="device-panel-tab-pane" data-pane="overview">`;
        if (editMode) html += _editFormHTML();

        // Ban alert
        if (d.banned) {
            html += `
            <div class="device-panel-ban-alert" role="note">
                <div class="device-panel-ban-alert-text">
                    <div class="device-panel-ban-alert-title">${_('device_detail.device_banned')}</div>
                    <div class="device-panel-ban-alert-when">${Utils.escapeHtml(_banLine(d))}</div>
                    <div class="device-panel-ban-alert-reason">${d.ban_reason
                        ? Utils.escapeHtml(_('device_detail.ban_reason_line', { reason: d.ban_reason }))
                        : _('device_detail.no_reason')}</div>
                </div>
            </div>`;
        }

        // Quick metrics summary (if available)
        if (currentMetrics) {
            html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title"><span class="material-icons">monitoring</span> ${_('device_detail.section_live_metrics')}</div>
                <div class="device-panel-metrics-grid">
                    ${_metricCard('CPU', currentMetrics.cpu_usage, 'speed')}
                    ${_metricCard(_('device_detail.metric_memory'), currentMetrics.memory_usage, 'memory')}
                    ${_metricCard(_('device_detail.metric_disk'), currentMetrics.disk_usage, 'storage')}
                </div>
                ${currentMetrics.updated_at ? `<div class="device-panel-metrics-updated">${_('device_detail.metrics_updated')} ${Utils.formatRelativeTime(currentMetrics.updated_at)}</div>` : ''}
            </div>`;
        }

        // Identity section
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title"><span class="material-icons">badge</span> ${_('device_detail.section_identity')}</div>
            <div class="device-panel-info-grid">
                ${_infoRow(_('devices.id'), `<span class="mono">${Utils.escapeHtml(d.id)}</span>`, d.id)}
                ${editMode ? '' : _infoRow(_('devices.display_name'), d.display_name ? Utils.escapeHtml(d.display_name) : Utils.emptyHtml())}
                ${_infoRow(_('devices.hostname'), (d.hostname || d.note) ? Utils.escapeHtml(d.hostname || d.note) : Utils.emptyHtml())}
                ${_infoRow(_('devices.username'), d.username ? Utils.userHtml(d.username) : Utils.emptyHtml())}
                ${d.uuid ? _infoRow('UUID', Utils.valueHtml(d.uuid, { copy: true, label: 'UUID' })) : ''}
                ${_infoRow(_('devices.platform'), Utils.platformHtml(d.platform || d.os || (d.sysinfo && d.sysinfo.platform) || ''))}
                ${d.sysinfo && d.sysinfo.version ? _infoRow(_('device_detail.version'), Utils.versionHtml(d.sysinfo.version)) : ''}
                ${identity.product_sku ? _infoRow('SKU', Utils.escapeHtml(identity.product_sku)) : ''}
                ${identity.conn_mode ? _infoRow(_('device_detail.client_mode'), Utils.escapeHtml(identity.conn_mode)) : ''}
                ${Array.isArray(identity.capabilities) && identity.capabilities.length
                    ? _infoRow(_('device_detail.capabilities'), Utils.escapeHtml(identity.capabilities.join(', '))) : ''}
            </div>
        </div>`;

        html += _connectionModeSection(d, identity);

        // Network section
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title"><span class="material-icons">lan</span> ${_('device_detail.section_network')}</div>
            <div class="device-panel-info-grid">
                ${_infoRow(_('devices.ip_address'), d.ip ? `<span class="mono">${Utils.escapeHtml(d.ip)}</span>` : Utils.emptyHtml(), d.ip)}
                ${_infoRow(_('device_detail.folder'), _folderName(d.folder_id))}
                ${d.groups && d.groups.length > 0 ? _infoRow(_('device_detail.device_groups'), Utils.tagsHtml(d.groups.map(g => g.name || g.guid))) : ''}
            </div>
        </div>`;

        // Timestamps
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title"><span class="material-icons">schedule</span> ${_('device_detail.section_timestamps')}</div>
            <div class="device-panel-info-grid">
                ${_infoRow(_('devices.first_seen'), Utils.timeHtml(d.created_at, { relative: false }))}
                ${_infoRow(_('devices.last_seen'), _lastSeenValue(d.last_online))}
                ${d.status_tier && d.status_tier.toLowerCase() !== 'online' && d.status_tier.toLowerCase() !== 'offline'
                    ? _infoRow(_('device_detail.status_tier'), _statusTierBadge(d.status_tier.toLowerCase()))
                    : ''}
            </div>
        </div>`;

        html += `</div>`;
        return html;
    }

    // ── Hardware tab (sysinfo data) ──

    function _hardwarePane() {
        const d = device;
        const hardwareSnapshot = d.telemetry?.snapshots?.hardware;
        const s = d.sysinfo || hardwareSnapshot?.data || {};
        let html = `<div class="device-panel-tab-pane" data-pane="hardware">`;
        const inventoryHtml = _inventoryHTML();

        if (!d.sysinfo && !hardwareSnapshot) {
            // Nothing from the client; the agent's report (if any) is the whole tab
            if (inventoryHtml) {
                html += inventoryHtml + `</div>`;
                return html;
            }
            html += `
            <div class="device-panel-empty-state">
                <span class="material-icons">memory</span>
                <p>${_('device_detail.no_sysinfo')}</p>
                <p class="device-panel-empty-hint">${_('device_detail.no_sysinfo_hint')}</p>
            </div>`;
            html += `</div>`;
            return html;
        }

        // System section
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title">
                <span class="material-icons">computer</span> ${_('device_detail.section_system')}
                ${_can('device.edit') ? `<button type="button" class="btn btn-sm device-panel-inline-action" data-refresh-hardware>${Utils.icon('refresh')}${_('device_detail.read_again')}</button>` : ''}
            </div>
            <div class="device-panel-info-grid">
                ${s.hostname ? _infoRow(_('devices.hostname'), Utils.escapeHtml(s.hostname)) : ''}
                ${s.username ? _infoRow(_('devices.username'), Utils.escapeHtml(s.username)) : ''}
                ${s.os_full ? _infoRow(_('device_detail.os'), Utils.escapeHtml(s.os_full)) : ''}
                ${s.platform ? _infoRow(_('devices.platform'), Utils.escapeHtml(s.platform)) : ''}
                ${s.version ? _infoRow(_('device_detail.version'), Utils.escapeHtml(s.version)) : ''}
                ${s.vendor ? _infoRow(_('device_detail.vendor'), Utils.escapeHtml(s.vendor)) : ''}
                ${s.domain ? _infoRow(_('device_detail.domain'), Utils.escapeHtml(s.domain)) : ''}
                ${s.cpu ? _infoRow('CPU', Utils.escapeHtml(s.cpu)) : ''}
                ${s.memory ? _infoRow(_('device_detail.total_memory'), Utils.escapeHtml(s.memory)) : ''}
                ${hardwareSnapshot?.status && hardwareSnapshot.status !== 'ok'
                    ? _infoRow(_('device_detail.read_status'), Utils.escapeHtml(hardwareSnapshot.status)) : ''}
            </div>
        </div>`;

        // CPU section, only when the device reported something for it (no heading over nothing)
        if (s.cpu_name || s.cpu_cores || s.cpu_freq_ghz) {
            html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title"><span class="material-icons">speed</span> ${_('device_detail.section_cpu')}</div>
            <div class="device-panel-info-grid">
                ${s.cpu_name ? _infoRow(_('device_detail.cpu_model'), Utils.escapeHtml(s.cpu_name)) : ''}
                ${s.cpu_cores ? _infoRow(_('device_detail.cpu_cores'), Utils.escapeHtml(String(s.cpu_cores))) : ''}
                ${s.cpu_freq_ghz ? _infoRow(_('device_detail.cpu_freq'), _formatFreq(s.cpu_freq_ghz)) : ''}
            </div>
        </div>`;
        }

        // Memory section
        if (s.memory_gb) {
            html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title"><span class="material-icons">memory</span> ${_('device_detail.section_memory')}</div>
                <div class="device-panel-info-grid">
                    ${_infoRow(_('device_detail.total_memory'), _formatMemory(s.memory_gb))}
                </div>
            </div>`;
        }

        // Displays section
        const displays = _safeParseJSON(s.displays_json || s.displays, []);
        if (displays.length > 0) {
            html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title"><span class="material-icons">monitor</span> ${_('device_detail.section_displays')}</div>
                <div class="device-panel-displays-list">
                    ${displays.map((disp, i) => {
                        const w = disp.width || disp.w || 0;
                        const h = disp.height || disp.h || 0;
                        const name = disp.name || ('#' + (i + 1));
                        return `<div class="device-panel-display-item">
                            <span class="material-icons">monitor</span>
                            <span>${Utils.escapeHtml(name)}</span>
                            ${w && h ? `<span class="device-panel-display-res">${w}×${h}</span>` : ''}
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Encoding capabilities
        const encoding = _safeParseJSON(s.encoding_json || s.encoding, []);
        if (encoding.length > 0) {
            html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title"><span class="material-icons">videocam</span> ${_('device_detail.section_encoding')}</div>
                <div class="device-panel-encoding-tags">
                    ${encoding.map(e => {
                        const label = typeof e === 'string' ? e : (e.name || e.codec || JSON.stringify(e));
                        return `<span class="device-panel-encoding-tag">${Utils.escapeHtml(label)}</span>`;
                    }).join('')}
                </div>
            </div>`;
        }

        html += inventoryHtml;
        html += `</div>`;
        return html;
    }

    // ── Inventory report (hardware tab) ──
    // The BetterDesk agent's own report: hardware facts, disks, network adapters,
    // system and installed programs. Same data the inventory page lists.

    // Numbers, sizes, times and empty values from the shared helpers (GUIDE.md "Data display")
    const _invEmpty = () => Utils.emptyHtml();
    const _invBytes = (bytes) => (bytes > 0 ? Utils.formatBytes(bytes) : '');

    function _invPercent(used, total) {
        if (!total || total <= 0 || used == null) return null;
        return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    }

    function _invMeter(pct, label) {
        if (pct == null) return _invEmpty();
        const level = pct >= 95 ? ' is-full' : pct >= 85 ? ' is-high' : '';
        return `<div class="meter${level}"><span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${pct}%"></span></span>`
            + `<span class="meter-value">${Utils.escapeHtml(label || Utils.formatPercent(pct))}</span></div>`;
    }

    function _invDuration(seconds) {
        return Number(seconds) > 0 ? Utils.formatDuration(Number(seconds)) : '';
    }

    // Same rows as the rest of the panel; empty values are left out
    function _invFact(label, valueHtml) {
        if (valueHtml === '' || valueHtml == null) return '';
        return _infoRow(Utils.escapeHtml(label), valueHtml);
    }

    function _invDiskSizes(disk) {
        const gb = (v) => (Number(v) || 0) * 1024 ** 3;
        const total = disk.total_bytes != null ? Number(disk.total_bytes) : gb(disk.total_gb);
        let used = disk.used_bytes != null ? Number(disk.used_bytes) : (disk.used_gb != null ? gb(disk.used_gb) : null);
        if (used == null && disk.available_bytes != null && total) used = total - Number(disk.available_bytes);
        if (used == null && disk.free_bytes != null && total) used = total - Number(disk.free_bytes);
        return { total, used };
    }

    async function _loadInventory() {
        if (!device) return;
        const id = device.id;
        inventoryLoading = true;
        try {
            const data = await Utils.api('/api/inventory/' + encodeURIComponent(id));
            inventoryData = { id, data: data || {} };
        } catch (err) {
            inventoryData = err && err.status === 404 ? { id, none: true } : { id, error: (err && err.message) || '' };
        } finally {
            inventoryLoading = false;
        }
        if (device && device.id === id) _render();
    }

    function _inventoryHTML() {
        const esc = Utils.escapeHtml;
        if (!device) return '';
        if (!inventoryData || inventoryData.id !== device.id) {
            return `<p class="state dp-inventory-state">${esc(_('inventory.loading_detail'))}</p>`;
        }
        if (inventoryData.none) return '';
        if (inventoryData.error !== undefined) {
            return `<p class="state is-error dp-inventory-state">${esc(_('inventory.detail_failed'))} ${esc(inventoryData.error)}
                <button type="button" class="btn btn-sm" data-inventory-retry>${esc(_('actions.retry'))}</button></p>`;
        }
        const data = inventoryData.data;
        const hw = data.hardware && typeof data.hardware === 'object' ? data.hardware : data;
        const sw = data.software && typeof data.software === 'object' ? data.software : {};
        const tel = data.telemetry || {};
        const cpu = hw.cpu && typeof hw.cpu === 'object' ? hw.cpu : { brand: hw.cpu || data.cpu };
        const mem = hw.memory && typeof hw.memory === 'object' ? hw.memory : {};

        const cpuLoad = typeof tel.cpu_usage_percent === 'number' && tel.received_at ? tel.cpu_usage_percent
            : (typeof cpu.usage_percent === 'number' ? cpu.usage_percent : null);
        const memTotal = Number(tel.memory_total_bytes) || Number(mem.total_bytes) || (data.memory_total_mb ? data.memory_total_mb * 1048576 : 0);
        const memUsed = Number(tel.memory_total_bytes) ? Number(tel.memory_used_bytes) : (Number(mem.used_bytes) || (data.memory_used_mb ? data.memory_used_mb * 1048576 : 0));
        const memPct = _invPercent(memUsed, memTotal);
        const cores = cpu.logical_cores || cpu.cores || data.cpu_cores;
        const physical = cpu.physical_cores;
        const uptime = tel.uptime_secs || hw.uptime_secs || hw.uptime || data.uptime;

        const cpuLoadHtml = cpuLoad == null ? '' : _invMeter(Math.round(cpuLoad), Utils.formatPercent(cpuLoad, { digits: 1 }));
        const memHtml = memTotal
            ? (memPct == null ? esc(_invBytes(memTotal)) : _invMeter(memPct, _('inventory.used_of', { used: _invBytes(memUsed), total: _invBytes(memTotal) })))
            : '';
        let coresText = '';
        if (cores) coresText = physical && physical !== cores
            ? _('inventory.cores_detail', { logical: cores, physical })
            : String(cores);

        let html = `<div class="dp-inventory">
            <div class="device-panel-section">
                <div class="device-panel-section-title">${esc(_('inventory.group_hardware'))}</div>
                <div class="device-panel-info-grid dp-inv-facts">
                    ${_invFact(_('inventory.processor'), cpu.brand ? esc(cpu.brand) : '')}
                    ${_invFact(_('inventory.cores'), coresText ? esc(coresText) : '')}
                    ${_invFact(_('inventory.cpu_load'), cpuLoadHtml)}
                    ${_invFact(_('inventory.memory'), memHtml)}
                    ${_invFact(_('inventory.architecture'), hw.architecture ? esc(hw.architecture) : '')}
                </div>`;

        const disks = Array.isArray(hw.disks) ? hw.disks : [];
        if (disks.length) {
            html += `<h3 class="dp-inv-sub" id="dp-inv-disks-title">${esc(_('inventory.disks'))}</h3>
                <div class="table-scroll" tabindex="0" role="region" aria-labelledby="dp-inv-disks-title"><table class="data-table dp-inv-disks">
                    <thead><tr><th>${esc(_('inventory.drive'))}</th><th>${esc(_('inventory.file_system'))}</th><th>${esc(_('inventory.used'))}</th></tr></thead>
                    <tbody>${disks.map((disk) => {
                        const { total, used } = _invDiskSizes(disk);
                        const pct = _invPercent(used, total);
                        const label = total ? _('inventory.used_of', { used: _invBytes(used), total: _invBytes(total) }) : '';
                        const name = disk.mount_point || disk.device || disk.name || '?';
                        const sub = disk.device && disk.device !== name ? disk.device : '';
                        return `<tr>
                            <td>${Utils.valueHtml(name)}${sub ? `<span class="cell-sub">${Utils.valueHtml(sub)}</span>` : ''}${disk.removable ? `<span class="cell-sub">${esc(_('inventory.removable_drive'))}</span>` : ''}</td>
                            <td>${disk.filesystem || disk.fs_type ? esc(disk.filesystem || disk.fs_type) : _invEmpty()}</td>
                            <td class="dp-inv-disk-use">${pct == null ? (total ? esc(_invBytes(total)) : _invEmpty()) : _invMeter(pct, label)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>`;
        }

        const nics = Array.isArray(hw.network_interfaces) ? hw.network_interfaces : [];
        if (nics.length) {
            html += `<h3 class="dp-inv-sub" id="dp-inv-nics-title">${esc(_('inventory.network_interfaces'))}</h3>
                <div class="table-scroll" tabindex="0" role="region" aria-labelledby="dp-inv-nics-title"><table class="data-table dp-inv-nics">
                    <thead><tr><th>${esc(_('inventory.adapter'))}</th><th>${esc(_('inventory.mac_address'))}</th><th>${esc(_('inventory.ip_addresses'))}</th></tr></thead>
                    <tbody>${nics.map((nic) => `<tr>
                        <td>${esc(nic.name || '?')}</td>
                        <td>${Utils.valueHtml(nic.mac, { copy: true, label: _('inventory.mac_address') })}</td>
                        <td>${(nic.ip_addresses || []).length ? (nic.ip_addresses || []).map((ip) => `<span class="dp-inv-ip">${Utils.valueHtml(ip, { copy: true })}</span>`).join('') : _invEmpty()}</td>
                    </tr>`).join('')}</tbody>
                </table></div>`;
        }
        html += `</div>`;

        const osName = hw.os_name || data.os || '';
        const collected = Utils.parseDate(data.collected_at);
        const received = Utils.parseDate(data.received_at);
        html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title">${esc(_('inventory.group_software'))}</div>
                <div class="device-panel-info-grid dp-inv-facts">
                    ${_invFact(_('inventory.os'), osName ? esc(osName) : '')}
                    ${_invFact(_('inventory.os_version'), hw.os_version ? Utils.versionHtml(hw.os_version) : '')}
                    ${_invFact(_('inventory.kernel'), hw.kernel ? esc(hw.kernel) : '')}
                    ${_invFact(_('inventory.uptime'), _invDuration(uptime) ? esc(_invDuration(uptime)) : '')}
                    ${_invFact(_('inventory.collected_at'), collected ? Utils.timeHtml(collected, { relative: false }) : '')}
                    ${_invFact(_('inventory.received_at'), received ? Utils.timeHtml(received, { relative: false }) : '')}
                </div>`;

        const apps = Array.isArray(sw.apps) ? sw.apps.slice() : [];
        apps.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        html += `<div class="dp-inv-apps-head">
                <h3 class="dp-inv-sub" id="dp-inv-apps-title">${esc(_('inventory.installed_programs'))}</h3>
                <span class="text-muted" id="dp-inv-apps-count">${esc(apps.length === 1 ? _('inventory.programs_one') : _('inventory.programs_many', { count: apps.length }))}</span>
            </div>`;
        if (!apps.length) {
            html += `<p class="state">${esc(_('inventory.no_programs'))}</p>`;
        } else {
            html += `<div class="search-wrapper dp-inv-apps-search">
                    <span class="material-icons" aria-hidden="true">search</span>
                    <input type="search" class="form-input" id="dp-inv-apps-search" aria-label="${esc(_('inventory.search_programs'))}" placeholder="${esc(_('inventory.search_programs'))}">
                </div>
                <div class="table-scroll" tabindex="0" role="region" aria-labelledby="dp-inv-apps-title"><table class="data-table dp-inv-apps">
                    <thead><tr><th>${esc(_('inventory.program'))}</th><th>${esc(_('inventory.version'))}</th><th class="dp-inv-col-publisher">${esc(_('inventory.publisher'))}</th><th class="dp-inv-col-installed">${esc(_('inventory.installed'))}</th></tr></thead>
                    <tbody id="dp-inv-apps-body">${apps.map((app) => {
                        const installed = Utils.parseDate(app.installed_at || app.install_date);
                        const search = [app.name, app.version, app.publisher].join(' ').toLowerCase();
                        return `<tr data-search="${esc(search)}">
                            <td>${esc(app.name || '?')}${app.publisher ? `<span class="cell-sub dp-inv-phone-publisher">${esc(app.publisher)}</span>` : ''}</td>
                            <td class="dp-inv-version">${Utils.versionHtml(app.version)}</td>
                            <td class="dp-inv-col-publisher">${app.publisher ? esc(app.publisher) : _invEmpty()}</td>
                            <td class="dp-inv-col-installed">${installed ? Utils.timeHtml(installed, { relative: false, format: { year: 'numeric', month: 'short', day: 'numeric' } }) : _invEmpty()}</td>
                        </tr>`;
                    }).join('')}
                    <tr class="dp-inv-apps-empty" hidden><td colspan="4" class="state-cell">${esc(_('inventory.no_programs_match'))}</td></tr></tbody>
                </table></div>`;
        }
        html += `</div></div>`;
        return html;
    }

    function _wireInventory(root, query) {
        root.querySelector('[data-inventory-retry]')?.addEventListener('click', function () {
            inventoryData = null;
            _loadInventory();
        });
        const input = root.querySelector('#dp-inv-apps-search');
        if (!input) return;
        const rows = Array.from(root.querySelectorAll('#dp-inv-apps-body tr[data-search]'));
        const empty = root.querySelector('.dp-inv-apps-empty');
        const count = root.querySelector('#dp-inv-apps-count');
        const total = rows.length;
        const apply = function () {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            rows.forEach(function (row) {
                const hit = !q || row.dataset.search.includes(q);
                row.hidden = !hit;
                if (hit) shown += 1;
            });
            empty.hidden = shown > 0;
            count.textContent = q
                ? _('inventory.programs_shown', { shown, count: total })
                : (total === 1 ? _('inventory.programs_one') : _('inventory.programs_many', { count: total }));
        };
        input.addEventListener('input', apply);
        if (query) { input.value = query; apply(); }
    }

    // ── Metrics tab (CPU, memory, disk usage + availability history) ──

    function _formatAvailabilityTime(iso) {
        if (!iso) return '—';
        try {
            const d = new Date(iso);
            if (Number.isNaN(d.getTime())) return Utils.escapeHtml(String(iso));
            return Utils.escapeHtml(d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
        } catch (_) {
            return Utils.escapeHtml(String(iso));
        }
    }

    function _availabilityStatusLabel(status) {
        const s = String(status || '').toUpperCase();
        const key = 'device_detail.availability_status_' + s.toLowerCase();
        const translated = _(key);
        return translated !== key ? translated : s || '—';
    }

    function _availabilitySourceLabel(source) {
        const s = String(source || '').toLowerCase();
        const key = 'device_detail.availability_source_' + s;
        const translated = _(key);
        return translated !== key ? translated : (s || '—');
    }

    function _formatDayLabel(dayStr) {
        const p = String(dayStr || '').split('-').map(Number);
        const d = new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
        if (Number.isNaN(d.getTime())) return String(dayStr || '');
        try {
            return d.toLocaleDateString(Utils._dateLocale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        } catch (_) {
            return String(dayStr);
        }
    }

    function _formatSpan(ms) {
        const min = Math.round(ms / 60000);
        if (min < 1) return _('device_detail.duration_under_min');
        const h = Math.floor(min / 60);
        const m = min % 60;
        if (!h) return _('device_detail.duration_min').replace('{m}', m);
        if (!m) return _('device_detail.duration_h').replace('{h}', h);
        return _('device_detail.duration_h_min').replace('{h}', h).replace('{m}', m);
    }

    // Status groups of the availability strip, in legend order, with the
    // share-legend key class and the strip fill class (device-detail.css)
    const AVAIL_GROUPS = [
        { status: 'ONLINE', cls: 'is-ok' },
        { status: 'DEGRADED', cls: 'is-warning' },
        { status: 'CRITICAL', cls: 'is-danger' },
        { status: 'OFFLINE', cls: 'is-muted' },
    ];

    /**
     * One day as a horizontal band: who was online, degraded, critical or
     * offline when, from the recorded status changes. The state before the
     * first change is that change's "from" status; with no change today the
     * device's current state has held since midnight. The band is decorative
     * (aria-hidden): the legend under it gives the totals and the table below
     * lists every change.
     */
    function _availabilityStrip(dayStr, events) {
        const p = String(dayStr || '').split('-').map(Number);
        const start = new Date(p[0], (p[1] || 1) - 1, p[2] || 1).getTime();
        const end = new Date(p[0], (p[1] || 1) - 1, (p[2] || 1) + 1).getTime();
        const now = Date.now();
        const until = Math.min(end, now);
        if (!(until > start)) return '';

        const changes = (events || []).map(function (ev) {
            const at = Utils.parseDate(ev.created_at);
            return at ? { t: at.getTime(), from: String(ev.from_status || '').toUpperCase(), to: String(ev.to_status || '').toUpperCase() } : null;
        }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });

        let state = changes.length
            ? changes[0].from
            : (device && device.online ? String(device.status_tier || 'ONLINE').toUpperCase() : 'OFFLINE');
        const spans = [];
        let t = start;
        changes.forEach(function (c) {
            const at = Math.min(Math.max(c.t, start), until);
            if (at > t) spans.push({ from: t, to: at, status: state });
            t = Math.max(t, at);
            state = c.to;
        });
        if (until > t) spans.push({ from: t, to: until, status: state });

        const known = {};
        AVAIL_GROUPS.forEach(function (g) { known[g.status] = g; });
        const totals = {};
        spans.forEach(function (s) {
            if (!known[s.status]) return;
            totals[s.status] = (totals[s.status] || 0) + (s.to - s.from);
        });

        const total = end - start;
        const pct = function (v) { return (((v - start) / total) * 100).toFixed(3) + '%'; };
        const width = function (a, b) { return (((b - a) / total) * 100).toFixed(3) + '%'; };
        const locale = Utils._dateLocale();
        const clock = function (ms) {
            return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        };

        let svg = `<svg class="dp-strip" width="100%" height="44" aria-hidden="true" focusable="false">
            <rect class="dp-strip-bg" x="0" y="0" width="100%" height="20"></rect>`;
        spans.forEach(function (s) {
            const g = known[s.status];
            if (!g) return;
            svg += `<rect class="dp-strip-span ${g.cls}" x="${pct(s.from)}" y="0" width="${width(s.from, s.to)}" height="20"><title>${Utils.escapeHtml(_availabilityStatusLabel(s.status) + ', ' + clock(s.from) + '–' + clock(s.to))}</title></rect>`;
        });
        // Ticks every 3 hours, labels every 6 (start and end anchored inside the band)
        for (let h = 0; h <= 24; h += 3) {
            const at = new Date(p[0], (p[1] || 1) - 1, p[2] || 1, h).getTime();
            const x = h === 24 ? '100%' : pct(at);
            svg += `<line class="dp-strip-tick" x1="${x}" x2="${x}" y1="20" y2="${h % 6 ? 23 : 26}"></line>`;
            if (h % 6 === 0) {
                const anchor = h === 0 ? 'start' : (h === 24 ? 'end' : 'middle');
                svg += `<text class="dp-strip-label${h % 12 ? ' is-minor' : ''}" x="${x}" y="40" text-anchor="${anchor}">${Utils.escapeHtml(clock(h === 24 ? end : at))}</text>`;
            }
        }
        if (now < end) {
            svg += `<line class="dp-strip-now" x1="${pct(now)}" x2="${pct(now)}" y1="-3" y2="23"></line>`;
        }
        svg += `</svg>`;

        const legend = AVAIL_GROUPS.filter(function (g) { return totals[g.status] > 0; }).map(function (g) {
            return `<li><span class="key ${g.cls}" aria-hidden="true"></span>${Utils.escapeHtml(_availabilityStatusLabel(g.status))} <strong>${Utils.escapeHtml(_formatSpan(totals[g.status]))}</strong></li>`;
        }).join('');

        return `
        <div class="dp-strip-wrap">
            ${svg}
            <ul class="share-legend dp-strip-legend">${legend}</ul>
            ${now < end ? `<p class="device-panel-empty-hint">${Utils.escapeHtml(_('device_detail.availability_until_now').replace('{time}', clock(now)))}</p>` : ''}
        </div>`;
    }

    // ── Usage chart: CPU, memory and disk (%) from the heartbeat samples ──

    function _usageSection() {
        return `
        <div class="device-panel-section" id="dp-usage-section">
            <div class="device-panel-section-title">${_('device_detail.section_usage_history')}</div>
            <p class="section-note">${_('device_detail.usage_note')}</p>
            <div class="dp-usage-chart" id="dp-usage-chart"></div>
        </div>`;
    }

    function _renderUsageChart() {
        const host = overlayEl && overlayEl.querySelector('#dp-usage-chart');
        if (!host || !device) return;
        const num = function (v) { const n = Number(v); return v === null || v === undefined || Number.isNaN(n) ? null : n; };
        const samples = (Array.isArray(device.metrics_history) ? device.metrics_history : []).map(function (s) {
            const at = Utils.parseDate(s.time);
            return at ? { t: at.getTime(), cpu: num(s.cpu), memory: num(s.memory), disk: num(s.disk) } : null;
        }).filter(Boolean).sort(function (a, b) { return a.t - b.t; });

        const pctText = function (v) { return v === null ? '–' : Math.round(v) + ' %'; };
        if (!samples.length) {
            host.innerHTML = `<p class="device-panel-empty-hint">${_('device_detail.usage_empty')}</p>`;
            return;
        }
        if (samples.length < 2 || typeof UiChart === 'undefined') {
            const s = samples[samples.length - 1];
            host.innerHTML = `<p>${Utils.escapeHtml(_('device_detail.usage_one')
                .replace('{time}', Utils.formatDate(s.t))
                .replace('{cpu}', pctText(s.cpu)).replace('{memory}', pctText(s.memory)).replace('{disk}', pctText(s.disk)))}</p>`;
            return;
        }

        // A sample that comes much later than the usual interval starts a new
        // line: one empty position between them breaks the line there
        const diffs = [];
        for (let i = 1; i < samples.length; i++) diffs.push(samples[i].t - samples[i - 1].t);
        const sortedDiffs = diffs.slice().sort(function (a, b) { return a - b; });
        const usual = sortedDiffs[Math.floor(sortedDiffs.length / 2)] || 0;
        const first = samples[0].t;
        const last = samples[samples.length - 1].t;
        const locale = Utils._dateLocale();
        const crossesDay = new Date(first).toDateString() !== new Date(last).toDateString();
        const fmt = new Intl.DateTimeFormat(locale, crossesDay
            ? { weekday: 'short', hour: '2-digit', minute: '2-digit' }
            : { hour: '2-digit', minute: '2-digit' });

        const labels = [];
        const cpu = [];
        const memory = [];
        const disk = [];
        samples.forEach(function (s, i) {
            if (i > 0 && usual > 0 && diffs[i - 1] > usual * 3) {
                labels.push('…');
                cpu.push(null); memory.push(null); disk.push(null);
            }
            labels.push(fmt.format(new Date(s.t)));
            cpu.push(s.cpu); memory.push(s.memory); disk.push(s.disk);
        });

        const range = function (arr) {
            const v = arr.filter(function (x) { return x !== null; });
            return v.length ? [Math.min.apply(null, v), Math.max.apply(null, v)] : [null, null];
        };
        const rc = range(cpu);
        const rm = range(memory);
        const rd = range(disk);
        const summary = _('device_detail.usage_summary')
            .replace('{count}', samples.length)
            .replace('{start}', Utils.formatDate(first))
            .replace('{end}', Utils.formatDate(last))
            .replace('{cpu_min}', pctText(rc[0])).replace('{cpu_max}', pctText(rc[1]))
            .replace('{memory_min}', pctText(rm[0])).replace('{memory_max}', pctText(rm[1]))
            .replace('{disk_min}', pctText(rd[0])).replace('{disk_max}', pctText(rd[1]));

        UiChart.render(host, {
            kind: 'line',
            label: _('device_detail.usage_chart_label'),
            summary: summary,
            labels: labels,
            series: [
                { name: _('device_detail.metric_cpu'), values: cpu },
                { name: _('device_detail.metric_memory'), values: memory },
                { name: _('device_detail.metric_disk'), values: disk },
            ],
            yMax: 100,
            format: function (v) { return Math.round(v) + ' %'; },
            xHeading: _('device_detail.availability_col_time'),
        });
    }

    function _availabilitySection() {
        const day = availabilityDay || _localDayString();
        const enabled = !!(availabilityData && availabilityData.enabled);
        const events = (availabilityData && Array.isArray(availabilityData.events)) ? availabilityData.events : [];
        const isToday = day === _localDayString();

        let html = `
        <div class="device-panel-section" id="dp-availability-section">
            <div class="device-panel-section-title">
                <span class="material-icons">timeline</span> ${_('device_detail.section_availability_history')}
            </div>
            <div class="device-panel-availability-toolbar">
                <button type="button" class="btn btn-secondary btn-sm dp-day-step" id="dp-avail-prev">
                    <span class="material-icons" aria-hidden="true">chevron_left</span>${_('device_detail.availability_prev_day')}
                </button>
                <span class="device-panel-availability-day" id="dp-avail-day" aria-live="polite">${Utils.escapeHtml(_formatDayLabel(day))}</span>
                <button type="button" class="btn btn-secondary btn-sm dp-day-step" id="dp-avail-next" ${isToday ? 'disabled' : ''}>
                    ${_('device_detail.availability_next_day')}<span class="material-icons" aria-hidden="true">chevron_right</span>
                </button>
            </div>`;

        if (availabilityLoading) {
            html += `<p class="device-panel-empty-hint">${_('device_detail.availability_loading')}</p>`;
        } else if (availabilityData && availabilityData.error) {
            html += `<p class="state is-error">${_('device_detail.availability_error')}
                <button type="button" class="btn btn-sm" id="dp-avail-retry">${Utils.icon('refresh')}${_('errors.try_again')}</button></p>`;
        } else if (!enabled) {
            html += `
            <div class="device-panel-empty-state device-panel-empty-compact">
                <span class="material-icons">history</span>
                <p>${_('device_detail.availability_disabled')}</p>
                <p class="device-panel-empty-hint">${_('device_detail.availability_disabled_hint')}</p>
            </div>`;
        } else if (!events.length) {
            // No change today means the current state has held since midnight
            if (isToday) html += _availabilityStrip(day, []);
            html += `
            <div class="device-panel-empty-state device-panel-empty-compact">
                <span class="material-icons">event_note</span>
                <p>${_('device_detail.availability_empty')}</p>
                <p class="device-panel-empty-hint">${_('device_detail.availability_empty_hint')}</p>
            </div>`;
        } else {
            html += _availabilityStrip(day, events);
            html += `
            <div class="device-panel-table-wrap" tabindex="0" role="region" aria-label="${Utils.escapeHtml(_('device_detail.section_availability_history'))}">
                <table class="device-panel-availability-table">
                    <thead>
                        <tr>
                            <th>${_('device_detail.availability_col_time')}</th>
                            <th>${_('device_detail.availability_col_from')}</th>
                            <th>${_('device_detail.availability_col_to')}</th>
                            <th>${_('device_detail.availability_col_source')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${events.map(ev => `
                        <tr>
                            <td>${_formatAvailabilityTime(ev.created_at)}</td>
                            <td><span class="device-panel-avail-status avail-${Utils.escapeHtml(String(ev.from_status || '').toLowerCase())}">${Utils.escapeHtml(_availabilityStatusLabel(ev.from_status))}</span></td>
                            <td><span class="device-panel-avail-status avail-${Utils.escapeHtml(String(ev.to_status || '').toLowerCase())}">${Utils.escapeHtml(_availabilityStatusLabel(ev.to_status))}</span></td>
                            <td>${Utils.escapeHtml(_availabilitySourceLabel(ev.source))}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        html += `</div>`;
        return html;
    }

    function _bindAvailabilityControls() {
        const retry = overlayEl?.querySelector('#dp-avail-retry');
        if (retry) {
            retry.onclick = async () => {
                await _loadAvailability(availabilityDay);
                _render();
                _switchTab('metrics');
            };
        }
        const prev = overlayEl?.querySelector('#dp-avail-prev');
        const next = overlayEl?.querySelector('#dp-avail-next');
        if (prev) {
            prev.onclick = async () => {
                availabilityDay = _shiftDay(availabilityDay || _localDayString(), -1);
                await _loadAvailability(availabilityDay);
                _render();
                _switchTab('metrics');
            };
        }
        if (next) {
            next.onclick = async () => {
                const today = _localDayString();
                const nextDay = _shiftDay(availabilityDay || today, 1);
                if (nextDay > today) return;
                availabilityDay = nextDay;
                await _loadAvailability(availabilityDay);
                _render();
                _switchTab('metrics');
            };
        }
    }

    function _formatSessionDuration(seconds, active) {
        if (active && (seconds == null || seconds < 0)) {
            return _('device_detail.sessions_active');
        }
        const sec = Math.max(0, Math.floor(Number(seconds) || 0));
        if (active) {
            return _('device_detail.sessions_active') + ' · ' + _formatDurationHMS(sec);
        }
        return _formatDurationHMS(sec);
    }

    function _formatDurationHMS(sec) {
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (h > 0) {
            return h + 'h ' + String(m).padStart(2, '0') + 'm';
        }
        if (m > 0) {
            return m + 'm ' + String(s).padStart(2, '0') + 's';
        }
        return s + 's';
    }

    function _sessionTransportLabel(transport) {
        const t = String(transport || '').toLowerCase();
        if (t === 'punch_hole') return _('device_detail.sessions_transport_punch');
        if (t === 'request_relay') return _('device_detail.sessions_transport_relay');
        return transport || '—';
    }

    function _metricsSummarySection() {
        const d = device || {};
        const policy = d.connection_mode || {};
        const effective = policy.effective_mode || policy.desired_mode || '';
        const availCount = (availabilityData && Array.isArray(availabilityData.events))
            ? availabilityData.events.length
            : 0;
        const sessCount = (connectionSessionsData && Array.isArray(connectionSessionsData.sessions))
            ? connectionSessionsData.sessions.length
            : 0;
        const statusLabel = _resolveDeviceStatus(d).label;

        return `
        <div class="device-panel-section device-panel-metrics-summary">
            <div class="device-panel-section-title">
                <span class="material-icons">assessment</span> ${_('device_detail.section_metrics_summary')}
            </div>
            <div class="device-panel-info-grid">
                ${_infoRow(_('devices.status'), Utils.escapeHtml(String(statusLabel)))}
                ${_infoRow(_('devices.last_seen'), _lastSeenValue(d.last_online))}
                ${_infoRow(_('devices.ip_address'), d.ip ? `<span class="mono">${Utils.escapeHtml(d.ip)}</span>` : '—')}
                ${effective ? _infoRow(_('device_detail.connection_mode_effective'), Utils.escapeHtml(effective)) : ''}
                ${_infoRow(_('device_detail.metrics_avail_today'), String(availCount))}
                ${_infoRow(_('device_detail.metrics_sessions_tracked'), String(sessCount))}
            </div>
        </div>`;
    }

    function _connectionSessionsSection() {
        const sessions = (connectionSessionsData && Array.isArray(connectionSessionsData.sessions))
            ? connectionSessionsData.sessions
            : [];
        let html = `
        <div class="device-panel-section" id="dp-sessions-section">
            <div class="device-panel-section-title">
                <span class="material-icons">link</span> ${_('device_detail.section_connection_sessions')}
            </div>`;

        if (connectionSessionsLoading) {
            html += `<p class="device-panel-empty-hint">${_('device_detail.sessions_loading')}</p>`;
        } else if (connectionSessionsData && connectionSessionsData.error) {
            html += `
            <div class="device-panel-empty-state device-panel-empty-compact">
                <span class="material-icons">link_off</span>
                <p>${_('device_detail.sessions_error')}</p>
                <p class="device-panel-empty-hint">${Utils.escapeHtml(connectionSessionsData.error)}</p>
            </div>`;
        } else if (!sessions.length) {
            html += `
            <div class="device-panel-empty-state device-panel-empty-compact">
                <span class="material-icons">link_off</span>
                <p>${_('device_detail.sessions_empty')}</p>
                <p class="device-panel-empty-hint">${_('device_detail.sessions_empty_hint')}</p>
            </div>`;
        } else {
            html += `
            <div class="device-panel-table-wrap" tabindex="0" role="region" aria-label="${Utils.escapeHtml(_('device_detail.section_connection_sessions'))}">
                <table class="device-panel-availability-table">
                    <thead>
                        <tr>
                            <th>${_('device_detail.sessions_col_when')}</th>
                            <th>${_('device_detail.sessions_col_who')}</th>
                            <th>${_('device_detail.sessions_col_from')}</th>
                            <th>${_('device_detail.sessions_col_transport')}</th>
                            <th>${_('device_detail.sessions_col_duration')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sessions.map(s => {
                            const who = s.username || s.peer_name || s.peer_id || '—';
                            const whoExtra = (s.username && s.peer_name)
                                ? `<div class="device-panel-session-sub">${Utils.escapeHtml(s.peer_name)}${s.peer_id ? ` · <span class="mono">${Utils.escapeHtml(s.peer_id)}</span>` : ''}</div>`
                                : (s.peer_id && who !== s.peer_id
                                    ? `<div class="device-panel-session-sub mono">${Utils.escapeHtml(s.peer_id)}</div>`
                                    : '');
                            return `
                            <tr>
                                <td>${Utils.escapeHtml(Utils.formatDate(s.started_at) || '—')}</td>
                                <td>${Utils.escapeHtml(who)}${whoExtra}</td>
                                <td class="mono">${Utils.escapeHtml(s.peer_ip || '—')}</td>
                                <td>${Utils.escapeHtml(_sessionTransportLabel(s.transport))}</td>
                                <td>${Utils.escapeHtml(_formatSessionDuration(s.duration_seconds, !!s.active))}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>`;
        }

        html += `</div>`;
        return html;
    }

    function _metricsPane() {
        let html = `<div class="device-panel-tab-pane" data-pane="metrics">`;
        html += _metricsSummarySection();
        html += _usageSection();
        html += _availabilitySection();
        html += _connectionSessionsSection();
        html += `</div>`;
        return html;
    }

    // ── Tags & Notes tab ──

    function _tagsPane() {
        const d = device;
        const tags = d.tags || [];
        const hasTags = tags.length > 0;
        const canEdit = _can('device.edit');

        let html = `<div class="device-panel-tab-pane" data-pane="tags">`;

        // Tags section
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title" id="dp-tags-title">${_('device_detail.tags')}</div>
            ${canEdit ? `<p class="form-hint device-panel-tags-hint">${_('device_detail.tags_unassign_hint') || _('devices.tags_device_hint') || 'Removing a tag here unassigns it from this device only. Use Manage Tags on the Devices page to rename or delete a tag everywhere.'}</p>` : ''}
            <div class="device-panel-tags-container" id="dp-tags-list">
                ${hasTags
                    ? tags.map(t => `
                        <span class="device-panel-tag">
                            ${Utils.escapeHtml(t)}
                            ${canEdit ? `<button type="button" class="device-panel-tag-remove btn-icon" data-tag="${Utils.escapeHtml(t)}" title="${_('devices.unassign_tag') || _('actions.delete')}" aria-label="${Utils.escapeHtml((_('devices.unassign_tag') || _('actions.delete')) + ': ' + t)}">
                                <span class="material-icons" aria-hidden="true">close</span>
                            </button>` : ''}
                        </span>`).join('')
                    : `<div class="device-panel-tags-empty">${_('device_detail.no_tags')}</div>`
                }
            </div>
            ${canEdit ? `<div class="device-panel-tag-input-row">
                <input type="text" class="device-panel-tag-input form-input" id="dp-tag-input" aria-labelledby="dp-tags-title"
                       placeholder="${_('device_detail.tag_placeholder')}" maxlength="50" list="dp-tag-suggestions">
                <datalist id="dp-tag-suggestions">
                    ${_tagSuggestionOptions(tags)}
                </datalist>
                <button type="button" class="btn device-panel-tag-add-btn" id="dp-tag-add-btn">${Utils.icon('add')}${_('device_detail.add_tag')}</button>
            </div>` : ''}
        </div>`;

        // Notes section
        html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title" id="dp-notes-title">${_('device_detail.notes')}</div>
            ${canEdit ? `<textarea class="device-panel-notes-textarea form-input" id="dp-notes-textarea" aria-labelledby="dp-notes-title"
                      placeholder="${_('device_detail.notes_placeholder')}">${Utils.escapeHtml(d.note || '')}</textarea>
            <div class="device-panel-notes-actions">
                <button type="button" class="btn btn-sm" id="dp-notes-save">${_('actions.save')}</button>
            </div>` : `<p class="device-panel-note-text">${d.note ? Utils.escapeHtml(d.note) : _('device_detail.no_notes')}</p>`}
        </div>`;

        html += `</div>`;
        return html;
    }

    // ── Actions tab ──

    // Icon per action card, from the shared meanings in Utils.ICONS
    const ACTION_CARD_ICONS = {
        'connect-desktop': 'connect_app', 'connect-web': 'connect', edit: 'edit', 'change-id': 'rename',
        delete: 'delete', 'permanent-delete': 'delete_forever',
    };

    function _actionCard(action, title, desc, iconMeaning) {
        const meaning = iconMeaning || ACTION_CARD_ICONS[action];
        return `
                <button type="button" class="device-panel-action-card" data-action="${action}">
                    ${meaning ? Utils.icon(meaning) : '<span class="device-panel-action-glyph-space" aria-hidden="true"></span>'}
                    <span class="device-panel-action-text"><span class="device-panel-action-title">${title}</span>
                    <span class="device-panel-action-desc">${desc}</span></span>
                </button>`;
    }

    function _actionsPane() {
        const d = device;
        const isBanned = d.banned;
        const isDeleted = !!d.soft_deleted;
        const identity = d.telemetry?.snapshots?.identity?.data || {};
        const supportAgent = _isSupportAgent(identity);

        let html = `<div class="device-panel-tab-pane" data-pane="actions">`;

        if (isDeleted) {
            html += `
            <div class="device-panel-section">
                <p class="form-hint">${Utils.escapeHtml(_('devices.delete_reserved_hint'))}</p>
            </div>`;
            if (_can('device.delete')) {
                html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title">${_('devices.restore_action')}</div>
                <div class="device-panel-actions-grid">
                    ${_actionCard('restore', _('devices.restore_action'), _('devices.restore_confirm', { id: d.id }))}
                    ${_actionCard('permanent-delete', _('devices.permanent_delete_title'), _('devices.permanent_delete_confirm', { id: d.id }))}
                </div>
            </div>`;
            }
            html += `</div>`;
            return html;
        }

        // Connection actions
        if (_can('device.connect')) {
            html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title">${_('device_detail.section_connect')}</div>
            <div class="device-panel-actions-grid">
                ${_actionCard('connect-desktop', _('device_detail.action_connect_desktop'), _('device_detail.action_connect_desktop_desc'))}
                ${_actionCard('connect-web', _('device_detail.action_connect_web'), _('device_detail.action_connect_web_desc'))}
            </div>
        </div>`;
        }

        if (supportAgent) {
            html += `
            <div class="device-panel-section">
                <div class="device-panel-section-title">${Utils.escapeHtml(_('device_detail.support_mode_title'))}</div>
                <div class="device-panel-info-grid">
                    ${_infoRow(Utils.escapeHtml(_('device_detail.support_scope_label')), Utils.escapeHtml(_('device_detail.support_scope')))}
                    ${_infoRow(Utils.escapeHtml(_('device_detail.support_limits_label')), Utils.escapeHtml(_('device_detail.support_limits')))}
                </div>
            </div>`;
            html += `</div>`;
            return html;
        }

        // Management actions
        const manage = [];
        if (_can('device.edit')) {
            manage.push(_actionCard('edit', _('actions.edit'), _('device_detail.action_edit_desc')));
        }
        if (_can('device.change_id')) {
            manage.push(_actionCard('change-id', _('devices.change_id'), _('device_detail.action_change_id_desc')));
        }
        if (_can('device.ban')) {
            manage.push(_actionCard('toggle-ban', isBanned ? _('actions.unban') : _('actions.ban'),
                isBanned ? _('device_detail.action_unban_desc') : _('device_detail.action_ban_desc'), isBanned ? 'unban' : 'ban'));
        }
        if (manage.length) {
            html += `
        <div class="device-panel-section">
            <div class="device-panel-section-title">${_('device_detail.section_manage')}</div>
            <div class="device-panel-actions-grid">${manage.join('')}
            </div>
        </div>`;
        }

        // Danger zone
        if (_can('device.delete')) {
            html += `
        <div class="device-panel-danger-zone">
            <div class="device-panel-section-title">${_('device_detail.danger_zone')}</div>
            <div class="device-panel-actions-grid">
                ${_actionCard('delete', _('actions.delete'), _('device_detail.action_delete_desc'))}
            </div>
        </div>`;
        }

        html += `</div>`;
        return html;
    }

    // ── Footer ──

    // Footer slots stay put between view and edit mode: the first slot holds
    // Connect or Save (the primary), the second Edit or Cancel, Close keeps the
    // end. Each slot holds both of its buttons on top of each other and shows
    // one, so the slot is as wide as the wider label in either mode and
    // nothing moves when the mode changes.
    function _footerHTML() {
        const isDeleted = device && device.soft_deleted;
        const identity = device?.telemetry?.snapshots?.identity?.data || {};
        const supportAgent = _isSupportAgent(identity);
        const canConnect = !isDeleted && _can('device.connect');
        const canEdit = !isDeleted && !supportAgent && _can('device.edit');
        const off = (shown) => (shown ? '' : ' is-off" aria-hidden="true" tabindex="-1');
        const connectBtn = `<button type="button" class="btn btn-primary${off(!editMode)}" id="dp-connect-btn">${Utils.icon('connect')}${_('actions.connect')}</button>`;
        const editBtn = `<button type="button" class="btn btn-secondary${off(!editMode)}" id="dp-edit-btn">${Utils.icon('edit')}${_('actions.edit')}</button>`;
        const saveBtn = `<button type="button" class="btn btn-primary${off(editMode)}" id="dp-edit-save">${_('actions.save')}</button>`;
        const cancelBtn = `<button type="button" class="btn${off(editMode)}" id="dp-edit-cancel">${_('actions.cancel')}</button>`;
        let slots = '';
        if (canConnect && canEdit) {
            slots = `<span class="dp-footer-slot">${connectBtn}${saveBtn}</span><span class="dp-footer-slot">${editBtn}${cancelBtn}</span>`;
        } else if (canEdit) {
            // Without Connect, Edit takes the first slot and becomes Save
            slots = `<span class="dp-footer-slot">${editBtn}${saveBtn}</span><span class="dp-footer-slot">${cancelBtn}</span>`;
        } else if (canConnect) {
            slots = connectBtn;
        }
        return `
        <div class="device-panel-footer${editMode ? ' is-editing' : ''}">
            ${slots}
            <p class="form-status device-panel-edit-status" id="dp-edit-status" aria-live="polite"></p>
            <button type="button" class="btn btn-ghost" id="dp-close-btn">${_('actions.close')}</button>
        </div>`;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────

    function _isSupportAgent(identity) {
        if (!identity) return false;
        if (identity.product_sku === 'betterdesk-support') return true;
        if (identity.product_sku === 'betterdesk-desktop') return false;
        return identity.conn_mode === 'incoming-only';
    }

    function _connectionModeStatusLabel(status) {
        if (!status) return _('device_detail.connection_mode_status_none');
        const key = 'device_detail.connection_mode_status_' + status;
        const label = _(key);
        return label === key ? status : label;
    }

    function _connectionModeSection(d, identity) {
        const policy = d.connection_mode || {};
        const command = policy.command || {};
        const remembered = policy.policy || {};
        const effective = remembered.effective_mode || identity.conn_mode || '';
        const desired = remembered.desired_mode || '';
        const supportLocked = policy.support_agent || _isSupportAgent(identity);
        const canToggle = !!(policy.controllable && policy.can_change && !d.banned && !d.soft_deleted);
        const selected = desired || effective || 'normal';

        // A client that can't switch modes has nothing to show or do here: leave the section out
        if (!supportLocked && !policy.controllable) return '';
        const modeLabel = (m) => {
            if (m === 'normal') return _('device_detail.connection_mode_normal');
            if (m === 'incoming-only') return _('device_detail.connection_mode_incoming_only');
            return m || '–';
        };

        let body = '';
        if (supportLocked) {
            body = `<p class="form-hint">${Utils.escapeHtml(_('device_detail.connection_mode_support_locked'))}</p>`;
        } else {
            body = `
                <div class="device-panel-info-grid">
                    ${_infoRow(_('device_detail.connection_mode_effective'), Utils.escapeHtml(modeLabel(effective)))}
                    ${_infoRow(_('device_detail.connection_mode_desired'), Utils.escapeHtml(modeLabel(desired)))}
                    ${_infoRow(_('device_detail.connection_mode_status'), Utils.escapeHtml(_connectionModeStatusLabel(command.status)))}
                    ${command.rejection_code ? _infoRow(_('device_detail.connection_mode_status_rejected'), Utils.escapeHtml(command.rejection_code)) : ''}
                </div>
                ${canToggle ? `
                <div class="device-panel-conn-form">
                    <div class="form-group">
                    <label class="form-label" for="dp-conn-mode">${Utils.escapeHtml(_('device_detail.connection_mode_title'))}</label>
                    <select id="dp-conn-mode" class="form-select">
                        <option value="normal"${selected === 'normal' ? ' selected' : ''}>${Utils.escapeHtml(_('device_detail.connection_mode_normal'))}</option>
                        <option value="incoming-only"${selected === 'incoming-only' ? ' selected' : ''}>${Utils.escapeHtml(_('device_detail.connection_mode_incoming_only'))}</option>
                    </select>
                    </div>
                    <div class="form-group">
                    <label class="form-label" for="dp-conn-reason">${Utils.escapeHtml(_('device_detail.connection_mode_reason'))}</label>
                    <input id="dp-conn-reason" class="form-input" maxlength="500" placeholder="${Utils.escapeHtml(_('device_detail.connection_mode_reason_placeholder'))}">
                    </div>
                    <div><button class="btn" id="dp-conn-apply" type="button">${Utils.escapeHtml(_('device_detail.connection_mode_apply'))}</button></div>
                </div>` : ''}
            `;
        }

        return `
        <div class="device-panel-section" id="dp-connection-mode">
            <div class="device-panel-section-title"><span class="material-icons">swap_horiz</span> ${_('device_detail.connection_mode_title')}</div>
            ${body}
        </div>`;
    }

    async function _saveConnectionMode() {
        if (!device?.id) return;
        const mode = document.getElementById('dp-conn-mode')?.value;
        const reason = (document.getElementById('dp-conn-reason')?.value || '').trim();
        if (!reason) {
            Notifications.error(_('device_detail.connection_mode_reason'));
            return;
        }
        const button = document.getElementById('dp-conn-apply');
        if (button) button.disabled = true;
        try {
            await Utils.api('/api/devices/' + encodeURIComponent(device.id) + '/connection-mode', {
                method: 'POST',
                body: JSON.stringify({ mode, reason })
            });
            Notifications.success(_('device_detail.connection_mode_saved'));
            device = await Utils.api('/api/devices/' + encodeURIComponent(device.id));
            _render();
        } catch (err) {
            Notifications.error(err.message || _('device_detail.connection_mode_failed'));
            if (button) button.disabled = false;
        }
    }

    function _infoRow(label, valueHTML, copyValue) {
        const value = copyValue
            ? `<span class="value-field"><span class="value">${valueHTML}</span><button type="button" class="device-panel-copy-btn" data-copy="${Utils.escapeHtml(copyValue)}" aria-label="${_('actions.copy')} ${Utils.escapeHtml(label)}">${_('actions.copy')}</button></span>`
            : valueHTML;
        return `
        <div class="device-panel-info-row">
            <span class="device-panel-info-label">${label}</span>
            <span class="device-panel-info-value">${value}</span>
        </div>`;
    }

    /**
     * Render a metric card with circular progress indicator
     */
    function _metricCard(label, value, icon) {
        const available = typeof value === 'number' && Number.isFinite(value);
        const pct = available ? Math.min(100, Math.max(0, Math.round(value))) : 0;
        const colorClass = !available ? 'unsupported' : pct > 90 ? 'critical' : pct > 70 ? 'warning' : 'normal';
        return `
        <div class="device-panel-metric-card ${colorClass}">
            <div class="device-panel-metric-header">
                <span class="material-icons">${icon}</span>
                <span class="device-panel-metric-label">${label}</span>
            </div>
            <div class="device-panel-metric-bar-container">
                <div class="device-panel-metric-bar" style="width: ${available ? pct : 0}%"></div>
            </div>
            <div class="device-panel-metric-value">${available ? pct + '%' : '—'}</div>
        </div>`;
    }

    /**
     * Render a mini bar chart from an array of values (0-100)
     */
    function _miniBarChart(values, type) {
        if (!values || values.length === 0) return '';
        // Reverse so oldest is on the left
        const reversed = [...values].reverse();
        return `<div class="device-panel-mini-bars">` +
            reversed.map(v => {
                const pct = Math.min(100, Math.max(0, Math.round(v || 0)));
                const colorClass = pct > 90 ? 'critical' : pct > 70 ? 'warning' : 'normal';
                return `<div class="device-panel-mini-bar ${colorClass}" style="height: ${Math.max(2, pct)}%" title="${pct}%"></div>`;
            }).join('') +
            `</div>`;
    }

    /**
     * Format CPU frequency
     */
    function _formatFreq(ghz) {
        if (!ghz || ghz <= 0) return '-';
        if (ghz >= 1) return ghz.toFixed(2) + ' GHz';
        return (ghz * 1000).toFixed(0) + ' MHz';
    }

    /**
     * Format memory size
     */
    function _formatMemory(gb) {
        if (!gb || gb <= 0) return '-';
        if (gb >= 1024) return (gb / 1024).toFixed(1) + ' TB';
        if (gb >= 1) return gb.toFixed(1) + ' GB';
        return (gb * 1024).toFixed(0) + ' MB';
    }

    /**
     * Safely parse JSON string or return fallback
     */
    function _safeParseJSON(val, fallback) {
        if (Array.isArray(val)) return val;
        if (typeof val === 'object' && val !== null) return val;
        if (typeof val !== 'string' || !val) return fallback;
        try { return JSON.parse(val); } catch (e) { return fallback; }
    }

    function _lastSeenValue(lastOnline) {
        if (!Utils.parseDate(lastOnline)) return Utils.emptyHtml(_('time.never'));
        const rel = Utils.formatRelativeTime(lastOnline);
        return `${Utils.timeHtml(lastOnline, { relative: false })} <span class="device-panel-relative-time">(${Utils.escapeHtml(rel)})</span>`;
    }

    /** "Banned on 5 Nov 2026, 18:35 by admin" (without "by" when the console has no record of who) */
    function _banLine(d) {
        const when = Utils.parseDate(d.banned_at) ? Utils.formatDate(d.banned_at) : '';
        if (when && d.banned_by) return _('device_detail.banned_on_by', { date: when, user: d.banned_by });
        if (when) return _('device_detail.banned_on', { date: when });
        if (d.banned_by) return _('device_detail.banned_by', { user: d.banned_by });
        return _('device_detail.banned_unknown');
    }

    function _folderName(folderId) {
        if (!folderId) return _('folders.unassigned');
        // Try to get folder name from the global folders list (devices.js maintains it)
        if (window._betterdesk_folders) {
            const target = Number(folderId);
            const f = window._betterdesk_folders.find(item => Number(item.id) === target);
            if (f) return Utils.escapeHtml(f.name);
        }
        return '#' + folderId;
    }

    function _statusTierBadge(tier) {
        const cls = (tier || 'offline').toLowerCase();
        const label = _('status.' + cls) || cls;
        return `<span class="device-panel-status-badge ${cls}"><span class="status-dot"></span>${label}</span>`;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Events
    // ──────────────────────────────────────────────────────────────────────

    function _attachEvents() {
        if (!overlayEl) return;
        const panel = overlayEl.querySelector('#device-panel-inner');

        // Close button
        panel.querySelector('.device-panel-close')?.addEventListener('click', _requestClose);

        // Footer buttons
        panel.querySelector('#dp-close-btn')?.addEventListener('click', _requestClose);
        panel.querySelector('#dp-edit-btn')?.addEventListener('click', function () { _startEdit({}); });
        panel.querySelector('#dp-edit-cancel')?.addEventListener('click', function () { _cancelEdit(false); });
        panel.querySelector('#dp-edit-save')?.addEventListener('click', _saveEdit);
        if (editMode) _attachEditEvents(panel);
        panel.querySelector('#dp-connect-btn')?.addEventListener('click', function () {
            // Unified web remote client (/remote/:id); on a phone the list asks first
            _connect('web');
        });

        // Tabs
        panel.querySelectorAll('.device-panel-tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                _switchTab(tab.dataset.tab);
            });
        });

        // Views inside "Live data"
        panel.querySelectorAll('[data-live-view]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                liveView = btn.dataset.liveView;
                _switchTab('live');
            });
        });

        // Copy buttons
        panel.querySelectorAll('.device-panel-copy-btn').forEach(function (btn) {
            btn.addEventListener('click', async function (e) {
                e.stopPropagation();
                const text = btn.dataset.copy;
                if (!text) return;
                await Utils.copyToClipboard(text);
                Notifications.success(_('common.copied'));
            });
        });

        // Tag events
        _attachTagEvents(panel);

        panel.querySelector('[data-refresh-hardware]')?.addEventListener('click', async function (event) {
            event.preventDefault();
            if (!device?.id) return;
            const button = event.currentTarget;
            button.disabled = true;
            try {
                await Utils.api(`/api/devices/${encodeURIComponent(device.id)}/telemetry/refresh`, {
                    method: 'POST'
                });
                Notifications.success(_('device_detail.hardware_refresh_requested'));
            } catch (err) {
                Notifications.error(err.message || _('errors.server_error'));
            } finally {
                button.disabled = false;
            }
        });

        // Notes save
        panel.querySelector('#dp-notes-save')?.addEventListener('click', _saveNotes);
        panel.querySelector('#dp-conn-apply')?.addEventListener('click', _saveConnectionMode);

        // Action cards
        panel.querySelectorAll('.device-panel-action-card').forEach(function (card) {
            card.addEventListener('click', function () {
                if (card.classList.contains('disabled')) return;
                _handleAction(card.dataset.action);
            });
        });
    }

    function _switchTab(tabId) {
        // The agent views used to be tabs of their own; they now live in "Live data"
        if (AGENT_TABS.indexOf(tabId) !== -1) {
            liveView = tabId;
            tabId = 'live';
        }
        if (!overlayEl) return;
        const panel = overlayEl.querySelector('#device-panel-inner');
        // A tab the user can't see (permissions, support agent) falls back to the overview
        if (!panel.querySelector(`.device-panel-tab[data-tab="${tabId}"]`)) tabId = 'overview';
        activeTab = tabId;

        panel.querySelectorAll('.device-panel-tab').forEach(function (t) {
            t.classList.toggle('active', t.dataset.tab === tabId);
            t.setAttribute('aria-selected', t.dataset.tab === tabId ? 'true' : 'false');
        });
        panel.querySelectorAll('.device-panel-tab-pane').forEach(function (p) {
            p.classList.toggle('active', p.dataset.pane === tabId);
        });

        if (tabId === 'hardware' && device && (!inventoryData || inventoryData.id !== device.id) && !inventoryLoading) {
            _loadInventory();
        }

        if (tabId === 'live') {
            const views = _liveViews();
            if (views.indexOf(liveView) === -1) liveView = views[0];
            panel.querySelectorAll('[data-live-view]').forEach(function (b) {
                b.setAttribute('aria-pressed', b.dataset.liveView === liveView ? 'true' : 'false');
            });
            panel.querySelectorAll('.device-panel-live-view').forEach(function (v) {
                v.hidden = v.dataset.livePane !== liveView;
            });
            // Lazy-load agent data on first activation.
            _loadAgentTab(liveView);
        }
    }

    /** Whether the signed-in user may do this; the server checks again */
    function _can(permission) {
        return !(window.Utils && typeof Utils.can === 'function') || Utils.can(permission);
    }

    /** The Actions tab only appears when it holds at least one action for this user */
    function _hasActions() {
        if (!device) return false;
        if (device.soft_deleted) return _can('device.delete');
        return _can('device.connect') || _can('device.edit') || _can('device.change_id')
            || _can('device.ban') || _can('device.delete');
    }

    /** Connect from the panel: same path as the list (asks first on a phone) */
    function _connect(kind) {
        if (!device) return;
        if (kind === 'desktop') {
            window.open('rustdesk://' + encodeURIComponent(device.id), '_blank');
            return;
        }
        if (window.BetterDeskDevices && typeof window.BetterDeskDevices.connect === 'function') {
            window.BetterDeskDevices.connect(device.id, { deviceName: device.display_name || device.hostname || '' });
        } else {
            window.open('/remote/' + encodeURIComponent(device.id), '_blank');
        }
    }

    // ── Agent-backed tabs ───────────────────────────────────────────────

    // Track which tabs have been loaded so we don't refetch on every click.
    const _agentTabLoaded = {};

    async function _loadAgentTab(tabId) {
        if (_agentTabLoaded[tabId]) return;
        _agentTabLoaded[tabId] = true;

        if (!device || !device.id) return;
        const pane = overlayEl?.querySelector(`[data-agent-pane="${tabId}"]`);
        if (!pane) return;

        pane.innerHTML = `<div class="device-panel-agent-loading">
            <span class="material-icons spinning">autorenew</span>
            <div>${_('common.loading')}</div>
        </div>`;

        const endpointMap = {
            services:  { method: 'GET',  url: `/api/devices/${encodeURIComponent(device.id)}/services`  },
            processes: { method: 'GET',  url: `/api/devices/${encodeURIComponent(device.id)}/processes` },
            events:    { method: 'GET',  url: `/api/devices/${encodeURIComponent(device.id)}/events?limit=200` },
            activity:  { method: 'GET',  url: `/api/devices/${encodeURIComponent(device.id)}/activity`  },
            files:     { method: 'POST', url: `/api/devices/${encodeURIComponent(device.id)}/files/browse`, body: { path: '/', show_hidden: false } }
        };

        const ep = endpointMap[tabId];
        if (!ep) return;

        try {
            let resp;
            if (ep.method === 'POST') {
                resp = await Utils.api(ep.url, { method: 'POST', body: JSON.stringify(ep.body) });
            } else {
                resp = await Utils.api(ep.url);
            }
            const data = (resp && resp.data) || resp || null;
            _renderAgentTab(tabId, data, pane);
        } catch (err) {
            _agentTabLoaded[tabId] = false; // allow retry
            pane.innerHTML = _agentErrorHTML(err, tabId);
        }
    }

    function _agentErrorHTML(err, tabId) {
        const msg = err && err.message ? String(err.message) : 'unknown';
        // Differentiate offline vs generic error for clearer UX.
        const isOffline = msg.indexOf('503') !== -1 || msg.indexOf('offline') !== -1;
        const isTimeout = msg.indexOf('504') !== -1 || msg.indexOf('timeout') !== -1;
        const icon = isOffline ? 'cloud_off' : isTimeout ? 'hourglass_empty' : 'error_outline';
        const title = isOffline
            ? _('device_detail.agent_offline') || 'Agent is offline'
            : isTimeout
            ? _('device_detail.agent_timeout') || 'Agent did not respond in time'
            : _('device_detail.agent_error') || 'Failed to load data from agent';
        return `<div class="device-panel-agent-error">
            <span class="material-icons">${icon}</span>
            <div class="device-panel-agent-error-title">${title}</div>
            <div class="device-panel-agent-error-hint">${Utils.escapeHtml(msg)}</div>
            <button class="btn btn-secondary btn-sm" data-retry-tab="${tabId}">
                ${Utils.icon('refresh')}${_('actions.retry') || 'Retry'}
            </button>
        </div>`;
    }

    function _renderAgentTab(tabId, data, pane) {
        if (data?.pending) {
            pane.innerHTML = `
                <div class="device-panel-agent-empty">
                    <div>${_('device_detail.agent_pending')}</div>
                    <div class="device-panel-agent-hint">${_('device_detail.agent_pending_hint')}</div>
                    <button type="button" class="btn btn-sm" data-retry-tab="${tabId}">${Utils.icon('refresh')}${_('actions.refresh')}</button>
                </div>`;
            pane.querySelector('[data-retry-tab]')?.addEventListener('click', function () {
                _agentTabLoaded[tabId] = false;
                _loadAgentTab(tabId);
            });
            return;
        }
        if (tabId === 'services') {
            pane.innerHTML = _renderServicesList(data);
            _attachServiceEvents(pane);
        } else if (tabId === 'processes') {
            pane.innerHTML = _renderProcessList(data);
            _attachProcessEvents(pane);
        } else if (tabId === 'events') {
            pane.innerHTML = _renderEventList(data);
        } else if (tabId === 'activity') {
            pane.innerHTML = _renderActivity(data);
        } else if (tabId === 'files') {
            pane.innerHTML = _renderFileBrowser(data, '/');
            _attachFileBrowserEvents(pane);
        }

        // Generic retry button handler
        pane.querySelector('[data-retry-tab]')?.addEventListener('click', function () {
            const tid = this.dataset.retryTab;
            _agentTabLoaded[tid] = false;
            _loadAgentTab(tid);
        });
    }

    function _renderServicesList(data) {
        const services = Array.isArray(data?.services) ? data.services : Array.isArray(data) ? data : [];
        if (!services.length) {
            return `<div class="device-panel-agent-empty">${_('device_detail.agent_empty')}</div>`;
        }
        const rows = services.slice(0, 500).map(s => `
            <tr data-service-name="${Utils.escapeHtml(s.name || '')}">
                <td>${Utils.escapeHtml(s.name || '')}</td>
                <td>${Utils.escapeHtml(s.display_name || s.name || '')}</td>
                <td>${s.status ? Utils.statusHtml(s.status === 'running' ? 'good' : 'neutral', s.status) : Utils.emptyHtml()}</td>
                <td>${Utils.escapeHtml(s.start_type || '-')}</td>
                <td class="device-panel-agent-actions">
                    ${_can('device.edit') ? `<button type="button" class="btn btn-sm" data-service-action="start">${_('device_detail.service_start_action')}</button>
                    <button type="button" class="btn btn-sm" data-service-action="stop">${_('device_detail.service_stop_action')}</button>` : ''}
                </td>
            </tr>`).join('');
        return `<table class="device-panel-agent-table">
            <thead><tr>
                <th>${_('device_detail.service_name') || 'Name'}</th>
                <th>${_('device_detail.service_display') || 'Display'}</th>
                <th>${_('device_detail.service_status') || 'Status'}</th>
                <th>${_('device_detail.service_start') || 'Start'}</th>
                <th><span class="sr-only">${_('devices.actions')}</span></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function _attachServiceEvents(pane) {
        pane.querySelectorAll('[data-service-action]').forEach(button => {
            button.addEventListener('click', async function () {
                const row = button.closest('tr');
                const name = row?.dataset.serviceName;
                if (!name || !device?.id) return;
                button.disabled = true;
                try {
                    const response = await Utils.api(`/api/devices/${encodeURIComponent(device.id)}/telemetry/command`, {
                        method: 'POST',
                        body: { command: 'service.control', args: { name, action: button.dataset.serviceAction } }
                    });
                    if (response?.pending || response?.data?.pending) {
                        Notifications.success(_('device_detail.command_queued'));
                    } else {
                        Notifications.success(_('device_detail.service_command_done'));
                    }
                } catch (err) {
                    Notifications.error(err.message || _('errors.server_error'));
                } finally {
                    button.disabled = false;
                }
            });
        });
    }

    function _renderProcessList(data) {
        const procs = Array.isArray(data?.processes) ? data.processes : Array.isArray(data) ? data : [];
        if (!procs.length) {
            return `<div class="device-panel-agent-empty">${_('device_detail.agent_empty')}</div>`;
        }
        // Sort by CPU descending, show top 200
        procs.sort((a, b) => (b.cpu || 0) - (a.cpu || 0));
        const rows = procs.slice(0, 200).map(p => `
            <tr>
                <td>${Utils.escapeHtml(String(p.pid ?? '-'))}</td>
                <td>${Utils.escapeHtml(p.name || '-')}</td>
                <td>${Utils.escapeHtml(p.user || '-')}</td>
                <td>${Number(p.cpu || 0).toFixed(1)}%</td>
                <td>${Number(p.memory_mb || 0).toFixed(0)} MB</td>
                <td>${_can('device.edit') ? `<button type="button" class="btn btn-sm" data-process-kill="${Utils.escapeHtml(String(p.pid ?? ''))}" data-process-name="${Utils.escapeHtml(p.name || '')}">${_('device_detail.process_end')}</button>` : ''}</td>
            </tr>`).join('');
        return `<table class="device-panel-agent-table">
            <thead><tr>
                <th>PID</th>
                <th>${_('device_detail.process_name') || 'Name'}</th>
                <th>${_('device_detail.process_user') || 'User'}</th>
                <th>CPU</th>
                <th>${_('device_detail.process_memory') || 'Memory'}</th>
                <th><span class="sr-only">${_('devices.actions')}</span></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }

    function _attachProcessEvents(pane) {
        pane.querySelectorAll('[data-process-kill]').forEach(button => {
            button.addEventListener('click', async function () {
                const pid = button.dataset.processKill;
                if (!pid || !device?.id) return;
                const ok = await Modal.confirm({
                    title: _('device_detail.process_end_title'),
                    message: _('device_detail.process_end_confirm', { name: button.dataset.processName || '-', pid }),
                    confirmLabel: _('device_detail.process_end'),
                    danger: true
                });
                if (!ok) return;
                button.disabled = true;
                try {
                    await Utils.api(`/api/devices/${encodeURIComponent(device.id)}/telemetry/command`, {
                        method: 'POST',
                        body: { command: 'process.terminate', args: { pid: Number(pid) } }
                    });
                    Notifications.success(_('device_detail.command_sent'));
                } catch (err) {
                    Notifications.error(err.message || _('errors.server_error'));
                } finally {
                    button.disabled = false;
                }
            });
        });
    }

    function _renderEventList(data) {
        const events = Array.isArray(data?.events) ? data.events : Array.isArray(data) ? data : [];
        if (!events.length) {
            return `<div class="device-panel-agent-empty">${_('device_detail.agent_empty')}</div>`;
        }
        const rows = events.slice(0, 500).map(e => {
            const level = String(e.level || 'info').toLowerCase();
            const levelClass = level === 'error' || level === 'critical' ? 'error'
                : level === 'warning' || level === 'warn' ? 'warn' : 'info';
            const detail = Utils.escapeHtml(JSON.stringify(e, null, 2));
            return `<details class="device-panel-event-row ${levelClass}">
                <summary>
                    <span class="device-panel-event-time">${Utils.escapeHtml(e.time || '')}</span>
                    <span class="device-panel-event-source">${Utils.escapeHtml(e.source || e.facility || '-')}</span>
                    <span class="device-panel-event-msg">${Utils.escapeHtml(e.message || '')}</span>
                </summary>
                <pre class="device-panel-event-detail">${detail}</pre>
            </details>`;
        }).join('');
        return `<div class="device-panel-event-list">${rows}</div>`;
    }

    function _renderActivity(data) {
        const items = Array.isArray(data?.apps) ? data.apps : Array.isArray(data) ? data : [];
        if (!items.length) {
            return `<div class="device-panel-agent-empty">${_('device_detail.agent_empty')}</div>`;
        }
        // Sort by total seconds
        items.sort((a, b) => (b.seconds || 0) - (a.seconds || 0));
        const maxSec = Math.max(1, items[0].seconds || 1);
        const rows = items.slice(0, 50).map(a => {
            const pct = Math.min(100, ((a.seconds || 0) / maxSec) * 100);
            const minutes = Math.floor((a.seconds || 0) / 60);
            return `<div class="device-panel-activity-row">
                <div class="device-panel-activity-name">${Utils.escapeHtml(a.name || a.app || '-')}</div>
                <div class="device-panel-activity-bar">
                    <div class="device-panel-activity-bar-fill" style="width:${pct.toFixed(1)}%"></div>
                </div>
                <div class="device-panel-activity-time">${minutes} min</div>
            </div>`;
        }).join('');
        return `<div class="device-panel-activity-list">${rows}</div>`;
    }

    function _renderFileBrowser(data, currentPath) {
        const entries = Array.isArray(data?.entries) ? data.entries : Array.isArray(data) ? data : [];
        const path = data?.path || currentPath || '/';
        const parent = data?.parent || null;
        const rows = entries.slice(0, 1000).map(e => {
            const icon = e.is_dir ? 'folder' : 'description';
            const size = e.is_dir ? '' : _formatBytes(e.size || 0);
            return `<div class="device-panel-file-row" data-is-dir="${e.is_dir ? '1' : '0'}" data-path="${Utils.escapeHtml(e.path || '')}">
                <span class="material-icons">${icon}</span>
                <div class="device-panel-file-name">${Utils.escapeHtml(e.name || '')}</div>
                <div class="device-panel-file-size">${size}</div>
                ${e.is_dir ? '' : `<button type="button" class="btn btn-sm device-panel-file-download">${Utils.icon('download')}${_('device_detail.file_download')}</button>`}
            </div>`;
        }).join('');
        return `<div class="device-panel-file-browser">
            <div class="device-panel-file-path">
                ${parent ? `<button type="button" class="btn btn-sm" data-fb-up="${Utils.escapeHtml(parent)}">${_('device_detail.parent_folder')}</button>` : ''}
                <span>${Utils.escapeHtml(path)}</span>
            </div>
            <div class="device-panel-file-list">${rows}</div>
        </div>`;
    }

    function _attachFileBrowserEvents(pane) {
        pane.querySelectorAll('[data-fb-up]').forEach(btn => {
            btn.addEventListener('click', () => _browseFiles(btn.dataset.fbUp));
        });
        pane.querySelectorAll('.device-panel-file-row').forEach(row => {
            row.addEventListener('dblclick', () => {
                if (row.dataset.isDir === '1') _browseFiles(row.dataset.path);
            });
            row.addEventListener('contextmenu', function (event) {
                event.preventDefault();
                if (row.dataset.isDir !== '1') _downloadFile(row.dataset.path);
            });
            row.querySelector('.device-panel-file-download')?.addEventListener('click', function (event) {
                event.stopPropagation();
                _downloadFile(row.dataset.path);
            });
        });
    }

    async function _downloadFile(path) {
        if (!device?.id || !path) return;
        try {
            const response = await Utils.api(`/api/devices/${encodeURIComponent(device.id)}/files/read`, {
                method: 'POST',
                body: JSON.stringify({ path, offset: 0, length: 1024 * 1024 })
            });
            const data = response?.data || response;
            if (data?.pending) {
                Notifications.success(_('device_detail.download_requested'));
                return;
            }
            const fileData = data?.data;
            if (!fileData) throw new Error(_('device_detail.file_empty'));
            const bytes = Uint8Array.from(atob(fileData), character => character.charCodeAt(0));
            const blob = new Blob([bytes], { type: 'application/octet-stream' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = path.split(/[\\/]/).pop() || 'download';
            link.click();
            URL.revokeObjectURL(link.href);
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    async function _browseFiles(path) {
        if (!device || !device.id) return;
        const pane = overlayEl?.querySelector('[data-agent-pane="files"]');
        if (!pane) return;
        pane.innerHTML = `<div class="device-panel-agent-loading"><span class="material-icons spinning">autorenew</span><div>${_('common.loading')}</div></div>`;
        try {
            const resp = await Utils.api(`/api/devices/${encodeURIComponent(device.id)}/files/browse`, {
                method: 'POST',
                body: JSON.stringify({ path, show_hidden: false })
            });
            pane.innerHTML = _renderFileBrowser(resp?.data || resp, path);
            _attachFileBrowserEvents(pane);
        } catch (err) {
            pane.innerHTML = _agentErrorHTML(err, 'files');
            pane.querySelector('[data-retry-tab]')?.addEventListener('click', function () {
                _agentTabLoaded['files'] = false;
                _loadAgentTab('files');
            });
        }
    }

    function _formatBytes(n) {
        if (!n) return '0 B';
        const k = 1024;
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(k)));
        return (n / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
    }

    // ── Tags ──

    function _attachTagEvents(panel) {
        const addBtn = panel.querySelector('#dp-tag-add-btn');
        const input = panel.querySelector('#dp-tag-input');

        _loadTagSuggestions(panel);

        if (addBtn && input) {
            addBtn.addEventListener('click', function () { _addTag(input.value.trim()); });
            input.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); _addTag(input.value.trim()); }
            });
        }

        panel.querySelectorAll('.device-panel-tag-remove').forEach(function (btn) {
            btn.addEventListener('click', function () { _removeTag(btn.dataset.tag); });
        });
    }

    async function _addTag(tag) {
        if (!tag || !device) return;
        const tags = [...(device.tags || [])];
        if (tags.includes(tag)) {
            Notifications.warning(_('device_detail.tag_exists'));
            return;
        }
        tags.push(tag);
        await _saveTags(tags);
    }

    async function _removeTag(tag) {
        if (!device) return;
        const tags = (device.tags || []).filter(function (t) { return t !== tag; });
        await _saveTags(tags);
    }

    async function _saveTags(tags) {
        try {
            await Utils.api('/api/devices/' + encodeURIComponent(device.id) + '/tags', {
                method: 'PUT',
                body: { tags: tags }
            });
            device.tags = tags;
            availableTags = Array.from(new Set(availableTags.concat(tags))).sort(function (a, b) {
                return a.localeCompare(b);
            });
            _render();
            _switchTab('tags');
            _notifyChanged();
            Notifications.success(_('common.saved'));
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    function _tagSuggestionOptions(currentTags) {
        const current = new Set(currentTags || []);
        return (availableTags || [])
            .filter(function (tag) { return tag && !current.has(tag); })
            .map(function (tag) { return `<option value="${Utils.escapeHtml(tag)}"></option>`; })
            .join('');
    }

    function _updateTagSuggestions(panel) {
        const list = panel.querySelector('#dp-tag-suggestions');
        if (!list || !device) return;
        list.innerHTML = _tagSuggestionOptions(device.tags || []);
    }

    async function _loadTagSuggestions(panel) {
        if (availableTagsLoaded) {
            _updateTagSuggestions(panel);
            return;
        }

        try {
            const response = await Utils.api('/api/tags');
            availableTags = response.tags || [];
        } catch (_) {
            availableTags = [];
        }

        availableTagsLoaded = true;
        _updateTagSuggestions(panel);
    }

    // ── Notes ──

    async function _saveNotes() {
        if (!device) return;
        const textarea = overlayEl.querySelector('#dp-notes-textarea');
        if (!textarea) return;
        const note = textarea.value.trim();

        try {
            await Utils.api('/api/devices/' + encodeURIComponent(device.id), {
                method: 'PATCH',
                body: { note: note }
            });
            device.note = note;
            _notifyChanged();
            Notifications.success(_('common.saved'));
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    // ── Edit mode ──
    // Display name, note, folder and tags are edited in place in the overview.
    // Same calls as the device list used in its dialog: PATCH /api/devices/:id
    // (display_name, note), PUT /api/devices/:id/tags, PATCH /api/devices/:id/folder.

    function _parseTagList(value) {
        if (Array.isArray(value)) return value.map(String).filter(Boolean);
        return String(value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean);
    }

    function _folderList() {
        return window._betterdesk_folders || editFolders || [];
    }

    async function _ensureEditFolders() {
        if (window._betterdesk_folders || editFolders) return;
        try {
            const response = await Utils.api('/api/folders');
            editFolders = response.folders || [];
        } catch (e) {
            editFolders = [];
        }
    }

    async function _ensureTagList() {
        if (availableTagsLoaded) return;
        try {
            const response = await Utils.api('/api/tags');
            availableTags = response.tags || [];
        } catch (e) {
            availableTags = [];
        }
        availableTagsLoaded = true;
    }

    function _editSnapshot() {
        if (!editState) return '';
        return JSON.stringify([editState.name.trim(), editState.note.trim(), String(editState.folder || ''), editState.tags.slice().sort(), editState.tagInput.trim()]);
    }

    function _editDirty() {
        return editMode && editState && _editSnapshot() !== editInitial;
    }

    async function _startEdit(options) {
        if (!device || !_can('device.edit') || device.soft_deleted || editMode) return;
        await Promise.all([_ensureEditFolders(), _ensureTagList()]);
        if (!device) return;
        editMode = true;
        editState = {
            name: device.display_name || '',
            note: device.note || '',
            folder: device.folder_id ? String(device.folder_id) : '',
            tags: _parseTagList(device.tags),
            tagInput: '',
        };
        editInitial = _editSnapshot();
        activeTab = 'overview';
        _render();
        const panel = overlayEl && overlayEl.querySelector('#device-panel-inner');
        const target = panel && panel.querySelector(options && options.focusTags ? '#dp-edit-tag-input' : '#dp-edit-name');
        if (target) target.focus();
    }

    function _captureEditForm(root) {
        if (!editState || !root) return;
        const name = root.querySelector('#dp-edit-name');
        const note = root.querySelector('#dp-edit-note');
        const folder = root.querySelector('#dp-edit-folder');
        const tagInput = root.querySelector('#dp-edit-tag-input');
        if (name) editState.name = name.value;
        if (note) editState.note = note.value;
        if (folder) editState.folder = folder.value;
        if (tagInput) editState.tagInput = tagInput.value;
    }

    function _editTagRowsHTML() {
        const esc = Utils.escapeHtml;
        if (!editState.tags.length) return `<li class="list-row is-empty">${esc(_('device_detail.no_tags'))}</li>`;
        return editState.tags.map(function (tag, i) {
            return `<li class="list-row">
                <span class="row-main" id="dp-edit-tag-${i}">${esc(tag)}</span>
                <span class="row-end"><button type="button" class="btn btn-sm" data-edit-tag-remove="${esc(tag)}" aria-describedby="dp-edit-tag-${i}">${esc(_('actions.remove'))}</button></span>
            </li>`;
        }).join('');
    }

    function _editFormHTML() {
        const esc = Utils.escapeHtml;
        const folders = _folderList();
        const has = new Set(editState.tags.map(function (t) { return t.toLowerCase(); }));
        const suggestions = (availableTags || []).filter(function (t) { return t && !has.has(String(t).toLowerCase()); });
        const onList = !!(window.BetterDeskDevices && window.BetterDeskDevices.showEditModal);
        return `
        <form class="device-panel-section device-panel-edit" id="dp-edit-form" novalidate aria-labelledby="dp-edit-title">
            <div class="device-panel-section-title" id="dp-edit-title">${esc(_('device_detail.edit_heading'))}</div>
            <div class="form-group">
                <label class="form-label" for="dp-edit-name">${esc(_('devices.display_name'))}</label>
                <input type="text" id="dp-edit-name" class="form-input" maxlength="128" value="${esc(editState.name)}" aria-describedby="dp-edit-name-hint">
                <p class="form-hint" id="dp-edit-name-hint">${esc(_('devices.display_name_hint'))}</p>
            </div>
            <div class="form-group">
                <label class="form-label" for="dp-edit-note">${esc(_('devices.note'))}</label>
                <textarea id="dp-edit-note" class="form-input" rows="3" maxlength="512">${esc(editState.note)}</textarea>
            </div>
            ${folders.length ? `
            <div class="form-group">
                <label class="form-label" for="dp-edit-folder">${esc(_('device_detail.folder'))}</label>
                <select id="dp-edit-folder" class="form-select"${onList ? ' aria-describedby="dp-edit-folder-hint"' : ''}>
                    <option value="">${esc(_('folders.unassigned'))}</option>
                    ${folders.map(function (f) { return `<option value="${esc(String(f.id))}"${String(f.id) === String(editState.folder) ? ' selected' : ''}>${esc(f.name)}</option>`; }).join('')}
                </select>
                ${onList ? `<p class="form-hint" id="dp-edit-folder-hint">${esc(_('devices.folder_hint'))}</p>` : ''}
            </div>` : ''}
            <div class="form-group">
                <span class="form-label" id="dp-edit-tags-label">${esc(_('device_detail.tags'))}</span>
                <p class="form-hint">${esc(_('devices.tags_device_hint'))}</p>
                <ul class="list device-panel-edit-tags" id="dp-edit-tags" aria-labelledby="dp-edit-tags-label">${_editTagRowsHTML()}</ul>
            </div>
            <div class="form-group">
                <label class="form-label" for="dp-edit-tag-input">${esc(_('devices.add_tag_label'))}</label>
                <div class="device-panel-tag-input-row">
                    <input type="text" id="dp-edit-tag-input" class="form-input" list="dp-edit-tag-suggestions" autocomplete="off" maxlength="50"
                           value="${esc(editState.tagInput)}" aria-describedby="dp-edit-tag-hint dp-edit-tag-status">
                    <datalist id="dp-edit-tag-suggestions">${suggestions.map(function (t) { return `<option value="${esc(t)}"></option>`; }).join('')}</datalist>
                    <button type="button" class="btn" id="dp-edit-tag-add">${Utils.icon('add')}${esc(_('device_detail.add_tag'))}</button>
                </div>
                <p class="form-hint" id="dp-edit-tag-hint">${esc(_('devices.add_tag_hint'))}</p>
                <p class="form-status is-error" id="dp-edit-tag-status" aria-live="polite"></p>
            </div>
        </form>`;
    }

    function _addEditTag(panel) {
        const input = panel.querySelector('#dp-edit-tag-input');
        const status = panel.querySelector('#dp-edit-tag-status');
        const tag = input ? input.value.trim() : '';
        if (!tag) return true;
        if (editState.tags.some(function (t) { return t.toLowerCase() === tag.toLowerCase(); })) {
            if (status) status.textContent = _('device_detail.tag_exists');
            return false;
        }
        editState.tags.push(tag);
        editState.tagInput = '';
        input.value = '';
        if (status) status.textContent = '';
        _refreshEditTags(panel);
        return true;
    }

    function _refreshEditTags(panel) {
        const list = panel.querySelector('#dp-edit-tags');
        if (list) list.innerHTML = _editTagRowsHTML();
        const datalist = panel.querySelector('#dp-edit-tag-suggestions');
        if (datalist) {
            const has = new Set(editState.tags.map(function (t) { return t.toLowerCase(); }));
            datalist.innerHTML = (availableTags || []).filter(function (t) { return t && !has.has(String(t).toLowerCase()); })
                .map(function (t) { return `<option value="${Utils.escapeHtml(t)}"></option>`; }).join('');
        }
    }

    function _attachEditEvents(panel) {
        const form = panel.querySelector('#dp-edit-form');
        if (!form) return;
        form.addEventListener('submit', function (e) { e.preventDefault(); _saveEdit(); });
        panel.querySelector('#dp-edit-tag-add')?.addEventListener('click', function () {
            _addEditTag(panel);
            panel.querySelector('#dp-edit-tag-input')?.focus();
        });
        const input = panel.querySelector('#dp-edit-tag-input');
        input?.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); _addEditTag(panel); }
        });
        input?.addEventListener('input', function () {
            const status = panel.querySelector('#dp-edit-tag-status');
            if (status) status.textContent = '';
        });
        panel.querySelector('#dp-edit-tags')?.addEventListener('click', function (e) {
            const btn = e.target.closest('[data-edit-tag-remove]');
            if (!btn) return;
            const tag = btn.dataset.editTagRemove;
            editState.tags = editState.tags.filter(function (t) { return t !== tag; });
            _refreshEditTags(panel);
            panel.querySelector('#dp-edit-tag-input')?.focus();
        });
        // Enter in the name field saves, like a form
        panel.querySelector('#dp-edit-name')?.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); _saveEdit(); }
        });
    }

    async function _confirmDiscard() {
        if (!_editDirty()) return true;
        return Modal.confirm({
            title: _('device_detail.discard_title'),
            message: _('device_detail.discard_message'),
            confirmLabel: _('device_detail.discard_confirm'),
            danger: true
        });
    }

    async function _cancelEdit(ask) {
        if (!editMode || editSaving) return;
        const panel = overlayEl && overlayEl.querySelector('#device-panel-inner');
        if (panel) _captureEditForm(panel);
        if (ask && !(await _confirmDiscard())) return;
        editMode = false;
        editState = null;
        _render();
        overlayEl?.querySelector('#dp-edit-btn')?.focus();
    }

    async function _requestClose() {
        if (editMode) {
            const panel = overlayEl && overlayEl.querySelector('#device-panel-inner');
            if (panel) _captureEditForm(panel);
            if (!(await _confirmDiscard())) return;
            editMode = false;
            editState = null;
        }
        close();
    }

    async function _saveEdit() {
        if (!editMode || editSaving || !device) return;
        const panel = overlayEl.querySelector('#device-panel-inner');
        _captureEditForm(panel);
        // A tag typed but not added yet is meant to be saved too
        if (!_addEditTag(panel)) return;
        const deviceId = device.id;
        const displayName = editState.name.trim();
        const note = editState.note.trim();
        const tags = editState.tags.slice();
        const folderChanged = String(editState.folder || '') !== String(device.folder_id || '') &&
            !(Number(editState.folder || 0) === 0 && Number(device.folder_id || 0) === 0);
        const status = panel.querySelector('#dp-edit-status');
        const saveBtn = panel.querySelector('#dp-edit-save');
        const cancelBtn = panel.querySelector('#dp-edit-cancel');

        editSaving = true;
        if (status) { status.className = 'form-status device-panel-edit-status'; status.textContent = ''; }
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = _('devices.saving'); }
        if (cancelBtn) cancelBtn.disabled = true;
        try {
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId), {
                method: 'PATCH',
                body: { display_name: displayName, note: note }
            });
            const tagResult = await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '/tags', {
                method: 'PUT',
                body: { tags: tags }
            });
            if (folderChanged) {
                await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '/folder', {
                    method: 'PATCH',
                    body: { folderId: editState.folder ? Number(editState.folder) : null }
                });
            }
            const savedTags = (tagResult && tagResult.tags) || tags;
            availableTags = Array.from(new Set(availableTags.concat(savedTags))).sort(function (a, b) { return a.localeCompare(b); });
            editSaving = false;
            editMode = false;
            editState = null;
            device = await Utils.api('/api/devices/' + encodeURIComponent(deviceId));
            _render();
            document.dispatchEvent(new CustomEvent('devices:updated', {
                detail: { id: deviceId, display_name: displayName, note: note, tags: savedTags }
            }));
            _notifyChanged();
            Notifications.success(_('common.saved'), displayName || device.hostname || deviceId);
            overlayEl?.querySelector('#dp-edit-btn')?.focus();
        } catch (err) {
            editSaving = false;
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _('actions.save'); }
            if (cancelBtn) cancelBtn.disabled = false;
            if (status) {
                status.className = 'form-status device-panel-edit-status is-error';
                status.textContent = (err && err.message) || _('errors.server_error');
            }
        }
    }

    /** Open the panel for a device straight in edit mode (options.focusTags starts in the tag field) */
    async function edit(deviceId, options) {
        if (!deviceId) return;
        if (!device || device.id !== deviceId || !overlayEl) await open(deviceId);
        if (!device || device.id !== deviceId) return;
        await _startEdit(options || {});
    }

    // ── Actions ──

    async function _handleAction(action) {
        if (!device) return;

        switch (action) {
            case 'edit':
                _startEdit({});
                break;

            case 'connect-desktop':
                _connect('desktop');
                break;

            case 'connect-web':
                _connect('web');
                break;

            case 'change-id':
                await _changeId();
                break;

            case 'toggle-ban':
                await _toggleBan();
                break;

            case 'delete':
                await _deleteDevice();
                break;

            case 'restore':
                await _restoreDevice();
                break;

            case 'permanent-delete':
                await _permanentDeleteDevice();
                break;
        }
    }

    async function _changeId() {
        // Capture device ID before async operation — panel close sets device=null
        const deviceId = device && device.id;
        if (!deviceId) return;

        if (device.online) {
            const proceed = await Modal.confirm({
                title: _('devices.change_id_title'),
                message: _('devices.change_id_online_warn'),
                confirmLabel: _('devices.change_id'),
                danger: false
            });
            if (!proceed) return;
        }

        const newId = await Modal.prompt({
            title: _('devices.change_id_title'),
            label: _('devices.new_id'),
            placeholder: 'NEWID123',
            hint: _('devices.change_id_hint')
        });
        if (!newId) return;
        if (newId.length < 6 || newId.length > 16) {
            Notifications.error(_('devices.id_length_error'));
            return;
        }
        if (!/^[A-Z0-9_-]+$/i.test(newId)) {
            Notifications.error(_('devices.id_format_error'));
            return;
        }
        try {
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '/change-id', {
                method: 'POST',
                body: { newId }
            });
            Notifications.success(_('devices.change_id_success'));
            close();
            _notifyChanged();
        } catch (err) {
            Notifications.error(err.message || _('errors.change_id_failed'));
        }
    }

    async function _toggleBan() {
        // Capture before async — panel close sets device=null
        const deviceId = device && device.id;
        const isBanned = device && device.banned;
        if (!deviceId) return;

        const action = isBanned ? 'unban' : 'ban';
        const deviceName = device.display_name || device.hostname || '';
        let answer;
        if (window.BetterDeskDevices && typeof window.BetterDeskDevices.confirmBanChange === 'function') {
            answer = await window.BetterDeskDevices.confirmBanChange(deviceId, isBanned, deviceName);
        } else {
            const ok = await Modal.confirm({
                title: _('devices.' + action + '_title'),
                message: _('devices.' + action + '_confirm', { id: deviceId }),
                confirmLabel: _(isBanned ? 'actions.unban' : 'actions.ban'),
                danger: !isBanned
            });
            answer = ok ? { reason: '' } : null;
        }
        if (!answer) return;
        try {
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '/' + action, {
                method: 'POST',
                body: isBanned ? {} : { reason: answer.reason }
            });
            Notifications.success(_('devices.' + action + '_success'));
            // Refresh panel if still open
            if (overlayEl) {
                device = await Utils.api('/api/devices/' + encodeURIComponent(deviceId));
                _render();
                // After a ban, the overview shows who banned it, when and why
                _switchTab(isBanned ? 'actions' : 'overview');
            }
            _notifyChanged();
        } catch (err) {
            Notifications.error(err.message || _('errors.' + action + '_failed'));
        }
    }

    async function _restoreDevice() {
        const deviceId = device && device.id;
        if (!deviceId) return;

        const confirmed = await Modal.confirm({
            title: _('devices.restore_title'),
            message: _('devices.restore_confirm', { id: deviceId }),
            confirmLabel: _('devices.restore_action'),
            danger: false
        });
        if (!confirmed) return;

        try {
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '/restore', { method: 'POST' });
            Notifications.success(_('devices.restore_success'));
            device = await Utils.api('/api/devices/' + encodeURIComponent(deviceId));
            _render();
            _notifyChanged();
        } catch (err) {
            Notifications.error(err.message || _('devices.restore_failed'));
        }
    }

    async function _permanentDeleteDevice() {
        const deviceId = device && device.id;
        if (!deviceId) return;

        const confirmed = await Modal.confirm({
            title: _('devices.permanent_delete_title'),
            message: _('devices.permanent_delete_confirm', { id: deviceId }),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + '?hard=true', { method: 'DELETE' });
            Notifications.success(_('devices.permanent_delete_success'));
            close();
            _notifyChanged();
        } catch (err) {
            Notifications.error(err.message || _('errors.delete_failed'));
        }
    }

    async function _deleteDevice() {
        // Capture before async — panel close sets device=null
        const deviceId = device && device.id;
        if (!deviceId) return;

        const releaseIdInput = Utils.generateId();
        const deleteChoice = await new Promise((resolve) => {
            Modal.show({
                title: _('devices.delete_title'),
                content: `
                    <p>${Utils.escapeHtml(_('devices.delete_confirm', { id: deviceId }))}</p>
                    <p class="form-hint">${Utils.escapeHtml(_('devices.delete_reserved_hint'))}</p>
                    <label class="form-check" for="${releaseIdInput}">
                        <input type="checkbox" id="${releaseIdInput}">
                        <span>${Utils.escapeHtml(_('devices.delete_hard_option'))}</span>
                    </label>
                    <p class="form-hint">${Utils.escapeHtml(_('devices.delete_hard_hint'))}</p>
                `,
                buttons: [
                    {
                        label: _('actions.cancel'),
                        class: 'btn-secondary',
                        onClick: () => {
                            Modal.close();
                            resolve(null);
                        }
                    },
                    {
                        label: _('actions.delete'),
                        class: 'btn-danger',
                        icon: 'delete',
                        onClick: () => {
                            const hard = !!document.getElementById(releaseIdInput)?.checked;
                            Modal.close();
                            resolve({ hard });
                        }
                    }
                ],
                closable: true,
                onClose: () => resolve(null)
            });
        });
        if (!deleteChoice) return;
        try {
            const query = deleteChoice.hard ? '?hard=true' : '';
            await Utils.api('/api/devices/' + encodeURIComponent(deviceId) + query, { method: 'DELETE' });
            Notifications.success(
                deleteChoice.hard
                    ? _('devices.permanent_delete_success')
                    : _('devices.delete_soft_success_hint')
            );
            close();
            _notifyChanged();
        } catch (err) {
            Notifications.error(err.message || _('errors.delete_failed'));
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Auto-refresh
    // ──────────────────────────────────────────────────────────────────────

    function _startRefresh(deviceId) {
        _stopRefresh();
        refreshTimer = setInterval(async function () {
            try {
                const updated = await Utils.api('/api/devices/' + encodeURIComponent(deviceId));
                if (updated && overlayEl) {
                    device = updated;
                    // Only re-render header status (minimal update, avoid losing form state)
                    const statusBar = overlayEl.querySelector('.device-panel-status-bar');
                    if (statusBar) {
                        const statusInfo = _resolveDeviceStatus(device);
                        const badge = statusBar.querySelector('.device-panel-status-badge');
                        if (badge) {
                            badge.className = 'device-panel-status-badge status ' + statusInfo.className;
                            if (statusInfo.title) {
                                badge.title = statusInfo.title;
                            } else {
                                badge.removeAttribute('title');
                            }
                            badge.textContent = statusInfo.label;
                        }
                    }
                }
            } catch (e) {
                // Silent — device may have been deleted
            }
        }, 15000);
    }

    function _stopRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // Notify parent (devices table) of changes
    // ──────────────────────────────────────────────────────────────────────

    function _notifyChanged() {
        document.dispatchEvent(new CustomEvent('deviceDetail:changed'));
    }

    // ──────────────────────────────────────────────────────────────────────
    // Cleanup on navigation
    // ──────────────────────────────────────────────────────────────────────
    window.addEventListener('beforeunload', function () {
        _stopRefresh();
    });

    return { open: open, close: close, edit: edit };
})();

window.DeviceDetail = DeviceDetail;
