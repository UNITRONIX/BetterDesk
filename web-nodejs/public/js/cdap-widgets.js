/**
 * BetterDesk Console - CDAP Widget Renderer
 * Renders device widgets based on CDAP manifest and polls state updates.
 * Supports Phase 2 widget types: toggle, gauge, button, led, text, slider, select, chart.
 */

(function () {
    'use strict';

    const __ = window.BetterDesk?.translations || {};
    const t = (key) => {
        const parts = key.split('.');
        let val = __;
        for (const p of parts) {
            val = val?.[p];
        }
        return val || key;
    };

    const STATE_POLL_INTERVAL = 3000;
    const INFO_POLL_INTERVAL = 10000;

    let deviceId = '';
    let manifest = null;
    let widgetState = {};
    let statePollTimer = null;
    let infoPollTimer = null;
    let isConnected = false;

    // ── Initialization ───────────────────────────────────────────────────

    function init() {
        const page = document.querySelector('.cdap-device-page');
        if (!page) return;

        deviceId = page.dataset.deviceId;
        if (!deviceId) return;

        loadDeviceInfo();
        loadManifestAndState();
        loadLinkedDevices();
        initLinkButton();
    }

    async function loadDeviceInfo() {
        try {
            const res = await fetch(`/api/cdap/devices/${encodeURIComponent(deviceId)}`, {
                headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
            });
            if (!res.ok) throw new Error(res.statusText);
            const data = await res.json();

            if (data.success && data.data) {
                updateDeviceHeader(data.data);
            }
        } catch (err) {
            console.error('CDAP device info error:', err);
        }

        // Schedule periodic info refresh
        if (!infoPollTimer) {
            infoPollTimer = setInterval(loadDeviceInfo, INFO_POLL_INTERVAL);
        }
    }

    function updateDeviceHeader(info) {
        isConnected = !!info.connected;

        // Device name (prefer manifest name or hostname)
        const nameEl = document.getElementById('cdap-device-name');
        if (nameEl) {
            nameEl.textContent = info.manifest?.device?.name || info.hostname || deviceId;
        }

        // Device type
        const typeEl = document.getElementById('cdap-device-type');
        if (typeEl && info.manifest?.device?.type) {
            const iconMap = {
                scada: 'factory',
                iot: 'sensors',
                os_agent: 'computer',
                network: 'router',
                camera: 'videocam',
                desktop: 'desktop_windows',
                custom: 'memory'
            };
            const icon = iconMap[info.manifest.device.type] || 'memory';
            typeEl.textContent = '';
            const iconEl = document.createElement('span');
            iconEl.className = 'material-icons';
            iconEl.textContent = icon;
            const labelEl = document.createElement('span');
            labelEl.textContent = info.manifest.device.type;
            typeEl.appendChild(iconEl);
            typeEl.appendChild(labelEl);
        }

        // Version
        const verEl = document.getElementById('cdap-device-version');
        if (verEl && info.manifest?.device?.firmware_version) {
            verEl.innerHTML = `<span class="material-icons">info</span><span>v${escapeHtml(info.manifest.device.firmware_version)}</span>`;
        }

        // Uptime
        const uptimeEl = document.getElementById('cdap-device-uptime');
        if (uptimeEl && info.connected_at) {
            const uptime = formatDuration(Date.now() - new Date(info.connected_at).getTime());
            uptimeEl.innerHTML = `<span class="material-icons">schedule</span><span>${uptime}</span>`;
        }

        // Status indicator
        const statusEl = document.getElementById('cdap-device-status');
        if (statusEl) {
            statusEl.className = `cdap-device-status ${isConnected ? 'online' : 'offline'}`;
            statusEl.innerHTML = `
                <span class="cdap-status-dot"></span>
                <span class="cdap-status-text">${isConnected ? t('cdap.connected') : t('cdap.disconnected')}</span>
            `;
        }

        // Offline banner
        const banner = document.getElementById('cdap-offline-banner');
        if (banner) {
            banner.classList.toggle('hidden', isConnected);
        }
    }

    async function loadManifestAndState() {
        const loading = document.getElementById('cdap-loading');
        const grid = document.getElementById('cdap-widget-grid');
        const empty = document.getElementById('cdap-empty');

        try {
            // Fetch manifest and state in parallel
            const [manifestRes, stateRes] = await Promise.all([
                fetch(`/api/cdap/devices/${encodeURIComponent(deviceId)}/manifest`, {
                    headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
                }),
                fetch(`/api/cdap/devices/${encodeURIComponent(deviceId)}/state`, {
                    headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
                })
            ]);

            if (manifestRes.ok) {
                const mData = await manifestRes.json();
                if (mData.success) manifest = mData.data;
            }

            if (stateRes.ok) {
                const sData = await stateRes.json();
                if (sData.success) widgetState = sData.data || {};
            }

            if (loading) loading.classList.add('hidden');

            if (!manifest || !manifest.widgets || manifest.widgets.length === 0) {
                if (empty) empty.classList.remove('hidden');
                return;
            }

            renderWidgets();
            startStatePolling();
            startAlertPolling();

        } catch (err) {
            console.error('CDAP manifest/state error:', err);
            if (loading) {
                loading.innerHTML = `<p class="cdap-error">${t('cdap.load_error')}</p>`;
            }
        }
    }

    // ── Widget Rendering ─────────────────────────────────────────────────

    function renderWidgets() {
        const grid = document.getElementById('cdap-widget-grid');
        if (!grid || !manifest?.widgets) return;

        // Remove loading state
        const loading = document.getElementById('cdap-loading');
        if (loading) loading.remove();

        // Group widgets by category if categories exist
        const widgets = manifest.widgets;
        const grouped = groupByCategory(widgets);

        let html = '';
        for (const [category, catWidgets] of Object.entries(grouped)) {
            if (category !== '_default') {
                html += `<div class="cdap-widget-category"><h3>${escapeHtml(category)}</h3></div>`;
            }
            for (const widget of catWidgets) {
                html += renderWidget(widget);
            }
        }

        grid.innerHTML = html;

        // Apply initial state values
        applyState(widgetState);

        // Show command log if any interactive widgets
        const hasInteractive = widgets.some(w =>
            ['toggle', 'button', 'slider', 'select', 'file_browser'].includes(w.type)
        );
        if (hasInteractive) {
            const log = document.getElementById('cdap-command-log');
            if (log) log.classList.remove('hidden');
        }

        // Bind widget event handlers
        bindWidgetEvents();
    }

    function groupByCategory(widgets) {
        const groups = {};
        for (const w of widgets) {
            const cat = w.category || '_default';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(w);
        }
        return groups;
    }

    function renderWidget(widget) {
        const { id, type, label, unit, read_only } = widget;
        const safeId = escapeHtml(id);
        const safeLabel = escapeHtml(label || id);
        const readOnlyClass = read_only ? ' cdap-widget-readonly' : '';

        const sizeClass = getWidgetSizeClass(type, widget);

        let inner = '';
        switch (type) {
            case 'toggle':
                inner = renderToggle(widget);
                break;
            case 'gauge':
                inner = renderGauge(widget);
                break;
            case 'button':
                inner = renderButton(widget);
                break;
            case 'led':
                inner = renderLed(widget);
                break;
            case 'text':
                inner = renderText(widget);
                break;
            case 'slider':
                inner = renderSlider(widget);
                break;
            case 'select':
                inner = renderSelect(widget);
                break;
            case 'chart':
                inner = renderChart(widget);
                break;
            case 'table':
                inner = renderTable(widget);
                break;
            case 'terminal':
                inner = renderTerminal(widget);
                break;
            case 'desktop':
                inner = renderDesktop(widget);
                break;
            case 'video_stream':
                inner = renderVideoStream(widget);
                break;
            case 'file_browser':
                inner = renderFileBrowser(widget);
                break;
            case 'audio':
                inner = renderAudioStream(widget);
                break;
            default:
                inner = `<div class="cdap-widget-unsupported">${escapeHtml(type)}</div>`;
        }

        return `
            <div class="cdap-widget ${sizeClass}${readOnlyClass}" data-widget-id="${safeId}" data-widget-type="${escapeHtml(type)}">
                <div class="cdap-widget-header">
                    <span class="cdap-widget-label">${safeLabel}</span>
                    ${unit ? `<span class="cdap-widget-unit">${escapeHtml(unit)}</span>` : ''}
                </div>
                <div class="cdap-widget-body">
                    ${inner}
                </div>
            </div>
        `;
    }

    function getWidgetSizeClass(type, widget) {
        if (widget.size === 'large') return 'cdap-widget-lg';
        if (widget.size === 'small') return 'cdap-widget-sm';
        // Default sizes by type
        switch (type) {
            case 'chart': return 'cdap-widget-lg';
            case 'table': return 'cdap-widget-lg';
            case 'terminal': return 'cdap-widget-lg';
            case 'desktop': return 'cdap-widget-xl';
            case 'video_stream': return 'cdap-widget-xl';
            case 'file_browser': return 'cdap-widget-lg';
            case 'audio': return 'cdap-widget-md';
            case 'text': return 'cdap-widget-sm';
            case 'led': return 'cdap-widget-sm';
            default: return '';
        }
    }

    // ── Individual Widget Renderers ──────────────────────────────────────

    function renderToggle(widget) {
        const disabled = widget.read_only ? 'disabled' : '';
        return `
            <label class="cdap-toggle">
                <input type="checkbox" class="cdap-toggle-input" data-action="set" ${disabled}>
                <span class="cdap-toggle-slider"></span>
            </label>
            <span class="cdap-toggle-label" id="wval-${escapeHtml(widget.id)}">—</span>
        `;
    }

    function renderGauge(widget) {
        const min = widget.min ?? 0;
        const max = widget.max ?? 100;
        return `
            <div class="cdap-gauge">
                <div class="cdap-gauge-bar">
                    <div class="cdap-gauge-fill" id="wbar-${escapeHtml(widget.id)}" style="width: 0%"></div>
                </div>
                <div class="cdap-gauge-value">
                    <span class="cdap-gauge-number" id="wval-${escapeHtml(widget.id)}">—</span>
                    <span class="cdap-gauge-range">${min} – ${max}</span>
                </div>
            </div>
        `;
    }

    function renderButton(widget) {
        const icon = widget.icon || 'play_arrow';
        const confirmText = widget.confirm ? `data-confirm="${escapeHtml(widget.confirm)}"` : '';
        return `
            <button class="btn cdap-action-btn" data-action="trigger" ${confirmText}>
                <span class="material-icons">${escapeHtml(icon)}</span>
                <span>${escapeHtml(widget.label || widget.id)}</span>
            </button>
        `;
    }

    function renderLed(widget) {
        return `
            <div class="cdap-led" id="wled-${escapeHtml(widget.id)}">
                <div class="cdap-led-light off"></div>
                <span class="cdap-led-label" id="wval-${escapeHtml(widget.id)}">—</span>
            </div>
        `;
    }

    function renderText(widget) {
        return `
            <div class="cdap-text-value" id="wval-${escapeHtml(widget.id)}">—</div>
        `;
    }

    function renderSlider(widget) {
        const min = widget.min ?? 0;
        const max = widget.max ?? 100;
        const step = widget.step ?? 1;
        const disabled = widget.read_only ? 'disabled' : '';
        return `
            <div class="cdap-slider-wrap">
                <input type="range" class="cdap-slider-input" 
                    min="${min}" max="${max}" step="${step}" value="${min}"
                    data-action="set" ${disabled}>
                <div class="cdap-slider-labels">
                    <span>${min}</span>
                    <span class="cdap-slider-value" id="wval-${escapeHtml(widget.id)}">${min}</span>
                    <span>${max}</span>
                </div>
            </div>
        `;
    }

    function renderSelect(widget) {
        const options = widget.options || [];
        const disabled = widget.read_only ? 'disabled' : '';
        let optHtml = `<option value="">— ${t('cdap.select_option')} —</option>`;
        for (const opt of options) {
            const val = typeof opt === 'object' ? opt.value : opt;
            const label = typeof opt === 'object' ? (opt.label || opt.value) : opt;
            optHtml += `<option value="${escapeHtml(String(val))}">${escapeHtml(String(label))}</option>`;
        }
        return `
            <select class="form-input cdap-select-input" data-action="set" ${disabled}>
                ${optHtml}
            </select>
        `;
    }

    function renderChart(widget) {
        // Phase 2: simple bar-style multi-value chart
        const series = widget.series || [];
        let barsHtml = '';
        for (const s of series) {
            barsHtml += `
                <div class="cdap-chart-bar-wrap" data-series="${escapeHtml(s.key || s.label || '')}">
                    <div class="cdap-chart-bar-label">${escapeHtml(s.label || s.key || '')}</div>
                    <div class="cdap-chart-bar-track">
                        <div class="cdap-chart-bar-fill" id="wbar-${escapeHtml(widget.id)}-${escapeHtml(s.key || '')}" style="width: 0%"></div>
                    </div>
                    <div class="cdap-chart-bar-value" id="wval-${escapeHtml(widget.id)}-${escapeHtml(s.key || '')}">—</div>
                </div>
            `;
        }
        return `<div class="cdap-chart-bars">${barsHtml}</div>`;
    }

    function renderTable(widget) {
        const columns = widget.columns || [];
        const pageSize = widget.page_size || 25;
        let headHtml = '';
        for (const col of columns) {
            const sortAttr = widget.sortable ? ` class="cdap-table-sortable" data-col="${escapeHtml(col.id || col.label)}"` : '';
            headHtml += `<th${sortAttr}>${escapeHtml(col.label || col.id || '')}</th>`;
        }
        return `
            <div class="cdap-table-toolbar">
                <input type="text" class="cdap-table-search" placeholder="${t('cdap.table_search') || 'Search...'}" data-widget="${escapeHtml(widget.id)}">
            </div>
            <div class="cdap-table-wrap" id="wtable-${escapeHtml(widget.id)}">
                <table class="cdap-table">
                    <thead><tr>${headHtml}</tr></thead>
                    <tbody id="wval-${escapeHtml(widget.id)}"></tbody>
                </table>
            </div>
            <div class="cdap-table-pagination" id="wpag-${escapeHtml(widget.id)}" data-page="0" data-page-size="${pageSize}">
                <button class="cdap-pag-btn cdap-pag-prev" disabled><span class="material-icons">chevron_left</span></button>
                <span class="cdap-pag-info"></span>
                <button class="cdap-pag-btn cdap-pag-next"><span class="material-icons">chevron_right</span></button>
            </div>
        `;
    }

    function renderTerminal(widget) {
        return `
            <div class="cdap-terminal" id="wval-${escapeHtml(widget.id)}">
                <div class="cdap-terminal-output"></div>
                <div class="cdap-terminal-connect">
                    <button class="btn cdap-terminal-connect-btn" data-widget="${escapeHtml(widget.id)}">
                        <span class="material-icons">terminal</span>
                        <span>${t('cdap.connect_terminal') || 'Connect Terminal'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderDesktop(widget) {
        return `
            <div class="cdap-desktop-widget" id="wval-${escapeHtml(widget.id)}">
                <div class="cdap-desktop-toolbar">
                    <span class="cdap-desktop-clipboard-indicator hidden"></span>
                </div>
                <div class="cdap-desktop-canvas-wrap">
                    <canvas class="cdap-desktop-canvas" width="1280" height="720"></canvas>
                    <div class="cdap-desktop-overlay">
                        <span class="material-icons">desktop_windows</span>
                        <span>${t('cdap.disconnected')}</span>
                    </div>
                </div>
                <div class="cdap-desktop-connect">
                    <button class="btn cdap-desktop-connect-btn" data-widget="${escapeHtml(widget.id)}">
                        <span class="material-icons">desktop_windows</span>
                        <span>${t('cdap.connect_desktop') || 'Connect Desktop'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderVideoStream(widget) {
        return `
            <div class="cdap-video-widget" id="wval-${escapeHtml(widget.id)}">
                <div class="cdap-video-container">
                    <canvas class="cdap-video-canvas" width="640" height="480"></canvas>
                    <div class="cdap-video-overlay">
                        <span class="material-icons">videocam</span>
                        <span>${t('cdap.disconnected')}</span>
                    </div>
                </div>
                <div class="cdap-video-connect">
                    <button class="btn cdap-video-connect-btn" data-widget="${escapeHtml(widget.id)}">
                        <span class="material-icons">videocam</span>
                        <span>${t('cdap.connect_video') || 'Connect Stream'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderFileBrowser(widget) {
        return `
            <div class="cdap-file-browser" id="wval-${escapeHtml(widget.id)}">
                <div class="cdap-file-toolbar">
                    <span class="cdap-file-path" id="wpath-${escapeHtml(widget.id)}">/</span>
                    <button class="btn btn-sm cdap-file-up" data-action="browse" data-value="..">
                        <span class="material-icons">arrow_upward</span>
                    </button>
                </div>
                <div class="cdap-file-list" id="wlist-${escapeHtml(widget.id)}">
                    <div class="cdap-file-empty">${t('cdap.disconnected')}</div>
                </div>
                <div class="cdap-file-connect">
                    <button class="btn cdap-file-connect-btn" data-widget="${escapeHtml(widget.id)}">
                        <span class="material-icons">folder_open</span>
                        <span>${t('cdap.connect_files') || 'Browse Files'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    function renderAudioStream(widget) {
        return `
            <div class="cdap-audio-widget" id="wval-${escapeHtml(widget.id)}">
                <div class="cdap-audio-controls">
                    <div class="cdap-audio-status disconnected">${t('cdap.disconnected')}</div>
                    <div class="cdap-audio-level">
                        <div class="cdap-audio-level-track">
                            <div class="cdap-audio-level-fill low"></div>
                        </div>
                    </div>
                    <div class="cdap-audio-buttons">
                        <button class="btn btn-sm cdap-audio-mute-btn" data-widget="${escapeHtml(widget.id)}" title="Mute">
                            <span class="material-icons">volume_up</span>
                        </button>
                    </div>
                </div>
                <div class="cdap-audio-connect">
                    <button class="btn cdap-audio-connect-btn" data-widget="${escapeHtml(widget.id)}">
                        <span class="material-icons">headphones</span>
                        <span>${t('cdap.connect_audio') || 'Connect Audio'}</span>
                    </button>
                </div>
            </div>
        `;
    }

    // ── State Polling & Application ──────────────────────────────────────

    function startStatePolling() {
        if (statePollTimer) clearInterval(statePollTimer);
        statePollTimer = setInterval(pollState, STATE_POLL_INTERVAL);
    }

    async function pollState() {
        try {
            const res = await fetch(`/api/cdap/devices/${encodeURIComponent(deviceId)}/state`, {
                headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
            });
            if (!res.ok) return;
            const data = await res.json();
            if (data.success && data.data) {
                widgetState = data.data;
                applyState(widgetState);
            }
        } catch (err) {
            // Silent fail — device may be offline
        }
    }

    function applyState(state) {
        if (!state || !manifest?.widgets) return;

        for (const widget of manifest.widgets) {
            const val = state[widget.id];
            if (val === undefined) continue;

            const el = document.querySelector(`[data-widget-id="${CSS.escape(widget.id)}"]`);
            if (!el) continue;

            switch (widget.type) {
                case 'toggle':
                    applyToggleState(el, widget, val);
                    break;
                case 'gauge':
                    applyGaugeState(el, widget, val);
                    break;
                case 'led':
                    applyLedState(el, widget, val);
                    break;
                case 'text':
                    applyTextState(el, widget, val);
                    break;
                case 'slider':
                    applySliderState(el, widget, val);
                    break;
                case 'select':
                    applySelectState(el, widget, val);
                    break;
                case 'chart':
                    applyChartState(el, widget, val);
                    break;
                case 'table':
                    applyTableState(el, widget, val);
                    break;
                case 'terminal':
                    applyTerminalState(el, widget, val);
                    break;
                case 'desktop':
                    applyDesktopState(el, widget, val);
                    break;
                case 'video_stream':
                    applyVideoStreamState(el, widget, val);
                    break;
                case 'file_browser':
                    applyFileBrowserState(el, widget, val);
                    break;
            }
        }
    }

    function applyToggleState(el, widget, val) {
        const input = el.querySelector('.cdap-toggle-input');
        const label = document.getElementById(`wval-${widget.id}`);
        const checked = val === true || val === 1 || val === 'on' || val === 'true';
        if (input && !input._userInteracting) input.checked = checked;
        if (label) label.textContent = checked ? 'ON' : 'OFF';
    }

    function applyGaugeState(el, widget, val) {
        const num = parseFloat(val);
        if (isNaN(num)) return;
        const min = widget.min ?? 0;
        const max = widget.max ?? 100;
        const pct = Math.min(100, Math.max(0, ((num - min) / (max - min)) * 100));

        const bar = document.getElementById(`wbar-${widget.id}`);
        const valEl = document.getElementById(`wval-${widget.id}`);
        if (bar) {
            bar.style.width = pct + '%';
            // Color based on thresholds
            if (pct > 90) bar.className = 'cdap-gauge-fill cdap-gauge-danger';
            else if (pct > 70) bar.className = 'cdap-gauge-fill cdap-gauge-warning';
            else bar.className = 'cdap-gauge-fill';
        }
        if (valEl) valEl.textContent = num.toFixed(widget.decimals ?? 1);
    }

    function applyLedState(el, widget, val) {
        const light = el.querySelector('.cdap-led-light');
        const label = document.getElementById(`wval-${widget.id}`);
        const on = val === true || val === 1 || val === 'on' || val === 'true';
        if (light) {
            light.className = `cdap-led-light ${on ? 'on' : 'off'}`;
            if (typeof val === 'string' && val.startsWith('#')) {
                light.style.backgroundColor = val;
                light.className = 'cdap-led-light on';
            }
        }
        if (label) label.textContent = typeof val === 'string' ? val : (on ? 'ON' : 'OFF');
    }

    function applyTextState(el, widget, val) {
        const valEl = document.getElementById(`wval-${widget.id}`);
        if (valEl) valEl.textContent = String(val);
    }

    function applySliderState(el, widget, val) {
        const input = el.querySelector('.cdap-slider-input');
        const valEl = document.getElementById(`wval-${widget.id}`);
        const num = parseFloat(val);
        if (isNaN(num)) return;
        if (input && !input._userInteracting) input.value = num;
        if (valEl) valEl.textContent = num.toFixed(widget.decimals ?? 0);
    }

    function applySelectState(el, widget, val) {
        const select = el.querySelector('.cdap-select-input');
        if (select && !select._userInteracting) select.value = String(val);
    }

    function applyChartState(el, widget, val) {
        if (typeof val !== 'object') return;
        const series = widget.series || [];
        for (const s of series) {
            const key = s.key || s.label || '';
            const seriesVal = val[key];
            if (seriesVal === undefined) continue;
            const num = parseFloat(seriesVal);
            if (isNaN(num)) continue;
            const min = s.min ?? 0;
            const max = s.max ?? 100;
            const pct = Math.min(100, Math.max(0, ((num - min) / (max - min)) * 100));
            const bar = document.getElementById(`wbar-${widget.id}-${key}`);
            const valEl = document.getElementById(`wval-${widget.id}-${key}`);
            if (bar) bar.style.width = pct + '%';
            if (valEl) valEl.textContent = num.toFixed(1);
        }
    }

    // ── Table data store per widget (for pagination/search) ─────────────
    const _tableData = {};

    function applyTableState(el, widget, val) {
        const tbody = document.getElementById(`wval-${widget.id}`);
        if (!tbody || !Array.isArray(val)) return;
        const columns = widget.columns || [];

        // Store full dataset for search/pagination
        _tableData[widget.id] = val;

        // Apply search filter
        const searchInput = el.querySelector('.cdap-table-search');
        const searchTerm = (searchInput?.value || '').toLowerCase();
        let filtered = val;
        if (searchTerm) {
            filtered = val.filter(row => {
                for (const col of columns) {
                    const v = String(row[col.id] ?? row[col.label] ?? '').toLowerCase();
                    if (v.includes(searchTerm)) return true;
                }
                return false;
            });
        }

        // Pagination
        const pagEl = document.getElementById(`wpag-${widget.id}`);
        const pageSize = parseInt(pagEl?.dataset.pageSize || '25', 10);
        let page = parseInt(pagEl?.dataset.page || '0', 10);
        const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
        if (page >= totalPages) page = totalPages - 1;
        if (page < 0) page = 0;
        if (pagEl) pagEl.dataset.page = String(page);

        const start = page * pageSize;
        const rows = filtered.slice(start, start + pageSize);

        // Render rows with column type support
        let html = '';
        for (const row of rows) {
            html += '<tr>';
            for (const col of columns) {
                const cellVal = row[col.id] ?? row[col.label] ?? '';
                html += `<td>${renderTableCell(cellVal, col, widget)}</td>`;
            }
            html += '</tr>';
        }
        tbody.innerHTML = html || '<tr><td colspan="' + columns.length + '" class="cdap-table-empty">—</td></tr>';

        // Update pagination info
        if (pagEl) {
            const info = pagEl.querySelector('.cdap-pag-info');
            if (info) {
                if (filtered.length === 0) {
                    info.textContent = '0 / 0';
                } else {
                    info.textContent = `${start + 1}–${Math.min(start + pageSize, filtered.length)} / ${filtered.length}`;
                }
            }
            const prevBtn = pagEl.querySelector('.cdap-pag-prev');
            const nextBtn = pagEl.querySelector('.cdap-pag-next');
            if (prevBtn) prevBtn.disabled = page === 0;
            if (nextBtn) nextBtn.disabled = page >= totalPages - 1;

            // Hide pagination when only one page
            pagEl.style.display = totalPages <= 1 ? 'none' : '';
        }
    }

    function renderTableCell(val, col, widget) {
        const type = col.type || 'text';
        switch (type) {
            case 'badge': {
                const color = col.colors?.[val] || col.color || 'var(--accent)';
                return `<span class="cdap-badge" style="--badge-color:${escapeHtml(color)}">${escapeHtml(String(val))}</span>`;
            }
            case 'datetime': {
                if (!val) return '—';
                const d = new Date(val);
                if (isNaN(d.getTime())) return escapeHtml(String(val));
                return `<time datetime="${d.toISOString()}" title="${d.toLocaleString()}">${formatRelativeTime(d)}</time>`;
            }
            case 'number': {
                const num = parseFloat(val);
                if (isNaN(num)) return escapeHtml(String(val));
                const precision = col.decimals ?? 0;
                const suffix = col.suffix || '';
                return `<span class="cdap-number">${num.toFixed(precision)}${escapeHtml(suffix)}</span>`;
            }
            case 'action': {
                const actions = col.actions || [{ label: col.label, action: col.action || 'execute' }];
                return actions.map(a =>
                    `<button class="cdap-table-action" data-widget="${escapeHtml(widget.id)}" data-action="${escapeHtml(a.action || 'execute')}" data-row-val="${escapeHtml(String(val))}">${escapeHtml(a.label || 'Action')}</button>`
                ).join(' ');
            }
            case 'boolean': {
                const on = val === true || val === 1 || val === 'true' || val === 'on';
                return `<span class="cdap-led-light ${on ? 'on' : 'off'}" style="display:inline-block;width:10px;height:10px;border-radius:50%;"></span>`;
            }
            default:
                return escapeHtml(String(val));
        }
    }

    function formatRelativeTime(date) {
        const now = Date.now();
        const diff = now - date.getTime();
        if (diff < 60000) return t('cdap.just_now') || 'Just now';
        if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
        if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
        return date.toLocaleDateString();
    }

    function applyTerminalState(el, widget, val) {
        // If CDAPTerminal (xterm.js) is active for this widget, skip — xterm handles its own output via WS
        if (window.CDAPTerminal?.isActive(deviceId, widget.id)) return;

        // Legacy line-based rendering for non-interactive terminals
        const container = el.querySelector('.cdap-terminal-output');
        if (!container) return;
        if (Array.isArray(val)) {
            container.innerHTML = val.map(line => `<div class="cdap-terminal-line">${escapeHtml(String(line))}</div>`).join('');
        } else if (typeof val === 'string') {
            container.innerHTML += `<div class="cdap-terminal-line">${escapeHtml(val)}</div>`;
            // Auto-scroll to bottom
            const term = el.querySelector('.cdap-terminal');
            if (term) term.scrollTop = term.scrollHeight;
        }
        // Limit lines
        const lines = container.querySelectorAll('.cdap-terminal-line');
        const maxLines = 500;
        if (lines.length > maxLines) {
            for (let i = 0; i < lines.length - maxLines; i++) {
                lines[i].remove();
            }
        }
    }

    function applyDesktopState(el, widget, val) {
        // val is expected to have { connected, frame_url } or { connected: false }
        const overlay = el.querySelector('.cdap-desktop-overlay');
        if (typeof val === 'object' && val.connected) {
            if (overlay) overlay.classList.add('hidden');
        } else {
            if (overlay) overlay.classList.remove('hidden');
        }
    }

    function applyVideoStreamState(el, widget, val) {
        // val is expected to have { url } for MJPEG/snapshot URL or { connected: false }
        const overlay = el.querySelector('.cdap-video-overlay');
        const img = el.querySelector('.cdap-video-frame');
        if (typeof val === 'object' && val.url) {
            if (img) {
                // Append timestamp to prevent caching for snapshot mode
                const sep = val.url.includes('?') ? '&' : '?';
                img.src = val.url + sep + '_t=' + Date.now();
                img.classList.remove('hidden');
            }
            if (overlay) overlay.classList.add('hidden');
        } else {
            if (img) img.classList.add('hidden');
            if (overlay) overlay.classList.remove('hidden');
        }
    }

    function applyFileBrowserState(el, widget, val) {
        // val is expected to be { path, entries: [{ name, type, size }] }
        if (typeof val !== 'object') return;
        const pathEl = document.getElementById(`wpath-${widget.id}`);
        const listEl = document.getElementById(`wlist-${widget.id}`);
        if (pathEl && val.path) pathEl.textContent = val.path;
        if (!listEl || !Array.isArray(val.entries)) return;
        if (val.entries.length === 0) {
            listEl.innerHTML = '<div class="cdap-file-empty">Empty directory</div>';
            return;
        }
        // Sort: directories first, then files
        const sorted = [...val.entries].sort((a, b) => {
            if (a.type === 'dir' && b.type !== 'dir') return -1;
            if (a.type !== 'dir' && b.type === 'dir') return 1;
            return (a.name || '').localeCompare(b.name || '');
        });
        let html = '';
        for (const entry of sorted) {
            const icon = entry.type === 'dir' ? 'folder' : 'description';
            const size = entry.type === 'dir' ? '' : formatFileSize(entry.size || 0);
            html += `<div class="cdap-file-entry" data-name="${escapeHtml(entry.name)}" data-type="${escapeHtml(entry.type || 'file')}">
                <span class="material-icons cdap-file-icon">${icon}</span>
                <span class="cdap-file-name">${escapeHtml(entry.name)}</span>
                <span class="cdap-file-size">${size}</span>
            </div>`;
        }
        listEl.innerHTML = html;
    }

    function formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // ── Event Binding ────────────────────────────────────────────────────

    function bindWidgetEvents() {
        // Toggle switches
        document.querySelectorAll('.cdap-toggle-input').forEach(input => {
            input.addEventListener('change', (e) => {
                const widgetEl = e.target.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                window.CDAPCommands?.send(deviceId, wid, 'set', e.target.checked);
            });
            // Prevent state polling from overriding user interaction
            input.addEventListener('mousedown', () => { input._userInteracting = true; });
            input.addEventListener('change', () => { setTimeout(() => { input._userInteracting = false; }, 2000); });
        });

        // Action buttons
        document.querySelectorAll('.cdap-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const widgetEl = e.target.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                const confirm = btn.dataset.confirm;
                if (confirm) {
                    window.CDAPCommands?.sendWithConfirm(deviceId, wid, 'trigger', null, confirm);
                } else {
                    window.CDAPCommands?.send(deviceId, wid, 'trigger', null);
                }
            });
        });

        // Sliders (debounced)
        document.querySelectorAll('.cdap-slider-input').forEach(input => {
            let debounce = null;
            input.addEventListener('input', (e) => {
                const widgetEl = e.target.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                const valEl = document.getElementById(`wval-${wid}`);
                if (valEl) valEl.textContent = e.target.value;
                input._userInteracting = true;
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    window.CDAPCommands?.send(deviceId, wid, 'set', parseFloat(e.target.value));
                    setTimeout(() => { input._userInteracting = false; }, 2000);
                }, 300);
            });
        });

        // Selects
        document.querySelectorAll('.cdap-select-input').forEach(select => {
            select.addEventListener('change', (e) => {
                const widgetEl = e.target.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                select._userInteracting = true;
                window.CDAPCommands?.send(deviceId, wid, 'set', e.target.value);
                setTimeout(() => { select._userInteracting = false; }, 2000);
            });
        });

        // File browser navigation
        document.querySelectorAll('.cdap-file-up').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const widgetEl = e.target.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                window.CDAPCommands?.send(deviceId, wid, 'browse', '..');
            });
        });

        document.querySelectorAll('.cdap-file-list').forEach(list => {
            list.addEventListener('click', (e) => {
                const entry = e.target.closest('.cdap-file-entry');
                if (!entry || entry.dataset.type !== 'dir') return;
                const widgetEl = list.closest('.cdap-widget');
                if (!widgetEl) return;
                const wid = widgetEl.dataset.widgetId;
                window.CDAPCommands?.send(deviceId, wid, 'browse', entry.dataset.name);
            });
        });

        // Table sortable headers
        document.querySelectorAll('.cdap-table-sortable').forEach(th => {
            th.addEventListener('click', () => {
                const table = th.closest('.cdap-table');
                if (!table) return;
                const colIdx = Array.from(th.parentNode.children).indexOf(th);
                const tbody = table.querySelector('tbody');
                if (!tbody) return;
                const rows = Array.from(tbody.querySelectorAll('tr'));
                const asc = !th.classList.contains('sort-asc');
                th.parentNode.querySelectorAll('th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
                th.classList.add(asc ? 'sort-asc' : 'sort-desc');
                rows.sort((a, b) => {
                    const aVal = a.children[colIdx]?.textContent || '';
                    const bVal = b.children[colIdx]?.textContent || '';
                    const cmp = aVal.localeCompare(bVal, undefined, { numeric: true });
                    return asc ? cmp : -cmp;
                });
                rows.forEach(r => tbody.appendChild(r));
            });
        });

        // Table pagination buttons
        document.querySelectorAll('.cdap-table-pagination').forEach(pagEl => {
            const widgetId = pagEl.id.replace('wpag-', '');
            const widgetEl = document.querySelector(`[data-widget-id="${CSS.escape(widgetId)}"]`);
            const widget = manifest?.widgets?.find(w => w.id === widgetId);
            if (!widgetEl || !widget) return;

            pagEl.querySelector('.cdap-pag-prev')?.addEventListener('click', () => {
                let page = parseInt(pagEl.dataset.page || '0', 10);
                if (page > 0) {
                    pagEl.dataset.page = String(page - 1);
                    applyTableState(widgetEl, widget, _tableData[widgetId] || []);
                }
            });
            pagEl.querySelector('.cdap-pag-next')?.addEventListener('click', () => {
                let page = parseInt(pagEl.dataset.page || '0', 10);
                pagEl.dataset.page = String(page + 1);
                applyTableState(widgetEl, widget, _tableData[widgetId] || []);
            });
        });

        // Table search inputs (debounced)
        document.querySelectorAll('.cdap-table-search').forEach(input => {
            let debounce = null;
            input.addEventListener('input', () => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                    const widgetId = input.dataset.widget;
                    const widgetEl = document.querySelector(`[data-widget-id="${CSS.escape(widgetId)}"]`);
                    const widget = manifest?.widgets?.find(w => w.id === widgetId);
                    if (!widgetEl || !widget) return;
                    // Reset to first page on search
                    const pagEl = document.getElementById(`wpag-${widgetId}`);
                    if (pagEl) pagEl.dataset.page = '0';
                    applyTableState(widgetEl, widget, _tableData[widgetId] || []);
                }, 250);
            });
        });

        // Table action column buttons (delegated)
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.cdap-table-action');
            if (!btn) return;
            const wid = btn.dataset.widget;
            const action = btn.dataset.action;
            const rowVal = btn.dataset.rowVal;
            if (wid && action) {
                window.CDAPCommands?.send(deviceId, wid, action, rowVal);
            }
        });

        // Terminal connect buttons
        document.querySelectorAll('.cdap-terminal-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPTerminal) {
                    btn.closest('.cdap-terminal-connect')?.classList.add('hidden');
                    window.CDAPTerminal.open(deviceId, wid);
                }
            });
        });

        // Desktop connect buttons
        document.querySelectorAll('.cdap-desktop-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPDesktop) {
                    btn.closest('.cdap-desktop-connect')?.classList.add('hidden');
                    window.CDAPDesktop.open(deviceId, wid);
                }
            });
        });

        // Video stream connect buttons
        document.querySelectorAll('.cdap-video-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPVideo) {
                    btn.closest('.cdap-video-connect')?.classList.add('hidden');
                    window.CDAPVideo.open(deviceId, wid);
                }
            });
        });

        // File browser connect buttons
        document.querySelectorAll('.cdap-file-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPFileBrowser) {
                    btn.closest('.cdap-file-connect')?.classList.add('hidden');
                    window.CDAPFileBrowser.open(deviceId, wid);
                }
            });
        });

        // Audio connect buttons
        document.querySelectorAll('.cdap-audio-connect-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPAudio) {
                    btn.closest('.cdap-audio-connect')?.classList.add('hidden');
                    window.CDAPAudio.open(deviceId, wid);
                }
            });
        });

        // Audio mute buttons
        document.querySelectorAll('.cdap-audio-mute-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const wid = btn.dataset.widget;
                if (wid && window.CDAPAudio) {
                    const muted = window.CDAPAudio.toggleMute(deviceId, wid);
                    const icon = btn.querySelector('.material-icons');
                    if (icon) icon.textContent = muted ? 'volume_off' : 'volume_up';
                }
            });
        });
    }

    // ── Utilities ────────────────────────────────────────────────────────

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function formatDuration(ms) {
        if (ms < 0) ms = 0;
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const d = Math.floor(h / 24);
        if (d > 0) return `${d}d ${h % 24}h`;
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m`;
        return `${s}s`;
    }

    // ── Alert Polling & Rendering ──────────────────────────────────────

    let alertPollTimer = null;
    const ALERT_POLL_INTERVAL = 5000;

    function startAlertPolling() {
        pollAlerts();
        if (alertPollTimer) clearInterval(alertPollTimer);
        alertPollTimer = setInterval(pollAlerts, ALERT_POLL_INTERVAL);
    }

    async function pollAlerts() {
        try {
            const res = await fetch(`/api/cdap/alerts?device_id=${encodeURIComponent(deviceId)}`, {
                headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
            });
            if (!res.ok) return;
            const data = await res.json();
            const alerts = data?.data?.alerts || data?.alerts || [];
            renderAlerts(alerts);
        } catch (err) {
            // Silent fail
        }
    }

    function renderAlerts(alerts) {
        const panel = document.getElementById('cdap-alerts-panel');
        const list = document.getElementById('cdap-alerts-list');
        const count = document.getElementById('cdap-alerts-count');
        if (!panel || !list) return;

        const firing = alerts.filter(a => a.firing);
        panel.classList.toggle('hidden', firing.length === 0);
        if (count) count.textContent = firing.length;

        if (firing.length === 0) {
            list.innerHTML = '';
            return;
        }

        const severityOrder = { critical: 0, warning: 1, info: 2 };
        firing.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

        list.innerHTML = firing.map(a => {
            const icon = a.severity === 'critical' ? 'error' : a.severity === 'warning' ? 'warning' : 'info';
            const time = a.fired_at ? new Date(a.fired_at).toLocaleTimeString() : '';
            return `
                <div class="cdap-alert-item cdap-alert-${escapeHtml(a.severity)}">
                    <span class="material-icons cdap-alert-icon">${icon}</span>
                    <div class="cdap-alert-body">
                        <span class="cdap-alert-label">${escapeHtml(a.label)}</span>
                        <span class="cdap-alert-msg">${escapeHtml(a.message)}</span>
                    </div>
                    <span class="cdap-alert-time">${time}</span>
                </div>
            `;
        }).join('');
    }

    // ── Linked Devices ─────────────────────────────────────────────────

    async function loadLinkedDevices() {
        try {
            const res = await fetch(`/api/cdap/devices/${encodeURIComponent(deviceId)}/linked`, {
                headers: { 'X-CSRF-Token': window.BetterDesk?.csrfToken || '' }
            });
            if (!res.ok) return;
            const data = await res.json();
            renderLinkedDevices(data?.data?.linked || data?.linked || []);
        } catch (err) {
            console.error('CDAP linked devices error:', err);
        }
    }

    function renderLinkedDevices(linked) {
        const list = document.getElementById('cdap-linked-list');
        const count = document.getElementById('cdap-linked-count');
        const empty = document.getElementById('cdap-linked-empty');
        if (!list) return;

        if (count) count.textContent = linked.length;

        if (linked.length === 0) {
            if (empty) empty.classList.remove('hidden');
            list.querySelectorAll('.cdap-linked-item').forEach(el => el.remove());
            return;
        }

        if (empty) empty.classList.add('hidden');

        const html = linked.map(p => {
            const online = p.live_online || p.status === 'online';
            const statusClass = online ? 'online' : 'offline';
            const name = escapeHtml(p.hostname || p.id);
            const platform = escapeHtml(p.platform || '');
            return `
                <div class="cdap-linked-item" data-peer-id="${escapeHtml(p.id)}">
                    <span class="cdap-linked-status ${statusClass}"></span>
                    <div class="cdap-linked-info">
                        <span class="cdap-linked-name">${name}</span>
                        <span class="cdap-linked-id">${escapeHtml(p.id)}</span>
                    </div>
                    ${platform ? `<span class="cdap-linked-platform">${platform}</span>` : ''}
                    <button class="btn-icon cdap-unlink-btn" data-peer-id="${escapeHtml(p.id)}" title="${t('cdap.unlink_device')}">
                        <span class="material-icons">link_off</span>
                    </button>
                </div>
            `;
        }).join('');

        // Keep the empty state element, replace linked items
        list.querySelectorAll('.cdap-linked-item').forEach(el => el.remove());
        list.insertAdjacentHTML('beforeend', html);

        // Bind unlink buttons
        list.querySelectorAll('.cdap-unlink-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const peerId = btn.dataset.peerId;
                if (!confirm(t('cdap.unlink_confirm'))) return;
                try {
                    const res = await fetch(`/api/cdap/devices/${encodeURIComponent(peerId)}/link`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-CSRF-Token': window.BetterDesk?.csrfToken || ''
                        },
                        body: JSON.stringify({ linked_peer_id: '' })
                    });
                    if (res.ok) loadLinkedDevices();
                } catch (err) {
                    console.error('Unlink error:', err);
                }
            });
        });
    }

    function initLinkButton() {
        const btn = document.getElementById('cdap-link-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const peerId = prompt(t('cdap.link_prompt'));
            if (!peerId || !peerId.trim()) return;
            try {
                const res = await fetch(`/api/cdap/devices/${encodeURIComponent(peerId.trim())}/link`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': window.BetterDesk?.csrfToken || ''
                    },
                    body: JSON.stringify({ linked_peer_id: deviceId })
                });
                if (res.ok) loadLinkedDevices();
            } catch (err) {
                console.error('Link error:', err);
            }
        });
    }

    // ── Public API ───────────────────────────────────────────────────────

    window.CDAPWidgets = {
        init,
        refresh: loadManifestAndState,
        getState: () => widgetState,
        getManifest: () => manifest,
        isDeviceConnected: () => isConnected
    };

    // Auto-init on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (statePollTimer) clearInterval(statePollTimer);
        if (infoPollTimer) clearInterval(infoPollTimer);
        if (alertPollTimer) clearInterval(alertPollTimer);
    });
})();
