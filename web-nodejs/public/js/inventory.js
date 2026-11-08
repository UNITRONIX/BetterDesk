/**
 * BetterDesk Console - Inventory page
 *
 * Lists the hardware the agents report (GET /api/inventory, paged). A row
 * opens the device panel (deviceDetail.js) on its hardware tab, which shows
 * the full report (GET /api/inventory/:id).
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
    const esc = (value) => Utils.escapeHtml(value == null ? '' : String(value));

    let allDevices = [];
    let source = '';
    let currentSearch = '';
    let loadError = null;

    const tbody = document.getElementById('inventory-body');
    const countLine = document.getElementById('inventory-count');
    const searchInput = document.getElementById('search-input');
    const refreshBtn = document.getElementById('refresh-btn');
    const side = document.getElementById('inventory-side');

    // Disks and memory above this share count as almost full in the side column
    const FULL_PERCENT = 90;
    // Rows in the side column's list of systems
    const OS_ROWS = 6;

    // ---- Formatting ----

    // Numbers, sizes and times come from the shared helpers (utils.js, GUIDE.md "Data display")
    const formatNumber = (value, digits) => Utils.formatNumber(value, { maximumFractionDigits: digits });
    const formatBytes = (bytes) => (bytes > 0 ? Utils.formatBytes(bytes) : '');

    function percent(used, total) {
        if (!total || total <= 0 || used == null) return null;
        return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
    }

    function meter(pct, label) {
        if (pct == null) return Utils.emptyHtml();
        const level = pct >= 95 ? ' is-full' : pct >= 85 ? ' is-high' : '';
        return `<div class="meter${level}"><span class="meter-bar" aria-hidden="true"><span class="meter-fill" style="width:${pct}%"></span></span>`
            + `<span class="meter-value">${esc(label || Utils.formatPercent(pct))}</span></div>`;
    }

    function timeCell(value) {
        return Utils.timeHtml(value);
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
        renderSummary();
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
                    <button type="button" class="row-open" data-id="${esc(d.device_id)}"><span class="row-name">${esc(name || d.device_id)}</span>${name ? `<span class="cell-sub">${Utils.valueHtml(d.device_id)}</span>` : ''}${d.os ? `<span class="cell-sub phone-only">${esc(osText(d))}</span>` : ''}</button>
                </td>
                <td class="col-os">${Utils.platformHtml(d.os ? osText(d) : '')}</td>
                <td class="col-cpu">${hasCpu ? `<span class="cpu-name" title="${esc(d.cpu)}">${esc(d.cpu)}</span>` : Utils.emptyHtml()}
                    ${cpuSub.length ? `<span class="cell-sub">${esc(cpuSub.join(', '))}</span>` : ''}</td>
                <td class="col-memory">${memPct == null ? Utils.emptyHtml() : `${meter(memPct)}<span class="cell-sub memory-detail">${esc(memLabel)}</span>`}</td>
                <td class="col-disks is-num">${d.disk_count ? esc(Utils.formatNumber(d.disk_count)) : Utils.emptyHtml()}</td>
                <td class="col-updated">${timeCell(d.collected_at || d.last_seen)}</td>
            </tr>`;
    }

    // ---- Side column: systems and devices short of space ----

    // One share-bar part per OS family; the series colours come from ui/inventory.css
    const FAMILIES = [
        { id: 'windows', label: () => _('cross_platform.platform_windows'), cls: 'is-series-1' },
        { id: 'linux', label: () => _('cross_platform.platform_linux'), cls: 'is-series-2' },
        { id: 'apple', label: () => _('cross_platform.platform_macos'), cls: 'is-series-3' },
        { id: 'other', label: () => _('inventory.os_other'), cls: 'is-muted' },
    ];

    function osFamily(os) {
        const id = Utils.getPlatformLogoId(os);
        return id === 'windows' || id === 'linux' || id === 'apple' ? id : 'other';
    }

    // The system as the device reports it, without the version twice
    // ("macOS 15.1" with version "15.1" reads "macOS 15.1", not "macOS 15.1 15.1")
    function osText(d) {
        const full = String(d.os || '').trim();
        const name = String(d.os_name || '').trim();
        if (!name || !full.startsWith(name)) return full;
        const version = full.slice(name.length).trim();
        if (!version) return name;
        const words = name.split(/\s+/);
        return words.includes(version) ? name : full;
    }

    // The system without build numbers: "Windows 11 Pro", "Ubuntu 24.04"
    function osName(d) {
        if (d.os_name) return String(d.os_name).trim();
        return String(d.os || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    }

    function renderOsSummary() {
        const bar = document.getElementById('inv-os-bar');
        const legend = document.getElementById('inv-os-legend');
        const body = document.getElementById('inv-os-body');
        const withOs = allDevices.filter((d) => osName(d));
        const total = withOs.length;
        bar.textContent = '';
        legend.textContent = '';
        FAMILIES.forEach((f) => {
            const n = withOs.filter((d) => osFamily(d.os || d.os_name) === f.id).length;
            if (!n) return;
            const seg = document.createElement('span');
            seg.className = f.cls;
            seg.style.flexGrow = String(n);
            bar.appendChild(seg);
            const li = document.createElement('li');
            const key = document.createElement('span');
            key.className = 'key ' + f.cls;
            key.setAttribute('aria-hidden', 'true');
            const strong = document.createElement('strong');
            strong.textContent = formatNumber(n, 0);
            li.appendChild(key);
            li.appendChild(strong);
            li.appendChild(document.createTextNode(' ' + f.label()));
            legend.appendChild(li);
        });
        bar.hidden = total === 0;

        const counts = new Map();
        withOs.forEach((d) => {
            const name = osName(d);
            counts.set(name, (counts.get(name) || 0) + 1);
        });
        const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        // The most common systems; the rest stay findable through the search
        const shown = ranked.slice(0, OS_ROWS);
        const more = document.getElementById('inv-os-more');
        more.hidden = ranked.length <= OS_ROWS;
        more.textContent = _('inventory.os_more', { count: ranked.length - OS_ROWS });
        body.innerHTML = shown.length
            ? shown.map(([name, n]) => `<tr>
                    <td><button type="button" class="btn-link inv-os-filter" data-os="${esc(name)}">${esc(name)}</button></td>
                    <td class="is-num">${esc(formatNumber(n, 0))}</td>
                </tr>`).join('')
            : `<tr><td colspan="2" class="state-cell">${esc(_('inventory.os_none'))}</td></tr>`;
    }

    function spaceRow(d, sub) {
        const name = d.hostname && d.hostname !== d.device_id ? d.hostname : d.device_id;
        return `<li><button type="button" class="list-row is-link inv-space-row" data-id="${esc(d.device_id)}">
                <span class="row-main"><span class="row-title">${esc(name)}</span><span class="row-sub">${esc(sub)}</span></span>
                <span class="material-icons row-chevron" aria-hidden="true">chevron_right</span>
            </button></li>`;
    }

    function renderSpaceSummary() {
        const diskList = document.getElementById('inv-disk-list');
        const memList = document.getElementById('inv-mem-list');
        // Disk use comes with the list since the server reports each device's fullest disk
        const hasDiskData = allDevices.some((d) => typeof d.disk_max_used_percent === 'number');
        document.getElementById('inv-disk-title').hidden = !hasDiskData;
        diskList.hidden = !hasDiskData;
        if (hasDiskData) {
            const full = allDevices
                .filter((d) => d.disk_max_used_percent > FULL_PERCENT)
                .sort((a, b) => b.disk_max_used_percent - a.disk_max_used_percent);
            diskList.innerHTML = full.length
                ? full.map((d) => spaceRow(d, _('inventory.disk_full_row', {
                    mount: d.disk_max_mount || '',
                    pct: formatNumber(d.disk_max_used_percent, 0),
                    free: formatBytes(d.disk_max_free_bytes) || '0 B',
                }).trim())).join('')
                : `<li class="list-row is-empty">${esc(_('inventory.disks_none', { pct: FULL_PERCENT }))}</li>`;
        }
        const memFull = allDevices
            .map((d) => ({ d, pct: percent(d.memory_used_mb, d.memory_total_mb) }))
            .filter((x) => x.pct != null && x.pct > FULL_PERCENT)
            .sort((a, b) => b.pct - a.pct);
        memList.innerHTML = memFull.length
            ? memFull.map(({ d, pct }) => spaceRow(d, _('inventory.memory_full_row', {
                pct,
                used: formatBytes(d.memory_used_mb * 1048576),
                total: formatBytes(d.memory_total_mb * 1048576),
            }))).join('')
            : `<li class="list-row is-empty">${esc(_('inventory.memory_none', { pct: FULL_PERCENT }))}</li>`;
    }

    function renderSummary() {
        if (!side) return;
        side.hidden = !!loadError || !allDevices.length;
        if (side.hidden) return;
        renderOsSummary();
        // Devices from the peer list have no hardware report, so there is no space to judge
        document.getElementById('inv-space').hidden = source === 'peer_list';
        if (source !== 'peer_list') renderSpaceSummary();
    }

    side && side.addEventListener('click', (event) => {
        const filter = event.target.closest('.inv-os-filter');
        if (filter) {
            searchInput.value = filter.dataset.os;
            currentSearch = filter.dataset.os;
            render();
            searchInput.focus();
            return;
        }
        const row = event.target.closest('.inv-space-row');
        if (row) openDetail(row.dataset.id);
    });

    // ---- Device details ----

    // One device view everywhere: the device panel from the device list, opened on its hardware tab
    // (which shows this page's report: facts, disks, adapters, system and programs)
    function openDetail(deviceId) {
        if (typeof DeviceDetail !== 'undefined') DeviceDetail.open(deviceId, { tab: 'hardware' });
    }

    // ---- Events ----

    tbody.addEventListener('click', (event) => {
        const row = event.target.closest('tr[data-id]');
        if (!row) return;
        if (event.target.closest('a, input') || (event.target.closest('button') && !event.target.closest('.row-open'))) return;
        // Selecting text (an ID, a CPU name) is not a click on the row
        const selection = window.getSelection && window.getSelection();
        if (selection && !selection.isCollapsed && row.contains(selection.anchorNode)) return;
        openDetail(row.dataset.id);
    });

    searchInput.addEventListener('input', Utils.debounce(() => {
        currentSearch = searchInput.value.trim();
        render();
    }, 200));

    refreshBtn.addEventListener('click', loadInventory);

    loadInventory();
})();
