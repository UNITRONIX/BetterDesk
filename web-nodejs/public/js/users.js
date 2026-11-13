/**
 * BetterDesk Console - Users Page
 * User management for admins
 */

(function() {
    'use strict';
    
    document.addEventListener('DOMContentLoaded', init);
    
    // State
    let users = [];
    let userGroups = [];
    let userGroupsLoaded = false;
    let folders = [];
    let foldersLoaded = false;
    let strategies = [];
    let strategiesLoaded = false;
    let editingUserId = null;
    let accessCatalog = null;
    let accessPolicyState = null;
    // Cache: userId -> [{ id, org_id, name, org_name, role }]
    const userOrgsCache = new Map();
    
    // Elements
    let tableBody, emptyState, userGroupsManager;
    let contextMenuEl = null;
    let contextMenuState = null;
    
    function init() {
        tableBody = document.getElementById('users-tbody');
        emptyState = document.getElementById('users-empty');
        userGroupsManager = document.getElementById('user-groups-manager-list');
        
        loadUserGroups();
        loadFolders();
        loadStrategies();
        loadUsers();
        initEventListeners();
        initContextMenu();
        focusUserGroupsFromHash();
        
        window.addEventListener('app:refresh', loadUsers);
    }

    function focusUserGroupsFromHash() {
        if (window.location.hash !== '#user-groups') return;
        window.requestAnimationFrame(() => {
            document.getElementById('user-groups')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            document.getElementById('add-user-group-btn')?.focus();
        });
    }
    
    function initEventListeners() {
        // Add user button
        document.getElementById('add-user-btn')?.addEventListener('click', showAddUserModal);
        document.getElementById('add-user-group-btn')?.addEventListener('click', () => showUserGroupModal());
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#users-context-menu')) closeContextMenu();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeContextMenu();
        });
        window.addEventListener('resize', closeContextMenu);
        window.addEventListener('scroll', closeContextMenu, true);
    }

    function initContextMenu() {
        contextMenuEl = document.getElementById('users-context-menu');
        if (!contextMenuEl) return;
        contextMenuEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn || !contextMenuState) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            const state = contextMenuState;
            closeContextMenu();
            handleAction(action, state.id, state);
        });
    }

    function buildUserMenuHtml(user) {
        const provider = (user.auth_provider || 'local').toLowerCase();
        const isLocal = provider === 'local';
        return `
            <button type="button" class="users-context-item" data-action="organizations" role="menuitem">
                <span class="material-icons">business</span>
                <span>${Utils.escapeHtml(_('users.organizations'))}</span>
            </button>
            ${isLocal ? `<button type="button" class="users-context-item" data-action="reset-password" role="menuitem">
                <span class="material-icons">lock_reset</span>
                <span>${Utils.escapeHtml(_('users.reset_password'))}</span>
            </button>` : ''}
            <button type="button" class="users-context-item" data-action="edit" role="menuitem">
                <span class="material-icons">edit</span>
                <span>${Utils.escapeHtml(_('users.edit'))}</span>
            </button>
            <div class="users-context-divider" role="separator"></div>
            <button type="button" class="users-context-item danger" data-action="delete" role="menuitem">
                <span class="material-icons">delete</span>
                <span>${Utils.escapeHtml(_('actions.delete'))}</span>
            </button>`;
    }

    function buildUserGroupMenuHtml() {
        return `
            <button type="button" class="users-context-item" data-action="edit-user-group" role="menuitem">
                <span class="material-icons">edit</span>
                <span>${Utils.escapeHtml(_('users.edit_user_group') || 'Edit group')}</span>
            </button>
            <div class="users-context-divider" role="separator"></div>
            <button type="button" class="users-context-item danger" data-action="delete-user-group" role="menuitem">
                <span class="material-icons">delete</span>
                <span>${Utils.escapeHtml(_('users.delete_user_group') || 'Delete group')}</span>
            </button>`;
    }

    function positionContextMenu(clientX, clientY) {
        if (!contextMenuEl) return;
        const menuWidth = contextMenuEl.offsetWidth || 200;
        const menuHeight = contextMenuEl.offsetHeight || 160;
        let left = clientX;
        let top = clientY;
        if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
        if (top + menuHeight > window.innerHeight - 8) top = window.innerHeight - menuHeight - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        contextMenuEl.style.left = left + 'px';
        contextMenuEl.style.top = top + 'px';
    }

    function openContextMenu(clientX, clientY, html, state) {
        if (!contextMenuEl) return;
        contextMenuState = state;
        contextMenuEl.innerHTML = html;
        contextMenuEl.hidden = false;
        contextMenuEl.classList.add('open');
        positionContextMenu(clientX, clientY);
    }

    function closeContextMenu() {
        if (!contextMenuEl) return;
        contextMenuEl.classList.remove('open');
        contextMenuEl.hidden = true;
        contextMenuEl.innerHTML = '';
        contextMenuEl.style.left = '';
        contextMenuEl.style.top = '';
        contextMenuState = null;
    }

    function attachUserRowContextMenu() {
        if (!tableBody) return;
        tableBody.querySelectorAll('tr[data-id]').forEach(row => {
            row.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.user-orgs-cell')) return;
                e.preventDefault();
                const userId = row.dataset.id;
                const user = users.find(u => String(u.id) === String(userId));
                if (!user) return;
                openContextMenu(e.clientX, e.clientY, buildUserMenuHtml(user), {
                    id: user.id,
                    username: user.username
                });
            });
        });
    }
    
    /**
     * Load users from API
     */
    async function loadUsers() {
        try {
            const response = await Utils.api('/api/users');
            users = response.users || [];
            renderUsers();
            // Lazy-load organizations for each user (parallel, best-effort)
            loadUsersOrganizations();
        } catch (error) {
            console.error('Failed to load users:', error);
            if (error.status === 403) {
                Notifications.error(_('users.admin_only'));
            } else {
                Notifications.error(_('errors.load_users_failed'));
            }
        }
    }

    async function loadUserGroups() {
        try {
            const response = await Utils.api('/api/panel/user-groups');
            userGroups = response.groups || [];
            userGroupsLoaded = true;
            renderUserGroupsManager();
            if (users.length > 0) renderUsers();
        } catch (error) {
            userGroups = [];
            userGroupsLoaded = true;
            renderUserGroupsManager();
            console.error('Failed to load user groups:', error);
        }
    }

    async function ensureUserGroupsLoaded() {
        if (!userGroupsLoaded) await loadUserGroups();
    }

    function userGroupName(guid) {
        const group = userGroups.find(item => item.guid === guid);
        return group ? group.name : guid;
    }

    function renderUserGroupBadges(groupGuids) {
        if (!Array.isArray(groupGuids) || groupGuids.length === 0) return '';
        return `<div class="user-group-badges">${groupGuids.map(guid => `
            <span class="user-group-badge" title="${Utils.escapeHtml(userGroupName(guid))}">
                <span class="material-icons">group</span>
                ${Utils.escapeHtml(userGroupName(guid))}
            </span>`).join('')}</div>`;
    }

    function renderUserGroupCheckboxes(selectedGuids) {
        const selected = new Set(Array.isArray(selectedGuids) ? selectedGuids : []);
        const container = document.getElementById('user-groups-list');
        if (!container) return;
        if (!userGroups.length) {
            container.innerHTML = `<div class="empty-state-inline">${_('users.no_user_groups') || 'No user groups'}</div>`;
            return;
        }
        container.innerHTML = userGroups.map(group => `
            <label class="user-group-option">
                <input type="checkbox" value="${Utils.escapeHtml(group.guid)}" ${selected.has(group.guid) ? 'checked' : ''}>
                <span class="material-icons">group</span>
                <span>${Utils.escapeHtml(group.name || group.guid)}</span>
            </label>`).join('');
    }

    function selectedUserGroupGuids() {
        return Array.from(document.querySelectorAll('#user-groups-list input:checked')).map(input => input.value);
    }

    async function loadFolders() {
        try {
            const response = await Utils.api('/api/folders');
            folders = response.folders || [];
            foldersLoaded = true;
        } catch (error) {
            folders = [];
            foldersLoaded = true;
            console.error('Failed to load folders:', error);
        }
    }

    async function loadStrategies() {
        try {
            const response = await Utils.api('/api/panel/strategies');
            strategies = response.strategies || [];
            strategiesLoaded = true;
        } catch (error) {
            strategies = [];
            strategiesLoaded = true;
        }
    }

    async function loadAccessCatalog() {
        if (accessCatalog) return accessCatalog;
        const response = await Utils.api('/api/panel/access/catalog');
        accessCatalog = response;
        return accessCatalog;
    }

    function renderAccessPolicyEditor(data = {}) {
        const container = document.getElementById('user-access-policy-editor');
        if (!container || !accessCatalog?.sections) return;
        const directSections = new Map((data.sections || []).map(row => [row.resource_key, row.access_level]));
        const effectiveSections = data.effective?.sections || {};
        const directFeatures = new Map((data.features || []).map(row => [row.feature_key, !!row.enabled]));
        const effectiveFeatures = data.effective?.features || {};
        const groups = accessCatalog.groups || [];
        const sections = accessCatalog.sections || [];
        const localized = (key, fallback) => {
            const value = _(key);
            return value && value !== key ? value : fallback;
        };
        const levels = accessCatalog.levels || ['none', 'read', 'write'];
        const levelLabels = {
            none: localized('users.access_none', 'None'),
            read: localized('users.access_read', 'Read'),
            write: localized('users.access_write', 'Full'),
        };
        const renderChoices = (resourceType, resourceKey, selected, inherited) => `
            <input type="hidden" data-policy-${resourceType}="${Utils.escapeHtml(resourceKey)}" value="${inherited ? 'inherit' : Utils.escapeHtml(selected)}">
            <div class="access-policy-choices" role="group" aria-label="${Utils.escapeHtml(localized('users.access_policy_title', 'Access level'))}">
                ${levels.map(level => `<button type="button"
                    class="access-policy-choice ${selected === level ? 'is-selected' : ''} ${selected === level && inherited ? 'is-inherited' : ''}"
                    data-policy-level="${level}" aria-pressed="${selected === level ? 'true' : 'false'}"
                    title="${Utils.escapeHtml(levelLabels[level] || level)}">
                    <span class="material-icons">${level === 'none' ? 'block' : level === 'read' ? 'visibility' : 'edit'}</span>
                </button>`).join('')}
            </div>`;
        container.innerHTML = `
            <div class="access-policy-matrix" data-access-policy-matrix>
                <div class="access-policy-header">
                    <strong>${Utils.escapeHtml(localized('users.access_policy_section', 'Section'))}</strong>
                    ${levels.map(level => `<strong class="access-policy-level-${level}">${Utils.escapeHtml(levelLabels[level] || level)}</strong>`).join('')}
                </div>
                ${groups.map(group => {
                    const entries = sections.filter(section => section.group === group.key);
                    if (!entries.length) return '';
                    const groupKey = `group:${group.key}`;
                    const groupSelected = directSections.get(groupKey) || 'inherit';
                    return `<div class="access-policy-group">
                        <div class="access-policy-row access-policy-group-row">
                            <strong>${Utils.escapeHtml(localized('users.access_group_' + group.key, group.label || group.key))}</strong>
                            ${renderChoices('group', group.key, groupSelected, groupSelected === 'inherit')}
                        </div>
                        ${entries.map(section => {
                            const inherited = !directSections.has(section.key);
                            const selected = inherited
                                ? (effectiveSections[section.key]?.access || 'inherit')
                                : directSections.get(section.key);
                            return `<div class="access-policy-row">
                                <span>${Utils.escapeHtml(localized('users.access_section_' + section.key, section.label || section.key))}</span>
                                ${renderChoices('section', section.key, selected, inherited)}
                            </div>`;
                        }).join('')}
                    </div>`;
                }).join('')}
            </div>
            <div class="access-policy-features">
                <strong>${Utils.escapeHtml(localized('users.client_features', 'Client features'))}</strong>
                ${(accessCatalog.features || []).map(feature => {
                    const checked = directFeatures.has(feature.key)
                        ? directFeatures.get(feature.key)
                        : (effectiveFeatures[feature.key]?.enabled ?? true);
                    return `<label class="access-policy-toggle">
                        <input type="checkbox" data-policy-feature="${Utils.escapeHtml(feature.key)}" ${checked ? 'checked' : ''} ${feature.hardLock ? 'disabled' : ''}>
                        <span>${Utils.escapeHtml(localized('users.access_feature_' + feature.key, feature.label || feature.key))}</span>
                    </label>`;
                }).join('')}
            </div>`;
        container.querySelectorAll('.access-policy-choice').forEach(button => {
            button.addEventListener('click', () => {
                const row = button.closest('.access-policy-row');
                const choices = row?.querySelector('.access-policy-choices');
                const input = row?.querySelector('input[type="hidden"]');
                if (!row || !choices || !input) return;
                input.value = button.dataset.policyLevel;
                choices.querySelectorAll('.access-policy-choice').forEach(choice => {
                    const selected = choice === button;
                    choice.classList.toggle('is-selected', selected);
                    choice.classList.remove('is-inherited');
                    choice.setAttribute('aria-pressed', selected ? 'true' : 'false');
                });
            });
        });
    }

    async function loadAccessPolicyEditor(subjectType, subjectId) {
        try {
            await loadAccessCatalog();
            if (!subjectId) {
                renderAccessPolicyEditor();
                return;
            }
            const response = await Utils.api(`/api/panel/access/${subjectType}s/${encodeURIComponent(subjectId)}`);
            accessPolicyState = { subjectType, subjectId, data: response };
            renderAccessPolicyEditor(response);
        } catch (error) {
            const container = document.getElementById('user-access-policy-editor');
            if (container) container.innerHTML = `<div class="empty-state-inline">${Utils.escapeHtml(error.message || _('errors.server_error'))}</div>`;
        }
    }

    function collectAccessPolicy() {
        const sections = Array.from(document.querySelectorAll('[data-policy-section]'))
            .map(input => ({ resource_key: input.dataset.policySection, access_level: input.value }))
            .filter(row => row.access_level && row.access_level !== 'inherit');
        const groups = Array.from(document.querySelectorAll('[data-policy-group]'))
            .map(input => ({ resource_key: `group:${input.dataset.policyGroup}`, access_level: input.value }))
            .filter(row => row.access_level && row.access_level !== 'inherit');
        const features = Array.from(document.querySelectorAll('[data-policy-feature]'))
            .filter(input => !input.disabled)
            .map(input => ({ feature_key: input.dataset.policyFeature, enabled: input.checked }));
        return { sections: sections.concat(groups), features };
    }

    async function ensureFoldersLoaded() {
        if (!foldersLoaded) await loadFolders();
    }

    async function ensureStrategiesLoaded() {
        if (!strategiesLoaded) await loadStrategies();
    }

    function renderFolderCheckboxes(selectedIds) {
        const selected = new Set((selectedIds || []).map(id => Number(id)).filter(Number.isFinite));
        const container = document.getElementById('user-folders-list');
        if (!container) return;
        if (!folders.length) {
            container.innerHTML = `<div class="empty-state-inline">${_('users.no_folders') || 'No folders'}</div>`;
            return;
        }
        container.innerHTML = folders.map(folder => `
            <label class="user-group-option">
                <input type="checkbox" value="${folder.id}" ${selected.has(Number(folder.id)) ? 'checked' : ''}>
                <span class="material-icons">folder</span>
                <span>${Utils.escapeHtml(folder.name || folder.id)}</span>
            </label>`).join('');
    }

    function selectedFolderIds() {
        return Array.from(document.querySelectorAll('#user-folders-list input:checked'))
            .map(input => Number.parseInt(input.value, 10))
            .filter(Number.isFinite);
    }

    function renderStrategyOptions(selectedGuid) {
        const select = document.getElementById('user-strategy');
        if (!select) return;
        const current = String(selectedGuid || '');
        select.innerHTML = `<option value="">${Utils.escapeHtml(_('users.pro_strategy_none') || 'None')}</option>` +
            strategies.map(st => `
                <option value="${Utils.escapeHtml(st.guid)}" ${st.guid === current ? 'selected' : ''}>
                    ${Utils.escapeHtml(st.name || st.guid)}
                </option>`).join('');
    }

    const ROLE_DESC_KEYS = {
        viewer: 'users.role_desc_viewer',
        operator: 'users.role_desc_operator',
        pro: 'users.role_desc_pro',
        admin: 'users.role_desc_admin',
        super_admin: 'users.role_desc_super_admin',
        server_admin: 'users.role_desc_server_admin',
        global_admin: 'users.role_desc_global_admin'
    };

    function updateRoleDescription() {
        const role = document.getElementById('user-role')?.value || 'viewer';
        const descEl = document.getElementById('user-role-desc');
        if (!descEl) return;
        const key = ROLE_DESC_KEYS[role];
        descEl.textContent = key ? (_(key) || '') : '';
    }

    async function loadEffectiveScopeCounts() {
        if (!tableBody) return;
        const cells = tableBody.querySelectorAll('.user-scope-cell');
        await Promise.all(Array.from(cells).map(async cell => {
            const userId = cell.dataset.userId;
            if (!userId) return;
            try {
                const resp = await Utils.api(`/api/users/${userId}/effective-scope`);
                const count = resp.data?.count ?? 0;
                cell.textContent = _('users.effective_scope_count', { count }) || `${count} devices`;
            } catch (_) {
                cell.textContent = '—';
            }
        }));
    }

    function renderUserGroupsManager() {
        if (!userGroupsManager) return;
        if (!userGroupsLoaded) {
            userGroupsManager.innerHTML = `<div class="empty-state-inline">${_('users.loading_user_groups') || 'Loading user groups...'}</div>`;
            return;
        }
        if (!userGroups.length) {
            userGroupsManager.innerHTML = `<div class="empty-state-inline">${_('users.no_user_groups') || 'No user groups available'}</div>`;
            return;
        }

        userGroupsManager.innerHTML = userGroups.map(group => `
            <div class="user-group-manager-item" data-guid="${Utils.escapeHtml(group.guid)}">
                <div class="user-group-manager-main">
                    <span class="material-icons">groups</span>
                    <div class="user-group-manager-text">
                        <strong>${Utils.escapeHtml(group.name || group.guid)}</strong>
                        ${group.note ? `<span>${Utils.escapeHtml(group.note)}</span>` : ''}
                    </div>
                </div>
                <span class="user-group-member-count">${_('users.group_members_count', { count: group.member_count || 0 }) || (group.member_count || 0)}</span>
                <div class="user-group-manager-actions">
                    <button class="action-btn" data-action="edit-user-group" data-guid="${Utils.escapeHtml(group.guid)}" title="${_('users.edit_user_group') || 'Edit user group'}">
                        <span class="material-icons">edit</span>
                    </button>
                    <button class="action-btn danger" data-action="delete-user-group" data-guid="${Utils.escapeHtml(group.guid)}" title="${_('users.delete_user_group') || 'Delete user group'}">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </div>
        `).join('');

        userGroupsManager.querySelectorAll('[data-action="edit-user-group"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = userGroups.find(item => item.guid === btn.dataset.guid);
                if (group) showUserGroupModal(group);
            });
        });
        userGroupsManager.querySelectorAll('[data-action="delete-user-group"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const group = userGroups.find(item => item.guid === btn.dataset.guid);
                if (group) deleteUserGroup(group);
            });
        });
        userGroupsManager.querySelectorAll('.user-group-manager-item[data-guid]').forEach(item => {
            item.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                const group = userGroups.find(entry => entry.guid === item.dataset.guid);
                if (!group) return;
                openContextMenu(event.clientX, event.clientY, buildUserGroupMenuHtml(), {
                    type: 'group',
                    guid: group.guid,
                });
            });
        });
    }

    function showUserGroupModal(group = null) {
        const editing = !!group;
        Modal.show({
            title: editing ? (_('users.edit_user_group') || 'Edit user group') : (_('users.create_user_group') || 'Create user group'),
            content: `
                <form id="user-group-form" class="user-form">
                    <div class="form-group">
                        <label for="user-group-name">${_('users.group_name') || 'Group name'}</label>
                        <input type="text" id="user-group-name" class="form-input" maxlength="80" required value="${Utils.escapeHtml(group?.name || '')}" placeholder="${_('users.group_name_placeholder') || 'Operators'}">
                    </div>
                    <div class="form-group">
                        <label for="user-group-note">${_('users.group_note') || 'Note'}</label>
                        <textarea id="user-group-note" class="form-input" maxlength="500" rows="3" placeholder="${_('users.group_note_placeholder') || 'Optional note'}">${Utils.escapeHtml(group?.note || '')}</textarea>
                    </div>
                    <div class="form-group user-access-policy-group">
                        <label>${_('users.access_policy_title') || 'Panel access and client features'}</label>
                        <div id="user-access-policy-editor" class="user-access-policy-editor">
                            <div class="empty-state-inline">${_('users.loading_access_policy') || 'Loading access policy...'}</div>
                        </div>
                    </div>
                </form>
            `,
            size: 'large',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => saveUserGroup(group) }
            ],
            onOpen: () => {
                loadAccessPolicyEditor('group', group?.guid || null);
                document.getElementById('user-group-name')?.focus();
            }
        });
    }

    async function saveUserGroup(group = null) {
        const name = document.getElementById('user-group-name')?.value.trim() || '';
        const note = document.getElementById('user-group-note')?.value.trim() || '';
        if (!name) {
            Notifications.error(_('users.group_name_required') || 'Group name is required');
            return;
        }

        try {
            const url = group ? `/api/panel/user-groups/${encodeURIComponent(group.guid)}` : '/api/panel/user-groups';
            const response = await Utils.api(url, {
                method: group ? 'PATCH' : 'POST',
                body: { name, note }
            });
            const guid = group?.guid || response?.group?.guid;
            if (guid) {
                await Utils.api(`/api/panel/access/groups/${encodeURIComponent(guid)}`, {
                    method: 'PUT',
                    body: collectAccessPolicy()
                });
            }
            Notifications.success(group ? (_('users.user_group_updated') || 'User group updated') : (_('users.user_group_created') || 'User group created'));
            Modal.close();
            userGroupsLoaded = false;
            await loadUserGroups();
            await loadUsers();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    async function deleteUserGroup(group) {
        const confirmed = await Modal.confirm({
            title: _('users.delete_user_group') || 'Delete user group',
            message: (_('users.delete_user_group_confirm') || 'Delete user group {name}?').replace('{name}', group.name || group.guid),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await Utils.api(`/api/panel/user-groups/${encodeURIComponent(group.guid)}`, { method: 'DELETE' });
            Notifications.success(_('users.user_group_deleted') || 'User group deleted');
            userGroupsLoaded = false;
            await loadUserGroups();
            await loadUsers();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    /**
     * Lazy-load each user's organization memberships and update the table cells.
     * Errors per user are silently ignored so the table still renders.
     */
    async function loadUsersOrganizations() {
        if (!Array.isArray(users) || users.length === 0) return;
        await Promise.all(users.map(async (user) => {
            try {
                const resp = await Utils.api(`/api/users/${user.id}/organizations`);
                const orgs = (resp.organizations || []).map(normalizeOrgPayload).filter(o => o.id);
                userOrgsCache.set(Number(user.id), orgs);
                renderUserOrgsCell(user.id, orgs);
            } catch (_err) {
                renderUserOrgsCell(user.id, []);
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

    function renderUserOrgsCell(userId, orgs) {
        const cell = document.querySelector(`tr[data-id="${userId}"] .user-orgs-cell`);
        if (!cell) return;
        if (!orgs || orgs.length === 0) {
            cell.innerHTML = `<span class="no-orgs">${_('users.no_orgs_short')}</span>`;
            return;
        }
        cell.innerHTML = orgs.map(o => `
            <span class="org-badge" data-org-id="${Utils.escapeHtml(o.id)}" title="${Utils.escapeHtml(o.org_name)}${o.role ? ' • ' + _('organizations.role_' + o.role) : ''}">
                <span class="material-icons">business</span>
                ${Utils.escapeHtml(o.org_name)}
            </span>
        `).join('');
    }

    /**
     * Re-fetch a single user's org memberships and refresh the inline cell.
     * Safe to call after add/remove from the Organizations modal.
     */
    async function refreshUserOrgsCell(userId) {
        try {
            const resp = await Utils.api(`/api/users/${userId}/organizations`);
            const orgs = (resp.organizations || []).map(normalizeOrgPayload).filter(o => o.id);
            userOrgsCache.set(Number(userId), orgs);
            renderUserOrgsCell(userId, orgs);
        } catch (_err) {
            // Leave cell as-is on failure
        }
    }
    
    /**
     * Render users table
     */
    function renderUsers() {
        if (!tableBody) return;
        
        if (users.length === 0) {
            tableBody.innerHTML = '';
            emptyState?.classList.remove('hidden');
            return;
        }
        
        emptyState?.classList.add('hidden');
        
        tableBody.innerHTML = users.map(user => {
            const roleIcons = {
                super_admin: 'shield_person',
                admin: 'admin_panel_settings',
                server_admin: 'dns',
                global_admin: 'public',
                operator: 'engineering',
                viewer: 'visibility',
                pro: 'star'
            };
            const roleIcon = roleIcons[user.role] || 'person';
            const roleLabelKey = 'users.role_' + user.role;
            const provider = (user.auth_provider || 'local').toLowerCase();
            const providerLabel = _('users.provider_' + provider) || provider;
            return `
            <tr data-id="${user.id}" class="user-row">
                <td>
                    <div class="user-info">
                        <div class="user-avatar">
                            <span class="material-icons">${roleIcon}</span>
                        </div>
                        <div class="user-name-stack">
                            <span class="user-username">${Utils.escapeHtml(user.username)}</span>
                            ${renderUserGroupBadges(user.user_groups)}
                        </div>
                    </div>
                </td>
                <td>${user.email ? Utils.escapeHtml(user.email) : '<span class="text-muted">—</span>'}</td>
                <td>
                    <span class="role-badge ${String(user.role || '').replace(/[^a-z0-9_-]/gi, '')}">
                        ${Utils.escapeHtml(_(roleLabelKey))}
                    </span>
                </td>
                <td>
                    <span class="user-scope-cell text-muted" data-user-id="${user.id}">…</span>
                </td>
                <td>
                    <span class="provider-badge provider-${provider}" title="${Utils.escapeHtml(providerLabel)}">
                        ${Utils.escapeHtml(providerLabel)}
                    </span>
                </td>
                <td>
                    <div class="user-orgs-cell" data-user-id="${user.id}" data-username="${Utils.escapeHtml(user.username)}">
                        <span class="skeleton skeleton-text" style="width: 80px; height: 14px;"></span>
                    </div>
                </td>
                <td>${Utils.formatDate(user.created_at)}</td>
                <td>${user.last_login ? Utils.formatDate(user.last_login) : '<span class="text-muted">' + _('users.never') + '</span>'}</td>
            </tr>
        `}).join('');

        attachUserRowContextMenu();
        // Clicking the inline orgs cell opens the Organizations modal
        tableBody.querySelectorAll('.user-orgs-cell').forEach(cell => {
            cell.addEventListener('click', () => {
                const id = cell.dataset.userId;
                const username = cell.dataset.username;
                if (id && username) showOrganizationsModal(id, username);
            });
        });
        loadEffectiveScopeCounts();
    }
    
    /**
     * Handle actions
     */
    async function handleAction(action, userId, data) {
        switch (action) {
            case 'edit':
                showEditUserModal(userId);
                break;
            case 'reset-password':
                await resetPassword(userId);
                break;
            case 'delete':
                await deleteUser(userId, data.username);
                break;
            case 'organizations':
                await showOrganizationsModal(userId, data.username);
                break;
            case 'edit-user-group': {
                const group = userGroups.find(item => item.guid === data.guid);
                if (group) showUserGroupModal(group);
                break;
            }
            case 'delete-user-group': {
                const group = userGroups.find(item => item.guid === data.guid);
                if (group) await deleteUserGroup(group);
                break;
            }
        }
    }
    
    /**
     * Show add user modal
     */
    async function showAddUserModal() {
        await Promise.all([ensureUserGroupsLoaded(), ensureFoldersLoaded(), ensureStrategiesLoaded()]);
        editingUserId = null;
        
        const template = document.getElementById('user-form-template');
        const content = template.content.cloneNode(true);
        const formHtml = content.querySelector('form').outerHTML;
        
        Modal.show({
            title: _('users.add_user'),
            content: formHtml,
            size: 'large',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('users.create'), class: 'btn-primary', onClick: () => submitUserForm() }
            ],
            onOpen: () => {
                initFormListeners();
                renderUserGroupCheckboxes([]);
                renderFolderCheckboxes([]);
                renderStrategyOptions('');
                updateRoleDescription();
                document.getElementById('user-direct-devices').value = '';
                loadAccessPolicyEditor('user', null);
                document.getElementById('user-username')?.focus();
            }
        });
    }
    
    /**
     * Show edit user modal
     */
    async function showEditUserModal(userId) {
        await Promise.all([ensureUserGroupsLoaded(), ensureFoldersLoaded(), ensureStrategiesLoaded()]);
        const user = users.find(u => Number(u.id) === Number(userId));
        if (!user) return;
        
        editingUserId = user.id;
        
        const template = document.getElementById('user-form-template');
        const content = template.content.cloneNode(true);
        const formHtml = content.querySelector('form').outerHTML;
        
        Modal.show({
            title: _('users.edit_user'),
            content: formHtml,
            size: 'large',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => submitUserForm() }
            ],
            onOpen: () => {
                initFormListeners();
                
                // Fill form with user data
                const usernameInput = document.getElementById('user-username');
                const roleSelect = document.getElementById('user-role');
                const passwordInput = document.getElementById('user-password');
                
                if (usernameInput) {
                    usernameInput.value = user.username;
                    // Issue #498 (2026-11-13): local accounts may be renamed. The
                    // provider owns the name for LDAP/OIDC, so the field stays
                    // locked there to avoid the next login recreating the old id.
                    const providerForName = (user.auth_provider || 'local').toLowerCase();
                    const canRename = providerForName !== 'ldap' && providerForName !== 'oidc';
                    usernameInput.readOnly = !canRename;
                    if (canRename) {
                        usernameInput.classList.remove('readonly');
                        const nameGroup = usernameInput.closest('.form-group');
                        if (nameGroup && !nameGroup.querySelector('.username-change-warning')) {
                            const warn = document.createElement('span');
                            warn.className = 'form-hint username-change-warning';
                            warn.textContent = _('users.username_change_warning')
                                || 'Changing the username updates address books, group assignments and signs the user out everywhere.';
                            nameGroup.appendChild(warn);
                        }
                    } else {
                        usernameInput.classList.add('readonly');
                    }
                }
                if (roleSelect) roleSelect.value = user.role;
                const emailInput = document.getElementById('user-email');
                if (emailInput) emailInput.value = user.email || '';
                if (passwordInput) passwordInput.placeholder = _('users.password_leave_empty');
                // LDAP accounts are fully provider-managed. OIDC passwords remain
                // provider-managed, while the panel role can be overridden.
                const provider = (user.auth_provider || 'local').toLowerCase();
                if (provider === 'ldap' && roleSelect) {
                    roleSelect.disabled = true;
                    const roleGroup = roleSelect.closest('.form-group');
                    if (roleGroup) {
                        const hint = document.createElement('span');
                        hint.className = 'form-hint';
                        hint.textContent = _('users.provider_managed_hint');
                        roleGroup.appendChild(hint);
                    }
                }
                if (provider !== 'local') {
                    if (passwordInput) {
                        passwordInput.value = '';
                        passwordInput.disabled = true;
                        passwordInput.placeholder = _('users.password_managed_by_provider');
                    }
                    const passwordGroup = passwordInput ? passwordInput.closest('.form-group') : null;
                    if (passwordGroup) {
                        const hint = document.createElement('span');
                        hint.className = 'form-hint';
                        hint.textContent = _('users.password_managed_by_provider');
                        passwordGroup.appendChild(hint);
                    }
                }
                renderUserGroupCheckboxes(user.user_groups || []);
                renderFolderCheckboxes(user.folder_ids || []);
                renderStrategyOptions(user.strategy_guid || '');
                updateRoleDescription();
                const directDevices = document.getElementById('user-direct-devices');
                if (directDevices) {
                    directDevices.value = Array.isArray(user.peer_grants) ? user.peer_grants.join(', ') : '';
                }
                loadAccessPolicyEditor('user', user.id);
            }
        });
    }
    
    /**
     * Initialize form listeners
     */
    function initFormListeners() {
        // Password visibility toggle
        document.querySelector('.toggle-password')?.addEventListener('click', function() {
            const input = document.getElementById('user-password');
            const icon = this.querySelector('.material-icons');
            if (input.type === 'password') {
                input.type = 'text';
                icon.textContent = 'visibility_off';
            } else {
                input.type = 'password';
                icon.textContent = 'visibility';
            }
        });
        
        // Password strength indicator
        document.getElementById('user-password')?.addEventListener('input', function() {
            updatePasswordStrength(this.value);
        });

        document.getElementById('user-role')?.addEventListener('change', updateRoleDescription);
    }
    
    /**
     * Update password strength indicator
     */
    function updatePasswordStrength(password) {
        const container = document.getElementById('password-strength');
        if (!container) return;
        
        if (!password) {
            container.innerHTML = '';
            return;
        }
        
        let score = 0;
        const feedback = [];
        
        if (password.length >= 8) score++;
        else feedback.push(_('settings.req_length'));
        
        if (password.length >= 12) score++;
        
        if (/[a-z]/.test(password)) score++;
        else feedback.push(_('settings.req_lowercase'));
        
        if (/[A-Z]/.test(password)) score++;
        else feedback.push(_('settings.req_uppercase'));
        
        if (/[0-9]/.test(password)) score++;
        else feedback.push(_('settings.req_number'));
        
        if (/[^a-zA-Z0-9]/.test(password)) score++;
        
        const strength = score <= 2 ? 'weak' : score <= 4 ? 'medium' : 'strong';
        const labels = { weak: _('users.strength_weak'), medium: _('users.strength_medium'), strong: _('users.strength_strong') };
        
        container.innerHTML = `
            <div class="strength-bar">
                <div class="strength-fill ${strength}" style="width: ${(score / 6) * 100}%"></div>
            </div>
            <span class="strength-label ${strength}">${labels[strength]}</span>
        `;
    }
    
    /**
     * Submit user form
     */
    async function submitUserForm() {
        const form = document.getElementById('user-form');
        if (!form) return;
        
        const username = document.getElementById('user-username')?.value.trim();
        const password = document.getElementById('user-password')?.value;
        const role = document.getElementById('user-role')?.value;
        const email = document.getElementById('user-email')?.value.trim();
        const groupGuids = selectedUserGroupGuids();
        const folderIds = selectedFolderIds();
        const strategyGuid = document.getElementById('user-strategy')?.value || '';
        const peerIdsRaw = document.getElementById('user-direct-devices')?.value || '';
        const peerIds = peerIdsRaw.split(/[,;\s]+/).map(v => v.trim()).filter(Boolean);
        
        // Validate
        if (!editingUserId) {
            // Creating new user
            if (!username || !password) {
                Notifications.error(_('users.fill_required'));
                return;
            }
            
            if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) {
                Notifications.error(_('users.invalid_username'));
                return;
            }
            
            if (password.length < 8) {
                Notifications.error(_('users.password_too_short'));
                return;
            }
        }
        
        try {
            if (editingUserId) {
                // Update existing user
                const user = users.find(item => Number(item.id) === Number(editingUserId));
                const provider = (user?.auth_provider || 'local').toLowerCase();
                const data = { email, groupGuids, folderIds, peerIds, strategyGuid };
                if (provider !== 'ldap') {
                    data.role = role;
                }
                if (provider === 'local' && password) {
                    if (password) data.password = password;
                }
                // Issue #498: send the name only when the operator actually changed
                // it, so an unmodified form cannot accidentally trigger a rename.
                if (provider === 'local' && username && username !== user?.username) {
                    data.username = username;
                }
                
                await Utils.api(`/api/users/${editingUserId}`, {
                    method: 'PATCH',
                    body: data
                });
                await Utils.api(`/api/panel/access/users/${editingUserId}`, {
                    method: 'PUT',
                    body: collectAccessPolicy()
                });
                Notifications.success(_('users.user_updated'));
            } else {
                // Create new user
                const created = await Utils.api('/api/users', {
                    method: 'POST',
                    body: { username, password, role, email, groupGuids, folderIds, peerIds, strategyGuid }
                });
                if (created?.id) {
                    await Utils.api(`/api/panel/access/users/${created.id}`, {
                        method: 'PUT',
                        body: collectAccessPolicy()
                    });
                }
                Notifications.success(_('users.user_created'));
            }
            
            Modal.close();
            loadUsers();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    /**
     * Reset user password
     */
    async function resetPassword(userId) {
        const user = users.find(u => Number(u.id) === Number(userId));
        if (!user) return;
        
        const newPassword = await Modal.prompt({
            title: _('users.reset_password'),
            label: _('users.new_password'),
            hint: _('users.password_hint'),
            inputType: 'password'
        });
        
        if (!newPassword) return;
        
        if (newPassword.length < 8) {
            Notifications.error(_('users.password_too_short'));
            return;
        }
        
        try {
            await Utils.api(`/api/users/${userId}/reset-password`, {
                method: 'POST',
                body: { newPassword }
            });
            Notifications.success(_('users.password_reset_success'));
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    /**
     * Delete user
     */
    async function deleteUser(userId, username) {
        const confirmed = await Modal.confirm({
            title: _('users.delete_title'),
            message: _('users.delete_confirm', { username }),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        
        if (!confirmed) return;
        
        try {
            await Utils.api(`/api/users/${userId}`, { method: 'DELETE' });
            Notifications.success(_('users.delete_success'));
            loadUsers();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    /**
     * Show organizations modal for user
     */
    async function showOrganizationsModal(userId, username) {
        let userOrgs = [];
        let allOrgs = [];

        const normalizeOrg = (org) => {
            const id = String(org.org_id || org.id || org.organization_id || '');
            return {
                ...org,
                id,
                org_id: id,
                name: org.name || org.org_name || (id ? 'Org #' + id : ''),
                org_name: org.org_name || org.name || (id ? 'Org #' + id : ''),
                role: org.role || ''
            };
        };
        
        try {
            // Fetch user's organizations
            const orgsResponse = await Utils.api(`/api/users/${userId}/organizations`);
            userOrgs = (orgsResponse.organizations || []).map(normalizeOrg).filter(o => o.id);
            
            // Fetch all organizations for adding
            const allOrgsResponse = await Utils.api('/api/panel/org');
            allOrgs = (allOrgsResponse.organizations || []).map(normalizeOrg).filter(o => o.id);
        } catch (error) {
            console.error('Failed to load organizations:', error);
            Notifications.error(_('errors.load_orgs_failed'));
            return;
        }
        
        // Filter out orgs user is already in
        const userOrgIds = new Set(userOrgs.map(o => o.id));
        const availableOrgs = allOrgs.filter(o => !userOrgIds.has(String(o.id)));
        
        const orgsListHtml = userOrgs.length > 0 
            ? userOrgs.map(org => `
                <div class="org-assignment-item" data-org-id="${Utils.escapeHtml(org.id)}">
                    <div class="org-info">
                        <span class="material-icons">business</span>
                        <span class="org-name">${Utils.escapeHtml(org.org_name)}</span>
                        ${org.role ? `<span class="role-badge ${Utils.escapeHtml(org.role)}">${_('organizations.role_' + org.role)}</span>` : ''}
                    </div>
                    <button class="action-btn danger remove-org-btn" data-org-id="${Utils.escapeHtml(org.id)}" title="${_('actions.remove')}">
                        <span class="material-icons">remove_circle</span>
                    </button>
                </div>
            `).join('')
            : `<div class="empty-state-inline">${_('users.no_organizations')}</div>`;
        
        const addOrgHtml = availableOrgs.length > 0 
            ? `
                <div class="add-org-row">
                    <select id="add-org-select" class="form-input">
                        <option value="">${_('policies.select_org_placeholder')}</option>
                        ${availableOrgs.map(o => `<option value="${Utils.escapeHtml(String(o.id))}">${Utils.escapeHtml(o.name)}</option>`).join('')}
                    </select>
                    <select id="add-org-role" class="form-input" style="width: 140px;" title="${_('organizations.org_role')}" aria-label="${_('organizations.org_role')}">
                        <option value="user">${_('organizations.role_user')}</option>
                        <option value="operator">${_('organizations.role_operator')}</option>
                        <option value="admin">${_('organizations.role_admin')}</option>
                        <option value="owner">${_('organizations.role_owner')}</option>
                    </select>
                    <button id="add-org-btn" class="btn btn-primary btn-sm">
                        <span class="material-icons">add</span>
                        ${_('actions.add')}
                    </button>
                </div>
            `
            : `<div class="empty-state-inline">${_('users.all_orgs_assigned')}</div>`;
        
        Modal.show({
            title: _('users.user_organizations', { username }),
            content: `
                <div class="org-assignments">
                    <h4 class="org-assignments-section">${_('users.org_membership_section')}</h4>
                    <p class="org-assignments-hint">${_('users.org_membership_hint')}</p>
                    <div class="org-assignments-list" id="user-orgs-list">
                        ${orgsListHtml}
                    </div>
                    ${addOrgHtml}
                </div>
            `,
            size: 'medium',
            buttons: [
                { label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }
            ],
            onOpen: () => {
                // Remove org handler
                document.querySelectorAll('.remove-org-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const orgId = btn.dataset.orgId;
                        try {
                            await Utils.api(`/api/panel/org/${orgId}/members/${userId}`, { method: 'DELETE' });
                            Notifications.success(_('users.org_removed'));
                            userOrgsCache.delete(Number(userId));
                            Modal.close();
                            refreshUserOrgsCell(userId);
                            showOrganizationsModal(userId, username); // Refresh
                        } catch (error) {
                            Notifications.error(error.message || _('errors.server_error'));
                        }
                    });
                });
                
                // Add org handler
                document.getElementById('add-org-btn')?.addEventListener('click', async () => {
                    const orgId = document.getElementById('add-org-select').value;
                    const role = document.getElementById('add-org-role').value;
                    
                    if (!orgId) {
                        Notifications.error(_('policies.select_org_placeholder'));
                        return;
                    }
                    
                    try {
                        await Utils.api(`/api/users/${userId}/organizations`, {
                            method: 'POST',
                            body: { org_id: orgId, role }
                        });
                        Notifications.success(_('organizations.user_linked'));
                        userOrgsCache.delete(Number(userId));
                        Modal.close();
                        refreshUserOrgsCell(userId);
                        showOrganizationsModal(userId, username); // Refresh
                    } catch (error) {
                        Notifications.error(error.message || _('errors.server_error'));
                    }
                });
            }
        });
    }
})();
