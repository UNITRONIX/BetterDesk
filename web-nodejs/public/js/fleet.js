/* fleet.js — Fleet tasks: resources, tasks, workflows, compliance */
'use strict';
(function () {
    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params || {}) : key);
    const TABS = ['resources', 'tasks', 'builder', 'compliance'];
    let _orgs = [];
    let _orgsLoaded = false;
    let _orgsFailed = false;
    let _resources = [];
    let _tasks = [];
    let _tasksLoaded = false;
    let _complianceData = [];
    let _menuSeq = 0;

    // -----------------------------------------------------------------------
    // Requests: JSON with the CSRF header; a failed answer throws with the server's message
    // -----------------------------------------------------------------------
    async function api(url, opts = {}) {
        const headers = { 'x-csrf-token': window.BetterDesk?.csrfToken || '' };
        if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
        const resp = await fetch(url, {
            method: opts.method || 'GET',
            credentials: 'same-origin',
            headers,
            body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
        });
        let data = null;
        try { data = await resp.json(); } catch { data = null; }
        if (!resp.ok || (data && data.success === false)) {
            const msg = (data && (data.error || data.message)) || resp.statusText || String(resp.status);
            throw new Error(msg);
        }
        return data;
    }

    function listFrom(data, key) {
        if (Array.isArray(data)) return data;
        if (!data) return [];
        return data.data || data[key] || [];
    }

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    async function init() {
        bindTabs();
        const search = document.getElementById('task-search');
        if (search) search.addEventListener('input', filterTasks);
        const active = document.querySelector('.fleet-tab.active')?.dataset.tab || 'resources';
        if (active === 'tasks') loadTasks();
        await loadOrganizations();
        if (active === 'resources') loadResources();
        if (active === 'compliance') loadCompliance();
    }

    function bindTabs() {
        const buttons = Array.from(document.querySelectorAll('.fleet-tab'));
        buttons.forEach((btn, i) => {
            btn.addEventListener('keydown', (e) => {
                const rtl = document.documentElement.dir === 'rtl';
                let next = null;
                if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) next = buttons[(i + 1) % buttons.length];
                else if (e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) next = buttons[(i - 1 + buttons.length) % buttons.length];
                else if (e.key === 'Home') next = buttons[0];
                else if (e.key === 'End') next = buttons[buttons.length - 1];
                if (!next) return;
                e.preventDefault();
                switchTab(next.dataset.tab);
                next.focus();
            });
        });
    }

    async function loadOrganizations() {
        try {
            const data = await api('/api/panel/org');
            _orgs = listFrom(data, 'organizations');
            _orgsFailed = false;
        } catch {
            _orgs = [];
            _orgsFailed = true;
        }
        _orgsLoaded = true;
        populateOrgSelects();
    }

    function populateOrgSelects() {
        ['res-org-select', 'comp-org-select'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const val = el.value;
            el.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            _orgs.forEach(o => {
                const opt = document.createElement('option');
                opt.value = o.id || o.name;
                opt.textContent = o.name || o.id;
                el.appendChild(opt);
            });
            if (val) el.value = val;
        });
        // Resources always belong to one organization: start with the first one
        const resSel = document.getElementById('res-org-select');
        if (resSel && !resSel.value && _orgs.length) resSel.value = _orgs[0].id || _orgs[0].name;
    }

    // -----------------------------------------------------------------------
    // Tabs
    // -----------------------------------------------------------------------
    function switchTab(tab) {
        if (!TABS.includes(tab)) tab = 'resources';
        document.querySelectorAll('.fleet-tab').forEach(t => {
            const on = t.dataset.tab === tab;
            t.classList.toggle('active', on);
            t.setAttribute('aria-selected', on ? 'true' : 'false');
            t.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('.fleet-panel').forEach(p => { p.hidden = p.id !== 'panel-' + tab; });
        const url = new URL(window.location);
        url.searchParams.set('tab', tab);
        history.replaceState(null, '', url);
        if (tab === 'resources') loadResources();
        if (tab === 'tasks') loadTasks();
        if (tab === 'compliance') loadCompliance();
    }

    // -----------------------------------------------------------------------
    // Shared table helpers
    // -----------------------------------------------------------------------
    function stateRow(tbody, cols, text, retryCall) {
        const retry = retryCall
            ? ` <button type="button" class="btn btn-sm" data-bd-call="${retryCall}">${esc(_('fleet.try_again'))}</button>`
            : '';
        tbody.innerHTML = `<tr><td colspan="${cols}" class="state-cell${retryCall ? ' is-error' : ''}"><span class="state-text">${esc(text)}${retry}</span></td></tr>`;
    }

    function rowMenu(label, items) {
        const id = 'fleet-menu-' + (++_menuSeq);
        return `<span class="menu-anchor">
            <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${id}" aria-label="${esc(label)}">
                <span class="material-icons" aria-hidden="true">more_vert</span></button>
            <span class="menu menu-end" id="${id}" role="menu">${items}</span>
        </span>`;
    }

    function setCount(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text || '';
    }

    function fmtDate(v) {
        if (!v) return '–';
        const d = new Date(v);
        return isNaN(d) ? esc(v) : esc(d.toLocaleString());
    }

    function notify(type, msg) {
        if (window.Notifications && Notifications[type]) Notifications[type](msg);
    }

    // -----------------------------------------------------------------------
    // Resources
    // -----------------------------------------------------------------------
    const RES_TYPES = ['printer', 'network_drive', 'dns', 'vpn', 'proxy'];
    const typeLabel = (t) => RES_TYPES.includes(t) ? _('fleet.type_' + t) : (t || '–');
    const scopeLabel = (s) => ['org', 'group', 'device'].includes(s) ? _('fleet.scope_' + s) : (s || _('fleet.scope_org'));

    async function loadResources() {
        const tbody = document.getElementById('res-tbody');
        if (!tbody) return;
        if (!_orgsLoaded) return; // init loads them after the organizations
        const orgId = document.getElementById('res-org-select')?.value;
        if (_orgsFailed) {
            setCount('res-count', '');
            stateRow(tbody, 6, _('fleet.orgs_failed'), 'Fleet.reloadOrganizations');
            return;
        }
        if (!orgId) {
            setCount('res-count', '');
            stateRow(tbody, 6, _orgs.length ? _('fleet.choose_org') : _('fleet.no_orgs'));
            return;
        }
        stateRow(tbody, 6, _('fleet.loading_resources'));
        try {
            const data = await api(`/api/panel/fleet/resources/${encodeURIComponent(orgId)}`);
            _resources = listFrom(data, 'resources');
        } catch (e) {
            _resources = [];
            setCount('res-count', '');
            stateRow(tbody, 6, _('fleet.resources_failed', { error: e.message }), 'Fleet.loadResources');
            return;
        }
        const typeFilter = document.getElementById('res-type-filter')?.value;
        const filtered = typeFilter ? _resources.filter(r => r.type === typeFilter) : _resources;
        renderResources(filtered, !!typeFilter);
    }

    function renderResources(list, filtered) {
        const tbody = document.getElementById('res-tbody');
        if (!tbody) return;
        setCount('res-count', _resources.length
            ? (filtered ? _('fleet.count_resources_filtered', { count: list.length, total: _resources.length }) : _('fleet.count_resources', { count: _resources.length }))
            : '');
        if (!list.length) {
            stateRow(tbody, 6, filtered && _resources.length ? _('fleet.no_resources_type') : _('fleet.no_resources'));
            return;
        }
        tbody.innerHTML = list.map(r => {
            const active = r.active !== false;
            const id = esc(JSON.stringify([String(r.id)]));
            return `
            <tr>
                <td>${esc(r.name)}</td>
                <td>${esc(typeLabel(r.type))}</td>
                <td><span class="mono">${esc(r.address || r.value || '–')}</span></td>
                <td>${esc(scopeLabel(r.scope))}${r.scope_value ? `<span class="cell-sub">${esc(r.scope_value)}</span>` : ''}</td>
                <td><span class="status ${active ? 'active' : 'stopped'}">${esc(active ? _('fleet.active') : _('fleet.inactive'))}</span></td>
                <td class="actions">
                    <button type="button" class="btn btn-sm" data-bd-call="Fleet.editResource" data-bd-args="${id}">${esc(_('fleet.edit'))}</button>
                    ${rowMenu(_('fleet.actions_for', { name: r.name || r.id }),
                        `<button type="button" class="menu-item danger" role="menuitem" data-bd-call="Fleet.deleteResource" data-bd-args="${id}">${esc(_('fleet.delete_ellipsis'))}</button>`)}
                </td>
            </tr>`;
        }).join('');
    }

    function resourceForm() {
        const opt = (v, k) => `<option value="${v}">${esc(_(k))}</option>`;
        return `
            <input type="hidden" id="res-edit-id">
            <div class="form-group">
                <label class="form-label" for="res-name">${esc(_('fleet.col_name'))}</label>
                <input type="text" id="res-name" class="form-input" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label" for="res-type">${esc(_('fleet.col_type'))}</label>
                <select id="res-type" class="form-select" data-bd-call="Fleet.onResTypeChange" data-bd-on="change">
                    ${RES_TYPES.map(t => opt(t, 'fleet.type_' + t)).join('')}
                </select>
            </div>
            <div class="form-group" id="res-address-group">
                <label class="form-label" for="res-address" id="res-address-label">${esc(_('fleet.address'))}</label>
                <input type="text" id="res-address" class="form-input mono" autocomplete="off" aria-describedby="res-address-hint">
                <p class="form-hint" id="res-address-hint"></p>
            </div>
            <div class="form-group">
                <label class="form-label" for="res-scope">${esc(_('fleet.col_scope'))}</label>
                <select id="res-scope" class="form-select">
                    ${opt('org', 'fleet.scope_org')}${opt('group', 'fleet.scope_group')}${opt('device', 'fleet.scope_device')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="res-scope-value">${esc(_('fleet.scope_value'))}</label>
                <input type="text" id="res-scope-value" class="form-input" autocomplete="off" aria-describedby="res-scope-hint">
                <p class="form-hint" id="res-scope-hint">${esc(_('fleet.scope_value_hint'))}</p>
            </div>
            <p class="form-status is-error" id="res-form-status" role="alert"></p>`;
    }

    function showResourceModal(resource) {
        // data-bd-call passes no argument from the toolbar button; edit passes the row
        if (!resource || typeof resource !== 'object' || resource instanceof Event) resource = null;
        const orgId = document.getElementById('res-org-select')?.value;
        if (!orgId) {
            notify('error', _orgs.length ? _('fleet.choose_org') : _('fleet.no_orgs'));
            return;
        }
        Modal.show({
            title: resource ? _('fleet.edit_resource') : _('fleet.add_resource'),
            content: resourceForm(),
            buttons: [
                { label: _('fleet.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: resource ? _('fleet.save') : _('fleet.add_resource'), class: 'btn-primary', onClick: saveResource }
            ]
        });
        document.getElementById('res-edit-id').value = resource?.id || '';
        document.getElementById('res-name').value = resource?.name || '';
        document.getElementById('res-type').value = resource?.type || 'printer';
        document.getElementById('res-address').value = resource?.address || resource?.value || '';
        document.getElementById('res-scope').value = resource?.scope || 'org';
        document.getElementById('res-scope-value').value = resource?.scope_value || '';
        onResTypeChange();
        document.getElementById('res-name').focus();
    }

    function closeResourceModal() { Modal.close(); }

    function onResTypeChange() {
        const type = document.getElementById('res-type')?.value;
        const label = document.getElementById('res-address-label');
        const hint = document.getElementById('res-address-hint');
        if (!label) return;
        const examples = {
            printer: '\\\\server\\printer',
            network_drive: '\\\\server\\share',
            dns: '8.8.8.8, 1.1.1.1',
            vpn: 'vpn.example.com',
            proxy: 'http://proxy:8080'
        };
        label.textContent = type === 'dns' ? _('fleet.address_dns') : type === 'vpn' ? _('fleet.address_vpn') : _('fleet.address');
        if (hint) hint.textContent = _('fleet.example', { value: examples[type] || '' });
    }

    async function saveResource() {
        const orgId = document.getElementById('res-org-select')?.value;
        const status = document.getElementById('res-form-status');
        const editId = document.getElementById('res-edit-id')?.value;
        const body = {
            name: document.getElementById('res-name')?.value?.trim(),
            type: document.getElementById('res-type')?.value,
            address: document.getElementById('res-address')?.value?.trim(),
            scope: document.getElementById('res-scope')?.value,
            scope_value: document.getElementById('res-scope-value')?.value?.trim()
        };
        if (!body.name) {
            if (status) status.textContent = _('fleet.name_required');
            document.getElementById('res-name')?.focus();
            return;
        }
        if (status) status.textContent = '';
        try {
            const url = editId
                ? `/api/panel/fleet/resources/${encodeURIComponent(orgId)}/${encodeURIComponent(editId)}`
                : `/api/panel/fleet/resources/${encodeURIComponent(orgId)}`;
            await api(url, { method: editId ? 'PUT' : 'POST', body });
            Modal.close();
            notify('success', editId ? _('fleet.resource_saved', { name: body.name }) : _('fleet.resource_added', { name: body.name }));
            loadResources();
        } catch (e) {
            if (status) status.textContent = _('fleet.save_failed', { error: e.message });
        }
    }

    function editResource(id) {
        const r = _resources.find(x => String(x.id) === String(id));
        if (r) showResourceModal(r);
    }

    async function deleteResource(id) {
        const r = _resources.find(x => String(x.id) === String(id));
        const name = r?.name || id;
        const ok = await Modal.confirm({
            title: _('fleet.delete_resource_title'),
            message: _('fleet.delete_resource_message', { name }),
            confirmLabel: _('fleet.delete'),
            danger: true
        });
        if (!ok) return;
        const orgId = document.getElementById('res-org-select')?.value;
        if (!orgId) return;
        try {
            await api(`/api/panel/fleet/resources/${encodeURIComponent(orgId)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
            notify('success', _('fleet.resource_deleted', { name }));
            loadResources();
        } catch (e) {
            notify('error', _('fleet.delete_failed', { error: e.message }));
        }
    }

    function onResOrgChange() { loadResources(); }

    async function reloadOrganizations() {
        await loadOrganizations();
        loadResources();
    }

    // -----------------------------------------------------------------------
    // Tasks
    // -----------------------------------------------------------------------
    const TASK_TYPES = ['script', 'restart', 'update', 'install', 'file_deploy', 'registry'];
    const taskTypeLabel = (t) => TASK_TYPES.includes(t) ? _('fleet.task_type_' + t) : (t || '–');
    const STATUS_CLASS = { pending: 'pending', running: 'running', success: 'ok', failed: 'error' };

    async function loadTasks() {
        const tbody = document.getElementById('task-tbody');
        if (!tbody) return;
        const qs = new URLSearchParams();
        const status = document.getElementById('task-status-filter')?.value;
        if (status) qs.set('status', status);
        if (!_tasksLoaded) stateRow(tbody, 7, _('fleet.loading_tasks'));
        try {
            const data = await api(`/api/panel/fleet/tasks?${qs.toString()}`);
            _tasks = listFrom(data, 'tasks');
            _tasksLoaded = true;
        } catch (e) {
            _tasks = [];
            setCount('task-count', '');
            stateRow(tbody, 7, _('fleet.tasks_failed', { error: e.message }), 'Fleet.loadTasks');
            return;
        }
        filterTasks();
    }

    function renderTasks(list, searching) {
        const tbody = document.getElementById('task-tbody');
        if (!tbody) return;
        setCount('task-count', _tasks.length
            ? (searching ? _('fleet.count_tasks_filtered', { count: list.length, total: _tasks.length }) : _('fleet.count_tasks', { count: _tasks.length }))
            : '');
        if (!list.length) {
            const status = document.getElementById('task-status-filter')?.value;
            stateRow(tbody, 7, searching || status ? _('fleet.no_tasks_match') : _('fleet.no_tasks'));
            return;
        }
        tbody.innerHTML = list.map(t => {
            const id = esc(JSON.stringify([String(t.id)]));
            const st = t.status || 'pending';
            const stLabel = STATUS_CLASS[st] ? _('fleet.status_' + st) : st;
            const name = t.name || t.id;
            return `
            <tr>
                <td>${esc(t.name)}</td>
                <td>${esc(taskTypeLabel(t.type || t.task_type))}</td>
                <td><span class="mono">${esc(t.targets || t.device_id || '–')}</span></td>
                <td>${esc(formatSchedule(t))}</td>
                <td><span class="status ${STATUS_CLASS[st] || ''}">${esc(stLabel)}</span></td>
                <td>${fmtDate(t.last_run)}</td>
                <td class="actions">
                    <button type="button" class="btn btn-sm" data-bd-call="Fleet.showOutput" data-bd-args="${id}">${esc(_('fleet.show_output'))}</button>
                    ${st === 'failed' ? `<button type="button" class="btn btn-sm" data-bd-call="Fleet.retryTask" data-bd-args="${id}">${esc(_('fleet.task_retry'))}</button>` : ''}
                    ${rowMenu(_('fleet.actions_for', { name }),
                        `<button type="button" class="menu-item danger" role="menuitem" data-bd-call="Fleet.deleteTask" data-bd-args="${id}">${esc(_('fleet.delete_ellipsis'))}</button>`)}
                </td>
            </tr>`;
        }).join('');
    }

    function filterTasks() {
        const q = (document.getElementById('task-search')?.value || '').trim().toLowerCase();
        if (!q) { renderTasks(_tasks, false); return; }
        renderTasks(_tasks.filter(t =>
            (t.name || '').toLowerCase().includes(q) ||
            String(t.targets || '').toLowerCase().includes(q)
        ), true);
    }

    function formatSchedule(t) {
        if (t.schedule_type === 'cron') return `${_('fleet.schedule_cron')}: ${t.schedule_value || t.cron || ''}`;
        if (t.schedule_type === 'once') {
            const d = t.schedule_value ? new Date(t.schedule_value) : null;
            return d && !isNaN(d) ? d.toLocaleString() : (t.schedule_value || _('fleet.schedule_once'));
        }
        return _('fleet.schedule_immediate');
    }

    function taskForm() {
        const opt = (v, k) => `<option value="${v}">${esc(_(k))}</option>`;
        return `
            <input type="hidden" id="task-edit-id">
            <div class="form-group">
                <label class="form-label" for="task-name">${esc(_('fleet.col_task_name'))}</label>
                <input type="text" id="task-name" class="form-input" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label" for="task-type">${esc(_('fleet.col_task_type'))}</label>
                <select id="task-type" class="form-select">
                    ${TASK_TYPES.map(t => opt(t, 'fleet.task_type_' + t)).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-targets">${esc(_('fleet.target_devices'))}</label>
                <input type="text" id="task-targets" class="form-input mono" autocomplete="off" aria-describedby="task-targets-hint">
                <p class="form-hint" id="task-targets-hint">${esc(_('fleet.target_hint'))}</p>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-schedule-type">${esc(_('fleet.col_schedule'))}</label>
                <select id="task-schedule-type" class="form-select" data-bd-call="Fleet.onScheduleTypeChange" data-bd-on="change">
                    ${opt('immediate', 'fleet.schedule_immediate')}${opt('once', 'fleet.schedule_once')}${opt('cron', 'fleet.schedule_cron')}
                </select>
            </div>
            <div class="form-group" id="task-schedule-value-group" hidden>
                <label class="form-label" for="task-schedule-value" id="task-schedule-value-label">${esc(_('fleet.schedule_when'))}</label>
                <input type="text" id="task-schedule-value" class="form-input" autocomplete="off" aria-describedby="task-schedule-hint">
                <p class="form-hint" id="task-schedule-hint"></p>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-script">${esc(_('fleet.script_content'))}</label>
                <textarea id="task-script" class="form-input mono" rows="8" spellcheck="false" aria-describedby="task-script-hint"></textarea>
                <p class="form-hint" id="task-script-hint">${esc(_('fleet.script_hint'))}</p>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-retries">${esc(_('fleet.retry_count'))}</label>
                <input type="number" id="task-retries" class="form-input is-short" value="0" min="0" max="3" aria-describedby="task-retries-hint">
                <p class="form-hint" id="task-retries-hint">${esc(_('fleet.retry_hint'))}</p>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-timeout">${esc(_('fleet.timeout_sec'))}</label>
                <input type="number" id="task-timeout" class="form-input is-short" value="300" min="30" max="3600" aria-describedby="task-timeout-hint">
                <p class="form-hint" id="task-timeout-hint">${esc(_('fleet.timeout_hint'))}</p>
            </div>
            <p class="form-status is-error" id="task-form-status" role="alert"></p>`;
    }

    function showTaskModal(task) {
        if (!task || typeof task !== 'object' || task instanceof Event) task = null;
        Modal.show({
            title: task ? _('fleet.edit_task') : _('fleet.create_task'),
            content: taskForm(),
            size: 'large',
            buttons: [
                { label: _('fleet.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: task ? _('fleet.save') : _('fleet.create_task'), class: 'btn-primary', onClick: saveTask }
            ]
        });
        document.getElementById('task-edit-id').value = task?.id || '';
        document.getElementById('task-name').value = task?.name || '';
        document.getElementById('task-type').value = task?.type || task?.task_type || 'script';
        document.getElementById('task-targets').value = task?.targets || task?.device_id || '';
        document.getElementById('task-schedule-type').value = task?.schedule_type || 'immediate';
        document.getElementById('task-schedule-value').value = task?.schedule_value || task?.cron || '';
        document.getElementById('task-script').value = task?.script || task?.payload || '';
        document.getElementById('task-retries').value = task?.retries ?? 0;
        document.getElementById('task-timeout').value = task?.timeout ?? 300;
        onScheduleTypeChange();
        document.getElementById('task-name').focus();
    }

    function closeTaskModal() { Modal.close(); }

    function onScheduleTypeChange() {
        const type = document.getElementById('task-schedule-type')?.value;
        const group = document.getElementById('task-schedule-value-group');
        const valInput = document.getElementById('task-schedule-value');
        const hint = document.getElementById('task-schedule-hint');
        const label = document.getElementById('task-schedule-value-label');
        if (!valInput || !group) return;
        group.hidden = type === 'immediate';
        if (type === 'once') {
            valInput.type = 'datetime-local';
            valInput.classList.remove('mono');
            if (label) label.textContent = _('fleet.schedule_when');
            if (hint) hint.textContent = '';
        } else {
            valInput.type = 'text';
            valInput.classList.add('mono');
            if (label) label.textContent = _('fleet.schedule_cron_label');
            if (hint) hint.textContent = _('fleet.cron_hint', { value: _('fleet.cron_placeholder') });
        }
    }

    async function saveTask() {
        const editId = document.getElementById('task-edit-id')?.value;
        const status = document.getElementById('task-form-status');
        const scheduleType = document.getElementById('task-schedule-type')?.value;
        const body = {
            name: document.getElementById('task-name')?.value?.trim(),
            type: document.getElementById('task-type')?.value,
            targets: document.getElementById('task-targets')?.value?.trim(),
            schedule_type: scheduleType,
            schedule_value: scheduleType === 'immediate' ? '' : document.getElementById('task-schedule-value')?.value?.trim(),
            script: document.getElementById('task-script')?.value,
            retries: parseInt(document.getElementById('task-retries')?.value) || 0,
            timeout: parseInt(document.getElementById('task-timeout')?.value) || 300
        };
        let problem = '';
        let field = '';
        if (!body.name) { problem = _('fleet.name_required'); field = 'task-name'; }
        else if (!body.targets) { problem = _('fleet.targets_required'); field = 'task-targets'; }
        else if (scheduleType !== 'immediate' && !body.schedule_value) { problem = _('fleet.schedule_required'); field = 'task-schedule-value'; }
        if (problem) {
            if (status) status.textContent = problem;
            document.getElementById(field)?.focus();
            return;
        }
        if (status) status.textContent = '';
        try {
            const url = editId ? `/api/panel/fleet/tasks/${encodeURIComponent(editId)}` : '/api/panel/fleet/tasks';
            await api(url, { method: editId ? 'PUT' : 'POST', body });
            Modal.close();
            notify('success', _('fleet.task_created', { name: body.name }));
            loadTasks();
        } catch (e) {
            if (status) status.textContent = _('fleet.save_failed', { error: e.message });
        }
    }

    async function deleteTask(id) {
        const t = _tasks.find(x => String(x.id) === String(id));
        const name = t?.name || id;
        const ok = await Modal.confirm({
            title: _('fleet.delete_task_title'),
            message: _('fleet.delete_task_message', { name }),
            confirmLabel: _('fleet.delete'),
            danger: true
        });
        if (!ok) return;
        try {
            await api(`/api/panel/fleet/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
            notify('success', _('fleet.task_deleted', { name }));
            loadTasks();
        } catch (e) {
            notify('error', _('fleet.delete_failed', { error: e.message }));
        }
    }

    async function retryTask(id) {
        const t = _tasks.find(x => String(x.id) === String(id));
        try {
            await api(`/api/panel/fleet/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST' });
            notify('success', _('fleet.task_retried', { name: t?.name || id }));
            loadTasks();
        } catch (e) {
            notify('error', _('fleet.retry_failed', { error: e.message }));
        }
    }

    async function showOutput(taskId) {
        const panel = document.getElementById('task-output-panel');
        const pre = document.getElementById('task-output-pre');
        const title = document.getElementById('task-output-title');
        if (!panel || !pre) return;
        const t = _tasks.find(x => String(x.id) === String(taskId));
        if (title) title.textContent = _('fleet.output_of', { name: t?.name || taskId });
        panel.hidden = false;
        pre.textContent = _('fleet.loading_output');
        panel.scrollIntoView({ block: 'nearest' });
        try {
            const data = await api(`/api/panel/fleet/tasks/${encodeURIComponent(taskId)}/output`);
            pre.textContent = data?.output || data?.log || _('fleet.no_output');
        } catch (e) {
            pre.textContent = _('fleet.output_failed', { error: e.message });
        }
    }

    function closeOutput() {
        const panel = document.getElementById('task-output-panel');
        if (panel) panel.hidden = true;
    }

    // -----------------------------------------------------------------------
    // Compliance
    // -----------------------------------------------------------------------
    async function loadCompliance() {
        const tbody = document.getElementById('comp-tbody');
        if (!tbody) return;
        const qs = new URLSearchParams();
        const orgId = document.getElementById('comp-org-select')?.value;
        if (orgId) qs.set('orgId', orgId);
        try {
            const data = await api(`/api/panel/fleet/compliance?${qs.toString()}`);
            _complianceData = listFrom(data, 'devices');
        } catch (e) {
            _complianceData = [];
            setCount('compliance-stats', '');
            stateRow(tbody, 6, _('fleet.compliance_failed', { error: e.message }), 'Fleet.loadCompliance');
            return;
        }
        renderCompliance(_complianceData);
    }

    function renderCompliance(list) {
        let compliant = 0, warning = 0, critical = 0, totalScore = 0;
        list.forEach(d => {
            const s = d.score ?? 0;
            totalScore += s;
            if (s >= 80) compliant++;
            else if (s >= 50) warning++;
            else critical++;
        });
        setCount('compliance-stats', list.length
            ? _('fleet.compliance_summary', { count: list.length, compliant, warning, critical, score: Math.round(totalScore / list.length) })
            : '');

        const tbody = document.getElementById('comp-tbody');
        if (!tbody) return;
        if (!list.length) { stateRow(tbody, 6, _('fleet.no_compliance_data')); return; }
        tbody.innerHTML = list.map(d => {
            const score = Math.max(0, Math.min(100, d.score ?? 0));
            const level = score >= 80 ? '' : score >= 50 ? ' is-high' : ' is-full';
            const devId = String(d.device_id || d.id);
            const id = esc(JSON.stringify([devId]));
            return `
            <tr>
                <td><span class="mono">${esc(devId)}</span>${d.hostname ? `<span class="cell-sub">${esc(d.hostname)}</span>` : ''}</td>
                <td>${esc(d.os || d.platform || '–')}</td>
                <td><div class="meter fleet-score${level}"><span class="meter-bar"><span class="meter-fill" style="width:${score}%"></span></span><span class="meter-value">${score} %</span></div></td>
                <td>${esc(String(d.issues ?? 0))}</td>
                <td>${fmtDate(d.last_scan)}</td>
                <td class="actions">
                    <button type="button" class="btn btn-sm" data-bd-call="Fleet.scanDevice" data-bd-args="${id}">${esc(_('fleet.comp_scan'))}</button>
                    ${rowMenu(_('fleet.actions_for', { name: d.hostname || devId }),
                        `<button type="button" class="menu-item" role="menuitem" data-bd-call="Fleet.remediate" data-bd-args="${id}">${esc(_('fleet.remediate_ellipsis'))}</button>`)}
                </td>
            </tr>`;
        }).join('');
    }

    async function scanDevice(deviceId) {
        try {
            await api(`/api/panel/fleet/compliance/${encodeURIComponent(deviceId)}/scan`, { method: 'POST' });
            notify('success', _('fleet.scan_started', { device: deviceId }));
            loadCompliance();
        } catch (e) {
            notify('error', _('fleet.scan_failed', { error: e.message }));
        }
    }

    async function scanAll() {
        const status = document.getElementById('comp-scan-status');
        const btn = document.getElementById('comp-scan-all');
        const setStatus = (text, cls) => { if (status) { status.textContent = text; status.className = 'form-status' + (cls ? ' ' + cls : ''); } };
        if (!_complianceData.length) { setStatus(_('fleet.scan_nothing'), 'is-error'); return; }
        if (btn) btn.disabled = true;
        setStatus(_('fleet.scanning', { count: _complianceData.length }));
        let failed = 0;
        for (const d of _complianceData) {
            try { await api(`/api/panel/fleet/compliance/${encodeURIComponent(d.device_id || d.id)}/scan`, { method: 'POST' }); }
            catch { failed++; }
        }
        if (btn) btn.disabled = false;
        setStatus(failed
            ? _('fleet.scan_all_partial', { failed, count: _complianceData.length })
            : _('fleet.scan_all_done', { count: _complianceData.length }), failed ? 'is-error' : 'is-ok');
        loadCompliance();
    }

    async function remediate(deviceId) {
        const ok = await Modal.confirm({
            title: _('fleet.remediate_title'),
            message: _('fleet.confirm_remediate'),
            confirmLabel: _('fleet.comp_remediate')
        });
        if (!ok) return;
        try {
            await api(`/api/panel/fleet/compliance/${encodeURIComponent(deviceId)}/remediate`, { method: 'POST', body: { action: 'auto' } });
            notify('success', _('fleet.remediate_started', { device: deviceId }));
            loadCompliance();
        } catch (e) {
            notify('error', _('fleet.remediate_failed', { error: e.message }));
        }
    }

    // -----------------------------------------------------------------------
    // Workflow list (the builder itself is fleet-builder.js)
    // -----------------------------------------------------------------------
    async function loadWorkflowList() {
        const sel = document.getElementById('workflow-select');
        if (!sel) return;
        try {
            const data = await api('/api/panel/fleet/workflows');
            const workflows = listFrom(data, 'workflows');
            const val = sel.value;
            sel.querySelectorAll('option:not(:first-child)').forEach(o => o.remove());
            workflows.forEach(w => {
                const opt = document.createElement('option');
                opt.value = w.id;
                opt.textContent = w.name || w.id;
                sel.appendChild(opt);
            });
            if (val) sel.value = val;
        } catch (e) {
            workflowStatus(_('fleet.workflows_failed', { error: e.message }), 'is-error');
        }
    }

    function workflowStatus(text, cls) {
        const el = document.getElementById('workflow-status');
        if (!el) return;
        el.textContent = text || '';
        el.className = 'form-status' + (cls ? ' ' + cls : '');
    }

    // Helpers
    function esc(s) {
        if (s === null || s === undefined || s === '') return '';
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    window.Fleet = {
        switchTab,
        // Resources
        loadResources, onResOrgChange, showResourceModal, closeResourceModal,
        onResTypeChange, saveResource, editResource, deleteResource, reloadOrganizations,
        // Tasks
        loadTasks, filterTasks, showTaskModal, closeTaskModal,
        onScheduleTypeChange, saveTask, deleteTask, retryTask,
        showOutput, closeOutput,
        // Compliance
        loadCompliance, scanDevice, scanAll, remediate,
        // Workflow
        loadWorkflowList, workflowStatus,
        loadWorkflow() { if (window.FleetBuilder) FleetBuilder.loadWorkflow(); },
        newWorkflow() { if (window.FleetBuilder) FleetBuilder.newWorkflow(); },
        saveWorkflow() { if (window.FleetBuilder) FleetBuilder.saveWorkflow(); },
        exportWorkflow() { if (window.FleetBuilder) FleetBuilder.exportWorkflow(); },
        executeWorkflow(dryRun) { if (window.FleetBuilder) FleetBuilder.execute(dryRun); }
    };

    document.addEventListener('DOMContentLoaded', init);
})();
