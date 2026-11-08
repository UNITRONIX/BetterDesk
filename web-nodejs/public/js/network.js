/**
 * BetterDesk Console - Network monitoring page
 *
 * Targets: GET/POST /api/network/targets, PATCH/DELETE /api/network/targets/:id,
 * POST .../:id/check, GET .../:id/history. Monitor loop: GET /api/network/monitor/status,
 * POST /api/network/monitor/start|stop. Adding, editing, deleting and starting or
 * stopping the monitor need server.config; running a check needs device.connect.
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
    const esc = (value) => Utils.escapeHtml(value == null ? '' : String(value));
    const DASH = '<span class="text-muted">–</span>';

    const canManage = Utils.can('server.config');
    const canCheck = Utils.can('device.connect');

    // The monitor loop runs this often and checks each target when its own interval is due
    const MONITOR_TICK_MS = 30000;
    const INTERVALS = [30, 60, 300, 600];

    const targetsBody = document.getElementById('targets-body');
    const countLine = document.getElementById('targets-count');
    const searchInput = document.getElementById('target-search');
    const refreshBtn = document.getElementById('refresh-btn');
    const createBtn = document.getElementById('create-target-btn');
    const monitorState = document.getElementById('monitor-state');
    const monitorBtn = document.getElementById('monitor-toggle-btn');
    const monitorStatus = document.getElementById('monitor-status');
    const toolsNote = document.getElementById('network-tools-note');

    let allTargets = [];
    let loadError = null;
    let monitorRunning = null;

    if (canManage) createBtn.hidden = false;
    if (canCheck && toolsNote) toolsNote.hidden = false;

    // ---- Formatting ----

    function intervalSeconds(t) {
        return t.interval_ms ? Math.round(t.interval_ms / 1000) : 60;
    }

    function intervalLabel(seconds) {
        if (seconds % 60 === 0) return _('network.every_minutes', { count: seconds / 60 });
        return _('network.every_seconds', { count: seconds });
    }

    function checkLabel(t) {
        switch (t.check_type) {
            case 'tcp': return _('network.check_tcp', { port: t.port || 80 });
            case 'http': return 'HTTP';
            case 'https': return 'HTTPS';
            default: return _('network.check_ping');
        }
    }

    function address(t) {
        if (t.url) return t.url;
        if (t.port && t.check_type !== 'ping') return `${t.host}:${t.port}`;
        return t.host || '';
    }

    function statusHtml(t) {
        if (!Number(t.enabled)) return `<span class="status offline">${esc(_('network.status_paused'))}</span>`;
        if (t.last_status === 'up') return `<span class="status ok">${esc(_('network.status_up'))}</span>`;
        if (t.last_status === 'down') return `<span class="status error">${esc(_('network.status_down'))}</span>`;
        return `<span class="status offline">${esc(_('network.status_unchecked'))}</span>`;
    }

    function latencyText(ms) {
        if (ms == null || ms === '') return '';
        return _('network.ms', { value: Math.round(Number(ms)) });
    }

    function timeHtml(value) {
        const date = Utils.parseDate(value);
        if (!date) return DASH;
        return `<time datetime="${esc(date.toISOString())}" title="${esc(Utils.formatDate(date))}">${esc(Utils.formatRelativeTime(date))}</time>`;
    }

    function errorText(err) {
        return (err && err.message) || _('network.request_failed');
    }

    // ---- Targets ----

    async function loadTargets() {
        loadError = null;
        refreshBtn.disabled = true;
        if (!allTargets.length) {
            targetsBody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(_('network.loading'))}</td></tr>`;
        }
        try {
            const data = await Utils.api('/api/network/targets');
            allTargets = Array.isArray(data) ? data : [];
        } catch (err) {
            loadError = err;
            allTargets = [];
        } finally {
            refreshBtn.disabled = false;
        }
        render();
    }

    function renderCount(shown) {
        if (loadError || !allTargets.length) { countLine.textContent = ''; return; }
        const parts = [allTargets.length === 1 ? _('network.count_one') : _('network.count_many', { count: allTargets.length })];
        const active = allTargets.filter((t) => Number(t.enabled));
        const down = active.filter((t) => t.last_status === 'down').length;
        const unchecked = active.filter((t) => t.last_status !== 'up' && t.last_status !== 'down').length;
        if (down) parts.push(_('network.count_down', { count: down }));
        else if (active.length && !unchecked) parts.push(_('network.count_all_up'));
        if (unchecked) parts.push(_('network.count_unchecked', { count: unchecked }));
        const times = active.filter((t) => t.last_status === 'up' && t.last_rtt_ms != null).map((t) => Number(t.last_rtt_ms));
        if (times.length) {
            parts.push(_('network.count_latency', { ms: Math.round(times.reduce((a, b) => a + b, 0) / times.length) }));
        }
        if (searchInput.value.trim()) parts.push(_('network.count_shown', { count: shown }));
        countLine.textContent = parts.join(' ');
    }

    function render() {
        if (loadError) {
            targetsBody.innerHTML = `<tr><td colspan="6" class="state-cell is-error">${esc(_('network.load_failed'))} ${esc(errorText(loadError))}
                <button type="button" class="btn btn-sm" data-retry>${esc(_('actions.retry'))}</button></td></tr>`;
            targetsBody.querySelector('[data-retry]').addEventListener('click', loadTargets);
            renderCount(0);
            return;
        }
        const q = searchInput.value.trim().toLowerCase();
        const filtered = q
            ? allTargets.filter((t) => [t.name, t.host, t.url].some((v) => String(v || '').toLowerCase().includes(q)))
            : allTargets;
        renderCount(filtered.length);

        if (!allTargets.length) {
            targetsBody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(canManage ? _('network.empty_manage') : _('network.empty'))}</td></tr>`;
            return;
        }
        if (!filtered.length) {
            targetsBody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(_('network.no_match'))}</td></tr>`;
            return;
        }
        targetsBody.innerHTML = filtered.map((t, i) => rowHtml(t, i, filtered.length)).join('');
    }

    function rowHtml(t, index, total) {
        const id = esc(t.id);
        const menuId = `target-menu-${id}`;
        const nearEnd = total > 3 && index >= total - 2;
        const items = [`<button type="button" class="menu-item" role="menuitem" data-action="history" data-id="${id}">${esc(_('network.check_history'))}</button>`];
        if (canManage) {
            items.push(`<button type="button" class="menu-item" role="menuitem" data-action="edit" data-id="${id}">${esc(_('network.edit_target_item'))}</button>`);
            items.push('<span class="menu-divider" role="separator"></span>');
            items.push(`<button type="button" class="menu-item danger" role="menuitem" data-action="delete" data-id="${id}">${esc(_('network.delete_target_item'))}</button>`);
        }
        const latency = t.last_status === 'up' ? latencyText(t.last_rtt_ms) : '';
        return `
            <tr data-id="${id}">
                <td class="col-name"><span class="target-name">${esc(t.name)}</span>
                    <span class="cell-sub mono">${esc(address(t))}</span></td>
                <td class="col-check">${esc(checkLabel(t))}<span class="cell-sub">${esc(intervalLabel(intervalSeconds(t)))}</span></td>
                <td class="col-status">${statusHtml(t)}${t.last_status === 'down' || !latency ? '' : `<span class="cell-sub phone-only">${esc(latency)}</span>`}</td>
                <td class="col-latency">${latency ? esc(latency) : DASH}</td>
                <td class="col-last">${timeHtml(t.last_check_at)}</td>
                <td class="actions">
                    ${canCheck ? `<button type="button" class="btn btn-sm check-btn" data-action="check" data-id="${id}">${esc(_('network.check_now'))}</button>` : ''}
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                            aria-controls="${menuId}" aria-label="${esc(_('network.actions_for', { name: t.name }))}">
                            <span class="material-icons" aria-hidden="true">more_vert</span>
                        </button>
                        <span class="menu menu-end${nearEnd ? ' menu-up' : ''}" id="${menuId}" role="menu">${items.join('')}</span>
                    </span>
                </td>
            </tr>`;
    }

    function findTarget(id) {
        return allTargets.find((t) => String(t.id) === String(id));
    }

    async function checkTarget(id, button) {
        const t = findTarget(id);
        if (button) {
            button.disabled = true;
            button.textContent = _('network.checking');
        }
        try {
            const result = await Utils.api(`/api/network/targets/${encodeURIComponent(id)}/check`, { method: 'POST' });
            const name = t ? t.name : '';
            if (result && result.status === 'up') {
                Notifications.success(_('network.check_up', { name, ms: Math.round(Number(result.rtt_ms) || 0) }));
            } else {
                Notifications.error(_('network.check_down', { name, reason: (result && result.error) || _('network.no_answer') }));
            }
        } catch (err) {
            Notifications.error(_('network.check_failed', { reason: errorText(err) }));
        }
        await loadTargets();
    }

    // ---- Add / edit dialog ----

    function formHtml(t) {
        const type = t ? t.check_type : 'ping';
        const seconds = t ? intervalSeconds(t) : 60;
        const options = INTERVALS.includes(seconds) ? INTERVALS : INTERVALS.concat(seconds).sort((a, b) => a - b);
        return `
            <form class="target-form" id="target-form" novalidate>
                <div class="form-group">
                    <label class="form-label" for="target-name">${esc(_('network.name'))}</label>
                    <input type="text" id="target-name" class="form-input" maxlength="120" value="${esc(t ? t.name : '')}" required>
                    <p class="form-hint">${esc(_('network.name_hint'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="target-type">${esc(_('network.check_type'))}</label>
                    <select id="target-type" class="form-select is-medium">
                        <option value="ping"${type === 'ping' ? ' selected' : ''}>${esc(_('network.type_ping_long'))}</option>
                        <option value="tcp"${type === 'tcp' ? ' selected' : ''}>${esc(_('network.type_tcp_long'))}</option>
                        <option value="http"${type === 'http' ? ' selected' : ''}>${esc(_('network.type_http_long'))}</option>
                        <option value="https"${type === 'https' ? ' selected' : ''}>${esc(_('network.type_https_long'))}</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="target-host">${esc(_('network.host'))}</label>
                    <input type="text" id="target-host" class="form-input mono-input" value="${esc(t ? t.host : '')}"
                        autocapitalize="off" autocomplete="off" spellcheck="false" required>
                    <p class="form-hint">${esc(_('network.host_hint'))}</p>
                </div>
                <div class="form-group" id="target-port-group">
                    <label class="form-label" for="target-port">${esc(_('network.port'))}</label>
                    <input type="number" id="target-port" class="form-input is-short" min="1" max="65535" value="${esc(t && t.port ? t.port : '')}">
                    <p class="form-hint" id="target-port-hint"></p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="target-interval">${esc(_('network.interval_label'))}</label>
                    <select id="target-interval" class="form-select is-medium">
                        ${options.map((s) => `<option value="${s}"${s === seconds ? ' selected' : ''}>${esc(intervalLabel(s))}</option>`).join('')}
                    </select>
                    <p class="form-hint">${esc(_('network.interval_hint'))}</p>
                </div>
                <label class="check-field">
                    <input type="checkbox" id="target-enabled"${!t || Number(t.enabled) ? ' checked' : ''}>
                    <span class="check-label">${esc(_('network.enabled_label'))}</span>
                    <span class="form-hint">${esc(_('network.enabled_hint'))}</span>
                </label>
                <p class="form-status" id="target-form-status" role="alert"></p>
            </form>`;
    }

    function updatePortField() {
        const type = document.getElementById('target-type').value;
        const group = document.getElementById('target-port-group');
        const hint = document.getElementById('target-port-hint');
        group.hidden = type === 'ping';
        const defaults = { tcp: '80', http: '80', https: '443' };
        document.getElementById('target-port').placeholder = defaults[type] || '';
        hint.textContent = type === 'tcp' ? _('network.port_hint_tcp') : _('network.port_hint_web', { port: defaults[type] || '' });
    }

    function openTargetDialog(t) {
        Modal.show({
            title: t ? _('network.edit_target_title', { name: t.name }) : _('network.add_target'),
            content: formHtml(t),
            buttons: [
                { label: _('actions.cancel'), class: 'btn', onClick: () => Modal.close() },
                { label: t ? _('network.save_target') : _('network.add_target'), class: 'btn-primary', onClick: () => saveTarget(t) },
            ],
        });
        document.getElementById('target-type').addEventListener('change', updatePortField);
        document.getElementById('target-form').addEventListener('submit', (e) => { e.preventDefault(); saveTarget(t); });
        updatePortField();
    }

    async function saveTarget(t) {
        const status = document.getElementById('target-form-status');
        const nameEl = document.getElementById('target-name');
        const hostEl = document.getElementById('target-host');
        const type = document.getElementById('target-type').value;
        const portRaw = document.getElementById('target-port').value.trim();
        const seconds = parseInt(document.getElementById('target-interval').value, 10) || 60;
        const name = nameEl.value.trim();
        const host = hostEl.value.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');

        status.className = 'form-status is-error';
        if (!name) { status.textContent = _('network.name_required'); nameEl.focus(); return; }
        if (!host) { status.textContent = _('network.host_required'); hostEl.focus(); return; }
        let port = null;
        if (type !== 'ping') {
            port = portRaw ? parseInt(portRaw, 10) : (type === 'https' ? 443 : 80);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                status.textContent = _('network.port_invalid');
                document.getElementById('target-port').focus();
                return;
            }
        }

        const body = {
            name,
            host,
            check_type: type,
            port,
            interval_ms: seconds * 1000,
            enabled: document.getElementById('target-enabled').checked,
        };
        const buttons = document.querySelectorAll('.modal-footer .btn');
        buttons.forEach((b) => { b.disabled = true; });
        status.className = 'form-status';
        status.textContent = _('network.saving');
        try {
            if (t) {
                await Utils.api(`/api/network/targets/${encodeURIComponent(t.id)}`, { method: 'PATCH', body });
            } else {
                await Utils.api('/api/network/targets', { method: 'POST', body });
            }
            Modal.close();
            Notifications.success(t ? _('network.saved_target', { name }) : _('network.added_target', { name }));
            loadTargets();
        } catch (err) {
            buttons.forEach((b) => { b.disabled = false; });
            status.className = 'form-status is-error';
            status.textContent = _('network.save_failed', { reason: errorText(err) });
        }
    }

    async function deleteTarget(id) {
        const t = findTarget(id);
        if (!t) return;
        const ok = await Modal.confirm({
            title: _('network.delete_title'),
            message: _('network.delete_message', { name: t.name }),
            confirmLabel: _('network.delete_target_item'),
            danger: true,
        });
        if (!ok) return;
        try {
            await Utils.api(`/api/network/targets/${encodeURIComponent(id)}`, { method: 'DELETE' });
            Notifications.success(_('network.deleted_target', { name: t.name }));
        } catch (err) {
            Notifications.error(_('network.delete_failed', { reason: errorText(err) }));
        }
        loadTargets();
    }

    // ---- History dialog ----

    async function showHistory(id) {
        const t = findTarget(id);
        Modal.show({
            title: _('network.history_title', { name: t ? t.name : '' }),
            size: 'large',
            content: `<div id="history-body"><p class="state">${esc(_('network.loading_history'))}</p></div>`,
            buttons: [{ label: _('actions.close'), class: 'btn', onClick: () => Modal.close() }],
        });
        const body = document.getElementById('history-body');
        try {
            const history = await Utils.api(`/api/network/targets/${encodeURIComponent(id)}/history?limit=100`);
            if (!document.body.contains(body)) return;
            const entries = Array.isArray(history) ? history : [];
            if (!entries.length) {
                body.innerHTML = `<p class="state">${esc(_('network.no_history_yet'))}</p>`;
                return;
            }
            const down = entries.filter((e) => e.status !== 'up').length;
            body.innerHTML = `
                <p class="count-line">${esc(_('network.history_count', { count: entries.length, down }))}</p>
                <div class="table-scroll"><table class="data-table history-table">
                    <thead><tr><th>${esc(_('network.history_time'))}</th><th>${esc(_('network.status'))}</th><th>${esc(_('network.col_response'))}</th><th>${esc(_('network.history_detail'))}</th></tr></thead>
                    <tbody>${entries.map((e) => {
                        const date = Utils.parseDate(e.checked_at);
                        const up = e.status === 'up';
                        const detail = e.error_msg || (e.status_code ? _('network.http_status', { code: e.status_code }) : '');
                        return `<tr>
                            <td class="history-time">${date ? esc(Utils.formatDate(date, { second: '2-digit' })) : DASH}</td>
                            <td><span class="status ${up ? 'ok' : 'error'}">${esc(up ? _('network.status_up') : _('network.status_down'))}</span></td>
                            <td>${up && e.rtt_ms != null ? esc(latencyText(e.rtt_ms)) : DASH}</td>
                            <td class="history-detail">${detail ? esc(detail) : DASH}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>`;
        } catch (err) {
            if (!document.body.contains(body)) return;
            body.innerHTML = `<p class="state is-error">${esc(_('network.history_failed'))} ${esc(errorText(err))}</p>`;
        }
    }

    // ---- Monitor ----

    function renderMonitor() {
        if (monitorRunning === null) return;
        monitorState.className = `status ${monitorRunning ? 'ok' : 'offline'}`;
        monitorState.textContent = monitorRunning ? _('network.monitor_on') : _('network.monitor_off');
        monitorBtn.textContent = monitorRunning ? _('network.monitor_stop') : _('network.monitor_start');
        monitorBtn.hidden = !canManage;
    }

    async function loadMonitorStatus() {
        try {
            const data = await Utils.api('/api/network/monitor/status');
            monitorRunning = !!(data && data.running);
            renderMonitor();
        } catch (err) {
            monitorState.className = 'status error';
            monitorState.textContent = _('network.monitor_unknown', { reason: errorText(err) });
        }
    }

    monitorBtn.addEventListener('click', async () => {
        const action = monitorRunning ? 'stop' : 'start';
        monitorBtn.disabled = true;
        monitorStatus.className = 'form-status';
        monitorStatus.textContent = action === 'start' ? _('network.monitor_starting') : _('network.monitor_stopping');
        try {
            await Utils.api(`/api/network/monitor/${action}`, {
                method: 'POST',
                body: action === 'start' ? { interval_ms: MONITOR_TICK_MS } : {},
            });
            monitorRunning = action === 'start';
            renderMonitor();
            monitorStatus.className = 'form-status is-ok';
            monitorStatus.textContent = monitorRunning ? _('network.monitor_started') : _('network.monitor_stopped_msg');
            if (monitorRunning) setTimeout(loadTargets, 4000);
        } catch (err) {
            monitorStatus.className = 'form-status is-error';
            monitorStatus.textContent = _('network.monitor_failed', { reason: errorText(err) });
        } finally {
            monitorBtn.disabled = false;
        }
    });

    // ---- Events ----

    targetsBody.addEventListener('click', (event) => {
        const el = event.target.closest('[data-action]');
        if (!el) return;
        const id = el.dataset.id;
        switch (el.dataset.action) {
            case 'check': checkTarget(id, el); break;
            case 'history': showHistory(id); break;
            case 'edit': { const t = findTarget(id); if (t) openTargetDialog(t); break; }
            case 'delete': deleteTarget(id); break;
            default: break;
        }
    });

    createBtn.addEventListener('click', () => openTargetDialog(null));
    refreshBtn.addEventListener('click', () => { loadTargets(); loadMonitorStatus(); });
    searchInput.addEventListener('input', Utils.debounce(render, 150));

    loadTargets();
    loadMonitorStatus();
})();
