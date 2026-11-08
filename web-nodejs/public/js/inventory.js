/**
 * BetterDesk Console - Inventory page
 *
 * Lists the hardware the agents report (GET /api/inventory, paged) and
 * opens one device's full report in a dialog (GET /api/inventory/:id).
 * The detail endpoint returns the agent's report as sent: hardware and
 * software are nested ({ hardware: { cpu, memory, disks, ... }, software:
 * { apps } }), with the latest telemetry next to it.
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
    const esc = (value) => Utils.escapeHtml(value == null ? '' : String(value));
    const DASH = '<span class="text-muted">–</span>';

    let allDevices = [];
    let source = '';
    let currentSearch = '';
    let loadError = null;

    const tbody = document.getElementById('inventory-body');
    const countLine = document.getElementById('inventory-count');
    const searchInput = document.getElementById('search-input');
    const refreshBtn = document.getElementById('refresh-btn');

    // ---- Formatting ----

    const locale = () => (window.BetterDesk && window.BetterDesk.lang) || undefined;

    function formatNumber(value, digits) {
        try {
            return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(value);
        } catch (e) {
            return String(Math.round(value * 10 ** digits) / 10 ** digits);
        }
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        let val = bytes;
        while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
        return `${formatNumber(val, i > 2 ? 1 : 0)} ${units[i]}`;
    }

    const gbToBytes = (gb) => (Number(gb) || 0) * 1024 ** 3;

    function percent(used, total) {
        if (!total || total <= 0 || used == null) return null;
        return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    }

    function meter(pct, label) {
        if (pct == null) return DASH;
        const level = pct >= 95 ? ' is-full' : pct >= 85 ? ' is-high' : '';
        return `<div class="meter${level}"><span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${pct}%"></span></span>`
            + `<span class="meter-value">${esc(label || `${pct} %`)}</span></div>`;
    }

    function formatDuration(seconds) {
        seconds = Number(seconds) || 0;
        if (seconds <= 0) return '';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        if (days > 0) return _('inventory.duration_days', { days, hours });
        return _('inventory.duration_hours', { hours, minutes });
    }

    function timeCell(value) {
        const date = Utils.parseDate(value);
        if (!date) return DASH;
        return `<time datetime="${esc(date.toISOString())}" title="${esc(Utils.formatDate(date))}">${esc(Utils.formatRelativeTime(date))}</time>`;
    }

    // ---- List ----

    async function fetchAllPages() {
        const devices = [];
        let page = 1;
        let totalPages = 1;
        let listSource = '';
        do {
            const result = await Utils.api(`/api/inventory?limit=100&page=${page}`);
            const rows = Array.isArray(result && result.devices) ? result.devices : [];
            devices.push(...rows);
            if (rows.some((d) => d.source === 'peer_list')) listSource = 'peer_list';
            totalPages = Number(result && result.total_pages) || 1;
            page += 1;
        } while (page <= totalPages && page <= 50);
        return { devices, source: listSource };
    }

    async function loadInventory() {
        loadError = null;
        refreshBtn.disabled = true;
        tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(_('inventory.loading'))}</td></tr>`;
        countLine.textContent = '';
        try {
            const result = await fetchAllPages();
            allDevices = result.devices;
            source = result.source;
        } catch (err) {
            loadError = err;
            allDevices = [];
        } finally {
            refreshBtn.disabled = false;
        }
        render();
    }

    function matches(d, q) {
        return [d.device_id, d.hostname, d.os, d.cpu].some((v) => String(v || '').toLowerCase().includes(q));
    }

    function renderCount(shown) {
        if (loadError) { countLine.textContent = ''; return; }
        if (!allDevices.length) { countLine.textContent = ''; return; }
        if (source === 'peer_list') {
            countLine.textContent = _('inventory.count_no_reports', { count: allDevices.length });
            return;
        }
        let text = allDevices.length === 1
            ? _('inventory.count_one')
            : _('inventory.count_many', { count: allDevices.length });
        const loads = allDevices.map((d) => d.cpu_usage).filter((v) => typeof v === 'number');
        if (loads.length) {
            const avg = loads.reduce((s, v) => s + v, 0) / loads.length;
            text += ' ' + _('inventory.count_cpu', { cpu: formatNumber(avg, 0) });
        }
        if (currentSearch) text += ' ' + _('inventory.count_shown', { count: shown });
        countLine.textContent = text;
    }

    function render() {
        if (loadError) {
            tbody.innerHTML = `<tr><td colspan="6" class="state-cell is-error">${esc(_('inventory.load_failed'))} ${esc(loadError.message || '')}
                <button type="button" class="btn btn-sm" data-retry>${esc(_('actions.retry'))}</button></td></tr>`;
            tbody.querySelector('[data-retry]').addEventListener('click', loadInventory);
            renderCount(0);
            return;
        }

        const q = currentSearch.toLowerCase();
        const filtered = q ? allDevices.filter((d) => matches(d, q)) : allDevices;
        renderCount(filtered.length);

        if (!allDevices.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(_('inventory.empty'))}</td></tr>`;
            return;
        }
        if (!filtered.length) {
            tbody.innerHTML = `<tr><td colspan="6" class="state-cell">${esc(_('inventory.no_match'))}</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(rowHtml).join('');
    }

    function rowHtml(d) {
        const name = d.hostname && d.hostname !== d.device_id ? d.hostname : '';
        const memPct = percent(d.memory_used_mb, d.memory_total_mb);
        const memLabel = d.memory_total_mb
            ? _('inventory.used_of', { used: formatBytes(d.memory_used_mb * 1048576), total: formatBytes(d.memory_total_mb * 1048576) })
            : '';
        const cpuSub = [];
        if (d.cpu_cores) cpuSub.push(_('inventory.cores_count', { count: d.cpu_cores }));
        if (typeof d.cpu_usage === 'number') cpuSub.push(_('inventory.load_percent', { value: formatNumber(d.cpu_usage, 0) }));
        const hasCpu = d.cpu && d.cpu !== 'Unknown';

        return `
            <tr data-id="${esc(d.device_id)}">
                <td class="col-device">
                    <button type="button" class="row-open" data-id="${esc(d.device_id)}"><span class="row-name">${esc(name || d.device_id)}</span>${name ? `<span class="cell-sub mono">${esc(d.device_id)}</span>` : ''}${d.os ? `<span class="cell-sub phone-only">${esc(d.os)}</span>` : ''}</button>
                </td>
                <td class="col-os"><span class="os-name">${d.os ? Utils.getPlatformIconHtml(d.os) : ''}<span>${d.os ? esc(d.os) : DASH}</span></span></td>
                <td class="col-cpu">${hasCpu ? `<span class="cpu-name" title="${esc(d.cpu)}">${esc(d.cpu)}</span>` : DASH}
                    ${cpuSub.length ? `<span class="cell-sub">${esc(cpuSub.join(', '))}</span>` : ''}</td>
                <td class="col-memory">${memPct == null ? DASH : `${meter(memPct)}<span class="cell-sub memory-detail">${esc(memLabel)}</span>`}</td>
                <td class="col-disks num-cell">${d.disk_count ? esc(d.disk_count) : DASH}</td>
                <td class="col-updated">${timeCell(d.collected_at || d.last_seen)}</td>
            </tr>`;
    }

    // ---- Detail dialog ----

    function factsRow(label, valueHtml) {
        if (valueHtml === '' || valueHtml == null) return '';
        return `<dt>${esc(label)}</dt><dd>${valueHtml}</dd>`;
    }

    function diskSizes(disk) {
        const total = disk.total_bytes != null ? Number(disk.total_bytes) : gbToBytes(disk.total_gb);
        let used = disk.used_bytes != null ? Number(disk.used_bytes) : (disk.used_gb != null ? gbToBytes(disk.used_gb) : null);
        if (used == null && disk.available_bytes != null && total) used = total - Number(disk.available_bytes);
        if (used == null && disk.free_bytes != null && total) used = total - Number(disk.free_bytes);
        return { total, used };
    }

    function detailHtml(data, listRow) {
        const hw = data.hardware && typeof data.hardware === 'object' ? data.hardware : data;
        const sw = data.software && typeof data.software === 'object' ? data.software : {};
        const tel = data.telemetry || {};
        const cpu = hw.cpu && typeof hw.cpu === 'object' ? hw.cpu : { brand: hw.cpu || data.cpu };
        const mem = hw.memory && typeof hw.memory === 'object' ? hw.memory : {};

        const cpuLoad = typeof tel.cpu_usage_percent === 'number' && tel.received_at ? tel.cpu_usage_percent
            : (typeof cpu.usage_percent === 'number' ? cpu.usage_percent : null);
        const memTotal = Number(tel.memory_total_bytes) || Number(mem.total_bytes) || (data.memory_total_mb ? data.memory_total_mb * 1048576 : 0);
        const memUsed = Number(tel.memory_total_bytes) ? Number(tel.memory_used_bytes) : (Number(mem.used_bytes) || (data.memory_used_mb ? data.memory_used_mb * 1048576 : 0));
        const memPct = percent(memUsed, memTotal);
        const cores = cpu.logical_cores || cpu.cores || data.cpu_cores;
        const physical = cpu.physical_cores;
        const uptime = tel.uptime_secs || hw.uptime_secs || hw.uptime || data.uptime;

        const cpuLoadHtml = cpuLoad == null ? '' : meter(Math.round(cpuLoad), `${formatNumber(cpuLoad, 1)} %`);
        const memHtml = memTotal
            ? (memPct == null ? esc(formatBytes(memTotal)) : meter(memPct, _('inventory.used_of', { used: formatBytes(memUsed), total: formatBytes(memTotal) })))
            : '';
        let coresText = '';
        if (cores) coresText = physical && physical !== cores
            ? _('inventory.cores_detail', { logical: cores, physical })
            : String(cores);

        let html = `<h3 class="inv-group">${esc(_('inventory.group_hardware'))}</h3>
            <dl class="facts inv-facts">
                ${factsRow(_('inventory.device_id'), `<span class="mono">${esc(data.device_id)}</span>`)}
                ${factsRow(_('inventory.processor'), cpu.brand ? esc(cpu.brand) : '')}
                ${factsRow(_('inventory.cores'), coresText ? esc(coresText) : '')}
                ${factsRow(_('inventory.cpu_load'), cpuLoadHtml)}
                ${factsRow(_('inventory.memory'), memHtml)}
                ${factsRow(_('inventory.architecture'), hw.architecture ? esc(hw.architecture) : '')}
            </dl>`;

        const disks = Array.isArray(hw.disks) ? hw.disks : [];
        if (disks.length) {
            html += `<h4 class="inv-sub">${esc(_('inventory.disks'))}</h4>
                <div class="table-scroll"><table class="data-table inv-disks">
                    <thead><tr><th>${esc(_('inventory.drive'))}</th><th>${esc(_('inventory.file_system'))}</th><th>${esc(_('inventory.used'))}</th></tr></thead>
                    <tbody>${disks.map((disk) => {
                        const { total, used } = diskSizes(disk);
                        const pct = percent(used, total);
                        const label = total ? _('inventory.used_of', { used: formatBytes(used), total: formatBytes(total) }) : '';
                        const name = disk.mount_point || disk.device || disk.name || '?';
                        const sub = disk.device && disk.device !== name ? disk.device : '';
                        return `<tr>
                            <td><span class="mono">${esc(name)}</span>${sub ? `<span class="cell-sub mono">${esc(sub)}</span>` : ''}${disk.removable ? `<span class="cell-sub">${esc(_('inventory.removable_drive'))}</span>` : ''}</td>
                            <td>${disk.filesystem || disk.fs_type ? esc(disk.filesystem || disk.fs_type) : DASH}</td>
                            <td class="inv-disk-use">${pct == null ? (total ? esc(formatBytes(total)) : DASH) : meter(pct, label)}</td>
                        </tr>`;
                    }).join('')}</tbody>
                </table></div>`;
        }

        const nics = Array.isArray(hw.network_interfaces) ? hw.network_interfaces : [];
        if (nics.length) {
            html += `<h4 class="inv-sub">${esc(_('inventory.network_interfaces'))}</h4>
                <div class="table-scroll"><table class="data-table inv-nics">
                    <thead><tr><th>${esc(_('inventory.adapter'))}</th><th>${esc(_('inventory.mac_address'))}</th><th>${esc(_('inventory.ip_addresses'))}</th></tr></thead>
                    <tbody>${nics.map((nic) => `<tr>
                        <td>${esc(nic.name || '?')}</td>
                        <td>${nic.mac ? `<span class="mono">${esc(nic.mac)}</span>` : DASH}</td>
                        <td>${(nic.ip_addresses || []).length ? `<span class="mono">${(nic.ip_addresses || []).map(esc).join('<br>')}</span>` : DASH}</td>
                    </tr>`).join('')}</tbody>
                </table></div>`;
        }

        const osName = hw.os_name || data.os || (listRow && listRow.os) || '';
        html += `<h3 class="inv-group">${esc(_('inventory.group_software'))}</h3>
            <dl class="facts inv-facts">
                ${factsRow(_('inventory.os'), osName ? esc(osName) : '')}
                ${factsRow(_('inventory.os_version'), hw.os_version ? esc(hw.os_version) : '')}
                ${factsRow(_('inventory.kernel'), hw.kernel ? esc(hw.kernel) : '')}
                ${factsRow(_('inventory.uptime'), formatDuration(uptime) ? esc(formatDuration(uptime)) : '')}
                ${factsRow(_('inventory.collected_at'), Utils.parseDate(data.collected_at) ? esc(Utils.formatDate(data.collected_at)) : '')}
                ${factsRow(_('inventory.received_at'), Utils.parseDate(data.received_at) ? esc(Utils.formatDate(data.received_at)) : '')}
            </dl>`;

        const apps = Array.isArray(sw.apps) ? sw.apps.slice() : [];
        apps.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        html += `<div class="inv-apps-head">
                <h4 class="inv-sub" id="inv-apps-title">${esc(_('inventory.installed_programs'))}</h4>
                <span class="text-muted" id="inv-apps-count">${esc(apps.length === 1 ? _('inventory.programs_one') : _('inventory.programs_many', { count: apps.length }))}</span>
            </div>`;
        if (!apps.length) {
            html += `<p class="state">${esc(_('inventory.no_programs'))}</p>`;
        } else {
            html += `<div class="search-wrapper inv-apps-search">
                    <span class="material-icons" aria-hidden="true">search</span>
                    <input type="search" class="form-input" id="inv-apps-search" aria-label="${esc(_('inventory.search_programs'))}" placeholder="${esc(_('inventory.search_programs'))}">
                </div>
                <div class="table-scroll"><table class="data-table inv-apps" aria-labelledby="inv-apps-title">
                    <thead><tr><th>${esc(_('inventory.program'))}</th><th>${esc(_('inventory.version'))}</th><th class="inv-col-publisher">${esc(_('inventory.publisher'))}</th><th class="inv-col-installed">${esc(_('inventory.installed'))}</th></tr></thead>
                    <tbody id="inv-apps-body">${apps.map((app) => {
                        const installed = Utils.parseDate(app.installed_at || app.install_date);
                        const search = [app.name, app.version, app.publisher].join(' ').toLowerCase();
                        return `<tr data-search="${esc(search)}">
                            <td>${esc(app.name || '?')}<span class="cell-sub inv-phone-publisher">${esc(app.publisher || '')}</span></td>
                            <td class="inv-version">${app.version ? esc(app.version) : DASH}</td>
                            <td class="inv-col-publisher">${app.publisher ? esc(app.publisher) : DASH}</td>
                            <td class="inv-col-installed">${installed ? esc(Utils.formatDate(installed, { hour: undefined, minute: undefined })) : DASH}</td>
                        </tr>`;
                    }).join('')}
                    <tr class="inv-apps-empty" hidden><td colspan="4" class="state-cell">${esc(_('inventory.no_programs_match'))}</td></tr></tbody>
                </table></div>`;
        }
        return html;
    }

    function wireAppSearch(root) {
        const input = root.querySelector('#inv-apps-search');
        if (!input) return;
        const rows = Array.from(root.querySelectorAll('#inv-apps-body tr[data-search]'));
        const empty = root.querySelector('.inv-apps-empty');
        const count = root.querySelector('#inv-apps-count');
        const total = rows.length;
        input.addEventListener('input', () => {
            const q = input.value.trim().toLowerCase();
            let shown = 0;
            rows.forEach((row) => {
                const hit = !q || row.dataset.search.includes(q);
                row.hidden = !hit;
                if (hit) shown += 1;
            });
            empty.hidden = shown > 0;
            count.textContent = q
                ? _('inventory.programs_shown', { shown, count: total })
                : (total === 1 ? _('inventory.programs_one') : _('inventory.programs_many', { count: total }));
        });
    }

    async function openDetail(deviceId) {
        const listRow = allDevices.find((d) => d.device_id === deviceId) || {};
        const title = listRow.hostname && listRow.hostname !== deviceId ? listRow.hostname : deviceId;
        Modal.show({
            title,
            size: 'large',
            content: `<div class="inventory-detail" id="inventory-detail"><p class="state">${esc(_('inventory.loading_detail'))}</p></div>`,
            buttons: [{ label: _('actions.close'), class: 'btn', onClick: () => Modal.close() }],
        });
        const body = document.getElementById('inventory-detail');
        try {
            const data = await Utils.api(`/api/inventory/${encodeURIComponent(deviceId)}`);
            if (!document.body.contains(body)) return;
            body.innerHTML = detailHtml(data || {}, listRow);
            wireAppSearch(body);
        } catch (err) {
            if (!document.body.contains(body)) return;
            if (err.status === 404) {
                body.innerHTML = `<p class="state">${esc(_('inventory.detail_none'))}</p>`;
                return;
            }
            body.innerHTML = `<p class="state is-error">${esc(_('inventory.detail_failed'))} ${esc(err.message || '')}
                <button type="button" class="btn btn-sm" data-retry>${esc(_('actions.retry'))}</button></p>`;
            body.querySelector('[data-retry]').addEventListener('click', () => openDetail(deviceId));
        }
    }

    // ---- Events ----

    tbody.addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        if (event.target.closest('a, input') || (event.target.closest('button') && !event.target.closest('.row-open'))) return;
        openDetail(row.dataset.id);
    });

    searchInput.addEventListener('input', Utils.debounce(() => {
        currentSearch = searchInput.value.trim();
        render();
    }, 200));

    refreshBtn.addEventListener('click', loadInventory);

    loadInventory();
})();
