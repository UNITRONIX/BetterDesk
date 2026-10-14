/**
 * BetterDesk Console — Permissions Management (RBAC Phase 52)
 * Renders a permission matrix for each role with toggle switches.
 * Custom overrides are persisted in the Go server's role_permissions table.
 */
(function () {
    'use strict';

    const _ = (window.BetterDesk && window.BetterDesk.translations)
        ? (key) => {
            const keys = key.split('.');
            let val = window.BetterDesk.translations;
            for (const k of keys) {
                if (val && typeof val === 'object') val = val[k];
                else return key;
            }
            return (typeof val === 'string') ? val : key;
        }
        : (key) => key;

    const csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    // ── Permission categories ──────────────────────────────────────────

    const CATEGORIES = [
        {
            id: 'device',
            icon: 'devices',
            permissions: [
                'device.view', 'device.connect', 'guest.create', 'device.edit',
                'device.delete', 'device.ban', 'device.change_id', 'device.connection_mode',
                'remote_target.view', 'remote_target.connect', 'remote_target.edit',
                'remote_target.delete', 'remote_target.test'
            ]
        },
        {
            id: 'user',
            icon: 'group',
            permissions: ['user.view', 'user.create', 'user.edit', 'user.delete']
        },
        {
            id: 'server',
            icon: 'dns',
            permissions: ['server.config', 'server.keys', 'server.attestation']
        },
        {
            id: 'org',
            icon: 'corporate_fare',
            permissions: [
                'org.create', 'org.edit', 'org.delete',
                'org.manage_users', 'org.manage_devices'
            ]
        },
        {
            id: 'audit',
            icon: 'policy',
            permissions: ['audit.view', 'metrics.view', 'blocklist.edit']
        },
        {
            id: 'cdap',
            icon: 'hub',
            permissions: ['cdap.view', 'cdap.command', 'cdap.terminal', 'cdap.files']
        },
        {
            id: 'mesh',
            icon: 'terminal',
            permissions: ['mesh.terminal', 'mesh.files', 'mesh.power']
        },
        {
            id: 'enrollment',
            icon: 'how_to_reg',
            permissions: ['enrollment.manage', 'enrollment.approve']
        },
        {
            id: 'chat',
            icon: 'chat',
            permissions: ['chat.access']
        },
        {
            id: 'branding',
            icon: 'palette',
            permissions: ['branding.edit']
        },
        {
            id: 'billing',
            icon: 'receipt_long',
            permissions: ['billing.view', 'billing.manage', 'billing.reports', 'billing.export']
        }
    ];

    /** Categories plus an "other" bucket for permissions the server knows but this page does not. */
    function categoriesForRender() {
        const known = new Set();
        for (const cat of CATEGORIES) for (const p of cat.permissions) known.add(p);
        const other = allPermissions.filter(p => !known.has(p));
        const cats = CATEGORIES.map(cat => ({
            ...cat,
            permissions: allPermissions.length
                ? cat.permissions.filter(p => allPermissions.includes(p))
                : cat.permissions
        })).filter(cat => cat.permissions.length);
        if (other.length) cats.push({ id: 'other', icon: 'more_horiz', permissions: other });
        return cats;
    }

    // ── State ──────────────────────────────────────────────────────────

    let allRoles = [];            // [{name, level, is_super_admin, is_custom, description, permissions}]
    let allPermissions = [];      // ['device.view', ...]
    let overrides = [];           // [{role, permission, granted}]
    let selectedRole = '';
    let roleDefaults = {};        // role -> [default perms]
    let effectivePerms = {};      // permission -> granted bool (for current role)

    // ── Helpers ────────────────────────────────────────────────────────

    async function apiFetch(url, opts = {}) {
        const headers = { ...(opts.headers || {}), 'x-csrf-token': csrfToken };
        if (opts.body && typeof opts.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }
        const resp = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        return resp.json();
    }

    function unwrap(data) {
        return (data && data.success && data.data) ? data.data : data;
    }

    const ROLE_ICONS = {
        super_admin: 'shield_person',
        admin: 'admin_panel_settings',
        server_admin: 'dns',
        global_admin: 'public',
        operator: 'engineering',
        viewer: 'visibility',
        pro: 'star'
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function roleLabel(name) {
        const key = 'users.role_' + name;
        const t = _(key);
        return t !== key ? t : name;
    }

    function permLabel(perm) {
        const key = 'permissions.perm_' + perm.replace(/\./g, '_');
        const t = _(key);
        return t !== key ? t : perm;
    }

    function catLabel(catId) {
        const key = 'permissions.cat_' + catId;
        const t = _(key);
        return t !== key ? t : catId.charAt(0).toUpperCase() + catId.slice(1);
    }

    // ── Data Loading ───────────────────────────────────────────────────

    async function loadRoles() {
        const resp = unwrap(await apiFetch('/api/panel/roles'));
        allRoles = resp.roles || [];
        allPermissions = resp.all_permissions || [];

        // Build default map per role
        roleDefaults = {};
        for (const role of allRoles) {
            roleDefaults[role.name] = role.permissions || [];
        }

        populateRoleSelect();
    }

    async function loadOverrides() {
        const resp = unwrap(await apiFetch('/api/panel/role-permissions'));
        overrides = resp.overrides || [];
    }

    async function loadEffectivePerms(role) {
        const resp = unwrap(await apiFetch('/api/panel/roles/' + encodeURIComponent(role) + '/permissions'));
        const perms = resp.permissions || [];
        effectivePerms = {};
        for (const p of perms) effectivePerms[p] = true;
    }

    // ── Rendering ──────────────────────────────────────────────────────

    function populateRoleSelect() {
        const sel = document.getElementById('role-select');
        if (!sel) return;

        // Keep the placeholder
        sel.innerHTML = '<option value="" disabled selected>' + escapeHtml(_('permissions.select_role_placeholder')) + '</option>';
        const groups = [
            { label: _('permissions.builtin_roles'), roles: allRoles.filter(r => !r.is_custom) },
            { label: _('permissions.custom_roles'), roles: allRoles.filter(r => r.is_custom) }
        ];
        for (const group of groups) {
            if (!group.roles.length) continue;
            const optgroup = document.createElement('optgroup');
            optgroup.label = group.label;
            for (const role of group.roles) {
                const opt = document.createElement('option');
                opt.value = role.name;
                opt.textContent = roleLabel(role.name);
                optgroup.appendChild(opt);
            }
            sel.appendChild(optgroup);
        }

        if (selectedRole && allRoles.some(r => r.name === selectedRole)) {
            sel.value = selectedRole;
        } else {
            selectedRole = '';
        }
    }

    function renderRoleInfo(role) {
        const banner = document.getElementById('role-info-banner');
        const nameEl = document.getElementById('role-info-name');
        const levelEl = document.getElementById('role-info-level');
        const iconEl = document.getElementById('role-info-icon');
        const permCount = document.getElementById('role-perm-count');
        const overrideCount = document.getElementById('role-override-count');
        if (!banner) return;

        nameEl.textContent = roleLabel(role.name);
        if (role.is_custom) {
            levelEl.textContent = _('permissions.custom_role_tag') +
                (role.description ? ' — ' + role.description : '');
        } else {
            levelEl.textContent = _('permissions.level') + ' ' + role.level +
                (role.is_super_admin ? ' — ' + _('permissions.super_admin_tag') : '') +
                (role.is_server_level ? ' — ' + _('permissions.server_level_tag') : '');
        }
        iconEl.textContent = role.is_custom ? 'badge' : (ROLE_ICONS[role.name] || 'shield');
        const deleteBtn = document.getElementById('btn-delete-role');
        if (deleteBtn) deleteBtn.classList.toggle('hidden', !role.is_custom);

        const grantedCount = Object.keys(effectivePerms).length;
        permCount.textContent = grantedCount + '/' + allPermissions.length;

        const roleOverrides = overrides.filter(o => o.role === role.name);
        overrideCount.textContent = roleOverrides.length;

        banner.classList.remove('hidden');
    }

    function renderMatrix(role) {
        const container = document.getElementById('permissions-matrix');
        const emptyEl = document.getElementById('permissions-empty');
        const lockedEl = document.getElementById('permissions-locked');
        if (!container) return;

        // Super admin — locked notice
        if (role.is_super_admin) {
            container.classList.add('hidden');
            emptyEl.classList.add('hidden');
            lockedEl.classList.remove('hidden');
            document.getElementById('btn-reset-overrides').disabled = true;
            return;
        }

        lockedEl.classList.add('hidden');
        emptyEl.classList.add('hidden');
        container.classList.remove('hidden');

        const roleOverrides = overrides.filter(o => o.role === role.name);
        const overrideMap = {};
        for (const o of roleOverrides) overrideMap[o.permission] = o.granted;

        const defaults = roleDefaults[role.name] || [];
        const defaultSet = {};
        for (const p of defaults) defaultSet[p] = true;

        let html = '';
        for (const cat of categoriesForRender()) {
            html += `<div class="perm-category">
                <div class="perm-category-header">
                    <span class="material-icons">${cat.icon}</span>
                    <h3>${catLabel(cat.id)}</h3>
                </div>
                <div class="perm-category-body">`;

            for (const perm of cat.permissions) {
                const granted = !!effectivePerms[perm];
                const isDefault = !!defaultSet[perm];
                const isOverride = perm in overrideMap;
                const overrideClass = isOverride ? ' perm-override' : '';
                const grantedClass = granted ? ' perm-granted' : ' perm-denied';

                html += `<div class="perm-row${overrideClass}${grantedClass}">
                    <div class="perm-info">
                        <span class="perm-name">${permLabel(perm)}</span>
                        <span class="perm-key">${perm}</span>
                        ${isOverride ? '<span class="perm-badge override">' + _('permissions.custom') + '</span>' : ''}
                        ${!isOverride && isDefault ? '<span class="perm-badge default">' + _('permissions.default') + '</span>' : ''}
                    </div>
                    <div class="perm-actions">
                        ${isOverride ? '<button class="btn-icon-sm btn-revert" data-perm="' + perm + '" title="' + _('permissions.revert') + '"><span class="material-icons">undo</span></button>' : ''}
                        <label class="toggle-label">
                            <input type="checkbox" class="toggle-switch" data-perm="${perm}" ${granted ? 'checked' : ''}>
                        </label>
                    </div>
                </div>`;
            }
            html += '</div></div>';
        }

        container.innerHTML = html;
        document.getElementById('btn-reset-overrides').disabled = roleOverrides.length === 0;
    }

    // ── Event Handlers ─────────────────────────────────────────────────

    async function onRoleChange(e) {
        selectedRole = e.target.value;
        if (!selectedRole) return;

        const role = allRoles.find(r => r.name === selectedRole);
        if (!role) return;

        await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
        renderRoleInfo(role);
        renderMatrix(role);
    }

    async function onToggle(e) {
        const toggle = e.target;
        if (!toggle.classList.contains('toggle-switch')) return;
        if (!selectedRole) return;

        const perm = toggle.dataset.perm;
        const granted = toggle.checked;

        toggle.disabled = true;
        try {
            const resp = await apiFetch('/api/panel/role-permissions', {
                method: 'POST',
                body: JSON.stringify({ role: selectedRole, permission: perm, granted })
            });
            const data = unwrap(resp);
            if (data.error) {
                toggle.checked = !granted; // revert
                showToast(data.error, 'error');
                return;
            }
            showToast(_('permissions.saved'), 'success');
            // Refresh data
            await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
            const role = allRoles.find(r => r.name === selectedRole);
            if (role) {
                renderRoleInfo(role);
                renderMatrix(role);
            }
        } catch (err) {
            toggle.checked = !granted;
            showToast(_('common.error'), 'error');
        } finally {
            toggle.disabled = false;
        }
    }

    async function onRevert(e) {
        const btn = e.target.closest('.btn-revert');
        if (!btn) return;
        if (!selectedRole) return;

        const perm = btn.dataset.perm;
        btn.disabled = true;
        try {
            const resp = await apiFetch('/api/panel/role-permissions/' + encodeURIComponent(selectedRole) + '/' + encodeURIComponent(perm), {
                method: 'DELETE'
            });
            const data = unwrap(resp);
            if (data.error) {
                showToast(data.error, 'error');
                return;
            }
            showToast(_('permissions.reverted'), 'success');
            await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
            const role = allRoles.find(r => r.name === selectedRole);
            if (role) {
                renderRoleInfo(role);
                renderMatrix(role);
            }
        } catch (err) {
            showToast(_('common.error'), 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function onResetAllOverrides() {
        if (!selectedRole) return;
        const roleOverrides = overrides.filter(o => o.role === selectedRole);
        if (roleOverrides.length === 0) return;

        if (!confirm(_('permissions.confirm_reset'))) return;

        try {
            for (const o of roleOverrides) {
                await apiFetch('/api/panel/role-permissions/' + encodeURIComponent(selectedRole) + '/' + encodeURIComponent(o.permission), {
                    method: 'DELETE'
                });
            }
            showToast(_('permissions.all_reverted'), 'success');
            await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
            const role = allRoles.find(r => r.name === selectedRole);
            if (role) {
                renderRoleInfo(role);
                renderMatrix(role);
            }
        } catch (err) {
            showToast(_('common.error'), 'error');
        }
    }

    function selectRole(name) {
        const sel = document.getElementById('role-select');
        if (!sel) return;
        sel.value = name;
        sel.dispatchEvent(new Event('change'));
    }

    function onCreateRole() {
        if (!window.Modal) return;
        const copyOptions = allRoles
            .filter(r => !r.is_super_admin)
            .map(r => '<option value="' + escapeHtml(r.name) + '">' + escapeHtml(roleLabel(r.name)) + '</option>')
            .join('');
        const content = `
            <form id="create-role-form" class="modal-form" autocomplete="off">
                <div class="form-group">
                    <label for="new-role-name">${escapeHtml(_('permissions.role_name'))}</label>
                    <input type="text" id="new-role-name" class="form-input" required maxlength="32"
                        pattern="[a-z][a-z0-9_]{1,31}" placeholder="helpdesk">
                    <span class="form-hint">${escapeHtml(_('permissions.role_name_hint'))}</span>
                </div>
                <div class="form-group">
                    <label for="new-role-description">${escapeHtml(_('permissions.role_description'))}</label>
                    <input type="text" id="new-role-description" class="form-input" maxlength="200">
                </div>
                <div class="form-group">
                    <label for="new-role-copy">${escapeHtml(_('permissions.copy_from'))}</label>
                    <select id="new-role-copy" class="form-select">
                        <option value="">${escapeHtml(_('permissions.copy_from_none'))}</option>
                        ${copyOptions}
                    </select>
                </div>
            </form>`;

        async function submit() {
            const nameInput = document.getElementById('new-role-name');
            const name = (nameInput?.value || '').trim().toLowerCase();
            if (!/^[a-z][a-z0-9_]{1,31}$/.test(name)) {
                showToast(_('permissions.invalid_role_name'), 'error');
                nameInput?.focus();
                return;
            }
            const body = {
                name,
                description: (document.getElementById('new-role-description')?.value || '').trim(),
                copy_from: document.getElementById('new-role-copy')?.value || ''
            };
            try {
                const resp = await apiFetch('/api/panel/roles', { method: 'POST', body: JSON.stringify(body) });
                if (!resp || resp.success === false) {
                    showToast((resp && resp.error) || _('common.error'), 'error');
                    return;
                }
                window.Modal.close();
                showToast(_('permissions.role_created'), 'success');
                await Promise.all([loadRoles(), loadOverrides()]);
                selectRole(name);
            } catch (err) {
                showToast(_('common.error'), 'error');
            }
        }

        window.Modal.show({
            title: _('permissions.create_role'),
            content,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => window.Modal.close() },
                { label: _('permissions.create_role'), class: 'btn-primary', onClick: submit }
            ],
            onOpen: () => {
                const form = document.getElementById('create-role-form');
                form?.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
                document.getElementById('new-role-name')?.focus();
            }
        });
    }

    async function onDeleteRole() {
        const role = allRoles.find(r => r.name === selectedRole);
        if (!role || !role.is_custom) return;
        const ok = window.Modal && typeof window.Modal.confirm === 'function'
            ? await window.Modal.confirm({
                title: _('permissions.delete_role'),
                message: _('permissions.confirm_delete_role'),
                confirmLabel: _('permissions.delete_role'),
                danger: true
            })
            : confirm(_('permissions.confirm_delete_role'));
        if (!ok) return;

        try {
            const resp = await apiFetch('/api/panel/roles/' + encodeURIComponent(role.name), { method: 'DELETE' });
            if (!resp || resp.success === false) {
                showToast((resp && resp.error) || _('common.error'), 'error');
                return;
            }
            showToast(_('permissions.role_deleted'), 'success');
            selectedRole = '';
            await Promise.all([loadRoles(), loadOverrides()]);
            resetSelection();
        } catch (err) {
            showToast(_('common.error'), 'error');
        }
    }

    function resetSelection() {
        document.getElementById('role-info-banner')?.classList.add('hidden');
        document.getElementById('permissions-matrix')?.classList.add('hidden');
        document.getElementById('permissions-locked')?.classList.add('hidden');
        document.getElementById('permissions-empty')?.classList.remove('hidden');
        document.getElementById('btn-delete-role')?.classList.add('hidden');
        const resetBtn = document.getElementById('btn-reset-overrides');
        if (resetBtn) resetBtn.disabled = true;
    }

    function showToast(message, type) {
        if (window.Toast && typeof window.Toast[type] === 'function') {
            window.Toast[type]('', message);
        }
    }

    // ── Init ───────────────────────────────────────────────────────────

    async function init() {
        try {
            await Promise.all([loadRoles(), loadOverrides()]);
        } catch (err) {
            console.error('Failed to load permissions data:', err);
        }

        // Event listeners
        const roleSelect = document.getElementById('role-select');
        if (roleSelect) roleSelect.addEventListener('change', onRoleChange);

        const matrix = document.getElementById('permissions-matrix');
        if (matrix) {
            matrix.addEventListener('change', onToggle);
            matrix.addEventListener('click', onRevert);
        }

        const resetBtn = document.getElementById('btn-reset-overrides');
        if (resetBtn) resetBtn.addEventListener('click', onResetAllOverrides);

        const createBtn = document.getElementById('btn-create-role');
        if (createBtn) createBtn.addEventListener('click', onCreateRole);

        const deleteBtn = document.getElementById('btn-delete-role');
        if (deleteBtn) deleteBtn.addEventListener('click', onDeleteRole);
    }

    document.addEventListener('DOMContentLoaded', init);
})();
