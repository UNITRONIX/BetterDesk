/**
 * BetterDesk Console - App usage page
 * Daily usage reports from devices running the BetterDesk agent with activity tracking.
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params) : key);

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    async function getJson(url) {
        const resp = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
        let data = null;
        try { data = await resp.json(); } catch (_e) { data = null; }
        if (!resp.ok) throw new Error((data && data.error) || ('HTTP ' + resp.status));
        return data;
    }

    function formatDate(value) {
        if (!value) return '—';
        let s = String(value);
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
        const d = new Date(s);
        if (Number.isNaN(d.getTime())) return '—';
        return Utils.formatDate(d.toISOString());
    }

    function formatDuration(seconds) {
        seconds = Number(seconds) || 0;
        if (seconds <= 0) return '—';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        if (h > 0) return _('activity.duration_hm', { h, m });
        if (m > 0) return _('activity.duration_m', { m });
        return _('activity.duration_s', { s: Math.round(seconds) });
    }

    function categoryLabel(cat) {
        if (!cat) return '—';
        const key = 'activity.category_' + String(cat).toLowerCase();
        const label = _(key);
        return label !== key ? label : cat;
    }

    // ---- Elements ----
    const activityBody = document.getElementById('activity-body');
    const countLine = document.getElementById('activity-count');
    const searchInput = document.getElementById('activity-search');
    const dateFrom = document.getElementById('activity-from');
    const dateTo = document.getElementById('activity-to');
    const refreshBtn = document.getElementById('activity-refresh-btn');
    const presets = Array.from(document.querySelectorAll('#activity-presets [data-days]'));

    let allSummaries = [];

    // The API compares ISO timestamps as text, so "to" must cover the whole day.
    function rangeParams() {
        const params = new URLSearchParams();
        if (dateFrom.value) params.set('from', dateFrom.value);
        if (dateTo.value) params.set('to', dateTo.value + 'T23:59:59.999Z');
        return params;
    }

    function isoDay(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function markPreset(days) {
        presets.forEach((b) => {
            const on = b.dataset.days === days;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function applyPreset(days) {
        if (days) {
            const from = new Date();
            from.setDate(from.getDate() - (Number(days) - 1));
            dateFrom.value = isoDay(from);
            dateTo.value = isoDay(new Date());
        } else {
            dateFrom.value = '';
            dateTo.value = '';
        }
        markPreset(days);
        loadActivity();
    }

    // ---- Load ----
    async function loadActivity() {
        activityBody.innerHTML = `<tr><td colspan="6" class="state-cell">${escapeHtml(_('activity.loading'))}</td></tr>`;
        countLine.textContent = '';
        try {
            const data = await getJson(`/api/activity?${rangeParams()}`);
            allSummaries = (Array.isArray(data) ? data : (data.summaries || []))
                .slice()
                .sort((a, b) => String(b.reported_at || '').localeCompare(String(a.reported_at || '')));
            filterAndRender();
        } catch (err) {
            activityBody.innerHTML = `<tr><td colspan="6" class="state-cell"><span class="state is-error">${escapeHtml(_('activity.load_failed'))}
                <button type="button" class="btn btn-sm" id="activity-retry">${escapeHtml(_('activity.try_again'))}</button></span></td></tr>`;
            document.getElementById('activity-retry').addEventListener('click', loadActivity);
        }
    }

    function filterAndRender() {
        const q = searchInput.value.trim().toLowerCase();
        const filtered = q
            ? allSummaries.filter((s) => `${s.device_id || ''} ${s.hostname || ''}`.toLowerCase().includes(q))
            : allSummaries;
        renderActivity(filtered);
    }

    function renderActivity(rows) {
        const devices = new Set(rows.map((s) => s.device_id)).size;
        countLine.innerHTML = allSummaries.length
            ? _('activity.count_line', { reports: `<strong>${rows.length}</strong>`, devices })
            : '';
        if (!allSummaries.length) {
            const hasRange = dateFrom.value || dateTo.value;
            activityBody.innerHTML = `<tr><td colspan="6" class="state-cell">${escapeHtml(hasRange ? _('activity.empty_range') : _('activity.empty'))}</td></tr>`;
            return;
        }
        if (!rows.length) {
            activityBody.innerHTML = `<tr><td colspan="6" class="state-cell">${escapeHtml(_('activity.no_match'))}</td></tr>`;
            return;
        }
        activityBody.innerHTML = rows.map((s) => {
            const name = s.hostname && s.hostname !== s.device_id ? s.hostname : '';
            return `
            <tr>
                <td>${name ? `${escapeHtml(name)}<span class="cell-sub mono">${escapeHtml(s.device_id)}</span>` : `<span class="mono">${escapeHtml(s.device_id)}</span>`}</td>
                <td class="activity-num">${escapeHtml(formatDate(s.reported_at))}</td>
                <td class="activity-num">${escapeHtml(formatDuration(s.total_active_secs))}</td>
                <td class="activity-num">${escapeHtml(formatDuration(s.idle_seconds))}</td>
                <td class="activity-num">${Number(s.session_count) || 0}</td>
                <td class="actions"><button type="button" class="btn btn-sm detail-btn" data-id="${escapeHtml(s.device_id)}" data-name="${escapeHtml(name || s.device_id)}"
                    aria-label="${escapeHtml(_('activity.details_for', { name: name || s.device_id }))}">${escapeHtml(_('activity.details'))}</button></td>
            </tr>`;
        }).join('');
        // Phones show each row as a block; cells carry their column name (see ui/activity.css)
        const heads = Array.from(activityBody.closest('table').querySelectorAll('thead th')).map((th) => th.textContent.trim());
        activityBody.querySelectorAll('tr').forEach((tr) => {
            Array.from(tr.children).forEach((td, i) => {
                if (!td.classList.contains('actions') && heads[i]) td.setAttribute('data-label', heads[i]);
            });
        });
    }

    // ---- Detail dialog ----
    async function showDetail(deviceId, name) {
        const tpl = document.getElementById('activity-detail-tpl');
        Modal.show({
            title: _('activity.detail_title', { name }),
            content: tpl.innerHTML,
            size: 'large',
            buttons: [{ label: _('common.close'), class: 'btn-secondary', onClick: () => Modal.close() }]
        });
        const sessionsList = document.getElementById('sessions-list');
        const appsList = document.getElementById('apps-list');
        const params = rangeParams();
        const qs = params.toString() ? `?${params}` : '';

        try {
            const [detail, top] = await Promise.all([
                getJson(`/api/activity/${encodeURIComponent(deviceId)}${qs}`),
                getJson(`/api/activity/${encodeURIComponent(deviceId)}/top${qs}`)
            ]);
            if (!document.body.contains(appsList)) return;

            const appRows = Array.isArray(top) ? top : (top.top_apps || []);
            appsList.innerHTML = !appRows.length
                ? `<p class="state">${escapeHtml(_('activity.no_apps'))}</p>`
                : `<div class="table-scroll"><table class="data-table">
                    <thead><tr><th scope="col">${escapeHtml(_('activity.app_name'))}</th><th scope="col">${escapeHtml(_('activity.category'))}</th>
                        <th scope="col">${escapeHtml(_('activity.total_time'))}</th><th scope="col">${escapeHtml(_('activity.sessions'))}</th></tr></thead>
                    <tbody>${appRows.map((a) => `<tr>
                        <td>${escapeHtml(a.app_name || a.name || '—')}</td>
                        <td>${escapeHtml(categoryLabel(a.category))}</td>
                        <td class="activity-num">${escapeHtml(formatDuration(a.total_secs ?? a.total_seconds))}</td>
                        <td class="activity-num">${Number(a.session_count) || 0}</td></tr>`).join('')}</tbody></table></div>`;

            const sesRows = Array.isArray(detail) ? detail : (detail.sessions || []);
            sessionsList.innerHTML = !sesRows.length
                ? `<p class="state">${escapeHtml(_('activity.no_sessions'))}</p>`
                : `<p class="count-line">${escapeHtml(_('activity.recent_sessions_note', { count: sesRows.length }))}</p>
                    <div class="table-scroll"><table class="data-table">
                    <thead><tr><th scope="col">${escapeHtml(_('activity.started_at'))}</th><th scope="col">${escapeHtml(_('activity.app_name'))}</th>
                        <th scope="col">${escapeHtml(_('activity.window_title'))}</th><th scope="col">${escapeHtml(_('activity.duration'))}</th></tr></thead>
                    <tbody>${sesRows.map((s) => `<tr>
                        <td class="activity-num">${escapeHtml(formatDate(s.started_at || s.session_start))}</td>
                        <td>${escapeHtml(s.app_name || '—')}<span class="cell-sub">${escapeHtml(categoryLabel(s.category))}</span></td>
                        <td class="activity-window">${escapeHtml(s.window_title || '—')}</td>
                        <td class="activity-num">${escapeHtml(formatDuration(s.duration_secs ?? s.duration_seconds))}</td></tr>`).join('')}</tbody></table></div>`;
        } catch (err) {
            if (!document.body.contains(appsList)) return;
            appsList.innerHTML = `<p class="state is-error">${escapeHtml(_('activity.detail_failed'))}</p>`;
            sessionsList.innerHTML = '';
        }
    }

    // ---- Events ----
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(filterAndRender, 150);
    });
    [dateFrom, dateTo].forEach((input) => input.addEventListener('change', () => { markPreset(null); loadActivity(); }));
    presets.forEach((b) => b.addEventListener('click', () => applyPreset(b.dataset.days)));
    refreshBtn.addEventListener('click', loadActivity);
    activityBody.addEventListener('click', (e) => {
        const btn = e.target.closest('.detail-btn');
        if (btn) showDetail(btn.dataset.id, btn.dataset.name);
    });

    // ---- Init ----
    loadActivity();
})();
