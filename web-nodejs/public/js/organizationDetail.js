/**
 * BetterDesk Console — Organization detail (/organizations/:id)
 *
 * Four tabs: Users (members and invitations), Devices (assigned devices and
 * linked device groups), Address book (shared contacts) and Settings
 * (details, stored settings, delete). Dialogs use Modal.show(); every
 * action reports back next to where it happened or in a toast.
 */
'use strict';

(function () {
    const page = document.querySelector('.org-detail-page');
    const orgId = page?.dataset.orgId;
    if (!orgId) return;

    const API = `/api/panel/org/${encodeURIComponent(orgId)}`;
    // What this role may change (the API checks again); buttons it may not use stay hidden
    const canEdit = page.dataset.canEdit === 'true';
    const canUsers = page.dataset.canUsers === 'true';
    const canDevices = page.dataset.canDevices === 'true';

    // -----------------------------------------------------------------------
    //  Helpers
    // -----------------------------------------------------------------------
    async function api(method, path, body) {
        const csrfToken = window.BetterDesk?.csrfToken || '';
        const opts = { method, headers: { 'Content-Type': 'application/json' } };
        if (csrfToken) opts.headers['x-csrf-token'] = csrfToken;
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch(API + path, opts);
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
        return _(key, params) || key;
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

    function formatDate(d, withTime = true) {
        if (!d) return '—';
        const date = new Date(d);
        if (Number.isNaN(date.getTime())) return '—';
        const opts = { year: 'numeric', month: 'short', day: 'numeric' };
        if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
        return date.toLocaleDateString(document.documentElement.lang || undefined, opts);
    }

    function roleLabel(role) {
        const key = `organizations.role_${role}`;
        const v = tr(key);
        return v === key ? (role || '—') : v;
    }

    // Roles ordered lowest → highest. Backend value `user` is shown as "Member".
    function roleOptions(selected) {
        return ['user', 'operator', 'admin', 'owner'].map(r =>
            `<option value="${r}" ${r === selected ? 'selected' : ''}>${escHtml(roleLabel(r))}</option>`
        ).join('');
    }

    // "4 users" with the number in bold; the hidden span keeps the old count hook.
    function setCountLine(el, countId, n, oneKey, otherKey) {
        if (!el) return;
        const text = escHtml(t(n === 1 ? oneKey : otherKey, { count: '{{n}}' }));
        el.innerHTML = text.replace('{{n}}', `<strong>${n}</strong>`) + `<span id="${countId}" hidden>${n}</span>`;
    }

    // Loading, empty and error states: one sentence, a retry button for errors.
    function errorState(container, message, retry) {
        container.innerHTML = `<p class="state is-error"><span>${escHtml(message)}</span>
            ${retry ? `<button type="button" class="btn btn-sm">${escHtml(tr('actions.retry'))}</button>` : ''}</p>`;
        if (retry) container.querySelector('button').addEventListener('click', retry);
    }

    function loadErrorMessage(err) {
        return err && err.status === 403 ? t('no_permission') : t('loading_failed');
    }

    function rowMenu(id, label, items) {
        return `
            <span class="menu-anchor">
                <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                        aria-controls="${id}" aria-label="${escHtml(label)}">
                    <span class="material-icons" aria-hidden="true">more_vert</span>
                </button>
                <span class="menu menu-end" id="${id}" role="menu">${items}</span>
            </span>`;
    }

    // Menus near the end of a table open upwards so they are not cut off
    function flipLastMenus(container) {
        const menus = container.querySelectorAll('tbody .menu');
        if (menus.length > 3) {
            Array.from(menus).slice(-2).forEach(m => m.classList.add('menu-up'));
        }
    }

    // A dialog whose form submits with Enter and shows errors inside the dialog
    function formDialog({ title, fields, submitLabel, onSubmit, focusId }) {
        Modal.show({
            title,
            content: `<form id="org-dialog-form" novalidate>${fields}
                <p class="form-status is-error" id="org-dialog-status" role="alert"></p>
                <button type="submit" hidden></button></form>`,
            buttons: [
                { label: tr('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: submitLabel, class: 'btn-primary', onClick: () => submit() },
            ],
            onOpen: () => {
                document.getElementById('org-dialog-form')?.addEventListener('submit', (e) => {
                    e.preventDefault();
                    submit();
                });
                // Modal.show() already focused the first field; only move focus if it is elsewhere
                const form = document.getElementById('org-dialog-form');
                if (focusId && form && !form.contains(document.activeElement)) document.getElementById(focusId)?.focus();
            },
        });
        let busy = false;
        async function submit() {
            if (busy) return;
            const status = document.getElementById('org-dialog-status');
            const fail = (msg) => { if (status) status.textContent = msg; };
            if (status) status.textContent = '';
            busy = true;
            try {
                await onSubmit(fail);
            } catch (err) {
                fail(err.message);
            } finally {
                busy = false;
            }
        }
    }

    // -----------------------------------------------------------------------
    //  Tabs (arrow keys move between tabs; the hash keeps the open tab)
    // -----------------------------------------------------------------------
    const tabs = Array.from(document.querySelectorAll('.org-tab'));
    const TAB_ALIASES = { invitations: 'users', 'device-groups': 'devices' };

    function selectTab(name, focus) {
        const tab = tabs.find(x => x.dataset.tab === name) || tabs[0];
        tabs.forEach(x => {
            const on = x === tab;
            x.classList.toggle('active', on);
            x.setAttribute('aria-selected', on ? 'true' : 'false');
            x.tabIndex = on ? 0 : -1;
            const panel = document.getElementById(x.getAttribute('aria-controls'));
            if (panel) panel.hidden = !on;
        });
        if (focus) tab.focus();
        if (history.replaceState) history.replaceState(null, '', `#${tab.dataset.tab}`);
    }

    tabs.forEach((tab, i) => {
        tab.addEventListener('click', () => selectTab(tab.dataset.tab, false));
        tab.addEventListener('keydown', (e) => {
            let next = null;
            if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
            else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
            else if (e.key === 'Home') next = tabs[0];
            else if (e.key === 'End') next = tabs[tabs.length - 1];
            if (!next) return;
            if (document.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                next = tabs[(e.key === 'ArrowRight' ? i - 1 + tabs.length : i + 1) % tabs.length];
            }
            e.preventDefault();
            selectTab(next.dataset.tab, true);
        });
    });

    {
        const hash = location.hash.replace('#', '');
        const name = TAB_ALIASES[hash] || hash;
        if (tabs.some(x => x.dataset.tab === name)) selectTab(name, false);
    }

    // Copy buttons in the details list
    page.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-copy-target]');
        if (!btn) return;
        const src = document.getElementById(btn.dataset.copyTarget);
        if (!src) return;
        try {
            await navigator.clipboard.writeText(src.textContent.trim());
            const label = btn.textContent;
            btn.textContent = tr('common.copied');
            btn.classList.add('copied');
            setTimeout(() => { btn.textContent = label; btn.classList.remove('copied'); }, 1500);
        } catch (_) {
            toast(t('copy_failed'), 'error');
        }
    });

    // -----------------------------------------------------------------------
    //  Header and details
    // -----------------------------------------------------------------------
    let currentOrg = {};

    function renderDetails() {
        document.getElementById('org-detail-name').textContent = currentOrg.name || '';
        document.getElementById('org-detail-slug').textContent = currentOrg.slug || '—';
        document.getElementById('org-detail-logo').textContent = currentOrg.logo_url || '—';
        document.getElementById('org-detail-created').textContent = formatDate(currentOrg.created_at, false);
        if (currentOrg.name) document.title = `${currentOrg.name} - ${document.title.split(' - ').slice(1).join(' - ') || document.title}`;
    }

    async function loadOrgHeader() {
        const errorEl = document.getElementById('org-load-error');
        try {
            currentOrg = await api('GET', '');
            errorEl.hidden = true;
            renderDetails();
            return true;
        } catch (err) {
            errorEl.hidden = false;
            errorEl.querySelector('span').textContent = err.status === 404 ? t('org_not_found') : t('org_load_failed');
            return false;
        }
    }

    document.getElementById('org-load-retry')?.addEventListener('click', () => loadAll());

    document.getElementById('org-edit-btn')?.addEventListener('click', () => {
        formDialog({
            title: t('edit'),
            focusId: 'modal-org-name',
            submitLabel: tr('actions.save'),
            fields: `
                <div class="form-group">
                    <label class="form-label" for="modal-org-name">${escHtml(t('name'))}</label>
                    <input type="text" id="modal-org-name" class="form-input" maxlength="120" value="${escHtml(currentOrg.name || '')}">
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-org-slug">${escHtml(t('slug'))}</label>
                    <input type="text" id="modal-org-slug" class="form-input" maxlength="64" spellcheck="false" aria-describedby="modal-org-slug-hint" value="${escHtml(currentOrg.slug || '')}">
                    <p class="form-hint" id="modal-org-slug-hint">${escHtml(t('slug_hint'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-org-logo">${escHtml(t('logo_url'))}</label>
                    <input type="url" id="modal-org-logo" class="form-input" spellcheck="false" aria-describedby="modal-org-logo-hint" value="${escHtml(currentOrg.logo_url || '')}">
                    <p class="form-hint" id="modal-org-logo-hint">${escHtml(t('logo_url_hint'))}</p>
                </div>`,
            onSubmit: async (fail) => {
                const name = document.getElementById('modal-org-name')?.value?.trim();
                const slug = document.getElementById('modal-org-slug')?.value?.trim().toLowerCase();
                const logo_url = document.getElementById('modal-org-logo')?.value?.trim() || '';
                if (!name || !slug) return fail(t('name_slug_required'));
                await api('PUT', '', { name, slug, logo_url });
                Modal.close();
                toast(t('org_updated'), 'success');
                loadOrgHeader();
            },
        });
    });

    // -----------------------------------------------------------------------
    //  Users tab
    // -----------------------------------------------------------------------
    let orgUsers = [];

    function userName(id) {
        const u = orgUsers.find(x => x.id === id);
        return u ? (u.display_name || u.username) : id;
    }

    async function loadUsers() {
        const container = document.getElementById('users-table');
        const line = document.getElementById('users-count-line');
        try {
            const data = await api('GET', '/users');
            orgUsers = data.users || [];
            setCountLine(line, 'users-count', orgUsers.length, 'users_count_one', 'users_count_other');

            if (orgUsers.length === 0) {
                container.innerHTML = `<p class="state">${escHtml(t('no_users'))}</p>`;
                return;
            }

            container.innerHTML = `
                <div class="table-scroll"><table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">${escHtml(t('username'))}</th>
                            <th scope="col">${escHtml(t('email'))}</th>
                            <th scope="col">${escHtml(t('role'))}</th>
                            <th scope="col">${escHtml(t('last_login'))}</th>
                            ${canUsers ? `<th scope="col" class="actions"><span class="sr-only">${escHtml(t('actions'))}</span></th>` : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${orgUsers.map((u, i) => `
                            <tr>
                                <td><strong>${escHtml(u.username)}</strong>${u.display_name ? `<span class="cell-sub">${escHtml(u.display_name)}</span>` : ''}</td>
                                <td>${u.email ? escHtml(u.email) : '<span class="text-muted">—</span>'}</td>
                                <td>${escHtml(roleLabel(u.role))}</td>
                                <td>${formatDate(u.last_login)}</td>
                                ${canUsers ? `<td class="actions">${rowMenu(`org-user-menu-${i}`, t('actions_for', { name: u.username }), `
                                    <button type="button" class="menu-item user-role-btn" role="menuitem" data-user-id="${escHtml(u.id)}" data-role="${escHtml(u.role)}">${escHtml(t('edit_role'))}</button>
                                    <span class="menu-divider" role="separator"></span>
                                    <button type="button" class="menu-item danger user-remove-btn" role="menuitem" data-user-id="${escHtml(u.id)}">${escHtml(t('remove_from_org'))}</button>`)}
                                </td>` : ''}
                            </tr>`).join('')}
                    </tbody>
                </table></div>`;
            flipLastMenus(container);

            container.querySelectorAll('.user-remove-btn').forEach(btn => {
                btn.addEventListener('click', () => deleteUser(btn.dataset.userId));
            });
            container.querySelectorAll('.user-role-btn').forEach(btn => {
                btn.addEventListener('click', () => editUserRole(btn.dataset.userId, btn.dataset.role));
            });
        } catch (err) {
            if (line) line.textContent = '';
            errorState(container, loadErrorMessage(err), err.status === 403 ? null : loadUsers);
        }
    }

    // Add user: a new account for this organization, or link an existing server user
    document.getElementById('add-user-btn')?.addEventListener('click', async () => {
        let availableUsers = [];
        try {
            const resp = await api('GET', '/available-users');
            availableUsers = resp.users || [];
        } catch (_) {
            availableUsers = [];
        }
        const hasAvailable = availableUsers.length > 0;
        let mode = 'create';

        formDialog({
            title: t('add_user'),
            focusId: 'modal-user-name',
            submitLabel: t('add_user'),
            fields: `
                <div class="tabs org-add-user-tabs" role="tablist" aria-label="${escHtml(t('add_user'))}">
                    <button type="button" class="tab modal-tab active" role="tab" id="modal-tabbtn-create" data-tab="create" aria-selected="true" aria-controls="modal-tab-create">${escHtml(t('create_new_user'))}</button>
                    <button type="button" class="tab modal-tab" role="tab" id="modal-tabbtn-existing" data-tab="existing" aria-selected="false" aria-controls="modal-tab-existing" tabindex="-1">${escHtml(t('add_existing_user'))}</button>
                </div>
                <div id="modal-tab-create" class="modal-tab-content" role="tabpanel" aria-labelledby="modal-tabbtn-create">
                    <p class="form-hint org-dialog-note">${escHtml(t('create_new_user_hint'))}</p>
                    <div class="form-group">
                        <label class="form-label" for="modal-user-name">${escHtml(t('username'))}</label>
                        <input type="text" id="modal-user-name" class="form-input" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="modal-user-pass">${escHtml(t('password'))}</label>
                        <input type="password" id="modal-user-pass" class="form-input" autocomplete="new-password">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="modal-user-role">${escHtml(t('role'))}</label>
                        <select id="modal-user-role" class="form-select">${roleOptions('user')}</select>
                    </div>
                </div>
                <div id="modal-tab-existing" class="modal-tab-content" role="tabpanel" aria-labelledby="modal-tabbtn-existing" hidden>
                    ${hasAvailable ? `
                        <div class="form-group">
                            <label class="form-label" for="modal-existing-user">${escHtml(t('select_user'))}</label>
                            <select id="modal-existing-user" class="form-select">
                                <option value="">${escHtml(t('select_user_placeholder'))}</option>
                                ${availableUsers.map(u => `<option value="${escHtml(u.id)}">${escHtml(u.username)} (${escHtml(tr('users.role_' + u.role) === 'users.role_' + u.role ? u.role : tr('users.role_' + u.role))})</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="modal-existing-role">${escHtml(t('org_role'))}</label>
                            <select id="modal-existing-role" class="form-select">${roleOptions('user')}</select>
                        </div>
                        <p class="form-hint">${escHtml(t('link_user_hint'))}</p>
                    ` : `<p class="state">${escHtml(t('no_available_users'))}</p>`}
                </div>`,
            onSubmit: async (fail) => {
                if (mode === 'create') {
                    const username = document.getElementById('modal-user-name')?.value?.trim();
                    const password = document.getElementById('modal-user-pass')?.value;
                    const role = document.getElementById('modal-user-role')?.value || 'user';
                    if (!username || !password) return fail(t('username_password_required'));
                    await api('POST', '/users', { username, password, role });
                    Modal.close();
                    toast(t('user_added'), 'success');
                } else {
                    const userId = document.getElementById('modal-existing-user')?.value;
                    const role = document.getElementById('modal-existing-role')?.value || 'user';
                    if (!userId) return fail(t('select_user_first'));
                    await api('POST', '/members', { user_id: parseInt(userId, 10), role });
                    Modal.close();
                    toast(t('user_linked'), 'success');
                }
                loadUsers();
            },
        });

        // Switch between the two ways of adding someone
        setTimeout(() => {
            const btns = Array.from(document.querySelectorAll('.modal-tab'));
            const pick = (btn, focus) => {
                mode = btn.dataset.tab;
                btns.forEach(b => {
                    const on = b === btn;
                    b.classList.toggle('active', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                    b.tabIndex = on ? 0 : -1;
                    const panel = document.getElementById(b.getAttribute('aria-controls'));
                    if (panel) panel.hidden = !on;
                });
                if (focus) btn.focus();
            };
            btns.forEach((b, i) => {
                b.addEventListener('click', () => pick(b, false));
                b.addEventListener('keydown', (e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                    e.preventDefault();
                    pick(btns[(i + 1) % btns.length], true);
                });
            });
        }, 0);
    });

    function editUserRole(uid, currentRole) {
        const u = orgUsers.find(x => x.id === uid);
        formDialog({
            title: t('edit_role'),
            focusId: 'modal-edit-role',
            submitLabel: tr('actions.save'),
            fields: `
                ${u ? `<p class="org-dialog-note">${escHtml(u.username)}</p>` : ''}
                <div class="form-group">
                    <label class="form-label" for="modal-edit-role">${escHtml(t('role'))}</label>
                    <select id="modal-edit-role" class="form-select">${roleOptions(currentRole)}</select>
                </div>`,
            onSubmit: async () => {
                const role = document.getElementById('modal-edit-role')?.value;
                if (!role) return;
                await api('PUT', `/users/${encodeURIComponent(uid)}`, { role });
                Modal.close();
                toast(t('user_updated'), 'success');
                loadUsers();
            },
        });
    }

    async function deleteUser(uid) {
        const u = orgUsers.find(x => x.id === uid);
        const confirmed = await Modal.confirm({
            title: t('remove_from_org'),
            message: t('confirm_remove_user_named', { name: u ? u.username : uid }),
            confirmLabel: t('remove_from_org'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api('DELETE', `/users/${encodeURIComponent(uid)}`);
            toast(t('user_removed'), 'success');
            loadUsers();
        } catch (err) {
            toast(`${t('remove_failed')} ${err.message}`, 'error');
        }
    }

    // -----------------------------------------------------------------------
    //  Invitations (on the Users tab)
    // -----------------------------------------------------------------------
    async function loadInvitations() {
        const container = document.getElementById('invitations-table');
        try {
            const data = await api('GET', '/invitations');
            const invs = data.invitations || [];
            const countEl = document.getElementById('invitations-count');
            if (countEl) countEl.textContent = invs.length;

            if (invs.length === 0) {
                container.innerHTML = `<p class="state">${escHtml(t('no_invitations'))}</p>`;
                return;
            }

            container.innerHTML = `
                <div class="table-scroll" tabindex="0" role="region" aria-label="${escHtml(t('invitations'))}"><table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">${escHtml(t('token'))}</th>
                            <th scope="col">${escHtml(t('email'))}</th>
                            <th scope="col">${escHtml(t('role'))}</th>
                            <th scope="col">${escHtml(t('expires'))}</th>
                            <th scope="col">${escHtml(t('used'))}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${invs.map(inv => `
                            <tr>
                                <td><span class="mono">${escHtml((inv.token || '').substring(0, 16))}…</span></td>
                                <td>${inv.email ? escHtml(inv.email) : '<span class="text-muted">—</span>'}</td>
                                <td>${escHtml(roleLabel(inv.role))}</td>
                                <td>${formatDate(inv.expires_at)}</td>
                                <td>${inv.used_at ? formatDate(inv.used_at) : `<span class="text-muted">${escHtml(t('not_used'))}</span>`}</td>
                            </tr>`).join('')}
                    </tbody>
                </table></div>`;
        } catch (err) {
            errorState(container, loadErrorMessage(err), err.status === 403 ? null : loadInvitations);
        }
    }

    document.getElementById('create-invite-btn')?.addEventListener('click', () => {
        formDialog({
            title: t('create_invitation'),
            focusId: 'modal-invite-email',
            submitLabel: t('create_invitation'),
            fields: `
                <div class="form-group">
                    <label class="form-label" for="modal-invite-email">${escHtml(t('email'))}</label>
                    <input type="email" id="modal-invite-email" class="form-input" aria-describedby="modal-invite-email-hint">
                    <p class="form-hint" id="modal-invite-email-hint">${escHtml(t('optional'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-invite-role">${escHtml(t('role'))}</label>
                    <select id="modal-invite-role" class="form-select">${roleOptions('user')}</select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-invite-hours">${escHtml(t('expires_hours'))}</label>
                    <input type="number" id="modal-invite-hours" class="form-input is-short" value="72" min="1" max="720" aria-describedby="modal-invite-hours-hint">
                    <p class="form-hint" id="modal-invite-hours-hint">${escHtml(t('expires_hours_hint'))}</p>
                </div>`,
            onSubmit: async () => {
                const email = document.getElementById('modal-invite-email')?.value?.trim() || '';
                const role = document.getElementById('modal-invite-role')?.value || 'user';
                const hours = parseInt(document.getElementById('modal-invite-hours')?.value, 10) || 72;
                await api('POST', '/invite', { email, role, expires_in_hours: hours });
                Modal.close();
                toast(t('invitation_created'), 'success');
                loadInvitations();
            },
        });
    });

    // -----------------------------------------------------------------------
    //  Devices tab
    // -----------------------------------------------------------------------
    let orgDevices = [];

    async function loadDevices() {
        const container = document.getElementById('devices-table');
        const line = document.getElementById('devices-count-line');
        try {
            const data = await api('GET', '/devices');
            orgDevices = data.devices || [];
            setCountLine(line, 'devices-count', orgDevices.length, 'devices_count_one', 'devices_count_other');

            if (orgDevices.length === 0) {
                container.innerHTML = `<p class="state">${escHtml(t('no_devices'))}</p>`;
                return;
            }

            const cell = (v) => (v ? escHtml(v) : '<span class="text-muted">—</span>');
            container.innerHTML = `
                <div class="table-scroll"><table class="data-table">
                    <thead>
                        <tr>
                            <th scope="col">${escHtml(t('device_id'))}</th>
                            <th scope="col">${escHtml(t('department'))}</th>
                            <th scope="col">${escHtml(t('building'))}</th>
                            <th scope="col">${escHtml(t('location'))}</th>
                            <th scope="col">${escHtml(t('assigned_user'))}</th>
                            ${canDevices ? `<th scope="col" class="actions"><span class="sr-only">${escHtml(t('actions'))}</span></th>` : ''}
                        </tr>
                    </thead>
                    <tbody>
                        ${orgDevices.map((d, i) => `
                            <tr>
                                <td><a class="mono" href="/devices/${encodeURIComponent(d.device_id)}">${escHtml(d.device_id)}</a></td>
                                <td>${cell(d.department)}</td>
                                <td>${cell(d.building)}</td>
                                <td>${cell(d.location)}</td>
                                <td>${cell(d.assigned_user_id ? userName(d.assigned_user_id) : '')}</td>
                                ${canDevices ? `<td class="actions">${rowMenu(`org-device-menu-${i}`, t('actions_for', { name: d.device_id }), `
                                    <button type="button" class="menu-item danger device-unassign-btn" role="menuitem" data-device-id="${escHtml(d.device_id)}">${escHtml(t('remove_from_org'))}</button>`)}
                                </td>` : ''}
                            </tr>`).join('')}
                    </tbody>
                </table></div>`;
            flipLastMenus(container);

            container.querySelectorAll('.device-unassign-btn').forEach(btn => {
                btn.addEventListener('click', () => unassignDevice(btn.dataset.deviceId));
            });
        } catch (err) {
            if (line) line.textContent = '';
            errorState(container, loadErrorMessage(err), err.status === 403 ? null : loadDevices);
        }
    }

    document.getElementById('assign-device-btn')?.addEventListener('click', () => {
        formDialog({
            title: t('assign_device'),
            focusId: 'modal-device-id',
            submitLabel: t('assign_device'),
            fields: `
                <div class="form-group">
                    <label class="form-label" for="modal-device-id">${escHtml(t('device_id'))}</label>
                    <input type="text" id="modal-device-id" class="form-input is-medium" autocomplete="off" spellcheck="false" aria-describedby="modal-device-id-hint">
                    <p class="form-hint" id="modal-device-id-hint">${escHtml(t('device_id_hint'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-device-dept">${escHtml(t('department'))}</label>
                    <input type="text" id="modal-device-dept" class="form-input">
                </div>
                <div class="form-group">
                    <label class="form-label" for="modal-device-building">${escHtml(t('building'))}</label>
                    <input type="text" id="modal-device-building" class="form-input">
                </div>`,
            onSubmit: async (fail) => {
                const device_id = document.getElementById('modal-device-id')?.value?.trim();
                const department = document.getElementById('modal-device-dept')?.value?.trim() || '';
                const building = document.getElementById('modal-device-building')?.value?.trim() || '';
                if (!device_id) return fail(t('device_id_required'));
                if (/\s/.test(device_id)) return fail(t('device_id_invalid'));
                await api('POST', '/devices', { device_id, department, building });
                Modal.close();
                toast(t('device_assigned'), 'success');
                loadDevices();
            },
        });
    });

    async function unassignDevice(did) {
        const confirmed = await Modal.confirm({
            title: t('remove_from_org'),
            message: t('confirm_unassign_named', { id: did }),
            confirmLabel: t('remove_from_org'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api('DELETE', `/devices/${encodeURIComponent(did)}`);
            toast(t('device_unassigned'), 'success');
            loadDevices();
        } catch (err) {
            toast(`${t('remove_failed')} ${err.message}`, 'error');
        }
    }

    // -----------------------------------------------------------------------
    //  Device groups linked to this organization (team_id), on the Devices tab
    // -----------------------------------------------------------------------
    function groupTypeLabel(group) {
        if ((group.source_type || 'manual') === 'tag' && group.tag_filter) {
            return `${t('group_type_tag')}: ${group.tag_filter}`;
        }
        return t('group_type_manual');
    }

    function groupNameCell(group) {
        return `<strong>${escHtml(group.name || group.guid)}</strong>${group.note ? `<span class="cell-sub">${escHtml(group.note)}</span>` : ''}`;
    }

    async function loadDeviceGroups() {
        const container = document.getElementById('device-groups-container');
        if (!container) return;
        try {
            const data = await api('GET', '/device-groups');
            const deviceGroups = data.device_groups || [];
            const userGroups = data.user_groups || [];

            container.innerHTML = `
                <div class="section">
                    <div class="section-head">
                        <p class="count-line">${deviceGroups.length ? '' : escHtml(t('no_org_device_groups'))}</p>
                        <button type="button" class="btn" id="create-org-device-group-btn">${escHtml(t('create_org_device_group'))}</button>
                    </div>
                    ${deviceGroups.length ? `
                    <div class="table-scroll" tabindex="0" role="region" aria-label="${escHtml(t('device_groups_tab'))}"><table class="data-table">
                        <thead>
                            <tr>
                                <th scope="col">${escHtml(t('group_name'))}</th>
                                <th scope="col">${escHtml(t('group_type'))}</th>
                                <th scope="col">${escHtml(t('group_members'))}</th>
                                <th scope="col">${escHtml(t('group_allowed_user_groups'))}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${deviceGroups.map(group => `
                                <tr>
                                    <td>${groupNameCell(group)}</td>
                                    <td>${escHtml(groupTypeLabel(group))}</td>
                                    <td>${escHtml(String(group.member_count ?? 0))}</td>
                                    <td>${escHtml((group.allowed_user_groups || []).map(g => g.name || g.guid).filter(Boolean).join(', ') || '—')}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table></div>` : ''}
                </div>
                <div class="section">
                    <h3>${escHtml(t('org_user_groups_title'))}</h3>
                    <p class="section-note">${escHtml(t('org_user_groups_intro'))}</p>
                    ${userGroups.length ? `
                    <div class="table-scroll" tabindex="0" role="region" aria-label="${escHtml(t('org_user_groups_title'))}"><table class="data-table">
                        <thead>
                            <tr>
                                <th scope="col">${escHtml(t('group_name'))}</th>
                                <th scope="col">${escHtml(t('group_user_members'))}</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${userGroups.map(group => `
                                <tr>
                                    <td>${groupNameCell(group)}</td>
                                    <td>${escHtml(String(group.member_count ?? 0))}</td>
                                </tr>`).join('')}
                        </tbody>
                    </table></div>` : `<p class="state">${escHtml(t('no_org_user_groups'))}</p>`}
                </div>`;

            document.getElementById('create-org-device-group-btn')?.addEventListener('click', createDeviceGroup);
        } catch (err) {
            errorState(container, loadErrorMessage(err), err.status === 403 ? null : loadDeviceGroups);
        }
    }

    function createDeviceGroup() {
        const defaultName = currentOrg.name
            ? `${currentOrg.name} — ${t('group_devices_suffix')}`
            : '';
        formDialog({
            title: t('create_org_device_group'),
            focusId: 'modal-org-dg-name',
            submitLabel: tr('actions.create'),
            fields: `
                <div class="form-group">
                    <label class="form-label" for="modal-org-dg-name">${escHtml(t('group_name'))}</label>
                    <input type="text" id="modal-org-dg-name" class="form-input" value="${escHtml(defaultName)}" maxlength="80" aria-describedby="modal-org-dg-hint">
                    <p class="form-hint" id="modal-org-dg-hint">${escHtml(t('link_team_id_hint'))}</p>
                </div>`,
            onSubmit: async (fail) => {
                const name = document.getElementById('modal-org-dg-name')?.value?.trim();
                if (!name) return fail(t('group_name_required'));
                const csrfToken = window.BetterDesk?.csrfToken || '';
                const res = await fetch('/api/device-groups', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
                    },
                    body: JSON.stringify({ name, team_id: orgId, source_type: 'manual' }),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || res.statusText || 'Request failed');
                }
                Modal.close();
                toast(t('org_device_group_created'), 'success');
                loadDeviceGroups();
            },
        });
    }

    // -----------------------------------------------------------------------
    //  Settings tab: stored settings
    // -----------------------------------------------------------------------
    const settingsForm = document.getElementById('org-settings-form');
    const SETTING_FIELDS = {
        connection_policy: { id: 'setting-connection-policy', type: 'select', fallback: 'unattended' },
        allow_file_transfer: { id: 'setting-allow-file-transfer', type: 'bool', fallback: 'true' },
        allow_clipboard: { id: 'setting-allow-clipboard', type: 'bool', fallback: 'true' },
        max_session_duration_min: { id: 'setting-max-session', type: 'number', fallback: '120' },
    };

    function readSetting(key) {
        const f = SETTING_FIELDS[key];
        const el = document.getElementById(f.id);
        if (!el) return f.fallback;
        if (f.type === 'bool') return el.checked ? 'true' : 'false';
        return String(el.value || f.fallback);
    }

    function writeSetting(key, value) {
        const f = SETTING_FIELDS[key];
        const el = document.getElementById(f.id);
        if (!el) return;
        if (f.type === 'bool') el.checked = String(value) !== 'false';
        else el.value = value;
    }

    async function loadSettings() {
        const raw = document.getElementById('settings-raw');
        try {
            const data = await api('GET', '/settings');
            const settings = data.settings || [];
            Object.keys(SETTING_FIELDS).forEach(k => writeSetting(k, SETTING_FIELDS[k].fallback));
            settings.forEach(s => { if (SETTING_FIELDS[s.key]) writeSetting(s.key, s.value); });
            if (window.UiForm && settingsForm) UiForm.reset(settingsForm);
            if (!canEdit && settingsForm) settingsForm.querySelectorAll('input, select').forEach(el => { el.disabled = true; });

            raw.innerHTML = settings.length ? `
                <div class="table-scroll" tabindex="0" role="region" aria-label="${escHtml(t('raw_settings'))}"><table class="data-table org-raw-settings">
                    <thead><tr><th scope="col">${escHtml(t('key'))}</th><th scope="col">${escHtml(t('value'))}</th></tr></thead>
                    <tbody>
                        ${settings.map(s => `<tr><td class="mono">${escHtml(s.key)}</td><td class="mono">${escHtml(s.value)}</td></tr>`).join('')}
                    </tbody>
                </table></div>` : `<p class="state">${escHtml(t('no_settings'))}</p>`;
        } catch (err) {
            errorState(raw, loadErrorMessage(err), loadSettings);
        }
    }

    settingsForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const saveBtn = document.getElementById('save-settings-btn');
        saveBtn.disabled = true;
        try {
            for (const key of Object.keys(SETTING_FIELDS)) {
                await api('PUT', '/settings', { key, value: readSetting(key) });
            }
            await loadSettings();
            if (window.UiForm) UiForm.saved(settingsForm, t('settings_saved'));
        } catch (err) {
            if (window.UiForm) UiForm.failed(settingsForm, `${tr('ui_form.save_failed')} ${err.message}`);
        } finally {
            saveBtn.disabled = false;
        }
    });

    // -----------------------------------------------------------------------
    //  Shared organization address book
    // -----------------------------------------------------------------------
    const abForm = document.getElementById('org-address-book-form');
    let addressBookEnabled = true;
    let addressBookPeers = [];
    let addressBookTags = [];
    /** peer_id → true when encrypted vault password is set (#367) */
    let addressBookCredentialFlags = {};
    let addressBookShowJson = false;

    function abDirty() {
        if (window.UiForm && abForm) UiForm.markDirty(abForm);
    }

    async function loadPeerCredentialFlags() {
        addressBookCredentialFlags = {};
        try {
            const resp = await api('GET', '/peer-credentials');
            const list = Array.isArray(resp.credentials) ? resp.credentials : [];
            list.forEach(row => {
                const id = String(row.peer_id || '').trim();
                if (id && row.password_set !== false) addressBookCredentialFlags[id] = true;
            });
        } catch (_) {
            /* vault optional on older servers */
        }
    }

    async function setPeerCredential(peerId) {
        const id = String(peerId || '').trim();
        if (!id) {
            toast(t('address_book_peer_id_required'), 'error');
            return;
        }
        const password = await Modal.prompt({
            title: t('address_book_set_password'),
            label: t('address_book_set_password_prompt'),
            type: 'password',
            confirmLabel: tr('actions.save'),
        });
        if (password === null) return;
        if (!String(password).trim()) {
            toast(t('address_book_password_required'), 'error');
            return;
        }
        try {
            await api('PUT', `/peer-credentials/${encodeURIComponent(id)}`, { password: String(password).trim() });
            addressBookCredentialFlags[id] = true;
            toast(t('address_book_password_saved'), 'success');
            renderAddressBookPeersTable();
        } catch (err) {
            toast(err.message || t('address_book_password_save_failed'), 'error');
        }
    }

    async function clearPeerCredential(peerId) {
        const id = String(peerId || '').trim();
        if (!id) return;
        const confirmed = await Modal.confirm({
            title: t('address_book_clear_password'),
            message: t('address_book_clear_password_confirm'),
            confirmLabel: t('address_book_clear_password'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api('DELETE', `/peer-credentials/${encodeURIComponent(id)}`);
            delete addressBookCredentialFlags[id];
            toast(t('address_book_password_cleared'), 'success');
            renderAddressBookPeersTable();
        } catch (err) {
            toast(err.message || t('address_book_password_clear_failed'), 'error');
        }
    }

    function parseAddressBook(raw) {
        if (!raw || raw === '{}') return { peers: [], tags: [] };
        if (typeof raw === 'object') return raw;
        return JSON.parse(raw);
    }

    function formatAddressBook(ab) {
        const normalized = ab && typeof ab === 'object' ? ab : { peers: [], tags: [] };
        if (!Array.isArray(normalized.peers)) normalized.peers = [];
        if (!Array.isArray(normalized.tags)) normalized.tags = [];
        return JSON.stringify(normalized, null, 2);
    }

    function buildAddressBookPayload() {
        if (addressBookShowJson) {
            return currentAddressBookJSON();
        }
        const tagsRaw = document.getElementById('org-address-book-tags-input')?.value || '';
        const tags = tagsRaw.split(',').map(tag => tag.trim()).filter(Boolean);
        const peers = addressBookPeers.map(peer => {
            const entry = { id: String(peer.id || '').trim() };
            if (peer.alias) entry.alias = String(peer.alias).trim();
            if (Array.isArray(peer.tags) && peer.tags.length) entry.tags = peer.tags;
            return entry;
        }).filter(peer => peer.id);
        return { peers, tags };
    }

    function renderAddressBookPeersTable() {
        const tbody = document.getElementById('org-address-book-peers-body');
        if (!tbody) return;
        if (!addressBookPeers.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="state-cell org-ab-empty">${escHtml(t('address_book_no_peers'))}</td></tr>`;
            return;
        }
        tbody.innerHTML = addressBookPeers.map((peer, index) => {
            const hasPw = !!(peer.id && addressBookCredentialFlags[peer.id]);
            const pwLabel = hasPw ? t('address_book_password_set') : t('address_book_password_unset');
            const n = index + 1;
            return `
            <tr data-index="${index}">
                <td><input type="text" class="form-input org-ab-peer-id mono" value="${escHtml(peer.id || '')}" maxlength="64" spellcheck="false" aria-label="${escHtml(t('address_book_peer_id'))} ${n}"></td>
                <td><input type="text" class="form-input org-ab-peer-alias" value="${escHtml(peer.alias || '')}" maxlength="120" aria-label="${escHtml(t('address_book_alias'))} ${n}"></td>
                <td><input type="text" class="form-input org-ab-peer-tags" value="${escHtml((peer.tags || []).join(', '))}" maxlength="200" aria-label="${escHtml(t('address_book_peer_tags'))} ${n}"></td>
                <td class="org-ab-password-cell${hasPw ? ' is-set' : ''}"><span class="org-ab-password-flag">${escHtml(pwLabel)}</span></td>
                <td class="actions">${rowMenu(`org-ab-menu-${index}`, t('actions_for', { name: peer.id || peer.alias || n }), `
                    <button type="button" class="menu-item org-ab-set-password" role="menuitem" data-index="${index}">${escHtml(t('address_book_set_password'))}</button>
                    ${hasPw ? `<button type="button" class="menu-item org-ab-clear-password" role="menuitem" data-index="${index}">${escHtml(t('address_book_clear_password'))}</button>` : ''}
                    <span class="menu-divider" role="separator"></span>
                    <button type="button" class="menu-item danger org-ab-remove-peer" role="menuitem" data-index="${index}">${escHtml(t('address_book_remove_contact'))}</button>`)}
                </td>
            </tr>`;
        }).join('');
        flipLastMenus(tbody.closest('table').parentElement);

        tbody.querySelectorAll('.org-ab-remove-peer').forEach(btn => {
            btn.addEventListener('click', () => {
                syncAddressBookPeersFromTable(true);
                const idx = parseInt(btn.dataset.index, 10);
                if (!Number.isNaN(idx)) {
                    addressBookPeers.splice(idx, 1);
                    renderAddressBookPeersTable();
                    abDirty();
                }
            });
        });
        tbody.querySelectorAll('.org-ab-set-password').forEach(btn => {
            btn.addEventListener('click', () => {
                syncAddressBookPeersFromTable(true);
                const peer = addressBookPeers[parseInt(btn.dataset.index, 10)];
                if (peer) setPeerCredential(peer.id);
            });
        });
        tbody.querySelectorAll('.org-ab-clear-password').forEach(btn => {
            btn.addEventListener('click', () => {
                syncAddressBookPeersFromTable(true);
                const peer = addressBookPeers[parseInt(btn.dataset.index, 10)];
                if (peer) clearPeerCredential(peer.id);
            });
        });
    }

    // keepEmpty: keep rows without an ID so row indexes stay aligned while editing
    function syncAddressBookPeersFromTable(keepEmpty) {
        const rows = document.querySelectorAll('#org-address-book-peers-body tr[data-index]');
        const peers = Array.from(rows).map(row => {
            const tagsRaw = row.querySelector('.org-ab-peer-tags')?.value || '';
            return {
                id: row.querySelector('.org-ab-peer-id')?.value.trim() || '',
                alias: row.querySelector('.org-ab-peer-alias')?.value.trim() || '',
                tags: tagsRaw.split(',').map(tag => tag.trim()).filter(Boolean),
            };
        });
        addressBookPeers = keepEmpty ? peers : peers.filter(peer => peer.id);
    }

    function currentAddressBookJSON() {
        const textarea = document.getElementById('org-address-book-json');
        const raw = textarea?.value?.trim() || '{}';
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (_) {
            throw new Error(t('address_book_invalid_json'));
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error(t('address_book_invalid_json'));
        }
        if (parsed.peers && !Array.isArray(parsed.peers)) {
            throw new Error(t('address_book_peers_array_required'));
        }
        if (parsed.tags && !Array.isArray(parsed.tags)) {
            throw new Error(t('address_book_tags_array_required'));
        }
        return parsed;
    }

    async function saveAddressBook() {
        let data;
        try {
            if (!addressBookShowJson) syncAddressBookPeersFromTable(false);
            data = buildAddressBookPayload();
        } catch (err) {
            if (window.UiForm) UiForm.failed(abForm, err.message || t('address_book_invalid_json'));
            return;
        }

        const saveBtn = document.getElementById('save-address-book-btn');
        if (saveBtn) saveBtn.disabled = true;
        try {
            const enabled = !!document.getElementById('org-address-book-enabled')?.checked;
            await api('PUT', '/address-book', { data, enabled });
            addressBookEnabled = enabled;
            if (!addressBookShowJson) renderAddressBookPeersTable();
            if (window.UiForm) UiForm.saved(abForm, t('address_book_saved'));
        } catch (err) {
            if (window.UiForm) UiForm.failed(abForm, `${t('address_book_save_failed')}: ${err.message}`);
        } finally {
            if (saveBtn) saveBtn.disabled = false;
        }
    }

    async function importOrgDevicesIntoAddressBook() {
        try {
            syncAddressBookPeersFromTable(false);
            const data = buildAddressBookPayload();
            const deviceResp = await api('GET', '/devices');
            const devices = deviceResp.devices || [];
            const peers = Array.isArray(data.peers) ? data.peers : [];
            const seen = new Set(peers.map(peer => String(peer.id || '').trim()).filter(Boolean));
            let imported = 0;

            devices.forEach(device => {
                const id = String(device.device_id || '').trim();
                if (!id || seen.has(id)) return;
                const alias = device.department || device.location || device.building || id;
                peers.push({ id, alias, tags: [] });
                seen.add(id);
                imported += 1;
            });

            addressBookPeers = peers.map(p => ({ id: p.id, alias: p.alias || '', tags: Array.isArray(p.tags) ? p.tags : [] }));
            addressBookTags = Array.isArray(data.tags) ? data.tags : [];
            renderAddressBookPeersTable();
            const tagsInput = document.getElementById('org-address-book-tags-input');
            if (tagsInput) tagsInput.value = addressBookTags.join(', ');
            if (imported) abDirty();
            toast(imported ? t('address_book_imported') : t('address_book_import_none'), imported ? 'success' : 'info');
        } catch (err) {
            toast(err.message || t('loading_failed'), 'error');
        }
    }

    async function loadAddressBook() {
        const container = document.getElementById('address-book-container');
        if (!container) return;
        try {
            const data = await api('GET', '/address-book');
            const parsed = parseAddressBook(data.data);
            addressBookEnabled = data.enabled !== false;
            addressBookPeers = Array.isArray(parsed.peers) ? parsed.peers.map(peer => ({
                id: String(peer.id || '').trim(),
                alias: String(peer.alias || '').trim(),
                tags: Array.isArray(peer.tags) ? peer.tags.map(String) : [],
            })) : [];
            addressBookTags = Array.isArray(parsed.tags) ? parsed.tags.map(String) : [];
            await loadPeerCredentialFlags();
            addressBookShowJson = false;
            container.innerHTML = `
                <div class="section">
                    <p class="section-note">${escHtml(t('address_book_intro'))}</p>
                    <label class="check-field">
                        <input type="checkbox" id="org-address-book-enabled" ${addressBookEnabled ? 'checked' : ''}>
                        <span class="check-label">${escHtml(t('address_book_enabled'))}</span>
                    </label>
                </div>
                <div class="section org-address-book-structured" id="org-address-book-structured">
                    <div class="section-head">
                        <h2>${escHtml(t('address_book_contacts'))}</h2>
                        <button type="button" class="btn btn-sm" id="org-address-book-add-peer-btn">${escHtml(t('address_book_add_peer'))}</button>
                        <button type="button" class="btn btn-sm" id="import-org-devices-btn">${escHtml(t('address_book_import_devices'))}</button>
                    </div>
                    <p class="section-note">${escHtml(t('address_book_password_vault_hint'))}</p>
                    <div class="table-scroll">
                        <table class="data-table org-ab-table">
                            <thead>
                                <tr>
                                    <th scope="col">${escHtml(t('address_book_peer_id'))}</th>
                                    <th scope="col">${escHtml(t('address_book_alias'))}</th>
                                    <th scope="col">${escHtml(t('address_book_peer_tags'))}</th>
                                    <th scope="col">${escHtml(t('address_book_preset_password'))}</th>
                                    <th scope="col" class="actions"><span class="sr-only">${escHtml(t('actions'))}</span></th>
                                </tr>
                            </thead>
                            <tbody id="org-address-book-peers-body"></tbody>
                        </table>
                    </div>
                    <div class="form-group form-column">
                        <label class="form-label" for="org-address-book-tags-input">${escHtml(t('address_book_tags_label'))}</label>
                        <input type="text" id="org-address-book-tags-input" class="form-input" value="${escHtml(addressBookTags.join(', '))}" aria-describedby="org-address-book-tags-hint">
                        <p class="form-hint" id="org-address-book-tags-hint">${escHtml(t('address_book_tags_hint'))}</p>
                    </div>
                </div>
                <div class="section org-address-book-advanced">
                    <div><button type="button" class="btn btn-sm" id="org-address-book-toggle-json">${escHtml(t('address_book_show_json'))}</button></div>
                    <div class="form-group org-address-book-json-wrap" id="org-address-book-json-wrap" hidden>
                        <label class="form-label" for="org-address-book-json">${escHtml(t('address_book_json'))}</label>
                        <textarea id="org-address-book-json" class="form-input org-address-book-json" spellcheck="false" aria-describedby="org-address-book-json-hint">${escHtml(formatAddressBook(parsed))}</textarea>
                        <p class="form-hint" id="org-address-book-json-hint">${escHtml(t('address_book_json_hint'))}</p>
                    </div>
                </div>
            `;

            renderAddressBookPeersTable();
            if (window.UiForm && abForm) UiForm.reset(abForm);
            if (!canEdit) container.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });

            document.getElementById('org-address-book-add-peer-btn')?.addEventListener('click', () => {
                syncAddressBookPeersFromTable(true);
                addressBookPeers.push({ id: '', alias: '', tags: [] });
                renderAddressBookPeersTable();
                abDirty();
                const rows = document.querySelectorAll('#org-address-book-peers-body .org-ab-peer-id');
                rows[rows.length - 1]?.focus();
            });

            document.getElementById('import-org-devices-btn')?.addEventListener('click', importOrgDevicesIntoAddressBook);

            document.getElementById('org-address-book-toggle-json')?.addEventListener('click', () => {
                const wrap = document.getElementById('org-address-book-json-wrap');
                const btn = document.getElementById('org-address-book-toggle-json');
                const structured = document.getElementById('org-address-book-structured');
                if (!addressBookShowJson) {
                    syncAddressBookPeersFromTable(false);
                    const payload = buildAddressBookPayload();
                    document.getElementById('org-address-book-json').value = formatAddressBook(payload);
                    addressBookShowJson = true;
                    if (wrap) wrap.hidden = false;
                    if (structured) structured.hidden = true;
                    btn.textContent = t('address_book_hide_json');
                } else {
                    try {
                        const parsedJson = currentAddressBookJSON();
                        addressBookPeers = Array.isArray(parsedJson.peers) ? parsedJson.peers : [];
                        addressBookTags = Array.isArray(parsedJson.tags) ? parsedJson.tags : [];
                        document.getElementById('org-address-book-tags-input').value = addressBookTags.join(', ');
                        addressBookShowJson = false;
                        renderAddressBookPeersTable();
                    } catch (err) {
                        if (window.UiForm) UiForm.failed(abForm, err.message || t('address_book_invalid_json'));
                        return;
                    }
                    if (wrap) wrap.hidden = true;
                    if (structured) structured.hidden = false;
                    btn.textContent = t('address_book_show_json');
                }
            });
        } catch (err) {
            errorState(container, loadErrorMessage(err), err.status === 403 ? null : loadAddressBook);
        }
    }

    abForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveAddressBook();
    });

    // -----------------------------------------------------------------------
    //  Delete organization (danger zone at the end of Settings)
    // -----------------------------------------------------------------------
    document.getElementById('org-delete-btn')?.addEventListener('click', async () => {
        const confirmed = await Modal.confirm({
            title: t('delete_org'),
            message: t('delete_confirm_named', { name: currentOrg.name || orgId }),
            confirmLabel: t('delete_org'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await api('DELETE', '');
            toast(t('org_deleted'), 'success');
            window.location.href = '/organizations';
        } catch (err) {
            toast(`${t('delete_failed')} ${err.message}`, 'error');
        }
    });

    // -----------------------------------------------------------------------
    //  Init
    // -----------------------------------------------------------------------
    async function loadAll() {
        const ok = await loadOrgHeader();
        const body = document.querySelector('.org-detail-body');
        const edit = document.getElementById('org-edit-btn');
        if (body) body.hidden = !ok;
        if (edit) edit.hidden = !ok || !canEdit;
        if (!ok) return;
        await loadUsers();          // devices show user names, so users first
        loadInvitations();
        loadDevices();
        loadSettings();
        loadAddressBook();
        loadDeviceGroups();
    }

    loadAll();
})();
