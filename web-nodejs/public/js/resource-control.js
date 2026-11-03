/* ============================================
   Resource Control — resource-control.js
   ============================================ */
(function () {
    'use strict';
    const _ = window._ || (k => k);

    let currentTab = 'overview';
    let devices = [];
    let complianceData = null;

    // ---- Tab switching ----
    function switchTab(tab) {
        currentTab = tab;
        document.querySelectorAll('.rc-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        document.querySelectorAll('.rc-panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + tab));
    }

    // ---- Compliance overview ----
    async function loadCompliance() {
        try {
            const resp = await fetch('/api/panel/resource-control/compliance');
            const data = await resp.json();
            complianceData = data.data || data;
            renderComplianceStats(complianceData);
            renderComplianceCategories(complianceData);
        } catch (e) {
            console.warn('Resource control compliance load error:', e);
            renderComplianceStats(null);
        }
    }

    function renderComplianceStats(d) {
        const el = document.getElementById('compliance-stats');
        if (!el) return;
        const total = d ? (d.total_devices || 0) : 0;
        const compliant = d ? (d.compliant || 0) : 0;
        const partial = d ? (d.partial || 0) : 0;
        const noncomp = d ? (d.noncompliant || 0) : 0;
        const pct = total > 0 ? Math.round((compliant / total) * 100) : 0;

        el.innerHTML = `
            <div class="rc-stat-card">
                <div class="rc-stat-value">${total}</div>
                <div class="rc-stat-label">${_('resource_control.stat_total_devices')}</div>
            </div>
            <div class="rc-stat-card">
                <div class="rc-stat-value green">${compliant}</div>
                <div class="rc-stat-label">${_('resource_control.stat_compliant')}</div>
            </div>
            <div class="rc-stat-card">
                <div class="rc-stat-value yellow">${partial}</div>
                <div class="rc-stat-label">${_('resource_control.stat_partial')}</div>
            </div>
            <div class="rc-stat-card">
                <div class="rc-stat-value red">${noncomp}</div>
                <div class="rc-stat-label">${_('resource_control.stat_noncompliant')}</div>
            </div>
            <div class="rc-stat-card">
                <div class="rc-stat-value ${pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red'}">${pct}%</div>
                <div class="rc-stat-label">${_('resource_control.stat_compliance_rate')}</div>
            </div>
        `;
    }

    function renderComplianceCategories(d) {
        const el = document.getElementById('compliance-categories');
        if (!el) return;
        const cats = d && d.categories ? d.categories : [
            { key: 'usb', icon: 'usb', pct: 0 },
            { key: 'optical', icon: 'album', pct: 0 },
            { key: 'monitors', icon: 'monitor', pct: 0 },
            { key: 'disks', icon: 'storage', pct: 0 },
            { key: 'quotas', icon: 'speed', pct: 0 }
        ];
        const catMap = { usb: 'usb', optical: 'optical', monitors: 'monitor', disks: 'disk', quotas: 'quota' };
        el.innerHTML = cats.map(c => {
            const pct = c.pct || 0;
            const colorCls = pct >= 80 ? 'green' : pct >= 50 ? 'yellow' : 'red';
            return `
                <div class="rc-category-card">
                    <div class="rc-category-icon ${catMap[c.key] || c.key}">
                        <span class="material-icons-round">${c.icon || 'settings'}</span>
                    </div>
                    <div class="rc-category-info">
                        <div class="rc-category-name">${_('resource_control.tab_' + c.key)}</div>
                        <div class="rc-category-bar">
                            <div class="rc-category-fill ${colorCls}" style="width:${pct}%"></div>
                        </div>
                        <div class="rc-category-pct">${pct}% ${_('resource_control.stat_compliant').toLowerCase()}</div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ---- Device list ----
    async function loadDevices() {
        try {
            const resp = await fetch('/api/panel/resource-control/devices');
            const data = await resp.json();
            devices = data.data || data.devices || data || [];
            if (!Array.isArray(devices)) devices = [];
            renderDevices(devices);
        } catch (e) {
            console.warn('Resource control devices load error:', e);
            devices = [];
            renderDevices([]);
        }
    }

    function renderDevices(list) {
        const tbody = document.getElementById('rc-device-tbody');
        if (!tbody) return;
        if (!list.length) {
            tbody.innerHTML = `<tr><td colspan="9">
                <div class="rc-empty">
                    <span class="material-icons-round">devices</span>
                    <p>${_('resource_control.no_devices')}</p>
                </div>
            </td></tr>`;
            return;
        }
        tbody.innerHTML = list.map(d => {
            const res = d.resources || {};
            return `
                <tr>
                    <td><strong>${escHtml(d.hostname || d.id)}</strong><br><span style="color:var(--text-secondary);font-size:12px">${escHtml(d.id)}</span></td>
                    <td>${escHtml(d.platform || '-')}</td>
                    <td>${d.online ? '<span style="color:#3fb950">● Online</span>' : '<span style="color:#8b949e">○ Offline</span>'}</td>
                    <td>${badgeFor(res.usb)}</td>
                    <td>${badgeFor(res.optical)}</td>
                    <td>${badgeFor(res.monitors)}</td>
                    <td>${badgeFor(res.disks)}</td>
                    <td>${badgeFor(res.quotas)}</td>
                    <td><button class="rc-action-btn" data-bd-call="ResourceControl.configure" data-bd-args='["${escHtml(d.id)}"]'>${_('resource_control.btn_configure')}</button></td>
                </tr>
            `;
        }).join('');
    }

    function badgeFor(status) {
        if (!status || status === 'na') return `<span class="rc-badge na">${_('resource_control.badge_na')}</span>`;
        if (status === 'compliant') return `<span class="rc-badge compliant"><span class="material-icons-round">check</span>${_('resource_control.badge_compliant')}</span>`;
        if (status === 'partial') return `<span class="rc-badge partial"><span class="material-icons-round">warning</span>${_('resource_control.badge_partial')}</span>`;
        return `<span class="rc-badge noncompliant"><span class="material-icons-round">close</span>${_('resource_control.badge_noncompliant')}</span>`;
    }

    function filterDevices() {
        const q = (document.getElementById('rc-device-search') || {}).value || '';
        const lq = q.toLowerCase();
        const filtered = devices.filter(d =>
            (d.id || '').toLowerCase().includes(lq) ||
            (d.hostname || '').toLowerCase().includes(lq) ||
            (d.platform || '').toLowerCase().includes(lq)
        );
        renderDevices(filtered);
    }

    // ---- Configure device ----
    async function configure(deviceId) {
        switchTab('usb');
        try {
            const resp = await fetch('/api/panel/resource-control/policies/' + encodeURIComponent(deviceId));
            const data = await resp.json();
            const policy = data.data || data;
            populateForms(policy, deviceId);
        } catch (e) {
            console.warn('Load policy error:', e);
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

    // ---- Range slider labels ----
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
    function init() {
        loadCompliance();
        loadDevices();

        // Range slider listeners
        const bri = document.getElementById('monitors-brightness');
        if (bri) bri.addEventListener('input', updateBrightnessLabel);
        const cpu = document.getElementById('quotas-cpu');
        if (cpu) cpu.addEventListener('input', updateQuotaLabels);
        const ram = document.getElementById('quotas-ram');
        if (ram) ram.addEventListener('input', updateQuotaLabels);
    }

    // ---- Helpers ----
    function escHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
    function setChecked(id, v) { const el = document.getElementById(id); if (el) el.checked = v; }

    window.ResourceControl = { init, switchTab, filterDevices, configure };
})();
