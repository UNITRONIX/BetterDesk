/**
 * BetterDesk Console — Organizations list (/organizations)
 *
 * A table of organizations (name, users, devices, created). Rows open the
 * detail page; edit and delete sit in each row's menu. Create and edit use
 * Modal.show().
 */
'use strict';

(function () {
    const API_BASE = '/api/panel/org';

    let organizations = [];
    const counts = {};          // org id -> { users, devices } (null = unknown)

    const orgList = document.getElementById('org-list');
    const countLine = document.getElementById('org-count-line');
    const createBtn = document.getElementById('create-org-btn');
    const pageEl = document.querySelector('.org-page');
    const canEdit = pageEl?.dataset.canEdit === 'true';
    const canDelete = pageEl?.dataset.canDelete === 'true';

    // -----------------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------------
    async function api(method, path, body) {
        const csrfToken = window.BetterDesk?.csrfToken || '';
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (csrfToken) opts.headers['x-csrf-token'] = csrfToken;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(API_BASE + path, opts);
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            const e = new Error(err.error || res.statusText || 'Request failed');
            e.status = res.status;
            throw e;
        }
        if (res.status === 204) return null;
        return res.json();
    }

    function tr(key, params) {
        if (typeof _ !== 'function') return key;
        const v = _(key, params);
        return v || key;
    }

    function t(key, params) {
        return tr(`organizations.${key}`, params);
    }

    function toast(msg, type = 'info') {
        if (typeof Notifications !== 'undefined' && Notifications[type]) Notifications[type](msg);
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function formatDate(d) {
        if (!d) return '—';
        const date = new Date(d);
        if (Number.isNaN(date.getTime())) return '—';
        return date.toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function slugify(name) {
        return name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .substring(0, 64);
    }

    // -----------------------------------------------------------------------
    //  Render
    // -----------------------------------------------------------------------
    function stateRow(html) {
        orgList.innerHTML = `<tr><td colspan="5" class="state-cell">${html}</td></tr>`;
    }

    function countCell(org, field) {
        const c = counts[org.id];
        if (!c) return '<span class="text-muted">…</span>';
        return c[field] == null ? '<span class="text-muted">—</span>' : escHtml(String(c[field]));
    }

    function renderCountLine() {
        const n = organizations.length;
        countLine.innerHTML = n
            ? escHtml(tr(n === 1 ? 'users.org_count_one' : 'users.org_count_many', { count: '{{n}}' }))
                .replace('{{n}}', `<strong id="org-count">${n}</strong>`)
            : '';
    }

    function renderOrganizations() {
        renderCountLine();

        if (organizations.length === 0) {
            stateRow(escHtml(t('empty_list')));
            return;
        }

        orgList.innerHTML = organizations.map((org, i) => {
            const id = escHtml(org.id);
            const href = `/organizations/${encodeURIComponent(org.id)}`;
            const menuId = `org-menu-${i}`;
            return `
            <tr class="org-row" data-id="${id}" data-href="${href}">
                <td>
                    <a href="${href}" class="org-name">${escHtml(org.name)}</a>
                    <span class="cell-sub">${escHtml(org.slug)}</span>
                </td>
                <td class="num-col" data-count="users">${countCell(org, 'users')}</td>
                <td class="num-col" data-count="devices">${countCell(org, 'devices')}</td>
                <td>${formatDate(org.created_at)}</td>
                <td class="actions">${canEdit || canDelete ? `
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                                aria-controls="${menuId}" aria-label="${escHtml(t('actions_for', { name: org.name }))}">
                            <span class="material-icons" aria-hidden="true">more_vert</span>
                        </button>
                        <span class="menu menu-end${i >= organizations.length - 2 && organizations.length > 3 ? ' menu-up' : ''}" id="${menuId}" role="menu">
                            ${canEdit ? `<button type="button" class="menu-item org-edit-btn" role="menuitem" data-id="${id}">${Utils.icon('edit')}<span>${escHtml(tr('common.edit'))}</span></button>` : ''}
                            ${canEdit && canDelete ? '<span class="menu-divider" role="separator"></span>' : ''}
                            ${canDelete ? `<button type="button" class="menu-item danger org-delete-btn" role="menuitem" data-id="${id}">${Utils.icon('delete')}<span>${escHtml(tr('common.delete'))}</span></button>` : ''}
                        </span>
                    </span>` : ''}
                </td>
            </tr>`;
        }).join('');
    }

    function updateCountCells(orgId) {
        const row = orgList.querySelector(`tr[data-id="${CSS.escape(orgId)}"]`);
        const org = organizations.find(o => o.id === orgId);
        if (!row || !org) return;
        row.querySelector('[data-count="users"]').innerHTML = countCell(org, 'users');
        row.querySelector('[data-count="devices"]').innerHTML = countCell(org, 'devices');
    }

    // Users and devices per organization: one request each, a few at a time.
    // The API has no counts in the list, and the console's API rate limit is
    // 100 requests a minute, so only the first COUNT_LIMIT rows get numbers.
    const COUNT_LIMIT = 12;
    async function loadCounts() {
        organizations.slice(COUNT_LIMIT).forEach(o => {
            counts[o.id] = { users: null, devices: null };
            updateCountCells(o.id);
        });
        const queue = organizations.slice(0, COUNT_LIMIT).map(o => o.id);
        async function worker() {
            while (queue.length) {
                const id = queue.shift();
                const path = `/${encodeURIComponent(id)}`;
                const [users, devices] = await Promise.all([
                    api('GET', `${path}/users`).then(d => (d.users || []).length).catch(() => null),
                    api('GET', `${path}/devices`).then(d => (d.devices || []).length).catch(() => null),
                ]);
                counts[id] = { users, devices };
                updateCountCells(id);
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
    }

    // -----------------------------------------------------------------------
    //  Load
    // -----------------------------------------------------------------------
    async function loadOrganizations() {
        try {
            const data = await api('GET', '');
            organizations = data.organizations || [];
            renderOrganizations();
            loadCounts();
        } catch (err) {
            countLine.textContent = '';
            stateRow(`<span class="text-danger">${escHtml(t('list_failed'))}</span>
                <button type="button" class="btn btn-sm" id="org-retry-btn">${escHtml(tr('actions.retry'))}</button>`);
            document.getElementById('org-retry-btn')?.addEventListener('click', () => {
                stateRow(escHtml(t('loading_list')));
                loadOrganizations();
            });
        }
    }

    // -----------------------------------------------------------------------
    //  Create / edit dialog
    // -----------------------------------------------------------------------
    function openModal(org) {
        const editing = !!org;
        Modal.show({
            title: editing ? t('edit') : t('create'),
            content: `
                <form id="org-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="org-name">${escHtml(t('name'))}</label>
                        <input type="text" id="org-name" class="form-input" maxlength="120" autocomplete="off" value="${escHtml(org?.name || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="org-slug">${escHtml(t('slug'))}</label>
                        <input type="text" id="org-slug" class="form-input" maxlength="64" autocomplete="off" spellcheck="false"
                               aria-describedby="org-slug-hint" value="${escHtml(org?.slug || '')}">
                        <p class="form-hint" id="org-slug-hint">${escHtml(t('slug_hint'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="org-logo-url">${escHtml(t('logo_url'))}</label>
                        <input type="url" id="org-logo-url" class="form-input" autocomplete="off" spellcheck="false"
                               aria-describedby="org-logo-hint" value="${escHtml(org?.logo_url || '')}">
                        <p class="form-hint" id="org-logo-hint">${escHtml(t('logo_url_hint'))}</p>
                    </div>
                    <p class="form-status is-error" id="org-form-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            buttons: [
                { label: tr('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: editing ? tr('actions.save') : t('create'), class: 'btn-primary', onClick: () => saveOrg(org) },
            ],
            onOpen: () => {
                const name = document.getElementById('org-name');
                const slug = document.getElementById('org-slug');
                let slugTouched = editing;
                slug?.addEventListener('input', () => { slugTouched = true; });
                name?.addEventListener('input', () => {
                    if (!slugTouched) slug.value = slugify(name.value);
                });
                document.getElementById('org-form')?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    saveOrg(org);
                });
            },
        });
    }

    async function saveOrg(org) {
        const status = document.getElementById('org-form-status');
        const body = {
            name: document.getElementById('org-name')?.value.trim() || '',
            slug: (document.getElementById('org-slug')?.value || '').trim().toLowerCase(),
            logo_url: document.getElementById('org-logo-url')?.value.trim() || '',
        };
        if (!body.name || !body.slug) {
            if (status) status.textContent = t('name_slug_required');
            return;
        }
        if (status) status.textContent = '';
        try {
            if (org) {
                await api('PUT', `/${encodeURIComponent(org.id)}`, body);
                Modal.close();
                toast(t('org_updated'), 'success');
            } else {
                await api('POST', '', body);
                Modal.close();
                toast(t('org_created'), 'success');
            }
            loadOrganizations();
        } catch (err) {
            if (status) status.textContent = err.message;
        }
    }

    // -----------------------------------------------------------------------
    //  Delete
    // -----------------------------------------------------------------------
    async function removeOrg(id) {
        const org = organizations.find(o => o.id === id);
        const confirmed = await Modal.confirm({
            title: t('delete_org'),
            message: t('delete_confirm_named', { name: org ? org.name : id }),
            confirmLabel: t('delete_org'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api('DELETE', `/${encodeURIComponent(id)}`);
            toast(t('org_deleted'), 'success');
            loadOrganizations();
        } catch (err) {
            toast(`${t('delete_failed')} ${err.message}`, 'error');
        }
    }

    // -----------------------------------------------------------------------
    //  Events
    // -----------------------------------------------------------------------
    createBtn?.addEventListener('click', () => openModal(null));

    orgList?.addEventListener('click', (e) => {
        const edit = e.target.closest('.org-edit-btn');
        if (edit) {
            const org = organizations.find(o => o.id === edit.dataset.id);
            if (org) openModal(org);
            return;
        }
        const del = e.target.closest('.org-delete-btn');
        if (del) {
            removeOrg(del.dataset.id);
            return;
        }
        // A click anywhere else on a row opens the organization
        if (e.target.closest('a, button, .menu-anchor')) return;
        const row = e.target.closest('tr.org-row');
        if (row && row.dataset.href) window.location.href = row.dataset.href;
    });

    loadOrganizations();
})();
