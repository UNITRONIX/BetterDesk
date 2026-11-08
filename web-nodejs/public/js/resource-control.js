/* ============================================
   USB and drive access (resource control) — resource-control.js
   The page lists devices; "Edit rules" opens the rules of one device
   with one tab and one save per category.
   ============================================ */
(function () {
    'use strict';

    const CATEGORIES = ['usb', 'optical', 'monitors', 'disks', 'quotas'];

    let currentTab = 'usb';
    let devices = [];
    let complianceData = null;
    let loadFailed = false;
    let currentDevice = null;
    let listOpener = null;

    function t(key, params) {
        const fn = window._;
        let s = typeof fn === 'function' ? fn(key, params) : key;
        if (params && typeof s === 'string') {
            s = s.replace(/\{(\w+)\}/g, (m, p) => (params[p] !== undefined ? params[p] : m));
        }
        return s;
    }

    // ---- Tabs inside the device editor ----
    function switchTab(tab) {
        if (tab === 'overview') { closeEditor(); return; }
        if (!CATEGORIES.includes(tab)) return;
        currentTab = tab;
        document.querySelectorAll('.rc-tab').forEach(btn => {
            const on = btn.dataset.tab === tab;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.tabIndex = on ? 0 : -1;
        });
        document.querySelectorAll('.rc-panel').forEach(p => {
            const on = p.id === 'panel-' + tab;
            p.classList.toggle('active', on);
            p.hidden = !on;
        });
    }

    function onTabKey(e) {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(e.key)) return;
        e.preventDefault();
        const rtl = document.documentElement.dir === 'rtl';
        let i = CATEGORIES.indexOf(currentTab);
        if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = CATEGORIES.length - 1;
        else {
            const forward = (e.key === 'ArrowRight') !== rtl;
            i = (i + (forward ? 1 : -1) + CATEGORIES.length) % CATEGORIES.length;
        }
        switchTab(CATEGORIES[i]);
        const btn = document.getElementById('rc-tab-' + CATEGORIES[i]);
        if (btn) btn.focus();
    }

    // ---- Compliance summary (side column: share bar, then per kind of rule) ----
    async function loadCompliance() {
        try {
            const resp = await fetch('/api/panel/resource-control/compliance', { credentials: 'same-origin' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            complianceData = data.data || data;
        } catch (e) {
            complianceData = null;
        }
        renderComplianceCategories(complianceData);
    }

    function categoryLabel(key) {
        return t('resource_control.cat_' + key);
    }

    function renderComplianceCategories(d) {
        const state = document.getElementById('compliance-state');
        const bar = document.getElementById('compliance-bar');
        const legend = document.getElementById('compliance-legend');
        const catsTitle = document.getElementById('compliance-categories-title');
        const el = document.getElementById('compliance-categories');
        if (!el || !state || !bar || !legend) return;
        const total = d ? Number(d.total_devices) || 0 : 0;
        const showParts = !!d && total > 0;
        state.hidden = showParts;
        state.classList.toggle('is-error', !d);
        if (!d) {
            state.innerHTML = `${escHtml(t('resource_control.compliance_failed'))} <button type="button" class="btn btn-sm" id="rc-compliance-retry">${escHtml(t('resource_control.try_again'))}</button>`;
            document.getElementById('rc-compliance-retry').addEventListener('click', () => {
                state.textContent = t('resource_control.loading');
                state.classList.remove('is-error');
                loadCompliance();
            });
        } else if (!total) {
            state.textContent = t('resource_control.compliance_empty');
        }
        bar.hidden = !showParts;
        legend.hidden = !showParts;
        el.hidden = !showParts;
        if (catsTitle) catsTitle.hidden = !showParts;
        bar.textContent = '';
        legend.textContent = '';
        el.textContent = '';
        if (!showParts) return;

        const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
        [
            { n: Number(d.compliant) || 0, cls: 'is-ok', label: t('resource_control.legend_all') },
            { n: Number(d.non_compliant ?? d.noncompliant) || 0, cls: 'is-danger', label: t('resource_control.legend_not') },
            { n: Number(d.no_policy) || 0, cls: 'is-muted', label: t('resource_control.legend_none') },
        ].forEach(part => {
            if (part.n > 0) {
                const seg = document.createElement('span');
                seg.className = part.cls;
                seg.style.flexGrow = String(part.n);
                bar.appendChild(seg);
            }
            const li = document.createElement('li');
            li.innerHTML = `<span class="key ${part.cls}" aria-hidden="true"></span><span><strong>${escHtml(fmt.format(part.n))}</strong> ${escHtml(part.label)}</span>`;
            legend.appendChild(li);
        });

        // The server sends categories as { usb: { enforced, total } }; older builds sent [{ key, pct }]
        const rows = [];
        const cats = d.categories || {};
        if (Array.isArray(cats)) {
            cats.forEach(c => rows.push([categoryLabel(c.key), `${Number(c.pct) || 0} %`]));
        } else {
            CATEGORIES.forEach(k => {
                const c = cats[k] || {};
                rows.push([categoryLabel(k), t('resource_control.of_devices', { n: Number(c.enforced) || 0, total: Number(c.total) || 0 })]);
            });
        }
        el.innerHTML = rows.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join('');
    }

    // ---- Device list ----
    async function loadDevices() {
        const tbody = document.getElementById('rc-device-tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="5" class="state-cell">${escHtml(t('resource_control.loading'))}</td></tr>`;
        try {
            const resp = await fetch('/api/panel/resource-control/devices', { credentials: 'same-origin' });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const data = await resp.json();
            devices = data.data || data.devices || data || [];
            if (!Array.isArray(devices)) devices = [];
            loadFailed = false;
        } catch (e) {
            devices = [];
            loadFailed = true;
        }
        filterDevices();
    }

    function isOnline(d) {
        if (d.online === true) return true;
        return String(d.status || '').toLowerCase() === 'online';
    }

    function rulesText(res) {
        if (!res || typeof res !== 'object') return t('resource_control.rules_unknown');
        const parts = CATEGORIES
            .filter(k => res[k] && res[k] !== 'na')
            .map(k => `${categoryLabel(k)}: ${t('resource_control.rule_state_' + (['compliant', 'partial'].includes(res[k]) ? res[k] : 'noncompliant'))}`);
        return parts.length ? parts.join(', ') : t('resource_control.rules_unknown');
    }

    function renderCount(shown) {
        const el = document.getElementById('compliance-stats');
        if (!el) return;
        if (loadFailed) { el.textContent = ''; return; }
        const total = devices.length;
        const key = shown === total
            ? (total === 1 ? 'resource_control.count_one' : 'resource_control.count_many')
            : 'resource_control.count_filtered';
        const html = escHtml(t(key, { count: '{{c}}', shown: '{{s}}', total: '{{t}}' }))
            .replace('{{c}}', `<strong>${total}</strong>`)
            .replace('{{s}}', `<strong>${shown}</strong>`)
            .replace('{{t}}', String(total));
        el.innerHTML = html;
    }

    function renderDevices(list) {
        const tbody = document.getElementById('rc-device-tbody');
        if (!tbody) return;
        renderCount(list.length);
        if (loadFailed) {
            tbody.innerHTML = `<tr><td colspan="5" class="state-cell"><span class="state is-error">${escHtml(t('resource_control.load_failed'))}
                <button type="button" class="btn btn-sm" id="rc-retry">${escHtml(t('resource_control.try_again'))}</button></span></td></tr>`;
            const retry = document.getElementById('rc-retry');
            if (retry) retry.addEventListener('click', () => { loadDevices(); loadCompliance(); });
            return;
        }
        if (!list.length) {
            const msg = devices.length ? t('resource_control.no_match') : t('resource_control.empty_list');
            tbody.innerHTML = `<tr><td colspan="5" class="state-cell">${escHtml(msg)}</td></tr>`;
            return;
        }
        // The rules column only earns its place once some device reports its rules
        const table = document.getElementById('rc-device-table');
        if (table) table.classList.toggle('rc-no-rules', !devices.some(d => d.resources && typeof d.resources === 'object'));
        tbody.innerHTML = list.map(d => {
            const name = d.hostname || d.id;
            const online = isOnline(d);
            return `
                <tr>
                    <td><span class="rc-device-name">${escHtml(name)}</span>${d.hostname ? `<span class="cell-sub mono">${escHtml(d.id)}</span>` : ''}${d.platform ? `<span class="cell-sub rc-platform-sub">${escHtml(d.platform)}</span>` : ''}</td>
                    <td class="rc-platform-col">${escHtml(d.platform || '—')}</td>
                    <td><span class="status ${online ? 'online' : 'offline'}">${escHtml(t(online ? 'status.online' : 'status.offline'))}</span></td>
                    <td class="rc-rules-cell rc-rules-col">${escHtml(rulesText(d.resources))}</td>
                    <td class="actions"><button type="button" class="btn btn-sm" data-rc-configure="${escHtml(d.id)}"
                        aria-label="${escHtml(t('resource_control.edit_rules_for', { name }))}">${escHtml(t('resource_control.edit_rules'))}</button></td>
                </tr>
            `;
        }).join('');
    }

    function filterDevices() {
        const q = ((document.getElementById('rc-device-search') || {}).value || '').trim().toLowerCase();
        const filtered = !q ? devices : devices.filter(d =>
            String(d.id || '').toLowerCase().includes(q) ||
            String(d.hostname || '').toLowerCase().includes(q) ||
            String(d.platform || '').toLowerCase().includes(q)
        );
        renderDevices(filtered);
    }

    // ---- Device editor ----
    function anyDirty() {
        return CATEGORIES.some(k => {
            const f = document.getElementById('panel-' + k);
            return f && window.UiForm && UiForm.isDirty(f);
        });
    }

    function showEditor(on) {
        const list = document.getElementById('rc-list');
        const comp = document.getElementById('rc-compliance');
        const overview = document.getElementById('rc-overview');
        const editor = document.getElementById('rc-editor');
        if (list) list.hidden = on;
        if (comp) comp.hidden = on;
        if (overview) overview.hidden = on;
        if (editor) editor.hidden = !on;
    }

    async function closeEditor() {
        if (anyDirty()) {
            const ok = await Modal.confirm({
                title: t('resource_control.discard_title'),
                message: t('resource_control.discard_message'),
                confirmLabel: t('resource_control.discard_confirm'),
                danger: true,
            });
            if (!ok) return;
        }
        CATEGORIES.forEach(k => { const f = document.getElementById('panel-' + k); if (f && window.UiForm) UiForm.reset(f); });
        currentDevice = null;
        window._rcDeviceId = null;
        showEditor(false);
        if (listOpener && document.contains(listOpener)) listOpener.focus();
        else { const s = document.getElementById('rc-device-search'); if (s) s.focus(); }
    }

    function setEditorState(text, isError) {
        const el = document.getElementById('rc-editor-state');
        if (!el) return;
        el.textContent = text || '';
        el.hidden = !text;
        el.classList.toggle('is-error', !!isError);
    }

    async function configure(deviceId) {
        const d = devices.find(x => String(x.id) === String(deviceId)) || { id: deviceId };
        currentDevice = d;
        window._rcDeviceId = deviceId;
        const name = d.hostname || d.id;
        document.getElementById('rc-editor-title').textContent = t('resource_control.editor_title', { name });
        const noteParts = [t('resource_control.editor_device_id', { id: d.id })];
        if (d.platform) noteParts.push(d.platform);
        document.getElementById('rc-editor-note').textContent = noteParts.join(' · ');
        populateForms({}, deviceId);
        CATEGORIES.forEach(k => { const f = document.getElementById('panel-' + k); if (f && window.UiForm) UiForm.reset(f); });
        showEditor(true);
        switchTab('usb');
        setEditorState(t('resource_control.editor_loading'));
        const title = document.getElementById('rc-editor-title');
        if (title) { title.tabIndex = -1; title.focus(); }

        try {
            const resp = await fetch('/api/panel/resource-control/policies/' + encodeURIComponent(deviceId), { credentials: 'same-origin' });
            if (currentDevice !== d) return;
            if (resp.status === 404) {
                setEditorState(t('resource_control.editor_none'));
                return;
            }
            const data = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(data.error || data.message || ('HTTP ' + resp.status));
            const policy = data.data || data.policy || data;
            populateForms(policy || {}, deviceId);
            CATEGORIES.forEach(k => { const f = document.getElementById('panel-' + k); if (f && window.UiForm) UiForm.reset(f); });
            setEditorState('');
        } catch (e) {
            if (currentDevice !== d) return;
            setEditorState(t('resource_control.editor_load_failed', { error: e.message }), true);
        }
    }

    function populateForms(policy, deviceId) {
        const usb = policy.usb || {};
        const optical = policy.optical || {};
        const monitors = policy.monitors || {};
        const disks = policy.disks || {};
        const quotas = policy.quotas || {};

        setVal('usb-storage-policy', usb.storage_policy || 'allowed');
        setVal('usb-whitelist', (usb.whitelist || []).join('\n'));
        setChecked('usb-audit-log', usb.audit_log !== false);

        setVal('optical-policy', optical.policy || 'allowed');
        setChecked('optical-audit-log', optical.audit_log !== false);

        setVal('monitors-max-count', monitors.max_count || 0);
        setVal('monitors-resolution', monitors.resolution || 'any');
        setVal('monitors-brightness', monitors.brightness || 100);
        updateBrightnessLabel();
        setVal('monitors-power-schedule', monitors.power_schedule || '');

        setChecked('disks-readonly', !!disks.readonly);
        setChecked('disks-encryption', !!disks.encryption_required);
        setChecked('disks-smart', !!disks.smart_monitoring);
        setVal('disks-hidden-partitions', (disks.hidden_partitions || []).join(', '));

        setVal('quotas-cpu', quotas.cpu_limit || 100);
        setVal('quotas-ram', quotas.ram_limit || 100);
        setVal('quotas-bandwidth', quotas.bandwidth_limit || 0);
        setVal('quotas-disk', quotas.disk_quota || 0);
        setVal('quotas-process-whitelist', (quotas.process_whitelist || []).join('\n'));
        updateQuotaLabels();

        // Store device ID for save operations
        window._rcDeviceId = deviceId;
    }

    function lines(id, sep) {
        return getVal(id).split(sep).map(s => s.trim()).filter(Boolean);
    }

    function int(id, fallback) {
        const n = parseInt(getVal(id), 10);
        return Number.isFinite(n) && n >= 0 ? n : fallback;
    }

    function collect(category) {
        switch (category) {
            case 'usb': return {
                storage_policy: getVal('usb-storage-policy'),
                whitelist: lines('usb-whitelist', /\n/),
                audit_log: isChecked('usb-audit-log'),
            };
            case 'optical': return {
                policy: getVal('optical-policy'),
                audit_log: isChecked('optical-audit-log'),
            };
            case 'monitors': return {
                max_count: int('monitors-max-count', 0),
                resolution: getVal('monitors-resolution'),
                brightness: int('monitors-brightness', 100),
                power_schedule: getVal('monitors-power-schedule').trim(),
            };
            case 'disks': return {
                readonly: isChecked('disks-readonly'),
                encryption_required: isChecked('disks-encryption'),
                smart_monitoring: isChecked('disks-smart'),
                hidden_partitions: lines('disks-hidden-partitions', ','),
            };
            case 'quotas': return {
                cpu_limit: int('quotas-cpu', 100),
                ram_limit: int('quotas-ram', 100),
                bandwidth_limit: int('quotas-bandwidth', 0),
                disk_quota: int('quotas-disk', 0),
                process_whitelist: lines('quotas-process-whitelist', /\n/),
            };
            default: return null;
        }
    }

    async function save(category, form) {
        const deviceId = window._rcDeviceId;
        const body = collect(category);
        if (!deviceId || !body) return;
        const btn = form.querySelector('[data-save-button]');
        if (btn) btn.disabled = true;
        try {
            await Utils.api('/api/panel/resource-control/policies/' + encodeURIComponent(deviceId) + '/' + category, {
                method: 'POST',
                body,
            });
            if (window.UiForm) UiForm.saved(form);
        } catch (e) {
            if (window.UiForm) UiForm.failed(form, t('resource_control.save_failed', { error: e.message }));
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ---- Range labels ----
    function updateBrightnessLabel() {
        const v = document.getElementById('monitors-brightness');
        const l = document.getElementById('monitors-brightness-val');
        if (v && l) l.textContent = v.value + '%';
    }

    function updateQuotaLabels() {
        const cpuV = document.getElementById('quotas-cpu');
        const cpuL = document.getElementById('quotas-cpu-val');
        if (cpuV && cpuL) cpuL.textContent = cpuV.value + '%';
        const ramV = document.getElementById('quotas-ram');
        const ramL = document.getElementById('quotas-ram-val');
        if (ramV && ramL) ramL.textContent = ramV.value + '%';
    }

    // ---- Init ----
    let started = false;
    function init() {
        if (started) return;
        started = true;
        loadCompliance();
        loadDevices();

        const search = document.getElementById('rc-device-search');
        if (search) search.addEventListener('input', filterDevices);

        const tbody = document.getElementById('rc-device-tbody');
        if (tbody) tbody.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-rc-configure]');
            if (!btn) return;
            listOpener = btn;
            configure(btn.getAttribute('data-rc-configure'));
        });

        const back = document.getElementById('rc-editor-back');
        if (back) back.addEventListener('click', () => closeEditor());

        document.querySelectorAll('.rc-tab').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
            btn.addEventListener('keydown', onTabKey);
        });

        CATEGORIES.forEach(k => {
            const form = document.getElementById('panel-' + k);
            if (form) form.addEventListener('submit', (e) => { e.preventDefault(); save(k, form); });
        });

        const bri = document.getElementById('monitors-brightness');
        if (bri) bri.addEventListener('input', updateBrightnessLabel);
        const cpu = document.getElementById('quotas-cpu');
        if (cpu) cpu.addEventListener('input', updateQuotaLabels);
        const ram = document.getElementById('quotas-ram');
        if (ram) ram.addEventListener('input', updateQuotaLabels);
    }

    // ---- Helpers ----
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML.replace(/"/g, '&quot;'); }
    function getVal(id) { const el = document.getElementById(id); return el ? String(el.value || '') : ''; }
    function isChecked(id) { const el = document.getElementById(id); return el ? el.checked : false; }
    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
    function setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = v; }

    window.ResourceControl = { init, switchTab, filterDevices, configure, close: closeEditor };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
