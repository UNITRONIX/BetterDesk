/**
 * BetterDesk Console - Tickets Page Script
 *
 * The list is a table with a toolbar (search, status, priority). A ticket
 * opens in a dialog with its facts, status actions and comments; create
 * and edit use a second dialog. Dialogs come from Modal (modal.js).
 */

(function () {
    'use strict';

    const _ = window.BetterDesk?.translations
        ? (key) => {
            const keys = key.split('.');
            let val = window.BetterDesk.translations;
            for (const k of keys) { val = val?.[k]; }
            return val || key;
        }
        : (key) => key;

    const csrfToken = window.BetterDesk?.csrfToken || '';
    const user = window.BetterDesk?.user || {};
    // Viewers only read and comment; the server refuses the rest.
    const canEdit = user.role !== 'viewer';

    // State
    let currentStatus = '';
    let currentPriority = '';
    let currentSearch = '';
    let stats = null;
    let lastTickets = [];
    let allTickets = [];
    let detailModalId = null;
    let loadSeq = 0;

    // DOM refs
    const tbody = document.getElementById('tickets-body');
    const countLine = document.getElementById('tickets-count');
    const searchInput = document.getElementById('search-input');
    const priorityFilter = document.getElementById('priority-filter');
    const filterButtons = document.querySelectorAll('.filter-btn');
    const createBtn = document.getElementById('create-ticket-btn');

    // ---- API ----

    async function apiFetch(url, options = {}) {
        const headers = { 'Content-Type': 'application/json' };
        if (csrfToken) headers['x-csrf-token'] = csrfToken;
        const resp = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
        let data = {};
        try { data = await resp.json(); } catch (_e) { /* empty body */ }
        if (!resp.ok || data.error) {
            throw new Error(data.error || resp.statusText || String(resp.status));
        }
        return data;
    }

    function fill(template, values) {
        return String(template).replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m));
    }

    // ---- Load ----

    async function loadTickets() {
        const seq = ++loadSeq;
        tbody.innerHTML = `<tr><td colspan="9" class="state-cell">${escapeHtml(_('tickets.loading'))}</td></tr>`;

        const params = new URLSearchParams();
        if (currentStatus) params.set('status', currentStatus);
        if (currentPriority) params.set('priority', currentPriority);
        if (currentSearch) params.set('search', currentSearch);

        try {
            const result = await apiFetch(`/api/tickets?${params}`);
            if (seq !== loadSeq) return;
            lastTickets = result.tickets || [];
            renderTable(lastTickets);
        } catch (err) {
            if (seq !== loadSeq) return;
            lastTickets = [];
            tbody.innerHTML = `<tr><td colspan="9" class="state-cell is-error">
                <span class="state is-error">${escapeHtml(_('tickets.load_failed'))} ${escapeHtml(err.message)}
                <button type="button" class="btn btn-sm" data-retry>${escapeHtml(_('actions.retry'))}</button></span></td></tr>`;
        }
        renderCount();
    }

    // Every ticket the user can see, unfiltered, for the side column and
    // the totals in the count line. Viewers get the ones assigned to them.
    async function loadStats() {
        try {
            const result = await apiFetch('/api/tickets');
            allTickets = result.tickets || [];
            stats = { total: allTickets.length };
        } catch (_e) {
            allTickets = null;
            stats = null;
        }
        renderCount();
        renderSummary();
    }

    function isFiltered() {
        return !!(currentStatus || currentPriority || currentSearch);
    }

    function isOverdue(t) {
        return !!t.sla_due_at && parseDate(t.sla_due_at) < new Date()
            && t.status !== 'closed' && t.status !== 'resolved';
    }

    // The count line: how many there are, or how many of them match the
    // filter. The split by status is in the side column.
    function renderCount() {
        if (!countLine) return;
        const num = (n) => `<strong>${Number(n) || 0}</strong>`;
        if (!stats) {
            countLine.innerHTML = lastTickets.length
                ? escapeHtml(fill(_('tickets.count_shown'), { shown: lastTickets.length }))
                : '';
            return;
        }
        if (isFiltered()) {
            countLine.innerHTML = fill(escapeHtml(_('tickets.count_filtered')), {
                shown: num(lastTickets.length), total: Number(stats.total) || 0,
            });
        } else {
            countLine.innerHTML = fill(escapeHtml(_('tickets.count_total')), { total: num(stats.total) });
        }
    }

    // ---- Side column ----

    const STATUS_PARTS = [
        { status: 'open', cls: 'is-warning' },
        { status: 'in_progress', cls: 'is-progress' },
        { status: 'resolved', cls: 'is-ok' },
        { status: 'closed', cls: 'is-muted' },
    ];
    const PRIORITIES = ['critical', 'high', 'medium', 'low'];

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    }

    function renderSummary() {
        const shareBar = document.getElementById('tickets-share-bar');
        const shareLegend = document.getElementById('tickets-share-legend');
        const prioList = document.getElementById('tickets-open-priority');
        const prioSection = document.getElementById('tickets-priority-section');
        const overdueList = document.getElementById('tickets-overdue-list');
        if (!shareBar || !shareLegend || !prioList || !overdueList) return;
        const fmt = new Intl.NumberFormat((window.BetterDesk && window.BetterDesk.lang) || undefined);

        shareBar.textContent = '';
        shareLegend.textContent = '';
        prioList.textContent = '';
        overdueList.textContent = '';
        if (!allTickets) {
            shareBar.hidden = true;
            shareLegend.appendChild(el('li', null, _('tickets.summary_failed')));
            if (prioSection) prioSection.hidden = true;
            overdueList.appendChild(el('li', 'list-row is-empty', _('tickets.summary_failed')));
            return;
        }

        // By status: one whole, each part filters the table
        STATUS_PARTS.forEach((p) => {
            const n = allTickets.filter(t => t.status === p.status).length;
            if (n > 0) {
                const seg = el('span', p.cls);
                seg.style.flexGrow = String(n);
                shareBar.appendChild(seg);
            }
            const li = el('li');
            const key = el('span', 'key ' + p.cls);
            key.setAttribute('aria-hidden', 'true');
            const btn = el('button', 'btn-link tickets-share-filter');
            btn.type = 'button';
            btn.dataset.shareStatus = p.status;
            btn.appendChild(el('strong', null, fmt.format(n)));
            btn.appendChild(document.createTextNode(' ' + _(`tickets.share_${p.status}`)));
            li.appendChild(key);
            li.appendChild(btn);
            shareLegend.appendChild(li);
        });
        shareBar.hidden = allTickets.length === 0;

        // Open and in-progress tickets by priority
        const active = allTickets.filter(t => t.status === 'open' || t.status === 'in_progress');
        if (prioSection) prioSection.hidden = active.length === 0;
        PRIORITIES.forEach((pr) => {
            prioList.appendChild(el('dt', null, _(`tickets.priority_${pr}`)));
            prioList.appendChild(el('dd', 'num', fmt.format(active.filter(t => t.priority === pr).length)));
        });

        // Overdue: past the due time and not resolved or closed, most overdue first
        const overdue = allTickets.filter(isOverdue)
            .sort((a, b) => parseDate(a.sla_due_at) - parseDate(b.sla_due_at));
        if (!overdue.length) {
            overdueList.appendChild(el('li', 'list-row is-empty', _('tickets.overdue_none')));
            return;
        }
        overdue.forEach((t) => {
            const li = el('li');
            const btn = el('button', 'list-row tickets-overdue-row');
            btn.type = 'button';
            btn.dataset.id = String(Number(t.id));
            const main = el('span', 'row-main');
            main.appendChild(el('span', 'row-title', t.title));
            main.appendChild(el('span', 'row-sub', fill(_('tickets.overdue_row'), {
                id: Number(t.id),
                priority: _(`tickets.priority_${String(t.priority || '').replace(/[^a-z_]/g, '')}`),
                time: Utils.formatRelativeTime(t.sla_due_at),
            })));
            btn.appendChild(main);
            const chev = el('span', 'material-icons row-chevron', 'chevron_right');
            chev.setAttribute('aria-hidden', 'true');
            btn.appendChild(chev);
            li.appendChild(btn);
            overdueList.appendChild(li);
        });
    }

    // ---- Render ----

    // Values use the shared data display (utils.js): status tones, tags, names, times
    function statusHtml(status) {
        const safe = String(status || '').replace(/[^a-z_]/g, '');
        return Utils.statusHtml(safe, _(`tickets.status_${safe}`));
    }

    // Priority is a severity: critical and high danger, medium warning, low neutral
    function priorityHtml(priority) {
        const safe = String(priority || '').replace(/[^a-z_]/g, '');
        return Utils.statusHtml(safe, _(`tickets.priority_${safe}`));
    }

    function categoryHtml(category) {
        return category ? Utils.tagHtml(categoryText(category)) : Utils.emptyHtml();
    }

    function categoryText(category) {
        if (!category) return '';
        const safe = String(category).replace(/[^a-z_]/g, '');
        const label = _(`tickets.category_${safe}`);
        return label === `tickets.category_${safe}` ? category : label;
    }

    function assigneeHtml(name, avatar) {
        return name
            ? Utils.userHtml(name, { avatar: !!avatar })
            : Utils.emptyHtml(_('tickets.unassigned'));
    }

    // A device opens the shared device panel (deviceDetail.js) when the role may view devices
    function deviceHtml(deviceId) {
        const canOpen = window.DeviceDetail && (!(window.Utils && typeof Utils.can === 'function') || Utils.can('device.view'));
        return canOpen
            ? `<button type="button" class="btn-link mono" data-open-device="${escapeHtml(deviceId)}">${escapeHtml(deviceId)}</button>`
            : `<span class="mono">${escapeHtml(deviceId)}</span>`;
    }

    // Recent: "5h ago"; older than a week: the date without the time, so the column stays narrow
    function createdHtml(value) {
        const d = Utils.parseDate(value);
        const old = d && Date.now() - d.getTime() > 7 * 86400000;
        return Utils.timeHtml(value, old ? { relative: false, format: { hour: undefined, minute: undefined } } : {});
    }

    function renderTable(tickets) {
        if (!tickets.length) {
            let msg = _('tickets.empty');
            if (isFiltered()) msg = _('tickets.empty_filtered');
            else if (!canEdit) msg = _('tickets.empty_viewer');
            tbody.innerHTML = `<tr><td colspan="9" class="state-cell">${escapeHtml(msg)}</td></tr>`;
            return;
        }

        tbody.innerHTML = tickets.map((t, i) => {
            const id = Number(t.id);
            const overdue = isOverdue(t);
            const menuId = `ticket-menu-${id}`;
            const up = tickets.length > 3 && i >= tickets.length - 2 ? ' menu-up' : '';
            const menu = canEdit ? `
                <span class="menu-anchor">
                    <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                        aria-controls="${menuId}" aria-label="${escapeHtml(fill(_('tickets.actions_for'), { id }))}">
                        <span class="material-icons" aria-hidden="true">more_vert</span>
                    </button>
                    <span class="menu menu-end${up}" id="${menuId}" role="menu">
                        <button type="button" class="menu-item edit-btn" role="menuitem" data-id="${id}">${Utils.icon('edit')}<span>${escapeHtml(_('actions.edit'))}</span></button>
                        <span class="menu-divider"></span>
                        <button type="button" class="menu-item danger delete-btn" role="menuitem" data-id="${id}">${Utils.icon('delete')}<span>${escapeHtml(_('actions.delete'))}</span></button>
                    </span>
                </span>` : '';

            return `<tr data-id="${id}">
                <td class="col-id">${id}</td>
                <td class="col-title">
                    <button type="button" class="btn-link ticket-link" data-id="${id}">${escapeHtml(t.title)}</button>
                    ${overdue ? `<span class="cell-sub sla-overdue">${escapeHtml(_('tickets.sla_overdue'))}</span>` : ''}
                    <span class="cell-sub ticket-meta-narrow">${priorityHtml(t.priority)}, ${assigneeHtml(t.assigned_to)}</span>
                </td>
                <td>${statusHtml(t.status)}</td>
                <td class="col-priority">${priorityHtml(t.priority)}</td>
                <td class="col-category">${categoryHtml(t.category)}</td>
                <td class="col-assignee">${assigneeHtml(t.assigned_to, true)}</td>
                <td class="col-device">${t.device_id ? deviceHtml(t.device_id) : ''}</td>
                <td class="col-created">${createdHtml(t.created_at)}</td>
                <td class="actions">${menu}</td>
            </tr>`;
        }).join('');
    }

    // ---- Detail ----

    function detailBody() {
        if (!detailModalId) return null;
        const overlay = document.getElementById(detailModalId);
        return overlay ? overlay.querySelector('.modal-body') : null;
    }

    function openDetail(id) {
        const ticket = lastTickets.find(t => String(t.id) === String(id)) || (allTickets || []).find(t => String(t.id) === String(id));
        const title = ticket ? `#${ticket.id} ${ticket.title}` : `#${id}`;
        const buttons = [];
        if (canEdit) {
            buttons.push({
                label: _('tickets.delete'),
                class: 'btn-danger-quiet',
                onClick: async () => { if (!(await deleteTicket(id))) openDetail(id); },
            });
            buttons.push({ label: _('tickets.edit'), class: '', onClick: () => openEdit(id) });
        }
        buttons.push({ label: _('actions.close'), class: '', onClick: () => Modal.close() });

        detailModalId = Modal.show({
            title,
            size: 'large',
            content: `<p class="state">${escapeHtml(_('common.loading'))}</p>`,
            buttons,
            onClose: () => { detailModalId = null; },
        });
        refreshDetail(id);
    }

    async function refreshDetail(id, afterRender) {
        const body = detailBody();
        if (!body) return;
        try {
            const t = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`);
            const target = detailBody();
            if (!target) return;
            const titleEl = document.getElementById(`${detailModalId}-title`);
            if (titleEl) titleEl.textContent = `#${t.id} ${t.title}`;
            target.innerHTML = renderDetail(t);
            if (afterRender) afterRender(target);
        } catch (err) {
            const target = detailBody();
            if (target) {
                target.innerHTML = `<p class="state is-error">${escapeHtml(_('tickets.load_detail_failed'))} ${escapeHtml(err.message)}
                    <button type="button" class="btn btn-sm" data-ticket-detail-action="reload" data-id="${Number(id)}">${escapeHtml(_('actions.retry'))}</button></p>`;
            }
        }
    }

    function renderDetail(t) {
        const id = Number(t.id);
        const overdue = isOverdue(t);
        const due = t.sla_due_at
            ? `${Utils.timeHtml(t.sla_due_at, { relative: false })}${overdue ? ` <span class="sla-overdue">${escapeHtml(_('tickets.sla_overdue'))}</span>` : ''}`
            : '—';

        let html = `
            <dl class="facts ticket-facts">
                <dt>${escapeHtml(_('tickets.status'))}</dt><dd>${statusHtml(t.status)}</dd>
                <dt>${escapeHtml(_('tickets.priority'))}</dt><dd>${priorityHtml(t.priority)}</dd>
                <dt>${escapeHtml(_('tickets.category'))}</dt><dd>${categoryHtml(t.category)}</dd>
                <dt>${escapeHtml(_('tickets.assigned_to'))}</dt><dd>${assigneeHtml(t.assigned_to, true)}</dd>
                <dt>${escapeHtml(_('tickets.device'))}</dt><dd>${t.device_id ? deviceHtml(t.device_id) : '—'}</dd>
                <dt>${escapeHtml(_('tickets.created_by'))}</dt><dd>${Utils.userHtml(t.created_by)}</dd>
                <dt>${escapeHtml(_('tickets.created_at'))}</dt><dd>${Utils.timeHtml(t.created_at, { relative: false })}</dd>
                <dt>${escapeHtml(_('tickets.sla_due'))}</dt><dd>${due}</dd>
            </dl>`;

        // Status and assignment, right under the facts they change
        if (canEdit) {
            const actions = [];
            if (t.status === 'open') {
                actions.push(`<button type="button" class="btn btn-sm" data-ticket-detail-action="change-status" data-id="${id}" data-status="in_progress">${escapeHtml(_('tickets.mark_in_progress'))}</button>`);
            }
            if (t.status === 'open' || t.status === 'in_progress') {
                actions.push(`<button type="button" class="btn btn-sm" data-ticket-detail-action="change-status" data-id="${id}" data-status="resolved">${Utils.icon('resolve')}<span>${escapeHtml(_('tickets.mark_resolved'))}</span></button>`);
            }
            if (t.status !== 'closed') {
                actions.push(`<button type="button" class="btn btn-sm" data-ticket-detail-action="change-status" data-id="${id}" data-status="closed">${escapeHtml(_('tickets.close_ticket'))}</button>`);
            }
            if (t.assigned_to !== user.username && user.username) {
                actions.push(`<button type="button" class="btn btn-sm" data-ticket-detail-action="assign" data-id="${id}">${escapeHtml(_('tickets.assign_to_me'))}</button>`);
            }
            if (t.assigned_to) {
                actions.push(`<button type="button" class="btn btn-sm" data-ticket-detail-action="unassign" data-id="${id}">${escapeHtml(_('tickets.unassign'))}</button>`);
            }
            if (actions.length) {
                html += `<div class="ticket-actions">${actions.join('')}
                    <span class="form-status" data-ticket-status-msg aria-live="polite"></span></div>`;
            }
        }

        if (t.description) {
            html += `<section class="ticket-block">
                <h3>${escapeHtml(_('tickets.description'))}</h3>
                <p class="ticket-description">${escapeHtml(t.description)}</p>
            </section>`;
        }

        if (t.attachments && t.attachments.length) {
            html += `<section class="ticket-block">
                <h3>${escapeHtml(_('tickets.attachments'))}</h3>
                <ul class="list">${t.attachments.map(a => `
                    <li class="list-row"><span class="row-main">
                        <a href="/api/tickets/attachments/${Number(a.id)}">${escapeHtml(a.filename)}</a>
                        <span class="row-sub">${escapeHtml(Utils.formatBytes(a.size_bytes || 0))}${a.uploaded_by ? `, ${escapeHtml(a.uploaded_by)}` : ''}</span>
                    </span></li>`).join('')}
                </ul>
            </section>`;
        }

        // Comments
        const comments = t.comments || [];
        html += `<section class="ticket-block" aria-labelledby="ticket-comments-title">
            <h3 id="ticket-comments-title">${escapeHtml(_('tickets.comments'))}</h3>`;
        if (comments.length) {
            html += `<ul class="list ticket-comments">${comments.map(c => `
                <li class="list-row comment-item${c.is_internal ? ' comment-internal' : ''}">
                    <div class="row-main">
                        <span class="row-sub comment-header">
                            <span class="comment-author">${Utils.userHtml(c.author, { avatar: true })}</span>,
                            <span class="comment-time">${Utils.timeHtml(c.created_at)}</span>${c.is_internal ? `, <span class="comment-internal-label">${escapeHtml(_('tickets.internal_label'))}</span>` : ''}
                        </span>
                        <p class="comment-body">${escapeHtml(c.body)}</p>
                    </div>
                </li>`).join('')}
            </ul>`;
        } else {
            html += `<p class="state">${escapeHtml(_('tickets.no_comments'))}</p>`;
        }
        html += `<div class="add-comment-form">
                <label class="form-label" for="new-comment">${escapeHtml(_('tickets.comment_label'))}</label>
                <textarea class="form-input" id="new-comment" rows="3" maxlength="2000"></textarea>
                ${canEdit ? `<label class="checkbox-row"><input type="checkbox" id="new-comment-internal">
                    <span>${escapeHtml(_('tickets.internal_note'))}</span></label>` : ''}
                <div class="form-actions">
                    <button type="button" class="btn btn-primary" data-ticket-detail-action="add-comment" data-id="${id}">${escapeHtml(_('tickets.add_comment'))}</button>
                    <span class="form-status" data-comment-status aria-live="polite"></span>
                </div>
            </div>
        </section>`;

        return html;
    }

    // ---- Create / Edit ----

    function formHtml() {
        const opt = (value, key) => `<option value="${value}">${escapeHtml(_(key))}</option>`;
        return `<form id="ticket-form" novalidate>
            <input type="hidden" id="ticket-id">
            <div class="form-group">
                <label class="form-label" for="ticket-title">${escapeHtml(_('tickets.ticket_title'))}</label>
                <input type="text" class="form-input" id="ticket-title" required maxlength="200">
            </div>
            <div class="form-group">
                <label class="form-label" for="ticket-desc">${escapeHtml(_('tickets.description'))}</label>
                <textarea class="form-input" id="ticket-desc" rows="4" maxlength="5000"></textarea>
            </div>
            <div class="form-group">
                <label class="form-label" for="ticket-priority">${escapeHtml(_('tickets.priority'))}</label>
                <select class="form-select" id="ticket-priority">
                    ${opt('low', 'tickets.priority_low')}
                    ${opt('medium', 'tickets.priority_medium')}
                    ${opt('high', 'tickets.priority_high')}
                    ${opt('critical', 'tickets.priority_critical')}
                </select>
                <p class="form-hint">${escapeHtml(_('tickets.priority_hint'))}</p>
            </div>
            <div class="form-group">
                <label class="form-label" for="ticket-category">${escapeHtml(_('tickets.category'))}</label>
                <select class="form-select" id="ticket-category">
                    ${opt('general', 'tickets.category_general')}
                    ${opt('hardware', 'tickets.category_hardware')}
                    ${opt('software', 'tickets.category_software')}
                    ${opt('network', 'tickets.category_network')}
                    ${opt('access', 'tickets.category_access')}
                    ${opt('other', 'tickets.category_other')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="ticket-device">${escapeHtml(_('tickets.device'))}</label>
                <input type="text" class="form-input is-medium mono" id="ticket-device" maxlength="64">
                <p class="form-hint" id="ticket-device-hint">${escapeHtml(_('tickets.device_hint'))}</p>
            </div>
            <p class="form-status is-error" id="ticket-form-status" aria-live="polite"></p>
        </form>`;
    }

    function showForm(title, saveLabel) {
        Modal.show({
            title,
            size: 'large',
            content: formHtml(),
            buttons: [
                { label: _('actions.cancel'), class: '', onClick: () => Modal.close() },
                { label: saveLabel, class: 'btn-primary', onClick: saveTicket },
            ],
            onClose: () => { detailModalId = null; },
        });
        const form = document.getElementById('ticket-form');
        if (form) {
            form.addEventListener('submit', (e) => { e.preventDefault(); saveTicket(); });
            const title = document.getElementById('ticket-title');
            title.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); saveTicket(); }
            });
        }
    }

    function openCreateModal() {
        detailModalId = null;
        showForm(_('tickets.create'), _('tickets.save_create'));
        document.getElementById('ticket-priority').value = 'medium';
        document.getElementById('ticket-category').value = 'general';
    }

    async function openEdit(id) {
        detailModalId = null;
        showForm(_('tickets.edit'), _('actions.save'));
        const status = document.getElementById('ticket-form-status');
        try {
            const t = await apiFetch(`/api/tickets/${encodeURIComponent(id)}`);
            if (!document.getElementById('ticket-form')) return;
            document.getElementById('ticket-id').value = t.id;
            document.getElementById('ticket-title').value = t.title || '';
            document.getElementById('ticket-desc').value = t.description || '';
            document.getElementById('ticket-priority').value = t.priority || 'medium';
            document.getElementById('ticket-category').value = t.category || 'general';
            // The server keeps the device a ticket was opened for
            const device = document.getElementById('ticket-device');
            device.value = t.device_id || '';
            device.disabled = true;
            document.getElementById('ticket-device-hint').textContent = _('tickets.device_fixed_hint');
        } catch (err) {
            if (status) status.textContent = `${_('tickets.load_detail_failed')} ${err.message}`;
        }
    }

    let saving = false;
    async function saveTicket() {
        if (saving) return;
        const status = document.getElementById('ticket-form-status');
        const id = document.getElementById('ticket-id').value;
        const body = {
            title: document.getElementById('ticket-title').value.trim(),
            description: document.getElementById('ticket-desc').value.trim(),
            priority: document.getElementById('ticket-priority').value,
            category: document.getElementById('ticket-category').value,
            device_id: id ? undefined : (document.getElementById('ticket-device').value.trim() || undefined),
        };

        if (!body.title) {
            status.textContent = _('tickets.title_required');
            document.getElementById('ticket-title').focus();
            return;
        }

        saving = true;
        status.textContent = '';
        try {
            const url = id ? `/api/tickets/${encodeURIComponent(id)}` : '/api/tickets';
            const method = id ? 'PATCH' : 'POST';
            await apiFetch(url, { method, body: JSON.stringify(body) });
            Modal.close();
            notify(id ? _('tickets.updated_success') : _('tickets.created_success'), 'success');
            loadTickets();
            loadStats();
        } catch (err) {
            status.textContent = err.message;
        } finally {
            saving = false;
        }
    }

    // ---- Actions ----

    async function deleteTicket(id) {
        const ticket = lastTickets.find(t => String(t.id) === String(id));
        const ok = await Modal.confirm({
            title: fill(_('tickets.delete_title'), { id }),
            message: fill(_('tickets.delete_confirm'), { id, title: ticket ? ticket.title : '' }),
            confirmLabel: _('tickets.delete'),
            danger: true,
        });
        if (!ok) return false;

        try {
            await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, { method: 'DELETE' });
            notify(fill(_('tickets.delete_success'), { id }), 'success');
            loadTickets();
            loadStats();
            return true;
        } catch (err) {
            notify(err.message, 'error');
            return false;
        }
    }

    function setDetailMessage(selector, text, isError) {
        const body = detailBody();
        const el = body && body.querySelector(selector);
        if (!el) { if (text) notify(text, isError ? 'error' : 'success'); return; }
        el.textContent = text;
        el.classList.toggle('is-error', !!isError);
        el.classList.toggle('is-ok', !isError && !!text);
    }

    async function patchTicket(id, changes) {
        try {
            await apiFetch(`/api/tickets/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(changes),
            });
            refreshDetail(id, (el) => {
                setDetailMessage('[data-ticket-status-msg]', _('tickets.updated_success'));
                // The pressed button is gone after the re-render; keep focus in the dialog
                const next = el.querySelector('.ticket-actions .btn') || el.querySelector('#new-comment');
                if (next) next.focus();
            });
            loadTickets();
            loadStats();
        } catch (err) {
            setDetailMessage('[data-ticket-status-msg]', err.message, true);
        }
    }

    async function addComment(ticketId) {
        const body = detailBody();
        const textarea = body && body.querySelector('#new-comment');
        if (!textarea) return;
        const text = textarea.value.trim();
        if (!text) {
            setDetailMessage('[data-comment-status]', _('tickets.comment_required'), true);
            textarea.focus();
            return;
        }
        const internal = body.querySelector('#new-comment-internal');

        try {
            await apiFetch(`/api/tickets/${encodeURIComponent(ticketId)}/comments`, {
                method: 'POST',
                body: JSON.stringify({ body: text, is_internal: !!(internal && internal.checked) }),
            });
            refreshDetail(ticketId, (el) => {
                setDetailMessage('[data-comment-status]', _('tickets.comment_added'));
                const area = el.querySelector('#new-comment');
                if (area) area.focus();
            });
        } catch (err) {
            setDetailMessage('[data-comment-status]', err.message, true);
        }
    }

    // ---- Helpers ----

    function escapeHtml(str) {
        if (str === null || str === undefined || str === '') return '';
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // SQLite's datetime('now') gives UTC without a zone ("2026-11-08 17:59:06");
    // read those as UTC instead of local time.
    function parseDate(value) {
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
            return new Date(value.replace(' ', 'T') + 'Z');
        }
        return new Date(value);
    }

    function notify(message, type) {
        if (typeof Notifications !== 'undefined') {
            if (type === 'error') Notifications.error(message);
            else Notifications.success(message);
        }
    }

    // ---- Events ----

    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
            });
            currentStatus = btn.dataset.status;
            loadTickets();
        });
    });

    if (priorityFilter) {
        priorityFilter.addEventListener('change', () => {
            currentPriority = priorityFilter.value;
            loadTickets();
        });
    }

    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            currentSearch = searchInput.value.trim();
            loadTickets();
        }, 300);
    });

    if (createBtn) createBtn.addEventListener('click', openCreateModal);

    const side = document.getElementById('tickets-side');
    if (side) {
        side.addEventListener('click', (e) => {
            const share = e.target.closest('[data-share-status]');
            if (share) {
                const btn = Array.from(filterButtons).find(b => b.dataset.status === share.dataset.shareStatus);
                if (btn) btn.click();
                return;
            }
            const row = e.target.closest('.tickets-overdue-row');
            if (row) openDetail(row.dataset.id);
        });
    }

    tbody.addEventListener('click', (e) => {
        const el = e.target.closest('.ticket-link, .view-btn, .edit-btn, .delete-btn, [data-retry]');
        if (!el) return;
        if (el.matches('[data-retry]')) { loadTickets(); loadStats(); return; }
        const id = el.dataset.id;
        if (el.matches('.edit-btn')) openEdit(id);
        else if (el.matches('.delete-btn')) deleteTicket(id);
        else openDetail(id);
    });

    // A device in the table or the detail dialog: the panel opens above the page, so the dialog closes first
    document.addEventListener('click', (e) => {
        const dev = e.target.closest('[data-open-device]');
        if (!dev || !window.DeviceDetail) return;
        if (dev.closest('.modal-overlay')) Modal.close();
        DeviceDetail.open(dev.dataset.openDevice);
    });

    // Actions inside the detail dialog (it lives in #modal-container)
    document.addEventListener('click', (e) => {
        const actionBtn = e.target.closest('[data-ticket-detail-action]');
        if (!actionBtn) return;
        const id = actionBtn.dataset.id;
        switch (actionBtn.dataset.ticketDetailAction) {
            case 'change-status':
                patchTicket(id, { status: actionBtn.dataset.status });
                break;
            case 'assign':
                patchTicket(id, { assigned_to: user.username });
                break;
            case 'unassign':
                patchTicket(id, { assigned_to: null });
                break;
            case 'add-comment':
                addComment(id);
                break;
            case 'reload':
                refreshDetail(id);
                break;
        }
    });

    // ---- Init ----
    loadTickets();
    loadStats();
})();
