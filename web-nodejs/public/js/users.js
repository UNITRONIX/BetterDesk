/**
 * BetterDesk Console - Users page
 * Users table, user groups, and the dialogs to add, edit, reset passwords,
 * manage organization membership and delete. Actions the signed-in user
 * may not do are hidden (Utils.can); the server still checks every request.
 */

(function() {
    'use strict';

    document.addEventListener('DOMContentLoaded', init);

    // Roles in the order the picker shows them. "admin" is the older name of
    // super_admin (same permissions, see middleware/auth.js).
    const ROLE_ORDER = ['viewer', 'operator', 'global_admin', 'server_admin', 'super_admin', 'admin', 'pro'];
    const SUPER_ROLES = new Set(['super_admin', 'admin']);
    const UNSCOPED_ROLES = new Set(['super_admin', 'admin', 'global_admin', 'server_admin']);

    // State
    let users = [];
    let usersLoaded = false;
    let userGroups = [];
    let userGroupsLoaded = false;
    let folders = [];
    let foldersLoaded = false;
    let strategies = [];
    let strategiesLoaded = false;
    // userId -> { count, restricted } or 'error'
    const scopeCache = new Map();
    // userId -> [{ id, org_name, role }] or 'error'
    const userOrgsCache = new Map();

    let tableBody, countLine, userGroupsManager, searchInput;
    // Search box text; ?search=<username> (from the global search) fills it on load
    let searchQuery = '';
    // Username from ?search= whose row is scrolled into view after the first render
    let revealUsername = '';

    const me = (window.BetterDesk && window.BetterDesk.user) || {};
    const canCreate = Utils.can('user.create');
    const canEdit = Utils.can('user.edit');
    const canDelete = Utils.can('user.delete');
    const canManageOrgs = Utils.can('org.manage_users');

    const esc = (value) => Utils.escapeHtml(value == null ? '' : String(value));

    function init() {
        tableBody = document.getElementById('users-tbody');
        countLine = document.getElementById('users-count-line');
        userGroupsManager = document.getElementById('user-groups-manager-list');
        searchInput = document.getElementById('users-search');

        const urlSearch = new URLSearchParams(window.location.search).get('search');
        if (urlSearch && urlSearch.trim()) {
            searchQuery = urlSearch.trim();
            revealUsername = searchQuery.toLowerCase();
            if (searchInput) searchInput.value = searchQuery;
        }

        // Only super admins and global admins can give any role, so only they can add users
        if (!canCreate || assignableRoles().length === 0) {
            document.getElementById('add-user-btn')?.closest('.page-actions')?.remove();
        }

        loadUserGroups();
        loadUsers();
        initEventListeners();
        focusUserGroupsFromHash();

        window.addEventListener('app:refresh', loadUsers);
    }

    function focusUserGroupsFromHash() {
        if (window.location.hash !== '#user-groups') return;
        window.requestAnimationFrame(() => {
            document.getElementById('user-groups')?.scrollIntoView({ block: 'start' });
            document.getElementById('add-user-group-btn')?.focus();
        });
    }

    function initEventListeners() {
        document.getElementById('add-user-btn')?.addEventListener('click', () => showUserModal(null));
        document.getElementById('add-user-group-btn')?.addEventListener('click', () => showUserGroupModal(null));

        searchInput?.addEventListener('input', Utils.debounce(() => {
            searchQuery = searchInput.value.trim();
            revealUsername = '';
            syncSearchParam();
            if (usersLoaded) renderUsers();
        }, 150));

        tableBody?.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'clear-search') {
                if (searchInput) searchInput.value = '';
                searchQuery = '';
                syncSearchParam();
                renderUsers();
                searchInput?.focus();
                return;
            }
            const user = users.find(u => String(u.id) === btn.dataset.id);
            if (!user) return;
            switch (btn.dataset.action) {
                case 'edit': showUserModal(user); break;
                case 'reset-password': showResetPasswordModal(user); break;
                case 'organizations': showOrganizationsModal(user); break;
                case 'delete': deleteUser(user); break;
            }
        });

        userGroupsManager?.addEventListener('click', (event) => {
            const btn = event.target.closest('[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'retry-groups') {
                userGroupsLoaded = false;
                renderUserGroupsManager(null);
                loadUserGroups();
                return;
            }
            const group = userGroups.find(item => item.guid === btn.dataset.guid);
            if (!group) return;
            if (btn.dataset.action === 'edit-user-group') showUserGroupModal(group);
            if (btn.dataset.action === 'delete-user-group') deleteUserGroup(group);
        });
    }

    // ------------------------------------------------------------------
    //  Helpers
    // ------------------------------------------------------------------

    /** Keeps ?search= in the address in step with the search box, so a reload shows the same list */
    function syncSearchParam() {
        const url = new URL(window.location.href);
        if (searchQuery) url.searchParams.set('search', searchQuery);
        else url.searchParams.delete('search');
        window.history.replaceState(window.history.state, '', url);
    }

    /** Users the search box lets through: username, email or role name contains every word */
    function visibleUsers() {
        const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
        if (!words.length) return users;
        return users.filter((user) => {
            const text = [user.username, user.email, roleLabel(user.role)].filter(Boolean).join(' ').toLowerCase();
            return words.every(word => text.includes(word));
        });
    }

    /** After the first render for ?search=<username>, bring that user's row into view */
    function revealSearchedUser() {
        if (!revealUsername || !tableBody) return;
        const row = Array.from(tableBody.querySelectorAll('tr[data-username]'))
            .find(tr => tr.dataset.username === revealUsername);
        revealUsername = '';
        if (row) row.scrollIntoView({ block: 'center' });
    }

    function roleLabel(role) {
        const key = 'users.role_' + role;
        const text = _(key);
        return text === key ? (role || '') : text;
    }

    /** Roles the signed-in user may give (mirrors canAssignUserRole in routes/users.routes.js) */
    function assignableRoles() {
        if (SUPER_ROLES.has(me.role)) return ROLE_ORDER.slice();
        if (me.role === 'global_admin') return ['viewer', 'operator', 'pro'];
        return [];
    }

    function providerOf(user) {
        return String(user.auth_provider || 'local').toLowerCase();
    }

    function providerLabel(provider) {
        const key = 'users.provider_' + provider;
        const text = _(key);
        return text === key ? provider : text;
    }

    function setStatus(el, message, ok) {
        if (!el) return;
        el.textContent = message || '';
        el.classList.toggle('is-ok', !!ok);
        el.classList.toggle('is-error', !ok);
    }

    function errorText(error) {
        return (error && error.message) || _('errors.server_error');
    }

    /** Same rules as authService.validatePasswordStrength: weak passwords are refused */
    function passwordStrength(password) {
        let score = 0;
        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password)) score++;
        if (/[A-Z]/.test(password)) score++;
        if (/[0-9]/.test(password)) score++;
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        return score <= 2 ? 'weak' : score <= 4 ? 'medium' : 'strong';
    }

    function passwordFieldHtml(id, label, hint) {
        return `
            <div class="form-group">
                <label class="form-label" for="${id}">${esc(label)}</label>
                <div class="password-wrapper">
                    <input type="password" id="${id}" class="form-input" autocomplete="new-password" spellcheck="false"
                           aria-describedby="${id}-hint ${id}-strength">
                    <button type="button" class="password-toggle" data-password-toggle="${id}" aria-pressed="false"
                            aria-label="${esc(_('users.show_password'))}">
                        <span class="material-icons" aria-hidden="true">visibility</span>
                    </button>
                </div>
                <p class="form-hint" id="${id}-hint">${esc(hint)}</p>
                <p class="form-hint" id="${id}-strength" aria-live="polite"></p>
            </div>`;
    }

    function wirePasswordField(id) {
        const input = document.getElementById(id);
        const toggle = document.querySelector(`[data-password-toggle="${id}"]`);
        const strength = document.getElementById(`${id}-strength`);
        toggle?.addEventListener('click', () => {
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
            toggle.querySelector('.material-icons').textContent = show ? 'visibility_off' : 'visibility';
        });
        input?.addEventListener('input', () => {
            if (!strength) return;
            if (!input.value) {
                strength.textContent = '';
                return;
            }
            const level = passwordStrength(input.value);
            strength.textContent = _('users.strength_line', { strength: _('users.strength_' + level) }) +
                (level === 'weak' ? ' ' + _('users.password_weak_hint') : '');
        });
    }

    // ------------------------------------------------------------------
    //  Users table
    // ------------------------------------------------------------------

    function stateRow(html) {
        if (tableBody) tableBody.innerHTML = `<tr><td colspan="8" class="state-cell">${html}</td></tr>`;
    }

    async function loadUsers() {
        try {
            const response = await Utils.api('/api/users');
            users = response.users || [];
            usersLoaded = true;
            scopeCache.clear();
            userOrgsCache.clear();
            renderUsers();
            loadScopes();
            loadUsersOrganizations();
        } catch (error) {
            console.error('Failed to load users:', error);
            if (countLine) countLine.textContent = '';
            stateRow(`<span class="text-danger">${esc(error.status === 403 ? errorText(error) : _('users.list_failed'))}</span>
                <button type="button" class="btn btn-sm" id="users-retry-btn">${esc(_('actions.retry'))}</button>`);
            document.getElementById('users-retry-btn')?.addEventListener('click', () => {
                stateRow(esc(_('users.loading_list')));
                loadUsers();
            });
        }
    }

    function renderCount(shown) {
        if (!countLine) return;
        const n = users.length;
        if (searchQuery && shown !== n) {
            countLine.innerHTML = esc(_('users.count_filtered', { shown: '\u0000', count: n }))
                .replace('\u0000', `<strong>${shown}</strong>`);
            return;
        }
        countLine.innerHTML = esc(_(n === 1 ? 'users.count_one' : 'users.count_many', { count: '\u0000' }))
            .replace('\u0000', `<strong>${n}</strong>`);
    }

    function scopeText(userId) {
        const scope = scopeCache.get(Number(userId));
        if (!scope) return { text: '…', muted: true };
        if (scope === 'error') return { text: _('users.scope_unknown'), muted: true };
        if (!scope.restricted) return { text: _('users.scope_all'), muted: false };
        if (scope.count === 0) return { text: _('users.scope_none'), muted: false };
        return { text: _(scope.count === 1 ? 'users.scope_count_one' : 'users.scope_count_many', { count: scope.count }), muted: false };
    }

    function orgsHtml(userId) {
        const orgs = userOrgsCache.get(Number(userId));
        if (!orgs) return '<span class="text-muted">…</span>';
        if (orgs === 'error') return Utils.emptyHtml(_('users.orgs_unknown'));
        if (!orgs.length) return Utils.emptyHtml(_('users.orgs_none'));
        return orgs.map(o => esc(o.org_name)).join(', ');
    }

    function renderUsers() {
        if (!tableBody) return;
        const list = visibleUsers();
        renderCount(list.length);
        if (users.length === 0) {
            stateRow(esc(_('users.empty_text')));
            return;
        }
        if (list.length === 0) {
            stateRow(`${esc(_('users.no_match', { query: searchQuery }))}
                <button type="button" class="btn btn-sm" data-action="clear-search">${esc(_('users.clear_search'))}</button>`);
            return;
        }

        tableBody.innerHTML = list.map((user, i) => {
            const id = esc(user.id);
            const provider = providerOf(user);
            const isLocal = provider === 'local';
            const isSelf = Number(user.id) === Number(me.id);
            const groupNames = (Array.isArray(user.user_groups) ? user.user_groups : [])
                .map(guid => (userGroups.find(g => g.guid === guid) || {}).name || guid);
            const subs = [];
            if (groupNames.length) subs.push(_('users.groups_line', { groups: groupNames.join(', ') }));
            if (isSelf) subs.push(_('users.this_is_you'));

            const scope = scopeText(user.id);
            const created = Utils.parseDate(user.created_at);
            const lastLogin = Utils.parseDate(user.last_login);

            // Row actions: Edit as a button, the rest in the row menu
            const menuItems = [];
            if (canEdit && isLocal) {
                menuItems.push(`<button type="button" class="menu-item" role="menuitem" data-action="reset-password" data-id="${id}">${Utils.icon('password')}<span>${esc(_('users.reset_password_menu'))}</span></button>`);
            }
            menuItems.push(`<button type="button" class="menu-item" role="menuitem" data-action="organizations" data-id="${id}">${Utils.icon('organization')}<span>${esc(_('users.organizations_menu'))}</span></button>`);
            if (canDelete && !isSelf) {
                menuItems.push('<span class="menu-divider" role="separator"></span>');
                menuItems.push(`<button type="button" class="menu-item danger" role="menuitem" data-action="delete" data-id="${id}">${Utils.icon('delete')}<span>${esc(_('users.delete_menu'))}</span></button>`);
            }
            let actions = '';
            if (canEdit) {
                actions += `<button type="button" class="btn btn-sm" data-action="edit" data-id="${id}">${esc(_('users.edit'))}<span class="sr-only"> ${esc(user.username)}</span></button>`;
            }
            if (!canEdit && menuItems.length === 1) {
                actions += `<button type="button" class="btn btn-sm" data-action="organizations" data-id="${id}">${esc(_('users.organizations'))}<span class="sr-only"> ${esc(user.username)}</span></button>`;
            } else {
                const menuId = `user-menu-${i}`;
                const up = list.length > 3 && i >= list.length - 2 ? ' menu-up' : '';
                actions += `
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                                aria-controls="${menuId}" aria-label="${esc(_('users.actions_for', { username: user.username }))}">
                            <span class="material-icons" aria-hidden="true">more_vert</span>
                        </button>
                        <span class="menu menu-end${up}" id="${menuId}" role="menu">${menuItems.join('')}</span>
                    </span>`;
            }

            return `
            <tr data-id="${id}" data-username="${esc(String(user.username || '').toLowerCase())}">
                <td>
                    ${Utils.userHtml(user, { avatar: true })}
                    ${subs.length ? `<span class="cell-sub">${esc(subs.join(' · '))}</span>` : ''}
                </td>
                <td>${user.email ? esc(user.email) : Utils.emptyHtml()}</td>
                <td class="user-role"><span class="tag-set">${Utils.tagHtml(roleLabel(user.role))}${isLocal ? '' : Utils.tagHtml(providerLabel(provider), { title: _('users.provider_account', { provider: providerLabel(provider) }) })}</span></td>
                <td class="user-scope-cell${scope.muted ? ' text-muted' : ''}" data-user-id="${id}">${esc(scope.text)}</td>
                <td class="user-orgs-cell" data-user-id="${id}">${orgsHtml(user.id)}</td>
                <td class="user-date">${Utils.timeHtml(lastLogin, { empty: _('users.never') })}</td>
                <td class="user-date">${Utils.timeHtml(created, { relative: false, format: { hour: undefined, minute: undefined } })}</td>
                <td class="actions">${actions}</td>
            </tr>`;
        }).join('');
        revealSearchedUser();
    }

    /** Devices each user can see. Unscoped roles and users without limits see all devices. */
    async function loadScopes() {
        const list = users.slice();
        await Promise.all(list.map(async (user) => {
            try {
                const resp = await Utils.api(`/api/users/${encodeURIComponent(user.id)}/effective-scope`);
                scopeCache.set(Number(user.id), {
                    count: Number(resp && resp.count) || 0,
                    restricted: !!(resp && resp.restricted)
                });
            } catch (error) {
                scopeCache.set(Number(user.id), 'error');
            }
            const cell = tableBody?.querySelector(`.user-scope-cell[data-user-id="${CSS.escape(String(user.id))}"]`);
            if (cell) {
                const scope = scopeText(user.id);
                cell.textContent = scope.text;
                cell.classList.toggle('text-muted', scope.muted);
            }
        }));
    }

    function normalizeOrgPayload(org) {
        const id = String(org.org_id || org.id || org.organization_id || '');
        return {
            ...org,
            id,
            org_id: id,
            name: org.name || org.org_name || (id ? 'Org #' + id : ''),
            org_name: org.org_name || org.name || (id ? 'Org #' + id : ''),
            role: org.role || ''
        };
    }

    async function fetchUserOrgs(userId) {
        const resp = await Utils.api(`/api/users/${encodeURIComponent(userId)}/organizations`);
        return (resp.organizations || []).map(normalizeOrgPayload).filter(o => o.id);
    }

    function renderUserOrgsCell(userId) {
        const cell = tableBody?.querySelector(`.user-orgs-cell[data-user-id="${CSS.escape(String(userId))}"]`);
        if (cell) cell.innerHTML = orgsHtml(userId);
    }

    async function loadUsersOrganizations() {
        await Promise.all(users.map(async (user) => {
            try {
                userOrgsCache.set(Number(user.id), await fetchUserOrgs(user.id));
            } catch (error) {
                userOrgsCache.set(Number(user.id), 'error');
            }
            renderUserOrgsCell(user.id);
        }));
    }

    // ------------------------------------------------------------------
    //  Add / edit user
    // ------------------------------------------------------------------

    async function loadFolders() {
        try {
            const response = await Utils.api('/api/folders');
            folders = response.folders || [];
        } catch (error) {
            folders = [];
        }
        foldersLoaded = true;
    }

    async function loadStrategies() {
        try {
            const response = await Utils.api('/api/panel/strategies');
            strategies = response.strategies || [];
        } catch (error) {
            strategies = [];
        }
        strategiesLoaded = true;
    }

    function roleChoicesHtml(user) {
        const allowed = new Set(assignableRoles());
        const current = user ? user.role : 'viewer';
        const providerLocked = user && providerOf(user) === 'ldap';
        // A role the editor may not give stays visible (checked, disabled) so the current role is clear
        const shown = ROLE_ORDER.filter(role => allowed.has(role) || role === current);
        return shown.map(role => {
            const disabled = providerLocked || !allowed.has(role);
            return `
                <li><label class="choice">
                    <input type="radio" name="role" value="${esc(role)}"${role === current ? ' checked' : ''}${disabled ? ' disabled' : ''}>
                    <span class="choice-title">${esc(roleLabel(role))}</span>
                    <span class="choice-desc">${esc(_('users.role_desc_' + role))}</span>
                </label></li>`;
        }).join('');
    }

    function checkListHtml(name, items, selected, emptyText) {
        if (!items.length) return `<p class="form-hint">${esc(emptyText)}</p>`;
        return `<div class="check-list">${items.map(item => `
            <label class="checkbox-row">
                <input type="checkbox" name="${name}" value="${esc(item.value)}"${selected.has(String(item.value)) ? ' checked' : ''}>
                <span>${esc(item.label)}</span>
            </label>`).join('')}</div>`;
    }

    function deviceAccessHtml(user) {
        const groupSel = new Set((user?.user_groups || []).map(String));
        const folderSel = new Set((user?.folder_ids || []).map(String));
        const peers = Array.isArray(user?.peer_grants) ? user.peer_grants.join(', ') : '';
        const strategy = String(user?.strategy_guid || '');
        const limited = groupSel.size + folderSel.size > 0 || peers || strategy;
        return `
            <details class="disclosure user-access"${limited ? ' open' : ''}>
                <summary><h3>${esc(_('users.device_access'))}</h3></summary>
                <p class="form-hint user-access-note">${esc(_('users.scope_hint'))}</p>
                <fieldset class="form-group">
                    <legend class="form-label">${esc(_('users.user_groups'))}</legend>
                    ${checkListHtml('user-group', userGroups.map(g => ({ value: g.guid, label: g.name || g.guid })), groupSel, _('users.no_user_groups'))}
                </fieldset>
                <fieldset class="form-group">
                    <legend class="form-label">${esc(_('users.user_folders'))}</legend>
                    ${checkListHtml('user-folder', folders.map(f => ({ value: f.id, label: f.name || f.id })), folderSel, _('users.no_folders'))}
                    <p class="form-hint">${esc(_('users.user_folders_hint'))}</p>
                </fieldset>
                <div class="form-group">
                    <label class="form-label" for="user-direct-devices">${esc(_('users.user_direct_devices'))}</label>
                    <input type="text" id="user-direct-devices" class="form-input" spellcheck="false" autocomplete="off"
                           value="${esc(peers)}" aria-describedby="user-direct-devices-hint">
                    <p class="form-hint" id="user-direct-devices-hint">${esc(_('users.user_direct_devices_hint'))}</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="user-strategy">${esc(_('users.pro_strategy_label'))}</label>
                    <select id="user-strategy" class="form-select" aria-describedby="user-strategy-hint">
                        <option value="">${esc(_('users.pro_strategy_none'))}</option>
                        ${strategies.map(st => `<option value="${esc(st.guid)}"${st.guid === strategy ? ' selected' : ''}>${esc(st.name || st.guid)}</option>`).join('')}
                    </select>
                    <p class="form-hint" id="user-strategy-hint">${esc(_('users.pro_strategy_hint'))}</p>
                </div>
            </details>`;
    }

    async function showUserModal(user) {
        const loads = [];
        if (!userGroupsLoaded) loads.push(loadUserGroups());
        if (!foldersLoaded) loads.push(loadFolders());
        if (!strategiesLoaded) loads.push(loadStrategies());
        await Promise.all(loads);

        const editing = !!user;
        const provider = editing ? providerOf(user) : 'local';
        const isLocal = provider === 'local';

        let accountHtml;
        if (editing) {
            accountHtml = `
                <dl class="facts user-facts">
                    <dt>${esc(_('users.username'))}</dt><dd>${Utils.userHtml(user, { avatar: true })}</dd>
                    <dt>${esc(_('users.sign_in_with'))}</dt><dd>${Utils.tagHtml(isLocal ? _('users.provider_local_account') : providerLabel(provider))}</dd>
                </dl>
                ${isLocal ? passwordFieldHtml('user-password', _('users.new_password'), _('users.password_leave_empty'))
                    : `<p class="form-hint user-provider-note">${esc(_('users.provider_managed_hint'))}</p>`}`;
        } else {
            accountHtml = `
                <div class="form-group">
                    <label class="form-label" for="user-username">${esc(_('users.username'))}</label>
                    <input type="text" id="user-username" class="form-input" autocomplete="off" spellcheck="false"
                           maxlength="32" aria-describedby="user-username-hint">
                    <p class="form-hint" id="user-username-hint">${esc(_('users.username_hint'))}</p>
                </div>
                ${passwordFieldHtml('user-password', _('users.password'), _('users.password_hint'))}`;
        }

        Modal.show({
            title: editing ? _('users.edit_user_named', { username: user.username }) : _('users.add_user'),
            content: `
                <form id="user-form" class="user-form" novalidate>
                    ${accountHtml}
                    <div class="form-group">
                        <label class="form-label" for="user-email">${esc(_('users.email'))}</label>
                        <input type="email" id="user-email" class="form-input" autocomplete="off" spellcheck="false"
                               value="${esc(editing ? user.email || '' : '')}" aria-describedby="user-email-hint">
                        <p class="form-hint" id="user-email-hint">${esc(_('users.email_hint'))}</p>
                    </div>
                    <fieldset class="form-group">
                        <legend class="form-label">${esc(_('users.role'))}</legend>
                        <div role="radiogroup" aria-label="${esc(_('users.role'))}"><ul class="choice-list">${roleChoicesHtml(user)}</ul></div>
                        <p class="form-hint">${esc(_('users.role_note'))}</p>
                    </fieldset>
                    ${deviceAccessHtml(user)}
                    <p class="form-status is-error" id="user-form-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: editing ? _('actions.save') : _('users.create'), class: 'btn-primary', onClick: () => submitUserForm(user) }
            ],
            onOpen: () => {
                wirePasswordField('user-password');
                document.getElementById('user-form')?.addEventListener('submit', (event) => {
                    event.preventDefault();
                    submitUserForm(user);
                });
                (document.getElementById('user-username') || document.getElementById('user-email'))?.focus();
            }
        });
    }

    async function submitUserForm(user) {
        const form = document.getElementById('user-form');
        const status = document.getElementById('user-form-status');
        if (!form) return;
        const editing = !!user;
        const provider = editing ? providerOf(user) : 'local';

        const username = document.getElementById('user-username')?.value.trim() || '';
        const password = document.getElementById('user-password')?.value || '';
        const email = document.getElementById('user-email')?.value.trim() || '';
        const role = form.querySelector('input[name="role"]:checked')?.value || 'viewer';
        const groupGuids = Array.from(form.querySelectorAll('input[name="user-group"]:checked')).map(i => i.value);
        const folderIds = Array.from(form.querySelectorAll('input[name="user-folder"]:checked'))
            .map(i => Number.parseInt(i.value, 10)).filter(Number.isFinite);
        const strategyGuid = document.getElementById('user-strategy')?.value || '';
        const peerIds = (document.getElementById('user-direct-devices')?.value || '')
            .split(/[,;\s]+/).map(v => v.trim()).filter(Boolean);

        // Check what the server would refuse, and say so here
        let problem = '';
        if (!editing && !username) problem = _('users.username_required');
        else if (!editing && !/^[a-zA-Z0-9_]{3,32}$/.test(username)) problem = _('users.invalid_username');
        else if (!editing && !password) problem = _('users.password_required');
        if (!problem && password) {
            if (password.length < 8) problem = _('users.password_too_short');
            else if (passwordStrength(password) === 'weak') problem = _('users.password_weak_hint');
        }
        if (problem) {
            setStatus(status, problem, false);
            return;
        }
        setStatus(status, _('users.saving'), true);

        try {
            if (editing) {
                const data = { email, groupGuids, folderIds, peerIds, strategyGuid };
                // Send the role only when it changed: an editor may keep a role they could not give
                if (provider !== 'ldap' && role !== user.role) data.role = role;
                if (provider === 'local' && password) data.password = password;
                await Utils.api(`/api/users/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: data });
                Modal.close();
                Notifications.success(_('users.user_updated_named', { username: user.username }));
            } else {
                await Utils.api('/api/users', {
                    method: 'POST',
                    body: { username, password, role, email, groupGuids, folderIds, peerIds, strategyGuid }
                });
                Modal.close();
                Notifications.success(_('users.user_created_named', { username }));
            }
            loadUsers();
            loadUserGroups();
        } catch (error) {
            setStatus(status, errorText(error), false);
        }
    }

    // ------------------------------------------------------------------
    //  Reset password
    // ------------------------------------------------------------------

    function showResetPasswordModal(user) {
        Modal.show({
            title: _('users.reset_password_for', { username: user.username }),
            content: `
                <form id="reset-password-form" novalidate>
                    ${passwordFieldHtml('reset-password-input', _('users.new_password'), _('users.password_hint'))}
                    <p class="form-status is-error" id="reset-password-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('users.set_password'), class: 'btn-primary', onClick: () => submitResetPassword(user) }
            ],
            onOpen: () => {
                wirePasswordField('reset-password-input');
                document.getElementById('reset-password-form')?.addEventListener('submit', (event) => {
                    event.preventDefault();
                    submitResetPassword(user);
                });
                document.getElementById('reset-password-input')?.focus();
            }
        });
    }

    async function submitResetPassword(user) {
        const status = document.getElementById('reset-password-status');
        const newPassword = document.getElementById('reset-password-input')?.value || '';
        let problem = '';
        if (!newPassword) problem = _('users.password_required');
        else if (newPassword.length < 8) problem = _('users.password_too_short');
        else if (passwordStrength(newPassword) === 'weak') problem = _('users.password_weak_hint');
        if (problem) {
            setStatus(status, problem, false);
            return;
        }
        setStatus(status, _('users.saving'), true);
        try {
            await Utils.api(`/api/users/${encodeURIComponent(user.id)}/reset-password`, {
                method: 'POST',
                body: { newPassword }
            });
            Modal.close();
            Notifications.success(_('users.password_reset_named', { username: user.username }));
        } catch (error) {
            setStatus(status, errorText(error), false);
        }
    }

    // ------------------------------------------------------------------
    //  Delete user
    // ------------------------------------------------------------------

    async function deleteUser(user) {
        const confirmed = await Modal.confirm({
            title: _('users.delete_title'),
            message: _('users.delete_confirm', { username: user.username }),
            confirmLabel: _('users.delete_title'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await Utils.api(`/api/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
            Notifications.success(_('users.deleted_named', { username: user.username }));
            loadUsers();
            loadUserGroups();
        } catch (error) {
            Notifications.error(errorText(error), _('users.delete_failed', { username: user.username }));
        }
    }

    // ------------------------------------------------------------------
    //  Organizations
    // ------------------------------------------------------------------

    async function showOrganizationsModal(user) {
        let userOrgs;
        let allOrgs = [];
        try {
            userOrgs = await fetchUserOrgs(user.id);
        } catch (error) {
            Notifications.error(errorText(error), _('errors.load_orgs_failed'));
            return;
        }
        let allOrgsFailed = false;
        if (canManageOrgs) {
            try {
                const resp = await Utils.api('/api/panel/org');
                allOrgs = (resp.organizations || []).map(normalizeOrgPayload).filter(o => o.id);
            } catch (error) {
                allOrgsFailed = true;
            }
        }

        Modal.show({
            title: _('users.user_organizations', { username: user.username }),
            content: `
                <div class="user-orgs-dialog">
                    <p class="form-hint">${esc(_('users.org_membership_hint'))}</p>
                    <ul class="list" id="user-orgs-list"></ul>
                    <div id="user-orgs-add"></div>
                    <p class="form-status" id="user-orgs-status" role="status" aria-live="polite"></p>
                </div>`,
            size: 'medium',
            buttons: [
                { label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }
            ],
            onOpen: () => renderOrgsDialog()
        });

        function orgRoleLabel(role) {
            const key = 'organizations.role_' + role;
            const text = _(key);
            return text === key ? role : text;
        }

        function renderOrgsDialog(focusSelector) {
            const list = document.getElementById('user-orgs-list');
            const add = document.getElementById('user-orgs-add');
            if (!list || !add) return;

            list.innerHTML = userOrgs.length
                ? userOrgs.map(org => `
                    <li class="list-row">
                        <span class="row-main">
                            <span class="row-title">${esc(org.org_name)}</span>
                            ${org.role ? `<span class="row-sub"><span class="sr-only">${esc(_('organizations.org_role'))}: </span>${Utils.tagHtml(orgRoleLabel(org.role))}</span>` : ''}
                        </span>
                        ${canManageOrgs ? `<span class="row-end"><button type="button" class="btn btn-sm btn-danger-quiet" data-remove-org="${esc(org.id)}">${esc(_('actions.remove'))}<span class="sr-only"> ${esc(org.org_name)}</span></button></span>` : ''}
                    </li>`).join('')
                : `<li class="list-row is-empty">${esc(_('users.no_organizations'))}</li>`;

            const memberIds = new Set(userOrgs.map(o => o.id));
            const available = allOrgs.filter(o => !memberIds.has(String(o.id)));
            if (!canManageOrgs) {
                add.innerHTML = '';
            } else if (allOrgsFailed) {
                add.innerHTML = `<p class="notice error">${esc(_('errors.load_orgs_failed'))}</p>`;
            } else if (!available.length) {
                add.innerHTML = `<p class="form-hint">${esc(allOrgs.length ? _('users.all_orgs_assigned') : _('users.no_orgs_exist'))}</p>`;
            } else {
                add.innerHTML = `
                    <form class="user-orgs-add-form" id="user-orgs-add-form" novalidate>
                        <h3>${esc(_('users.add_to_org'))}</h3>
                        <div class="form-group">
                            <label class="form-label" for="add-org-select">${esc(_('users.organization'))}</label>
                            <select id="add-org-select" class="form-select">
                                ${available.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="add-org-role">${esc(_('organizations.org_role'))}</label>
                            <select id="add-org-role" class="form-select">
                                ${['user', 'operator', 'admin', 'owner'].map(r => `<option value="${r}">${esc(orgRoleLabel(r))}</option>`).join('')}
                            </select>
                        </div>
                        <button type="submit" class="btn" id="add-org-btn">${Utils.icon('add')}${esc(_('users.add_to_org_button'))}</button>
                    </form>`;
                document.getElementById('user-orgs-add-form')?.addEventListener('submit', (event) => {
                    event.preventDefault();
                    addOrg();
                });
            }

            list.querySelectorAll('[data-remove-org]').forEach(btn => {
                btn.addEventListener('click', () => removeOrg(btn.dataset.removeOrg));
            });
            if (focusSelector) {
                const target = document.querySelector(focusSelector) || document.querySelector('.modal-footer .btn');
                target?.focus();
            }
        }

        async function refreshAfterChange() {
            userOrgs = await fetchUserOrgs(user.id);
            userOrgsCache.set(Number(user.id), userOrgs);
            renderUserOrgsCell(user.id);
        }

        async function addOrg() {
            const status = document.getElementById('user-orgs-status');
            const select = document.getElementById('add-org-select');
            const orgId = select?.value;
            const role = document.getElementById('add-org-role')?.value || 'user';
            if (!orgId) return;
            const name = select.options[select.selectedIndex]?.textContent || orgId;
            const btn = document.getElementById('add-org-btn');
            if (btn) btn.disabled = true;
            try {
                await Utils.api(`/api/users/${encodeURIComponent(user.id)}/organizations`, {
                    method: 'POST',
                    body: { org_id: orgId, role }
                });
                await refreshAfterChange();
                renderOrgsDialog('#add-org-select');
                setStatus(document.getElementById('user-orgs-status'), _('users.org_added_named', { org: name }), true);
            } catch (error) {
                if (btn) btn.disabled = false;
                setStatus(status, errorText(error), false);
            }
        }

        async function removeOrg(orgId) {
            const org = userOrgs.find(o => o.id === orgId);
            const name = org ? org.org_name : orgId;
            try {
                await Utils.api(`/api/panel/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(user.id)}`, { method: 'DELETE' });
                await refreshAfterChange();
                renderOrgsDialog('#add-org-select');
                setStatus(document.getElementById('user-orgs-status'), _('users.org_removed_named', { org: name }), true);
            } catch (error) {
                setStatus(document.getElementById('user-orgs-status'), errorText(error), false);
            }
        }
    }

    // ------------------------------------------------------------------
    //  User groups
    // ------------------------------------------------------------------

    async function loadUserGroups() {
        try {
            const response = await Utils.api('/api/panel/user-groups');
            userGroups = response.groups || [];
            userGroupsLoaded = true;
            renderUserGroupsManager();
        } catch (error) {
            userGroups = [];
            userGroupsLoaded = true;
            renderUserGroupsManager(error);
            console.error('Failed to load user groups:', error);
        }
        if (usersLoaded) renderUsers();
    }

    function renderUserGroupsManager(error) {
        if (!userGroupsManager) return;
        if (error === null || !userGroupsLoaded) {
            userGroupsManager.innerHTML = `<li class="list-row is-empty">${esc(_('users.loading_user_groups'))}</li>`;
            return;
        }
        if (error) {
            userGroupsManager.innerHTML = `<li class="list-row is-empty"><span class="row-main text-danger">${esc(_('users.groups_failed'))}</span>
                <span class="row-end"><button type="button" class="btn btn-sm" data-action="retry-groups">${esc(_('actions.retry'))}</button></span></li>`;
            return;
        }
        if (!userGroups.length) {
            userGroupsManager.innerHTML = `<li class="list-row is-empty">${esc(_('users.no_user_groups'))}</li>`;
            return;
        }

        // The side column is narrow: members go under the name, Edit and Delete into the row menu
        userGroupsManager.innerHTML = userGroups.map((group, i) => {
            const guid = esc(group.guid);
            const name = esc(group.name || group.guid);
            const count = Number(group.member_count) || 0;
            const members = esc(_(count === 1 ? 'users.members_one' : 'users.members_many', { count }));
            const menuId = `user-group-menu-${i}`;
            const up = userGroups.length > 3 && i >= userGroups.length - 2 ? ' menu-up' : '';
            return `
            <li class="list-row user-group-row" data-guid="${guid}">
                <span class="row-main">
                    <span class="row-title">${name}</span>
                    <span class="row-sub"><span class="user-group-members">${members}</span>${group.note ? ` · ${esc(group.note)}` : ''}</span>
                </span>
                ${canEdit ? `
                <span class="row-end">
                    <span class="menu-anchor">
                        <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                                aria-controls="${menuId}" aria-label="${esc(_('users.group_actions_for', { name: group.name || group.guid }))}">
                            <span class="material-icons" aria-hidden="true">more_vert</span>
                        </button>
                        <span class="menu menu-end${up}" id="${menuId}" role="menu">
                            <button type="button" class="menu-item" role="menuitem" data-action="edit-user-group" data-guid="${guid}">${Utils.icon('edit')}<span>${esc(_('users.edit'))}</span></button>
                            <span class="menu-divider" role="separator"></span>
                            <button type="button" class="menu-item danger" role="menuitem" data-action="delete-user-group" data-guid="${guid}">${Utils.icon('delete')}<span>${esc(_('actions.delete'))}</span></button>
                        </span>
                    </span>
                </span>` : ''}
            </li>`;
        }).join('');
    }

    function showUserGroupModal(group) {
        const editing = !!group;
        Modal.show({
            title: editing ? _('users.edit_user_group') : _('users.create_user_group_title'),
            content: `
                <form id="user-group-form" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="user-group-name">${esc(_('users.group_name'))}</label>
                        <input type="text" id="user-group-name" class="form-input" maxlength="80" autocomplete="off" value="${esc(group?.name || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="user-group-note">${esc(_('users.group_note'))}</label>
                        <textarea id="user-group-note" class="form-input" maxlength="500" rows="3" aria-describedby="user-group-note-hint">${esc(group?.note || '')}</textarea>
                        <p class="form-hint" id="user-group-note-hint">${esc(_('users.group_note_hint'))}</p>
                    </div>
                    <p class="form-status is-error" id="user-group-status" role="alert"></p>
                    <button type="submit" hidden></button>
                </form>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: editing ? _('actions.save') : _('users.create_user_group'), class: 'btn-primary', onClick: () => saveUserGroup(group) }
            ],
            onOpen: () => {
                document.getElementById('user-group-form')?.addEventListener('submit', (event) => {
                    event.preventDefault();
                    saveUserGroup(group);
                });
                document.getElementById('user-group-name')?.focus();
            }
        });
    }

    async function saveUserGroup(group) {
        const status = document.getElementById('user-group-status');
        const name = document.getElementById('user-group-name')?.value.trim() || '';
        const note = document.getElementById('user-group-note')?.value.trim() || '';
        if (!name) {
            setStatus(status, _('users.group_name_required'), false);
            return;
        }
        setStatus(status, _('users.saving'), true);
        try {
            const url = group ? `/api/panel/user-groups/${encodeURIComponent(group.guid)}` : '/api/panel/user-groups';
            await Utils.api(url, { method: group ? 'PATCH' : 'POST', body: { name, note } });
            Modal.close();
            Notifications.success(_(group ? 'users.group_updated_named' : 'users.group_created_named', { name }));
            await loadUserGroups();
        } catch (error) {
            setStatus(status, errorText(error), false);
        }
    }

    async function deleteUserGroup(group) {
        const name = group.name || group.guid;
        const confirmed = await Modal.confirm({
            title: _('users.delete_user_group'),
            message: _('users.delete_user_group_confirm', { name }),
            confirmLabel: _('users.delete_user_group'),
            danger: true
        });
        if (!confirmed) return;
        try {
            await Utils.api(`/api/panel/user-groups/${encodeURIComponent(group.guid)}`, { method: 'DELETE' });
            Notifications.success(_('users.group_deleted_named', { name }));
            await loadUserGroups();
            loadUsers();
            // The row and its menu are gone; keep focus in the section
            document.getElementById('add-user-group-btn')?.focus();
        } catch (error) {
            Notifications.error(errorText(error), _('users.group_delete_failed', { name }));
        }
    }
})();
