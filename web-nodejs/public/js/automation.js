/**
 * BetterDesk Console - Alerts and automation page
 *
 * Three tabs: alert rules (create, edit, enable or disable, delete),
 * alert history (filter by severity, acknowledge) and remote commands
 * (send, view result). Dialogs go through Modal.show / Modal.confirm.
 */

(function () {
    'use strict';

    const _ = (key, params) => {
        if (typeof window._ === 'function') {
            const v = window._(key, params || {});
            if (v && v !== key) return v;
        }
        return key;
    };

    const csrfToken = window.BetterDesk?.csrfToken || '';
    const pageEl = document.querySelector('.automation-page');
    const canEdit = pageEl?.dataset.canEdit === 'true';

    // ---- Tabs ----

    const TABS = ['rules', 'alerts', 'commands'];
    const tabBtns = Array.from(document.querySelectorAll('.tab-btn'));
    const tabPanels = document.querySelectorAll('.tab-panel');

    function selectTab(name, { focus = false, updateUrl = true } = {}) {
        if (!TABS.includes(name)) name = 'rules';
        tabBtns.forEach(b => {
            const on = b.dataset.tab === name;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
            if (on && focus) b.focus();
        });
        tabPanels.forEach(p => {
            const on = p.id === 'tab-' + name;
            p.classList.toggle('active', on);
            p.hidden = !on;
        });
        if (updateUrl) {
            const url = new URL(window.location.href);
            if (name === 'rules') url.searchParams.delete('tab'); else url.searchParams.set('tab', name);
            history.replaceState(null, '', url);
        }
        if (name === 'rules') loadRules();
        else if (name === 'alerts') loadAlerts();
        else if (name === 'commands') loadCommands();
    }

    tabBtns.forEach((btn, i) => {
        btn.addEventListener('click', () => selectTab(btn.dataset.tab));
        btn.addEventListener('keydown', (e) => {
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const rtl = document.documentElement.dir === 'rtl';
                const step = (e.key === 'ArrowRight') !== rtl ? 1 : -1;
                next = tabBtns[(i + step + tabBtns.length) % tabBtns.length];
            } else if (e.key === 'Home') next = tabBtns[0];
            else if (e.key === 'End') next = tabBtns[tabBtns.length - 1];
            if (next) { e.preventDefault(); selectTab(next.dataset.tab, { focus: true }); }
        });
    });

    // ---- API ----

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        const resp = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
        let data = null;
        try { data = await resp.json(); } catch (_e) { data = null; }
        if (!resp.ok) {
            const err = new Error((data && data.error) || _('automation.request_failed', { status: resp.status }));
            err.status = resp.status;
            throw err;
        }
        return data || {};
    }

    function stateRow(colspan, text, retry) {
        if (retry) {
            return `<tr><td colspan="${colspan}" class="state-cell text-danger">${escapeHtml(text)}
                <button type="button" class="btn btn-sm retry-btn">${escapeHtml(_('actions.retry'))}</button></td></tr>`;
        }
        return `<tr><td colspan="${colspan}" class="state-cell">${escapeHtml(text)}</td></tr>`;
    }

    function countText(n, one, many) {
        return _(n === 1 ? one : many, { count: '{{n}}' });
    }

    function setCountLine(el, parts) {
        // parts: [{ n, one, many }] - first number is bold
        if (!el) return;
        el.innerHTML = parts.map((p, i) => {
            const text = escapeHtml(countText(p.n, p.one, p.many));
            return i === 0 ? text.replace('{{n}}', `<strong>${p.n}</strong>`) : text.replace('{{n}}', String(p.n));
        }).join(', ');
    }

    // ==== RULES ====

    const rulesBody = document.getElementById('rules-body');
    const rulesCount = document.getElementById('rules-count');
    const createRuleBtn = document.getElementById('create-rule-btn');
    let rulesCache = [];

    async function loadRules() {
        rulesBody.innerHTML = stateRow(7, _('automation.loading_rules'));
        if (rulesCount) rulesCount.textContent = '';
        try {
            const resp = await apiFetch('/api/automation/rules');
            rulesCache = Array.isArray(resp) ? resp : Array.isArray(resp.rules) ? resp.rules : [];
            renderRules(rulesCache);
        } catch (err) {
            rulesBody.innerHTML = stateRow(7, `${_('automation.load_failed')} ${err.message}`, true);
            rulesBody.querySelector('.retry-btn')?.addEventListener('click', loadRules);
        }
    }

    function severityText(sev) {
        const key = 'automation.severity_' + sev;
        const v = _(key);
        return v === key ? String(sev || '') : v;
    }

    function severityClass(sev) {
        const s = safeSeverity(sev);
        if (s === 'critical' || s === 'high') return 'status error';
        if (s === 'warning' || s === 'medium') return 'status warning';
        return 'status offline';
    }

    function labelFor(prefix, value) {
        const key = `automation.${prefix}_${value}`;
        const v = _(key);
        return v === key ? String(value || '') : v;
    }

    function renderRules(rules) {
        if (!rules.length) {
            if (rulesCount) rulesCount.textContent = '';
            rulesBody.innerHTML = stateRow(7, _('automation.no_rules_hint'));
            return;
        }
        const enabled = rules.filter(r => r.enabled).length;
        setCountLine(rulesCount, [
            { n: rules.length, one: 'automation.rules_count_one', many: 'automation.rules_count_many' },
            { n: enabled, one: 'automation.enabled_count', many: 'automation.enabled_count' },
        ]);

        const last = rules.length - 1;
        rulesBody.innerHTML = rules.map((r, idx) => {
            const id = escapeHtml(r.id);
            const menuId = `rule-menu-${id}`;
            const up = idx >= 2 && idx >= last - 1 ? ' menu-up' : '';
            return `
            <tr data-id="${id}">
                <td><span class="rule-name">${escapeHtml(r.name)}</span>${r.description ? `<span class="cell-sub">${escapeHtml(r.description)}</span>` : ''}</td>
                <td>${escapeHtml(labelFor('type', r.condition_type))}<span class="cell-sub">${escapeHtml(labelFor('op', r.condition_op))}</span></td>
                <td>${escapeHtml(r.condition_value)}</td>
                <td><span class="${severityClass(r.severity)}">${escapeHtml(severityText(r.severity))}</span></td>
                <td>${r.scope_device_id ? `<span class="mono">${escapeHtml(r.scope_device_id)}</span>` : escapeHtml(_('automation.scope_all'))}</td>
                <td>${r.enabled
                    ? `<span class="status ok">${escapeHtml(_('automation.enabled'))}</span>`
                    : `<span class="status offline">${escapeHtml(_('automation.disabled'))}</span>`}</td>
                <td class="actions">${canEdit ? `
                    <button type="button" class="btn btn-sm edit-rule-btn" data-id="${id}">${escapeHtml(_('actions.edit'))}</button>
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                            aria-controls="${menuId}" aria-label="${escapeHtml(_('automation.rule_actions', { name: r.name }))}">
                            <span class="material-icons" aria-hidden="true">more_vert</span></button>
                        <span class="menu menu-end${up}" id="${menuId}" role="menu">
                            <button type="button" class="menu-item toggle-rule-btn" role="menuitem" data-id="${id}" data-enabled="${r.enabled ? '1' : '0'}">${escapeHtml(r.enabled ? _('automation.disable_rule') : _('automation.enable_rule'))}</button>
                            <span class="menu-divider"></span>
                            <button type="button" class="menu-item danger del-rule-btn" role="menuitem" data-id="${id}">${escapeHtml(_('automation.delete_rule_menu'))}</button>
                        </span>
                    </span>` : ''}
                </td>
            </tr>`;
        }).join('');

        rulesBody.querySelectorAll('.edit-rule-btn').forEach(btn => btn.addEventListener('click', () => editRule(btn.dataset.id)));
        rulesBody.querySelectorAll('.toggle-rule-btn').forEach(btn => btn.addEventListener('click', () => toggleRule(btn.dataset.id, btn.dataset.enabled !== '1')));
        rulesBody.querySelectorAll('.del-rule-btn').forEach(btn => btn.addEventListener('click', () => deleteRule(btn.dataset.id)));
    }

    function options(values, prefix, selected) {
        return values.map(v => `<option value="${v}"${v === selected ? ' selected' : ''}>${escapeHtml(labelFor(prefix, v))}</option>`).join('');
    }

    function openRuleModal(rule) {
        const editing = !!rule;
        const r = rule || {};
        Modal.show({
            title: editing ? _('automation.edit_rule') : _('automation.create_rule'),
            content: `
                <form id="rule-form" class="automation-dialog" novalidate>
                    <input type="hidden" id="rule-id" value="${escapeHtml(r.id ?? '')}">
                    <div class="form-group">
                        <label class="form-label" for="rule-name">${escapeHtml(_('automation.rule_name'))}</label>
                        <input type="text" class="form-input" id="rule-name" required maxlength="100" autocomplete="off" value="${escapeHtml(r.name || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-desc">${escapeHtml(_('automation.description'))}</label>
                        <input type="text" class="form-input" id="rule-desc" maxlength="500" autocomplete="off" aria-describedby="rule-desc-hint" value="${escapeHtml(r.description || '')}">
                        <p class="form-hint" id="rule-desc-hint">${escapeHtml(_('automation.description_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-condition">${escapeHtml(_('automation.condition_type'))}</label>
                        <select class="form-input" id="rule-condition" aria-describedby="rule-condition-hint">
                            ${options(['cpu_usage', 'memory_usage', 'disk_usage', 'offline_duration', 'idle_duration', 'custom'], 'type', r.condition_type || 'cpu_usage')}
                        </select>
                        <p class="form-hint" id="rule-condition-hint">${escapeHtml(_('automation.condition_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-operator">${escapeHtml(_('automation.condition_op'))}</label>
                        <select class="form-input" id="rule-operator">
                            ${options(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'], 'op', r.condition_op || 'gt')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-value">${escapeHtml(_('automation.condition_value'))}</label>
                        <input type="number" class="form-input is-short" id="rule-value" step="any" required aria-describedby="rule-value-hint" value="${escapeHtml(r.condition_value ?? '')}">
                        <p class="form-hint" id="rule-value-hint">${escapeHtml(_('automation.threshold_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-severity">${escapeHtml(_('automation.severity'))}</label>
                        <select class="form-input" id="rule-severity" aria-describedby="rule-severity-hint">
                            ${options(['info', 'warning', 'critical'], 'severity', r.severity || 'warning')}
                        </select>
                        <p class="form-hint" id="rule-severity-hint">${escapeHtml(_('automation.severity_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rule-device">${escapeHtml(_('automation.scope_device'))}</label>
                        <input type="text" class="form-input is-medium" id="rule-device" autocomplete="off" spellcheck="false" aria-describedby="rule-device-hint" value="${escapeHtml(r.scope_device_id || '')}">
                        <p class="form-hint" id="rule-device-hint">${escapeHtml(_('automation.scope_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="check-field">
                            <input type="checkbox" id="rule-enabled"${!editing || r.enabled ? ' checked' : ''}>
                            <span class="check-label">${escapeHtml(_('automation.enabled'))}</span>
                            <span class="form-hint">${escapeHtml(_('automation.enabled_hint'))}</span>
                        </label>
                    </div>
                    <p class="field-effect">${escapeHtml(_('automation.rule_effect'))}</p>
                    <p class="form-status is-error" id="rule-form-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: editing ? _('actions.save') : _('automation.create_rule'), class: 'btn-primary', onClick: () => saveRule() },
            ],
            onOpen: () => {
                document.getElementById('rule-form')?.addEventListener('submit', (e) => { e.preventDefault(); saveRule(); });
            },
        });
    }

    async function editRule(id) {
        try {
            const rule = await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}`);
            openRuleModal(rule);
        } catch (err) { showToast(`${_('automation.open_failed')} ${err.message}`, 'error'); }
    }

    function formError(msg, focusId) {
        const st = document.getElementById('rule-form-status');
        if (st) st.textContent = msg;
        if (focusId) document.getElementById(focusId)?.focus();
    }

    let savingRule = false;
    async function saveRule() {
        if (savingRule) return;
        const id = document.getElementById('rule-id').value;
        const rawValue = document.getElementById('rule-value').value.trim();
        const body = {
            name: document.getElementById('rule-name').value.trim(),
            description: document.getElementById('rule-desc').value.trim(),
            condition_type: document.getElementById('rule-condition').value,
            condition_op: document.getElementById('rule-operator').value,
            condition_value: parseFloat(rawValue),
            severity: document.getElementById('rule-severity').value,
            scope_device_id: document.getElementById('rule-device').value.trim() || null,
            enabled: document.getElementById('rule-enabled').checked,
        };

        if (!body.name) { formError(_('automation.name_required'), 'rule-name'); return; }
        if (rawValue === '' || !Number.isFinite(body.condition_value)) { formError(_('automation.threshold_required'), 'rule-value'); return; }

        savingRule = true;
        formError('');
        try {
            const url = id ? `/api/automation/rules/${encodeURIComponent(id)}` : '/api/automation/rules';
            await apiFetch(url, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) });
            Modal.close();
            showToast(_('automation.rule_saved', { name: body.name }), 'success');
            loadRules();
        } catch (err) {
            formError(`${_('automation.rule_save_failed')} ${err.message}`);
        } finally {
            savingRule = false;
        }
    }

    async function toggleRule(id, enable) {
        const rule = rulesCache.find(r => String(r.id) === String(id));
        const name = rule ? rule.name : '';
        try {
            await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled: enable }) });
            showToast(_(enable ? 'automation.rule_enabled_toast' : 'automation.rule_disabled_toast', { name }), 'success');
            loadRules();
        } catch (err) { showToast(`${_('automation.rule_save_failed')} ${err.message}`, 'error'); }
    }

    async function deleteRule(id) {
        const rule = rulesCache.find(r => String(r.id) === String(id));
        const name = rule ? rule.name : '';
        const ok = await Modal.confirm({
            title: _('automation.delete_rule'),
            message: _('automation.delete_rule_confirm', { name }),
            confirmLabel: _('automation.delete_rule_menu'),
            danger: true,
        });
        if (!ok) return;
        try {
            await apiFetch(`/api/automation/rules/${encodeURIComponent(id)}`, { method: 'DELETE' });
            showToast(_('automation.rule_deleted', { name }), 'success');
            loadRules();
        } catch (err) { showToast(`${_('automation.rule_delete_failed')} ${err.message}`, 'error'); }
    }

    if (createRuleBtn) createRuleBtn.addEventListener('click', () => openRuleModal(null));

    // ==== ALERTS ====

    const alertsBody = document.getElementById('alerts-body');
    const alertsCount = document.getElementById('alerts-count');
    const severityFilter = document.getElementById('alert-severity-filter');
    let severity = '';

    async function loadAlerts() {
        alertsBody.innerHTML = stateRow(7, _('automation.loading_alerts'));
        if (alertsCount) alertsCount.textContent = '';
        const params = new URLSearchParams();
        if (severity) params.set('severity', severity);

        try {
            const resp = await apiFetch(`/api/automation/alerts?${params}`);
            renderAlerts(Array.isArray(resp) ? resp : Array.isArray(resp.alerts) ? resp.alerts : []);
        } catch (err) {
            alertsBody.innerHTML = stateRow(7, `${_('automation.load_failed')} ${err.message}`, true);
            alertsBody.querySelector('.retry-btn')?.addEventListener('click', loadAlerts);
        }
    }

    function renderAlerts(alerts) {
        if (!alerts.length) {
            if (alertsCount) alertsCount.textContent = '';
            alertsBody.innerHTML = stateRow(7, severity ? _('automation.no_alerts_filtered') : _('automation.no_alerts_hint'));
            return;
        }
        const open = alerts.filter(a => !a.acknowledged_at && !a.acknowledged).length;
        setCountLine(alertsCount, [
            { n: alerts.length, one: 'automation.alerts_count_one', many: 'automation.alerts_count_many' },
            { n: open, one: 'automation.open_count', many: 'automation.open_count' },
        ]);
        alertsBody.innerHTML = alerts.map(a => {
            const acked = !!(a.acknowledged_at || a.acknowledged);
            const details = a.message || (a.measured_value != null ? a.measured_value : '');
            return `
            <tr>
                <td class="time-cell" title="${escapeHtml(formatDate(a.triggered_at))}">${escapeHtml(formatTimeAgo(a.triggered_at))}</td>
                <td>${escapeHtml(a.rule_name || '—')}</td>
                <td>${a.device_id ? `<span class="mono">${escapeHtml(a.device_id)}</span>` : '—'}</td>
                <td class="alert-details">${details !== '' ? escapeHtml(details) : '—'}</td>
                <td><span class="${severityClass(a.severity)}">${escapeHtml(severityText(a.severity))}</span></td>
                <td>${acked
                    ? `<span class="status ok">${escapeHtml(a.acknowledged_by ? _('automation.acknowledged_by', { name: a.acknowledged_by }) : _('automation.acknowledged'))}</span>`
                    : `<span class="status warning">${escapeHtml(_('automation.unacknowledged'))}</span>`}</td>
                <td class="actions">${!acked ? `<button type="button" class="btn btn-sm ack-btn" data-id="${escapeHtml(a.id)}">${escapeHtml(_('automation.acknowledge'))}</button>` : ''}</td>
            </tr>`;
        }).join('');

        alertsBody.querySelectorAll('.ack-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    await apiFetch(`/api/automation/alerts/${encodeURIComponent(btn.dataset.id)}/ack`, { method: 'POST' });
                    showToast(_('automation.alert_acknowledged'), 'success');
                    loadAlerts();
                } catch (err) {
                    btn.disabled = false;
                    showToast(`${_('automation.ack_failed')} ${err.message}`, 'error');
                }
            });
        });
    }

    severityFilter?.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            severity = btn.dataset.severity || '';
            severityFilter.querySelectorAll('.filter-btn').forEach(b => {
                const on = b === btn;
                b.classList.toggle('active', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            loadAlerts();
        });
    });

    // ==== COMMANDS ====

    const commandsBody = document.getElementById('commands-body');
    const commandsCount = document.getElementById('commands-count');
    const sendCmdBtn = document.getElementById('send-command-btn');
    const COMMAND_TYPES = ['shell', 'powershell', 'script', 'restart_service', 'reboot'];

    async function loadCommands() {
        commandsBody.innerHTML = stateRow(6, _('automation.loading_commands'));
        if (commandsCount) commandsCount.textContent = '';
        try {
            const resp = await apiFetch('/api/automation/commands');
            renderCommands(Array.isArray(resp) ? resp : Array.isArray(resp.commands) ? resp.commands : []);
        } catch (err) {
            commandsBody.innerHTML = stateRow(6, `${_('automation.load_failed')} ${err.message}`, true);
            commandsBody.querySelector('.retry-btn')?.addEventListener('click', loadCommands);
        }
    }

    function statusText(status) {
        const key = 'automation.status_' + status;
        const v = _(key);
        return v === key ? String(status || '') : v;
    }

    function statusClass(status) {
        const s = safeStatus(status);
        if (s === 'failed' || s === 'error') return 'status error';
        if (s === 'completed' || s === 'success') return 'status ok';
        if (s === 'running') return 'status running';
        if (s === 'cancelled') return 'status offline';
        return 'status pending';
    }

    function renderCommands(cmds) {
        if (!cmds.length) {
            if (commandsCount) commandsCount.textContent = '';
            commandsBody.innerHTML = stateRow(6, _('automation.no_commands_hint'));
            return;
        }
        const waiting = cmds.filter(c => c.status === 'pending').length;
        setCountLine(commandsCount, [
            { n: cmds.length, one: 'automation.commands_count_one', many: 'automation.commands_count_many' },
            { n: waiting, one: 'automation.waiting_count', many: 'automation.waiting_count' },
        ]);
        commandsBody.innerHTML = cmds.map(c => `
            <tr>
                <td class="time-cell" title="${escapeHtml(formatDate(c.created_at))}">${escapeHtml(formatTimeAgo(c.created_at))}${c.created_by ? `<span class="cell-sub">${escapeHtml(_('automation.sent_by', { name: c.created_by }))}</span>` : ''}</td>
                <td><span class="mono">${escapeHtml(c.device_id)}</span></td>
                <td>${escapeHtml(labelFor('cmd_type', c.command_type))}</td>
                <td class="cmd-payload" title="${escapeHtml(c.payload)}"><span class="mono">${escapeHtml(truncate(c.payload, 40))}</span></td>
                <td><span class="${statusClass(c.status)}">${escapeHtml(statusText(c.status))}</span></td>
                <td class="actions"><button type="button" class="btn btn-sm result-btn" data-id="${escapeHtml(c.id)}">${escapeHtml(c.result ? _('automation.view_result') : _('actions.details'))}</button></td>
            </tr>
        `).join('');

        commandsBody.querySelectorAll('.result-btn').forEach(btn => {
            btn.addEventListener('click', () => viewResult(btn.dataset.id));
        });
    }

    async function viewResult(id) {
        let cmd;
        try {
            cmd = await apiFetch(`/api/automation/commands/${encodeURIComponent(id)}`);
        } catch (err) {
            showToast(`${_('automation.open_failed')} ${err.message}`, 'error');
            return;
        }
        Modal.show({
            title: _('automation.command_title', { id: cmd.id }),
            size: 'large',
            content: `
                <dl class="facts automation-facts">
                    <dt>${escapeHtml(_('automation.device'))}</dt><dd><span class="mono">${escapeHtml(cmd.device_id)}</span></dd>
                    <dt>${escapeHtml(_('automation.command_type'))}</dt><dd>${escapeHtml(labelFor('cmd_type', cmd.command_type))}</dd>
                    <dt>${escapeHtml(_('automation.command_status'))}</dt><dd><span class="${statusClass(cmd.status)}">${escapeHtml(statusText(cmd.status))}</span></dd>
                    <dt>${escapeHtml(_('automation.sent_at'))}</dt><dd>${escapeHtml(formatDate(cmd.created_at))}${cmd.created_by ? ` (${escapeHtml(cmd.created_by)})` : ''}</dd>
                    ${cmd.completed_at ? `<dt>${escapeHtml(_('automation.completed_at'))}</dt><dd>${escapeHtml(formatDate(cmd.completed_at))}</dd>` : ''}
                </dl>
                <div class="code-block-head automation-block-head"><span class="code-block-title">${escapeHtml(_('automation.command_payload'))}</span></div>
                <pre class="code-block">${escapeHtml(cmd.payload)}</pre>
                <div class="code-block-head automation-block-head"><span class="code-block-title">${escapeHtml(_('automation.command_result'))}</span></div>
                ${cmd.result
                    ? `<pre class="code-block">${escapeHtml(cmd.result)}</pre>`
                    : `<p class="text-muted">${escapeHtml(_('automation.no_result_yet'))}</p>`}`,
            buttons: [{ label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }],
        });
    }

    function openCommandModal() {
        Modal.show({
            title: _('automation.send_command'),
            content: `
                <form id="cmd-form" class="automation-dialog" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="cmd-device">${escapeHtml(_('automation.device_id'))}</label>
                        <input type="text" class="form-input is-medium" id="cmd-device" required autocomplete="off" spellcheck="false" aria-describedby="cmd-device-hint">
                        <p class="form-hint" id="cmd-device-hint">${escapeHtml(_('automation.device_id_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="cmd-type">${escapeHtml(_('automation.command_type'))}</label>
                        <select class="form-input" id="cmd-type">${options(COMMAND_TYPES, 'cmd_type', 'shell')}</select>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="cmd-payload">${escapeHtml(_('automation.command_payload'))}</label>
                        <textarea class="form-input mono" id="cmd-payload" rows="4" maxlength="10000" required spellcheck="false" aria-describedby="cmd-payload-hint"></textarea>
                        <p class="form-hint" id="cmd-payload-hint">${escapeHtml(_('automation.payload_hint'))}</p>
                    </div>
                    <p class="field-effect is-restart">${escapeHtml(_('automation.command_effect'))}</p>
                    <p class="form-status is-error" id="cmd-form-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('automation.send_command'), class: 'btn-primary', onClick: () => sendCommand() },
            ],
            onOpen: () => {
                document.getElementById('cmd-form')?.addEventListener('submit', (e) => { e.preventDefault(); sendCommand(); });
            },
        });
        // Modal.show focuses the first field; a device ID is the first thing to enter
    }

    let sending = false;
    async function sendCommand() {
        if (sending) return;
        const status = document.getElementById('cmd-form-status');
        const body = {
            device_id: document.getElementById('cmd-device').value.trim(),
            command_type: document.getElementById('cmd-type').value,
            payload: document.getElementById('cmd-payload').value.trim(),
        };

        if (!body.device_id || !body.payload) {
            status.textContent = _('automation.id_payload_required');
            document.getElementById(body.device_id ? 'cmd-payload' : 'cmd-device')?.focus();
            return;
        }

        sending = true;
        status.textContent = '';
        try {
            await apiFetch('/api/automation/commands', { method: 'POST', body: JSON.stringify(body) });
            Modal.close();
            showToast(_('automation.command_sent', { device: body.device_id }), 'success');
            loadCommands();
        } catch (err) {
            status.textContent = `${_('automation.command_send_failed')} ${err.message}`;
        } finally {
            sending = false;
        }
    }

    if (sendCmdBtn) sendCmdBtn.addEventListener('click', openCommandModal);

    // ---- Helpers ----

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function safeToken(value, allowed, fallback) {
        return allowed.includes(value) ? value : fallback;
    }

    function safeSeverity(value) {
        return safeToken(value, ['info', 'low', 'warning', 'medium', 'high', 'critical'], 'warning');
    }

    function safeStatus(value) {
        return safeToken(value, ['pending', 'queued', 'running', 'success', 'completed', 'failed', 'error', 'cancelled'], 'pending');
    }

    function truncate(str, max) {
        if (!str) return '';
        return str.length > max ? str.slice(0, max) + '…' : str;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        return window.Utils?.formatDate ? Utils.formatDate(dateStr, { empty: '' }) : new Date(dateStr).toLocaleString();
    }

    function formatTimeAgo(dateStr) {
        if (!dateStr) return '—';
        return window.Utils?.formatRelativeTime ? Utils.formatRelativeTime(dateStr, { empty: '—' }) : new Date(dateStr).toLocaleString();
    }

    function showToast(message, type) {
        if (window.Notifications) {
            if (type === 'error') Notifications.error(message);
            else Notifications.success(message);
            return;
        }
        if (window.BetterDesk?.notify) window.BetterDesk.notify(message, type);
    }

    // ---- Init ----
    const initial = new URLSearchParams(window.location.search).get('tab');
    selectTab(TABS.includes(initial) ? initial : 'rules', { updateUrl: false });
})();
