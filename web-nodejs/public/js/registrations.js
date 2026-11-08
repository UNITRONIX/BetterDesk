/**
 * BetterDesk Console - Enrollment requests
 *
 * Two queues end up here:
 * - RustDesk clients that asked to join while enrollment needed approval
 *   (Go server: /api/enrollment/pending and /api/enrollment/history)
 * - BetterDesk clients that found the server on the local network and ask
 *   for its settings (console: /api/registrations)
 * Each row says which queue it came from. A device has one row per queue.
 */

(function () {
    'use strict';

    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params || {}) : key);
    const csrfToken = window.BetterDesk?.csrfToken || '';
    const can = (p) => (window.Utils && typeof Utils.can === 'function' ? Utils.can(p) : true);
    const esc = (s) => Utils.escapeHtml(String(s == null ? '' : s));

    const SOURCE_REGISTRATION = 'registration'; // local network (console queue)
    const SOURCE_ENROLLMENT = 'enrollment';     // RustDesk client (Go queue)

    // ---- State ----
    let currentStatus = 'pending';
    let currentSearch = '';
    let rows = [];
    let goPendingCount = 0;
    let loadFailed = false;
    let loading = false;
    let reloadQueued = false;
    // Rows decided on this page stay visible with their new status until the
    // filter changes, so the operator sees what happened and can open the device.
    const decided = new Map();

    let enrollmentUi = { mode: 'managed', rich_approve: true, tag_picker: true };
    let modeKnown = false;
    let folders = null;
    let groups = null;
    let tags = null;

    // ---- DOM ----
    const tbody = document.getElementById('registrations-body');
    const searchInput = document.getElementById('search-input');
    const countLine = document.getElementById('registrations-count');
    const filterButtons = document.querySelectorAll('.registrations-page .filter-btn');
    const modeNotice = document.getElementById('enrollment-mode-banner');
    const modeNoticeText = document.getElementById('enrollment-mode-banner-text');
    const modeLink = document.getElementById('enrollment-mode-link');
    const modeSection = document.getElementById('reg-mode');
    const modeCurrent = document.getElementById('reg-mode-current');
    const sourcesSection = document.getElementById('reg-sources');
    const sourcesList = document.getElementById('reg-sources-list');

    // ---- API ----

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        let resp;
        try {
            resp = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
        } catch (_) {
            return { success: false, network: true };
        }
        let data = {};
        try { data = await resp.json(); } catch (_) { data = {}; }
        if (!resp.ok && data.success === undefined) data.success = false;
        if (resp.status === 403) data.forbidden = true;
        return data;
    }

    function failureText(result, fallbackKey) {
        if (result && result.forbidden) return Utils.permissionDeniedMessage();
        if (result && result.network) return _('registrations.error_network');
        if (result && result.error) console.warn('[registrations]', result.error);
        return _(fallbackKey);
    }

    // ---- Normalising the queues into one row shape ----

    function fromRegistration(item) {
        return {
            key: `${SOURCE_REGISTRATION}:${item.id}`,
            source: SOURCE_REGISTRATION,
            rowId: String(item.id),
            device_id: item.device_id || '',
            hostname: item.hostname || '',
            platform: item.platform || '',
            version: item.version || '',
            ip: item.ip_address || item.ip || '',
            status: item.status || 'pending',
            asked_at: item.created_at || '',
            decided_at: item.approved_at || (item.status === 'rejected' ? item.updated_at : '') || '',
            decided_by: item.approved_by || '',
            reason: item.rejected_reason || '',
        };
    }

    function fromEnrollmentPending(item) {
        return {
            key: `${SOURCE_ENROLLMENT}:${item.device_id}`,
            source: SOURCE_ENROLLMENT,
            rowId: String(item.device_id || ''),
            device_id: item.device_id || '',
            hostname: item.hostname || '',
            platform: item.platform || '',
            version: item.version || '',
            ip: item.ip || item.ip_address || '',
            status: 'pending',
            asked_at: item.created_at || '',
            decided_at: '',
            decided_by: '',
            reason: '',
        };
    }

    function fromEnrollmentHistory(item) {
        const status = item.status === 'approved' ? 'approved' : 'rejected';
        return {
            key: `${SOURCE_ENROLLMENT}:${item.device_id}`,
            source: SOURCE_ENROLLMENT,
            rowId: String(item.device_id || ''),
            device_id: item.device_id || '',
            hostname: item.hostname || '',
            platform: item.platform || '',
            version: item.version || '',
            ip: item.ip || item.ip_address || '',
            status,
            asked_at: item.created_at || '',
            decided_at: item.decided_at || '',
            // The Go server records the console's API key, not the person
            decided_by: /^apikey:/.test(item.actor || '') ? '' : (item.actor || ''),
            reason: '',
            banned: !!item.banned,
        };
    }

    function time(row) {
        const d = Utils.parseDate(row.status === 'pending' ? row.asked_at : (row.decided_at || row.asked_at));
        return d ? d.getTime() : 0;
    }

    // One row per device and queue. The Go server keeps a device in its
    // history after a decision and can list it as pending again when it asks
    // again; the open request wins, otherwise the latest decision.
    function mergeRows(list) {
        const byKey = new Map();
        for (const row of list) {
            const prev = byKey.get(row.key);
            if (!prev) { byKey.set(row.key, row); continue; }
            if (prev.status === 'pending') continue;
            if (row.status === 'pending' || time(row) > time(prev)) byKey.set(row.key, row);
        }
        return [...byKey.values()];
    }

    // ---- Load ----

    async function loadRegistrations() {
        if (loading) { reloadQueued = true; return; }
        loading = true;
        if (!rows.length) renderState(_('registrations.loading'));
        try {
            const [lan, pending, history] = await Promise.all([
                apiFetch('/api/registrations'),
                apiFetch('/api/enrollment/pending'),
                apiFetch('/api/enrollment/history'),
            ]);
            if (!lan.success && !pending.success) {
                loadFailed = true;
                rows = [];
                goPendingCount = 0;
                renderState(failureText(lan.forbidden ? lan : pending, 'registrations.load_failed'), true);
                renderCount();
                return;
            }
            loadFailed = false;
            const list = [];
            if (lan.success) list.push(...(lan.data || []).map(fromRegistration));
            if (pending.success) list.push(...(pending.data || []).map(fromEnrollmentPending));
            if (history.success) list.push(...(history.data || []).map(fromEnrollmentHistory));
            rows = mergeRows(list);
            goPendingCount = rows.filter(r => r.source === SOURCE_ENROLLMENT && r.status === 'pending').length;
            render();
            updateModeNotice();
        } finally {
            loading = false;
            if (reloadQueued) { reloadQueued = false; loadRegistrations(); }
        }
    }

    async function loadEnrollmentUiSettings() {
        const result = await apiFetch('/api/registrations/enrollment-ui');
        if (result.success && result.data) {
            enrollmentUi = { ...enrollmentUi, ...result.data };
            modeKnown = true;
        }
        updateModeNotice();
    }

    // Keep the sidebar count in step after a decision (app.js polls it too)
    async function refreshSidebarCount() {
        const result = await apiFetch('/api/registrations/count');
        if (!result.success) return;
        const count = Math.max(0, Number(result.count) || 0);
        const badge = document.getElementById('reg-sidebar-badge');
        if (badge) {
            badge.textContent = String(count);
            badge.style.display = count > 0 ? '' : 'none';
        }
    }

    // ---- Render ----

    function matchesSearch(row) {
        if (!currentSearch) return true;
        const needle = currentSearch.toLowerCase();
        return [row.device_id, row.hostname, row.ip, row.platform, row.version]
            .some(v => String(v || '').toLowerCase().includes(needle));
    }

    function visibleRows() {
        const shown = new Map();
        for (const row of rows) {
            const d = decided.get(row.key);
            shown.set(row.key, d ? { ...row, ...d } : row);
        }
        // A decided row can drop out of the queue the server returns; keep it
        for (const [key, d] of decided) {
            if (!shown.has(key) && d.row) shown.set(key, { ...d.row, ...d });
        }
        return [...shown.values()]
            .filter(r => !currentStatus || r.status === currentStatus || (decided.has(r.key) && currentStatus === 'pending'))
            .filter(matchesSearch)
            .sort((a, b) => {
                const ap = a.status === 'pending' ? 0 : 1;
                const bp = b.status === 'pending' ? 0 : 1;
                if (ap !== bp) return ap - bp;
                return time(b) - time(a);
            });
    }

    function renderState(text, isError) {
        tbody.innerHTML = `<tr><td colspan="7" class="state-cell${isError ? ' is-error' : ''}">${esc(text)}${isError
            ? ` <button type="button" class="btn btn-sm" data-reg-action="retry">${esc(_('actions.retry'))}</button>` : ''}</td></tr>`;
    }

    function relative(value) {
        return Utils.formatRelativeTime(value, { empty: _('common.not_available') });
    }

    function sourceLabel(row) {
        return row.source === SOURCE_ENROLLMENT ? _('registrations.source_rustdesk') : _('registrations.source_lan');
    }

    function statusHtml(row) {
        const label = _(`registrations.status_${row.status}`);
        const cls = row.status === 'approved' ? 'ok' : (row.status === 'rejected' ? 'offline' : 'pending');
        let sub = '';
        if (row.status !== 'pending') {
            const when = row.decided_at ? Utils.formatDate(row.decided_at, { empty: '' }) : '';
            const by = row.decided_by || '';
            if (by && when) sub = _('registrations.decided_by_on', { name: by, date: when });
            else if (by) sub = _('registrations.decided_by', { name: by });
            else if (when) sub = when;
            if (row.banned) sub = sub ? `${sub}, ${_('registrations.also_banned')}` : _('registrations.also_banned');
        }
        return `<span class="status ${cls}">${esc(label)}</span>${sub ? `<span class="cell-sub">${esc(sub)}</span>` : ''}`;
    }

    function menuHtml(row, menuId, items, nameId) {
        if (!items.length) return '';
        return `<span class="menu-anchor">
            <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                aria-controls="${menuId}" aria-label="${esc(_('common.actions'))}" aria-describedby="${nameId}">
                <span class="material-icons" aria-hidden="true">more_vert</span></button>
            <span class="menu menu-end" id="${menuId}" role="menu">${items.join('')}</span>
        </span>`;
    }

    function actionAttrs(row, action) {
        return `data-reg-action="${action}" data-key="${esc(row.key)}"`;
    }

    function actionsHtml(row, index) {
        const menuItems = [];
        let inline = '';
        const isLan = row.source === SOURCE_REGISTRATION;
        const nameId = `reg-name-${index}`;
        const named = `aria-describedby="${nameId}"`;

        if (row.status === 'pending' && !decided.has(row.key)) {
            inline = `<button type="button" class="btn btn-sm" ${actionAttrs(row, 'approve')} ${named}>${Utils.icon('approve')}<span>${esc(_('registrations.approve_btn'))}</span></button>
                <button type="button" class="btn btn-sm btn-danger-quiet desktop-only" ${actionAttrs(row, 'reject')} ${named}>${Utils.icon('reject')}<span>${esc(_('registrations.reject_btn'))}</span></button>`;
            menuItems.push(`<button type="button" class="menu-item danger phone-only" role="menuitem" ${actionAttrs(row, 'reject')}>${Utils.icon('reject')}<span>${esc(_('registrations.reject_btn'))}…</span></button>`);
        } else if (row.status === 'approved') {
            inline = `<a class="btn btn-sm btn-ghost" href="/devices?search=${encodeURIComponent(row.device_id)}" ${named}>${esc(_('registrations.open_device'))}</a>`;
        } else if (row.status === 'rejected' && row.source === SOURCE_ENROLLMENT && !decided.has(row.key)) {
            inline = `<button type="button" class="btn btn-sm" ${actionAttrs(row, 'clear-rejection')} ${named}>${esc(_('registrations.allow_again'))}</button>`;
        }

        menuItems.push(`<button type="button" class="menu-item" role="menuitem" ${actionAttrs(row, 'copy')}>${Utils.icon('copy')}<span>${esc(_('registrations.copy_id'))}</span></button>`);
        if (isLan && row.status !== 'pending' && can('enrollment.manage')) {
            menuItems.push('<span class="menu-divider" role="separator"></span>');
            menuItems.push(`<button type="button" class="menu-item danger" role="menuitem" ${actionAttrs(row, 'remove')}>${Utils.icon('delete')}<span>${esc(_('registrations.delete_record'))}</span></button>`);
        }
        return `${inline}${menuHtml(row, `reg-menu-${index}`, menuItems, nameId)}`;
    }

    function rowHtml(row, index, total) {
        const name = row.hostname
            ? `<span class="row-name" id="reg-name-${index}">${esc(row.hostname)}</span>`
            : `<span class="row-name is-missing" id="reg-name-${index}">${esc(_('registrations.no_name'))}<span class="sr-only"> ${esc(row.device_id)}</span></span>`;
        const askedFull = Utils.formatDate(row.asked_at, { empty: '' });
        const age = relative(row.asked_at);
        const platform = row.platform || _('common.not_available');
        const phoneMeta = [platform, age].filter(Boolean).map(esc).join(' · ');
        const upClass = total > 3 && index >= total - 2 ? ' menu-near-end' : '';
        return `<tr data-key="${esc(row.key)}" data-source="${esc(row.source)}" data-id="${esc(row.rowId)}" class="is-${esc(row.status)}${upClass}">
            <td class="col-device">${name}<span class="cell-sub"><span class="mono">${esc(row.device_id)}</span><span class="phone-only"> · ${phoneMeta}</span></span></td>
            <td class="col-platform"><span class="platform-name">${Utils.getPlatformIconHtml(row.platform)}${esc(platform)}</span>${row.version
                ? `<span class="cell-sub">${esc(_('registrations.client_version', { version: row.version }))}</span>` : ''}</td>
            <td class="col-ip"><span class="mono">${esc(row.ip || _('common.not_available'))}</span></td>
            <td class="col-source">${esc(sourceLabel(row))}</td>
            <td class="col-requested"${askedFull ? ` title="${esc(askedFull)}"` : ''}>${esc(age)}</td>
            <td class="col-status">${statusHtml(row)}</td>
            <td class="actions">${actionsHtml(row, index)}</td>
        </tr>`;
    }

    function emptyText() {
        if (currentSearch) return _('registrations.empty_search');
        if (currentStatus === 'pending') return _('registrations.empty_pending');
        if (currentStatus === 'approved') return _('registrations.empty_approved');
        if (currentStatus === 'rejected') return _('registrations.empty_rejected');
        return _('registrations.empty_all');
    }

    function render() {
        if (loadFailed) return;
        const list = visibleRows();
        if (!list.length) {
            renderState(emptyText());
        } else {
            tbody.innerHTML = list.map((row, i) => rowHtml(row, i, list.length)).join('');
            tbody.querySelectorAll('tr.menu-near-end .menu').forEach(m => m.classList.add('menu-up'));
        }
        renderCount(list.length);
    }

    function renderCount(shown) {
        const waiting = rows.filter(r => r.status === 'pending' && !decided.has(r.key));
        let text;
        if (loadFailed) {
            text = '';
        } else if (!waiting.length) {
            text = _('registrations.count_none');
        } else {
            const oldest = waiting.reduce((a, b) => (time(a) <= time(b) ? a : b));
            const age = relative(oldest.asked_at);
            text = waiting.length === 1
                ? _('registrations.count_one', { age })
                : _('registrations.count_many', { count: waiting.length, age });
        }
        if (!loadFailed && (currentSearch || currentStatus !== 'pending') && typeof shown === 'number') {
            text += ' ' + _('registrations.count_shown', { count: shown });
        }
        countLine.textContent = text;
        renderSources();
    }

    // Side column: the current enrollment mode in words, and what it means
    // for the RustDesk requests in the list
    function updateModeNotice() {
        if (!modeNotice) return;
        const mode = ['open', 'managed', 'locked'].includes(enrollmentUi.mode) ? enrollmentUi.mode : 'managed';
        const canChange = can('server.config');
        if (modeSection && modeCurrent && modeKnown) {
            modeCurrent.textContent = '';
            const name = document.createElement('strong');
            name.textContent = _(`tokens.mode_${mode}`);
            modeCurrent.appendChild(name);
            modeCurrent.appendChild(document.createTextNode('. ' + _(`tokens.mode_${mode}_desc`)));
            modeSection.hidden = false;
        }
        if (modeLink) modeLink.hidden = !canChange;
        if (mode === 'managed' || goPendingCount === 0) {
            modeNotice.hidden = true;
            return;
        }
        const key = mode === 'locked' ? 'registrations.mode_locked_pending' : 'registrations.mode_open_pending';
        let text = _(key, { count: goPendingCount });
        if (!canChange) text += ' ' + _('registrations.mode_admin_only');
        modeNoticeText.textContent = text;
        modeNotice.hidden = false;
    }

    // Side column: waiting requests by the way they came in. The enrollment
    // mode applies to RustDesk clients only, so the split helps to read it.
    function renderSources() {
        if (!sourcesSection || !sourcesList) return;
        const waiting = rows.filter(r => r.status === 'pending' && !decided.has(r.key));
        if (loadFailed || !waiting.length) {
            sourcesSection.hidden = true;
            return;
        }
        const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);
        const parts = [
            { label: _('registrations.source_rustdesk'), n: waiting.filter(r => r.source === SOURCE_ENROLLMENT).length },
            { label: _('registrations.source_lan'), n: waiting.filter(r => r.source === SOURCE_REGISTRATION).length },
        ];
        sourcesList.textContent = '';
        parts.forEach((p) => {
            const dt = document.createElement('dt');
            dt.textContent = p.label;
            const dd = document.createElement('dd');
            dd.className = 'num';
            dd.textContent = fmt.format(p.n);
            sourcesList.appendChild(dt);
            sourcesList.appendChild(dd);
        });
        sourcesSection.hidden = false;
    }

    // ---- Approve dialog ----

    function factsHtml(row) {
        const facts = [
            [_('registrations.col_device_id'), `<span class="mono">${esc(row.device_id)}</span>`],
            [_('registrations.col_hostname'), row.hostname ? esc(row.hostname) : `<span class="text-muted">${esc(_('registrations.no_name'))}</span>`],
            [_('registrations.col_platform'), esc([row.platform || _('common.not_available'), row.version ? _('registrations.client_version', { version: row.version }) : ''].filter(Boolean).join(', '))],
            [_('registrations.col_ip'), `<span class="mono">${esc(row.ip || _('common.not_available'))}</span>`],
            [_('registrations.col_asked'), esc([Utils.formatDate(row.asked_at, { empty: _('common.not_available') }), row.asked_at ? `(${relative(row.asked_at)})` : ''].filter(Boolean).join(' '))],
            [_('registrations.col_source'), esc(sourceLabel(row))],
        ];
        return `<dl class="facts approve-facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
    }

    const SYNC_MODES = ['standard', 'silent', 'turbo'];

    function approveFormHtml(row) {
        const isGo = row.source === SOURCE_ENROLLMENT;
        const folderOptions = [`<option value="0">${esc(_('registrations.field_folder_none'))}</option>`]
            .concat((folders || []).map(f => `<option value="${esc(f.id)}">${esc(f.name || f.label || `#${f.id}`)}</option>`))
            .join('');
        const tagsBlock = enrollmentUi.tag_picker
            ? `<fieldset class="form-group approve-choices">
                    <legend class="form-label">${esc(_('registrations.field_tags'))}</legend>
                    <div id="approve-tags-picker" class="approve-check-grid">${tagCheckboxes([])}</div>
                    <div class="input-with-button approve-tag-new">
                        <input type="text" id="approve-tag-new" class="form-input" aria-label="${esc(_('registrations.field_tag_add_placeholder'))}" placeholder="${esc(_('registrations.field_tag_add_placeholder'))}">
                        <button type="button" class="btn" id="approve-tag-add-btn">${Utils.icon('add')}<span>${esc(_('registrations.field_tag_add_btn'))}</span></button>
                    </div>
               </fieldset>`
            : `<div class="form-group">
                    <label class="form-label" for="approve-tags">${esc(_('registrations.field_tags'))}</label>
                    <input type="text" id="approve-tags" class="form-input">
                    <p class="form-hint">${esc(_('registrations.field_tags_hint'))}</p>
               </div>`;
        const groupsBlock = (groups && groups.length)
            ? `<fieldset class="form-group approve-choices">
                    <legend class="form-label">${esc(_('registrations.field_groups'))}</legend>
                    <div id="approve-groups-picker" class="approve-check-grid">${groups.map(g => `
                        <label class="checkbox-row"><input type="checkbox" value="${esc(g.guid)}"><span>${esc(g.name || g.guid)}</span></label>`).join('')}</div>
                    <p class="form-hint">${esc(_('registrations.field_groups_hint'))}</p>
               </fieldset>`
            : '';
        const syncBlock = isGo
            ? `<div class="form-group">
                    <label class="form-label" for="approve-sync-mode">${esc(_('registrations.field_reporting'))}</label>
                    <select id="approve-sync-mode" class="form-select">${SYNC_MODES.map(m => `<option value="${m}">${esc(_(`registrations.reporting_${m}`))}</option>`).join('')}</select>
                    <p class="form-hint" id="approve-sync-hint" aria-live="polite">${esc(_('registrations.reporting_standard_desc'))}</p>
               </div>`
            : '';

        return `${factsHtml(row)}
            <div class="approve-form">
                <div class="form-group">
                    <label class="form-label" for="approve-display-name">${esc(_('registrations.field_name'))}</label>
                    <input type="text" id="approve-display-name" class="form-input" value="${esc(row.hostname)}" maxlength="120">
                    <p class="form-hint">${esc(_('registrations.field_name_hint'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="approve-folder">${esc(_('registrations.field_folder'))}</label>
                    <select id="approve-folder" class="form-select">${folderOptions}</select>
                </div>
                ${tagsBlock}
                ${groupsBlock}
                ${syncBlock}
            </div>
            <p class="form-status" id="approve-status" role="alert"></p>`;
    }

    function tagCheckboxes(selected) {
        const list = tags || [];
        if (!list.length) return `<p class="form-hint">${esc(_('registrations.no_tags_yet'))}</p>`;
        return list.map(tag => `<label class="checkbox-row"><input type="checkbox" value="${esc(tag)}"${selected.includes(tag) ? ' checked' : ''}><span>${esc(tag)}</span></label>`).join('');
    }

    async function ensureApproveData() {
        const jobs = [];
        if (folders === null) {
            jobs.push(apiFetch('/api/folders').then(r => {
                if (r.success) folders = (r.data && r.data.folders) || r.folders || [];
            }));
        }
        if (groups === null) {
            jobs.push(apiFetch('/api/device-groups').then(r => {
                const list = r.success ? ((r.data && r.data.groups) || r.groups || []) : [];
                groups = list.filter(g => (g.source_type || 'manual') !== 'tag');
            }));
        }
        if (enrollmentUi.tag_picker && tags === null) {
            jobs.push(apiFetch('/api/tags').then(r => {
                tags = (r.success && r.data && r.data.tags) ? r.data.tags : (r.tags || []);
            }));
        }
        await Promise.all(jobs);
    }

    async function openApprove(row, opener) {
        if (opener) opener.disabled = true;
        try { await ensureApproveData(); } finally { if (opener) opener.disabled = false; }
        if (opener) opener.focus();

        Modal.show({
            title: _('registrations.approve_title_named', { name: row.hostname || row.device_id }),
            content: approveFormHtml(row),
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('registrations.approve_btn'), class: 'btn-primary', onClick: () => submitApprove(row) },
            ],
        });

        const syncSelect = document.getElementById('approve-sync-mode');
        const syncHint = document.getElementById('approve-sync-hint');
        if (syncSelect && syncHint) {
            syncSelect.addEventListener('change', () => {
                syncHint.textContent = _(`registrations.reporting_${syncSelect.value}_desc`);
            });
        }
        const addBtn = document.getElementById('approve-tag-add-btn');
        const newTag = document.getElementById('approve-tag-new');
        const picker = document.getElementById('approve-tags-picker');
        if (addBtn && newTag && picker) {
            const add = () => {
                const tag = newTag.value.trim();
                if (!tag) return;
                const selected = selectedTags();
                if (!selected.includes(tag)) selected.push(tag);
                if (!tags.includes(tag)) tags.push(tag);
                picker.innerHTML = tagCheckboxes(selected);
                newTag.value = '';
                newTag.focus();
            };
            addBtn.addEventListener('click', add);
            newTag.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); add(); }
            });
        }
        const nameInput = document.getElementById('approve-display-name');
        if (nameInput) {
            nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); submitApprove(row); }
            });
            nameInput.select();
        }
    }

    function selectedTags() {
        const picker = document.getElementById('approve-tags-picker');
        if (picker) return [...picker.querySelectorAll('input:checked')].map(i => i.value);
        const text = document.getElementById('approve-tags');
        return String(text ? text.value : '').split(',').map(t => t.trim()).filter(Boolean);
    }

    async function submitApprove(row) {
        const status = document.getElementById('approve-status');
        const button = document.querySelector('.modal-footer .btn-primary');
        if (button && button.disabled) return;
        const groupsPicker = document.getElementById('approve-groups-picker');
        const payload = {
            display_name: (document.getElementById('approve-display-name')?.value || '').trim(),
            sync_mode: document.getElementById('approve-sync-mode')?.value || 'standard',
            tags: selectedTags().join(', '),
            folder_id: parseInt(document.getElementById('approve-folder')?.value || '0', 10) || 0,
            group_guids: groupsPicker ? [...groupsPicker.querySelectorAll('input:checked')].map(i => i.value) : [],
        };
        if (button) { button.disabled = true; button.textContent = _('registrations.approving'); }
        if (status) status.textContent = '';

        const result = row.source === SOURCE_ENROLLMENT
            ? await apiFetch(`/api/enrollment/approve/${encodeURIComponent(row.rowId)}`, { method: 'POST', body: JSON.stringify(payload) })
            : await apiFetch(`/api/registrations/${encodeURIComponent(row.rowId)}/approve`, { method: 'PUT', body: JSON.stringify(payload) });

        if (!result.success) {
            if (button) { button.disabled = false; button.textContent = _('registrations.approve_btn'); }
            if (status) {
                status.classList.add('is-error');
                status.textContent = failureText(result, 'registrations.approve_failed');
            }
            return;
        }

        Modal.close();
        const name = payload.display_name || row.hostname || row.device_id;
        decided.set(row.key, { status: 'approved', decided_at: new Date().toISOString(), decided_by: currentUserName(), row: { ...row, hostname: payload.display_name || row.hostname } });
        render();
        focusRow(row.key);
        Notifications.success(_('registrations.approved_named', { name }));
        refreshSidebarCount();
    }

    function currentUserName() {
        const user = window.BetterDesk && window.BetterDesk.user;
        return (user && (user.username || user.name)) || '';
    }

    function focusRow(key) {
        const tr = tbody.querySelector(`tr[data-key="${CSS.escape(key)}"]`);
        if (!tr) return;
        const target = tr.querySelector('td.actions a, td.actions button:not([data-menu-button])') || tr.querySelector('[data-menu-button]');
        if (target) target.focus({ preventScroll: false });
    }

    // ---- Reject ----

    function openReject(row) {
        const isGo = row.source === SOURCE_ENROLLMENT;
        const name = row.hostname || row.device_id;
        const content = `<p>${esc(isGo ? _('registrations.reject_text_rustdesk', { name }) : _('registrations.reject_text_lan', { name }))}</p>
            ${isGo
                ? `<label class="check-field approve-ban">
                        <input type="checkbox" id="reject-ban-checkbox">
                        <span class="check-label">${esc(_('registrations.reject_ban_option'))}</span>
                        <span class="form-hint">${esc(_('registrations.reject_ban_hint_plain'))}</span>
                   </label>`
                : `<div class="form-group">
                        <label class="form-label" for="reject-reason">${esc(_('registrations.reject_reason'))}</label>
                        <textarea id="reject-reason" class="form-textarea" rows="3" maxlength="500"></textarea>
                        <p class="form-hint">${esc(_('registrations.reject_reason_hint'))}</p>
                   </div>`}
            <p class="form-status" id="reject-status" role="alert"></p>`;
        Modal.show({
            title: _('registrations.reject_title_named', { name }),
            content,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('registrations.reject_btn'), class: 'btn-danger', onClick: () => submitReject(row) },
            ],
        });
    }

    async function submitReject(row) {
        const button = document.querySelector('.modal-footer .btn-danger');
        const status = document.getElementById('reject-status');
        if (button && button.disabled) return;
        if (button) button.disabled = true;
        const isGo = row.source === SOURCE_ENROLLMENT;
        const ban = !!document.getElementById('reject-ban-checkbox')?.checked;
        const result = isGo
            ? await apiFetch(`/api/enrollment/reject/${encodeURIComponent(row.rowId)}`, { method: 'POST', body: JSON.stringify({ ban }) })
            : await apiFetch(`/api/registrations/${encodeURIComponent(row.rowId)}/reject`, { method: 'PUT', body: JSON.stringify({ reason: document.getElementById('reject-reason')?.value || '' }) });
        if (!result.success) {
            if (button) button.disabled = false;
            if (status) {
                status.classList.add('is-error');
                status.textContent = failureText(result, 'registrations.reject_failed');
            }
            return;
        }
        Modal.close();
        decided.set(row.key, { status: 'rejected', decided_at: new Date().toISOString(), decided_by: currentUserName(), banned: ban, row });
        render();
        focusRow(row.key);
        Notifications.success(_('registrations.rejected_named', { name: row.hostname || row.device_id }));
        refreshSidebarCount();
    }

    // ---- Other row actions ----

    async function clearRejection(row) {
        const ok = await Modal.confirm({
            title: _('registrations.allow_again_title'),
            message: _('registrations.allow_again_text', { name: row.hostname || row.device_id }),
            confirmLabel: _('registrations.allow_again'),
        });
        if (!ok) return;
        const result = await apiFetch(`/api/enrollment/clear-rejection/${encodeURIComponent(row.rowId)}`, { method: 'POST', body: '{}' });
        if (!result.success) {
            Notifications.error(failureText(result, 'registrations.allow_again_failed'));
            return;
        }
        Notifications.success(_('registrations.allow_again_done', { name: row.hostname || row.device_id }));
        loadRegistrations();
    }

    async function removeRecord(row) {
        const ok = await Modal.confirm({
            title: _('registrations.delete_record_title'),
            message: _('registrations.delete_record_text', { name: row.hostname || row.device_id }),
            confirmLabel: _('registrations.delete_record'),
            danger: true,
        });
        if (!ok) return;
        const result = await apiFetch(`/api/registrations/${encodeURIComponent(row.rowId)}`, { method: 'DELETE' });
        if (!result.success) {
            Notifications.error(failureText(result, 'registrations.delete_failed'));
            return;
        }
        decided.delete(row.key);
        Notifications.success(_('registrations.deleted_success'));
        loadRegistrations();
    }

    async function copyId(row) {
        try {
            await Utils.copyToClipboard(row.device_id);
            Notifications.success(_('registrations.id_copied', { id: row.device_id }));
        } catch (_e) {
            Notifications.error(_('registrations.copy_failed'));
        }
    }

    function findRow(key) {
        const d = decided.get(key);
        const row = rows.find(r => r.key === key) || (d && d.row);
        return row ? { ...row, ...(d ? { status: d.status } : {}) } : null;
    }

    tbody.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-reg-action]');
        if (!btn) return;
        const action = btn.dataset.regAction;
        if (action === 'retry') { loadRegistrations(); return; }
        const row = findRow(btn.dataset.key);
        if (!row) return;
        switch (action) {
            case 'approve': openApprove(row, btn); break;
            case 'reject': openReject(row); break;
            case 'clear-rejection': clearRejection(row); break;
            case 'remove': removeRecord(row); break;
            case 'copy': copyId(row); break;
        }
    });

    // ---- Toolbar ----

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            currentStatus = btn.dataset.status || '';
            decided.clear();
            render();
        });
    });

    let searchTimer;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            render();
        }, 200);
    });

    // ---- Init ----

    loadEnrollmentUiSettings().then(loadRegistrations);

    // app.js owns the shared panel-event connection and dispatches this event
    // when a request arrives or is decided elsewhere.
    window.addEventListener('registrations:pending-changed', () => {
        loadRegistrations();
    });
})();
