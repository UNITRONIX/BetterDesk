/**
 * BetterDesk Console - Reports page
 * Generate a report, read it as tables, save it, open or delete saved reports.
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);
    const has = (key) => _(key) !== key;
    const csrfToken = window.BetterDesk?.csrfToken || '';
    const role = window.BetterDesk?.user?.role || '';
    // Saving and deleting is limited to admins on the server (routes/reports.routes.js)
    const canManage = ['admin', 'super_admin', 'global_admin'].includes(role);

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        const resp = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
        if (!resp.ok) {
            const text = await resp.text();
            let msg;
            try { msg = JSON.parse(text).error; } catch (_e) { msg = ''; }
            const err = new Error(msg || `HTTP ${resp.status}`);
            err.status = resp.status;
            throw err;
        }
        return resp;
    }

    function esc(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    function toDate(value) {
        if (!value) return null;
        let s = String(value);
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function formatDate(value) {
        const d = toDate(value);
        return d ? Utils.formatDate(d.toISOString()) : '—';
    }

    function formatDuration(seconds) {
        seconds = Number(seconds) || 0;
        if (seconds <= 0) return _('reports.none_time');
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return _('reports.duration_hm', { h, m });
        return _('reports.duration_m', { m: Math.max(1, m) });
    }

    function num(v) {
        const n = Number(v);
        if (v === null || v === undefined || Number.isNaN(n)) return '—';
        return n.toLocaleString(window.BetterDesk?.lang || undefined);
    }

    function humanize(key) {
        const words = String(key).replace(/_/g, ' ').trim();
        return words.charAt(0).toUpperCase() + words.slice(1);
    }

    function fieldLabel(key) {
        return has('reports.field_' + key) ? _('reports.field_' + key) : humanize(key);
    }

    function typeLabel(type) {
        return has('reports.type_' + type) ? _('reports.type_' + type) : humanize(type || '');
    }

    function notify(message, kind) {
        if (typeof Notifications !== 'undefined') {
            if (kind === 'error' && Notifications.error) return Notifications.error(message);
            if (Notifications.success) return Notifications.success(message);
        }
    }

    // ---- Small builders ----
    function table(columns, rows) {
        return `<div class="table-scroll"><table class="data-table">
            <thead><tr>${columns.map((c) => `<th scope="col"${c.num ? ' class="report-num"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>
            <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td${c.num ? ' class="report-num"' : ''}>${c.html ? c.html(r) : esc(c.value(r))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>`;
    }

    function block(title, inner) {
        return `<section class="report-block"><h3>${esc(title)}</h3>${inner}</section>`;
    }

    function facts(pairs) {
        return `<dl class="facts">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    }

    function countTable(obj, nameLabel, countLabel, translate) {
        const entries = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
        if (!entries.length) return `<p class="state">${esc(_('reports.no_rows'))}</p>`;
        return table([
            { label: nameLabel, value: (r) => (translate ? translate(r[0]) : r[0]) },
            { label: countLabel, value: (r) => num(r[1]), num: true }
        ], entries);
    }

    function genericTable(rows) {
        if (!rows.length) return `<p class="state">${esc(_('reports.no_rows'))}</p>`;
        const cols = Object.keys(rows[0]);
        return table(cols.map((c) => ({
            label: fieldLabel(c),
            value: (r) => {
                const v = r[c];
                if (v === null || v === undefined || v === '') return '—';
                if (typeof v === 'object') return JSON.stringify(v);
                if (/_at$/.test(c)) return formatDate(v);
                return v;
            }
        })), rows);
    }

    const levelLabel = (prefix) => (v) => (has(prefix + v) ? _(prefix + v) : humanize(v));

    // ---- Per-type renderers ----
    const RENDERERS = {
        devices(d) {
            return `<p class="report-lead">${esc(_('reports.devices_sentence', {
                total: num(d.total_devices), online: num(d.online), offline: num(d.offline), banned: num(d.banned)
            }))}</p>` + block(_('reports.platforms'), countTable(d.platform_distribution, _('reports.platform'), _('reports.devices')));
        },
        activity(d) {
            // Reports saved before the field fix carry *_ms fields with zero values
            const active = d.total_active_secs ?? (d.total_active_ms ? d.total_active_ms / 1000 : 0);
            const idle = d.total_idle_secs ?? (d.total_idle_ms ? d.total_idle_ms / 1000 : 0);
            const pairs = [];
            if (d.devices_with_activity !== undefined) pairs.push([_('reports.field_devices_with_activity'), num(d.devices_with_activity)]);
            pairs.push([_('reports.field_daily_reports'), num(d.daily_reports ?? d.total_devices_with_activity)]);
            pairs.push([_('reports.total_active'), formatDuration(active)]);
            pairs.push([_('reports.total_idle'), formatDuration(idle)]);
            const apps = d.top_applications || [];
            const appsHtml = apps.length
                ? table([
                    { label: _('reports.app'), value: (a) => a.name || '—' },
                    { label: _('reports.category'), value: (a) => (a.category ? levelLabel('activity.category_')(a.category) : '—') },
                    { label: _('reports.time_used'), value: (a) => formatDuration(a.total_secs ?? (a.total_ms ? a.total_ms / 1000 : 0)), num: true },
                    { label: _('reports.app_sessions'), value: (a) => num(a.sessions), num: true },
                    { label: _('reports.devices'), value: (a) => num(a.devices), num: true }
                ], apps)
                : `<p class="state">${esc(_('reports.no_apps'))}</p>`;
            return facts(pairs) + block(_('reports.top_applications'), appsHtml);
        },
        security(d) {
            const dlp = (d.dlp && d.dlp.stats) || {};
            let html = facts([
                [_('reports.field_dlp_total'), num(dlp.total || 0)],
                [_('reports.field_dlp_blocked'), num(dlp.blocked || 0)],
                [_('reports.field_dlp_logged'), num(dlp.logged || 0)]
            ]);
            const banned = d.banned_devices || [];
            html += block(_('reports.banned_devices'), banned.length
                ? table([
                    { label: _('reports.device_id'), html: (b) => `<span class="mono">${esc(b.id)}</span>` },
                    { label: _('reports.device_name'), value: (b) => b.hostname || '—' },
                    { label: _('reports.ip_address'), html: (b) => (b.ip ? `<span class="mono">${esc(b.ip)}</span>` : '—') },
                    { label: _('reports.ban_reason'), value: (b) => b.ban_reason || '—' }
                ], banned)
                : `<p class="state">${esc(_('reports.no_banned'))}</p>`);
            const audit = d.recent_audit || [];
            html += block(_('reports.recent_audit'), audit.length
                ? `<p class="count-line">${esc(_('reports.recent_audit_note', { shown: audit.length, total: d.audit_log_count ?? audit.length }))}
                    <a href="/security-audit?tab=audit">${esc(_('reports.open_audit_log'))}</a></p>` + table([
                    { label: _('reports.when'), value: (a) => formatDate(a.created_at) },
                    { label: _('reports.who'), value: (a) => a.username || '—' },
                    { label: _('reports.action'), value: (a) => (has('audit.action_' + a.action) ? _('audit.action_' + a.action) : humanize(a.action || '')) },
                    { label: _('reports.details'), value: (a) => a.details || '—' }
                ], audit)
                : `<p class="state">${esc(_('reports.no_rows'))}</p>`);
            const dlpEvents = (d.dlp && d.dlp.recent_events) || [];
            if (dlpEvents.length) html += block(_('reports.dlp_events'), genericTable(dlpEvents));
            return html;
        },
        tickets(d) {
            const s = d.stats || {};
            return `<p class="report-lead">${esc(_('reports.tickets_sentence', {
                total: num(s.total ?? d.total_tickets), open: num(s.open || 0), in_progress: num(s.in_progress || 0),
                resolved: num(s.resolved || 0), closed: num(s.closed || 0)
            }))}</p>`
                + block(_('reports.category_distribution'), countTable(d.category_distribution, _('reports.category'), _('reports.tickets'), levelLabel('tickets.category_')))
                + block(_('reports.priority_distribution'), countTable(d.priority_distribution, _('reports.priority'), _('reports.tickets'), levelLabel('tickets.priority_')));
        },
        network(d) {
            const targets = d.targets || [];
            return `<p class="report-lead">${esc(_('reports.network_sentence', {
                total: num(d.total_targets), up: num(d.up), down: num(d.down), unknown: num(d.unknown)
            }))}</p>` + block(_('reports.targets_status'), targets.length
                ? table([
                    { label: _('reports.target_name'), value: (t) => t.name || '—' },
                    { label: _('reports.target_host'), html: (t) => `<span class="mono">${esc(t.host || '—')}</span>` },
                    { label: _('reports.check_type'), value: (t) => t.check_type || '—' },
                    { label: _('reports.status'), value: (t) => t.last_status || '—' },
                    { label: _('reports.response_time'), value: (t) => (t.last_rtt_ms != null ? _('reports.ms', { ms: num(t.last_rtt_ms) }) : '—'), num: true },
                    { label: _('reports.last_check'), value: (t) => formatDate(t.last_check_at) }
                ], targets)
                : `<p class="state">${esc(_('reports.no_targets'))}</p>`);
        },
        inventory(d) {
            const avg = Number(d.avg_ram_mb) || 0;
            return facts([
                [_('reports.field_total_inventoried'), num(d.total_inventoried)],
                [_('reports.avg_ram'), avg ? _('reports.gb', { gb: (avg / 1024).toLocaleString(window.BetterDesk?.lang || undefined, { maximumFractionDigits: 1 }) }) : '—']
            ]) + block(_('reports.os_distribution'), countTable(d.os_distribution, _('reports.operating_system'), _('reports.devices')));
        },
        alerts(d) {
            const recent = d.recent_alerts || [];
            return facts([
                [_('reports.field_total_rules'), num(d.total_rules)],
                [_('reports.field_active_rules'), num(d.active_rules)],
                [_('reports.field_total_alerts'), num(d.total_alerts)]
            ]) + block(_('reports.alerts_per_rule'), countTable(d.alerts_per_rule, _('reports.rule'), _('reports.alerts')))
                + block(_('reports.recent_alerts'), genericTable(recent));
        }
    };

    function renderGeneric(data) {
        const pairs = [];
        let html = '';
        for (const [k, v] of Object.entries(data || {})) {
            if (v === null || v === undefined) continue;
            if (Array.isArray(v)) {
                html += block(fieldLabel(k), v.length && typeof v[0] === 'object' ? genericTable(v) : `<p>${esc(v.join(', ') || '—')}</p>`);
            } else if (typeof v === 'object') {
                html += block(fieldLabel(k), facts(Object.entries(v).map(([sk, sv]) => [fieldLabel(sk), typeof sv === 'object' ? JSON.stringify(sv) : sv])));
            } else {
                pairs.push([fieldLabel(k), v]);
            }
        }
        return (pairs.length ? facts(pairs) : '') + html;
    }

    // ---- Preview section ----
    const preview = document.getElementById('report-preview');
    const previewTitle = document.getElementById('report-preview-title');
    const previewMeta = document.getElementById('report-preview-meta');
    const previewContent = document.getElementById('preview-content');
    const status = document.getElementById('report-status');
    const saveBtn = document.getElementById('save-report-btn');
    const csvItem = document.getElementById('download-csv-item');
    const dateFrom = document.getElementById('report-from');
    const dateTo = document.getElementById('report-to');

    // What is shown: { type, data, generatedAt, filters, saved }
    let current = null;

    function periodText(filters) {
        const from = filters && filters.from ? formatDay(filters.from) : '';
        const to = filters && filters.to ? formatDay(filters.to) : '';
        if (from && to) return _('reports.period_from_to', { from, to });
        if (from) return _('reports.period_since', { from });
        if (to) return _('reports.period_until', { to });
        return _('reports.period_all');
    }

    function formatDay(value) {
        const d = toDate(String(value).slice(0, 10) + 'T12:00:00Z');
        return d ? Utils.formatDate(d.toISOString(), { hour: undefined, minute: undefined }) : value;
    }

    function showReport(report) {
        current = report;
        previewTitle.textContent = report.title || typeLabel(report.type);
        previewMeta.textContent = report.saved
            ? _('reports.saved_meta', { type: typeLabel(report.type), date: formatDate(report.generatedAt), period: periodText(report.filters) })
            : _('reports.generated_meta', { date: formatDate(report.generatedAt), period: periodText(report.filters) });
        const render = RENDERERS[report.type] || renderGeneric;
        let html = '';
        try { html = render(report.data || {}); } catch (_e) { html = renderGeneric(report.data || {}); }
        html += `<details class="disclosure report-raw"><summary>${esc(_('reports.raw_json'))}</summary>
            <pre class="code-block">${esc(JSON.stringify(report.data, null, 2))}</pre></details>`;
        previewContent.innerHTML = html;
        status.textContent = '';
        status.className = 'form-status';
        saveBtn.hidden = !canManage || !!report.saved;
        csvItem.hidden = !!report.saved;
        preview.hidden = false;
        preview.focus({ preventScroll: true });
        preview.scrollIntoView({ block: 'start', behavior: 'auto' });
    }

    function currentFilters() {
        return {
            from: dateFrom.value || undefined,
            to: dateTo.value ? dateTo.value + 'T23:59:59.999Z' : undefined
        };
    }

    async function generate(type, btn) {
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = _('reports.generating');
        try {
            const filters = currentFilters();
            const resp = await apiFetch('/api/reports/generate', { method: 'POST', body: JSON.stringify({ type, ...filters }) });
            const json = await resp.json();
            showReport({ type, data: json.data, generatedAt: json.generated_at, filters, saved: false });
        } catch (err) {
            notify(_('reports.generate_failed', { error: err.message }), 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = label;
        }
    }

    document.querySelectorAll('.report-generate-btn').forEach((btn) => {
        btn.addEventListener('click', () => generate(btn.dataset.type, btn));
    });

    function download(kind) {
        if (!current) return;
        const day = new Date().toISOString().slice(0, 10);
        if (kind === 'csv') {
            const filters = current.filters || {};
            const data = current.data || {};
            // The server flattens one list section to CSV; pick the main one for this report
            const section = ['top_applications', 'targets', 'banned_devices', 'recent_alerts']
                .find((k) => Array.isArray(data[k]) && data[k].length);
            apiFetch('/api/reports/generate/csv', { method: 'POST', body: JSON.stringify({ type: current.type, ...filters, section }) })
                .then((r) => r.text())
                .then((text) => save(text, 'text/csv', `report_${current.type}_${day}.csv`))
                .catch((err) => notify(_('reports.download_failed', { error: err.message }), 'error'));
            return;
        }
        save(JSON.stringify(current.data, null, 2), 'application/json', `report_${current.type}_${day}.json`);
    }

    function save(text, mime, name) {
        const blob = new Blob([text], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    document.querySelectorAll('#download-menu [data-download]').forEach((item) => {
        item.addEventListener('click', () => download(item.dataset.download));
    });

    saveBtn.addEventListener('click', () => {
        if (!current || current.saved) return;
        const suggested = `${typeLabel(current.type)}, ${formatDate(current.generatedAt)}`;
        Modal.prompt({
            title: _('reports.save_title'),
            label: _('reports.report_name'),
            value: suggested,
            hint: _('reports.save_hint'),
            confirmLabel: _('reports.save')
        }).then((value) => { if (value !== null) saveCurrent(value); });
    });

    async function saveCurrent(title) {
        title = String(title || '').trim();
        if (!title) return;
        status.className = 'form-status';
        status.textContent = _('reports.saving');
        try {
            const resp = await apiFetch('/api/reports/save', {
                method: 'POST',
                body: JSON.stringify({ title, type: current.type, ...(current.filters || {}) })
            });
            await resp.json();
            status.className = 'form-status is-ok';
            status.textContent = _('reports.saved_ok', { title });
            saveBtn.hidden = true;
            loadSaved();
        } catch (err) {
            status.className = 'form-status is-error';
            status.textContent = _('reports.save_failed', { error: err.message });
        }
    }

    // ---- Saved reports ----
    const savedBody = document.getElementById('saved-body');

    async function loadSaved() {
        savedBody.innerHTML = `<tr><td colspan="5" class="state-cell">${esc(_('reports.loading'))}</td></tr>`;
        try {
            const resp = await apiFetch('/api/reports/saved');
            const data = await resp.json();
            const reports = Array.isArray(data) ? data : [];
            if (!reports.length) {
                savedBody.innerHTML = `<tr><td colspan="5" class="state-cell">${esc(_('reports.no_saved'))}</td></tr>`;
                return;
            }
            savedBody.innerHTML = reports.map((r, i) => {
                const name = r.title || r.name || typeLabel(r.report_type);
                const menuId = 'saved-menu-' + r.id;
                return `<tr>
                    <td>${esc(name)}</td>
                    <td>${esc(typeLabel(r.report_type || r.type))}</td>
                    <td>${esc(r.created_by || '—')}</td>
                    <td class="report-num">${esc(formatDate(r.created_at))}</td>
                    <td class="actions">
                        <button type="button" class="btn btn-sm run-btn" data-id="${esc(r.id)}" aria-label="${esc(_('reports.open_named', { name }))}">${esc(_('reports.open'))}</button>
                        ${canManage ? `<span class="menu-anchor">
                            <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}" aria-label="${esc(_('reports.actions_for', { name }))}">
                                <span class="material-icons" aria-hidden="true">more_vert</span></button>
                            <span class="menu menu-end${i >= reports.length - 2 && reports.length > 3 ? ' menu-up' : ''}" id="${menuId}" role="menu">
                                <button type="button" class="menu-item danger del-btn" role="menuitem" data-id="${esc(r.id)}" data-name="${esc(name)}">${esc(_('reports.delete_saved'))}</button>
                            </span>
                        </span>` : ''}
                    </td>
                </tr>`;
            }).join('');
            // Phones show each row as a block; cells carry their column name (see ui/reports.css)
            const heads = Array.from(savedBody.closest('table').querySelectorAll('thead th')).map((th) => th.textContent.trim());
            savedBody.querySelectorAll('tr').forEach((tr) => {
                Array.from(tr.children).forEach((td, i) => {
                    if (!td.classList.contains('actions') && heads[i]) td.setAttribute('data-label', heads[i]);
                });
            });
        } catch (err) {
            savedBody.innerHTML = `<tr><td colspan="5" class="state-cell"><span class="state is-error">${esc(_('reports.saved_load_failed'))}
                <button type="button" class="btn btn-sm" id="saved-retry">${esc(_('reports.try_again'))}</button></span></td></tr>`;
            document.getElementById('saved-retry').addEventListener('click', loadSaved);
        }
    }

    savedBody.addEventListener('click', (e) => {
        const run = e.target.closest('.run-btn');
        if (run) { openSaved(run.dataset.id); return; }
        const del = e.target.closest('.del-btn');
        if (del) deleteSaved(del.dataset.id, del.dataset.name);
    });

    async function openSaved(id) {
        try {
            const resp = await apiFetch(`/api/reports/saved/${encodeURIComponent(id)}`);
            const saved = await resp.json();
            const payload = typeof saved.payload === 'string' ? JSON.parse(saved.payload) : (saved.payload || {});
            let filters = {};
            try { filters = typeof saved.filters === 'string' ? JSON.parse(saved.filters) : (saved.filters || {}); } catch (_e) { filters = {}; }
            showReport({
                type: saved.report_type || saved.type,
                title: saved.title,
                data: payload,
                generatedAt: saved.created_at,
                filters,
                saved: true
            });
        } catch (err) {
            notify(_('reports.open_failed', { error: err.message }), 'error');
        }
    }

    function deleteSaved(id, name) {
        Modal.confirm({
            title: _('reports.delete_title'),
            message: _('reports.delete_confirm_named', { name }),
            confirmLabel: _('reports.delete_saved'),
            danger: true
        }).then(async (ok) => {
            if (!ok) return;
            try {
                await apiFetch(`/api/reports/saved/${encodeURIComponent(id)}`, { method: 'DELETE' });
                notify(_('reports.deleted', { name }), 'success');
                if (current && current.saved && current.title === name) preview.hidden = true;
                loadSaved();
            } catch (err) {
                notify(_('reports.delete_failed', { error: err.message }), 'error');
            }
        });
    }

    // ---- Init ----
    loadSaved();
})();
