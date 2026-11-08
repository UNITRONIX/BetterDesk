/**
 * BetterDesk Console — Roles and permissions (/permissions)
 *
 * Pick a role, then allow or deny each permission with a checkbox. Every
 * change is saved right away as an override in the Go server's
 * role_permissions table; the row says "Saving…", then "Saved" or why it
 * failed. Overrides are marked "Changed" and can be reset one by one or all
 * at once from the danger zone.
 */
(function () {
    'use strict';

    function _(key, params) {
        if (typeof window._ === 'function') {
            const v = window._(key, params);
            if (v) return v;
        }
        return key;
    }

    const csrfToken = (window.BetterDesk && window.BetterDesk.csrfToken) || '';

    // ── Permission groups ──────────────────────────────────────────────
    // Permissions the server lists but no group names end up under "Other".

    const CATEGORIES = [
        { id: 'device', permissions: ['device.view', 'device.connect', 'guest.create', 'device.edit', 'device.delete', 'device.ban', 'device.change_id', 'device.connection_mode'] },
        { id: 'remote_target', permissions: ['remote_target.view', 'remote_target.connect', 'remote_target.edit', 'remote_target.delete', 'remote_target.test'] },
        { id: 'user', permissions: ['user.view', 'user.create', 'user.edit', 'user.delete'] },
        { id: 'org', permissions: ['org.create', 'org.edit', 'org.delete', 'org.manage_users', 'org.manage_devices'] },
        { id: 'enrollment', permissions: ['enrollment.manage', 'enrollment.approve'] },
        { id: 'chat', permissions: ['chat.access'] },
        { id: 'audit', permissions: ['audit.view', 'metrics.view', 'blocklist.edit'] },
        { id: 'server', permissions: ['server.config', 'server.keys', 'server.attestation'] },
        { id: 'branding', permissions: ['branding.edit'] },
        { id: 'billing', permissions: ['billing.view', 'billing.manage', 'billing.reports', 'billing.export'] },
        { id: 'cdap', permissions: ['cdap.view', 'cdap.command', 'cdap.terminal', 'cdap.files'] },
        { id: 'mesh', permissions: ['mesh.terminal', 'mesh.files', 'mesh.power'] },
    ];

    // ── State ──────────────────────────────────────────────────────────

    let allRoles = [];            // [{name, level, is_super_admin, permissions}]
    let allPermissions = [];      // ['device.view', ...]
    let overrides = [];           // [{role, permission, granted}]
    let selectedRole = '';
    let roleDefaults = {};        // role -> [default perms]
    let effectivePerms = {};      // permission -> granted bool (for current role)

    const $ = (id) => document.getElementById(id);

    // ── Helpers ────────────────────────────────────────────────────────

    async function apiFetch(url, opts = {}) {
        const headers = { ...(opts.headers || {}), 'x-csrf-token': csrfToken };
        if (opts.body && typeof opts.body === 'string') {
            headers['Content-Type'] = 'application/json';
        }
        const resp = await fetch(url, { ...opts, headers, credentials: 'same-origin' });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || (data && data.success === false)) {
            throw new Error((data && data.error) || resp.statusText || 'Request failed');
        }
        return data;
    }

    function unwrap(data) {
        return (data && data.success && data.data) ? data.data : data;
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    function translated(key, fallback) {
        const v = _(key);
        return v !== key ? v : fallback;
    }

    function roleLabel(name) {
        return translated('users.role_' + name, name);
    }

    function permLabel(perm) {
        return translated('permissions.perm_' + perm.replace(/\./g, '_'), perm);
    }

    function catLabel(catId) {
        return translated('permissions.cat_' + catId, catId.charAt(0).toUpperCase() + catId.slice(1));
    }

    function toast(message, type) {
        if (window.Notifications && typeof window.Notifications[type] === 'function') {
            window.Notifications[type](message);
        }
    }

    function currentRole() {
        return allRoles.find(r => r.name === selectedRole) || null;
    }

    // ── Data loading ───────────────────────────────────────────────────

    async function loadRoles() {
        const resp = unwrap(await apiFetch('/api/panel/roles'));
        allRoles = resp.roles || [];
        allPermissions = resp.all_permissions || [];
        roleDefaults = {};
        for (const role of allRoles) roleDefaults[role.name] = role.permissions || [];
    }

    async function loadOverrides() {
        const resp = unwrap(await apiFetch('/api/panel/role-permissions'));
        overrides = resp.overrides || [];
    }

    async function loadEffectivePerms(role) {
        const resp = unwrap(await apiFetch('/api/panel/roles/' + encodeURIComponent(role) + '/permissions'));
        effectivePerms = {};
        for (const p of (resp.permissions || [])) effectivePerms[p] = true;
    }

    // ── Rendering ──────────────────────────────────────────────────────

    function populateRoleSelect() {
        const sel = $('role-select');
        if (!sel) return;
        sel.innerHTML = '<option value="" disabled>' + escHtml(_('permissions.select_role_placeholder')) + '</option>';
        for (const role of allRoles) {
            const opt = document.createElement('option');
            opt.value = role.name;
            opt.textContent = roleLabel(role.name);
            sel.appendChild(opt);
        }
        sel.value = selectedRole || '';
    }

    function renderRoleInfo(role) {
        const banner = $('role-info-banner');
        if (!banner) return;

        const desc = translated('users.role_desc_' + role.name, '');
        $('role-info-name').textContent = desc;
        $('role-info-name').hidden = !desc;

        const levelEl = $('role-info-level');
        const roleOverrides = overrides.filter(o => o.role === role.name);
        const grantedCount = Object.keys(effectivePerms).length;
        const parts = [_('permissions.level_n', { level: role.level })];
        if (role.is_super_admin) parts.push(_('permissions.tag_full_access'));
        else if (role.is_server_level) parts.push(_('permissions.tag_server_wide'));
        let summary = parts.join(', ') + '. ';
        if (!role.is_super_admin) {
            summary += _('permissions.role_summary', {
                granted: '{{g}}', total: allPermissions.length, changed: '{{c}}',
            });
        }
        levelEl.innerHTML = escHtml(summary)
            .replace('{{g}}', `<strong>${grantedCount}</strong>`)
            .replace('{{c}}', `<strong>${roleOverrides.length}</strong>`)
            + `<span id="role-perm-count" hidden>${grantedCount}/${allPermissions.length}</span>`
            + `<span id="role-override-count" hidden>${roleOverrides.length}</span>`;

        banner.hidden = false;
    }

    function groupsForRender() {
        const known = new Set(allPermissions);
        const listed = new Set();
        const groups = CATEGORIES.map(cat => {
            const perms = cat.permissions.filter(p => !known.size || known.has(p));
            perms.forEach(p => listed.add(p));
            return { id: cat.id, permissions: perms };
        }).filter(g => g.permissions.length);
        const rest = allPermissions.filter(p => !listed.has(p));
        if (rest.length) groups.push({ id: 'other', permissions: rest });
        return groups;
    }

    function renderMatrix(role) {
        const container = $('permissions-matrix');
        const lockedEl = $('permissions-locked');
        const danger = $('permissions-danger');
        if (!container) return;

        $('permissions-empty').hidden = true;

        if (role.is_super_admin) {
            container.hidden = true;
            danger.hidden = true;
            lockedEl.hidden = false;
            $('btn-reset-overrides').disabled = true;
            return;
        }

        lockedEl.hidden = true;
        container.hidden = false;
        danger.hidden = false;

        const roleOverrides = overrides.filter(o => o.role === role.name);
        const overrideMap = {};
        for (const o of roleOverrides) overrideMap[o.permission] = o.granted;

        const defaultSet = new Set(roleDefaults[role.name] || []);

        let html = '';
        for (const cat of groupsForRender()) {
            const headingId = 'perm-cat-' + cat.id;
            html += `<section class="section perm-category" aria-labelledby="${headingId}">
                <h2 id="${headingId}">${escHtml(catLabel(cat.id))}</h2>
                <ul class="list">`;

            for (const perm of cat.permissions) {
                const granted = !!effectivePerms[perm];
                const isOverride = perm in overrideMap;
                const isDefault = defaultSet.has(perm);
                const rowId = 'perm-' + perm.replace(/[^a-z0-9]/gi, '-');
                const changedText = isDefault
                    ? _('permissions.changed_default_on')
                    : _('permissions.changed_default_off');

                html += `<li class="list-row perm-row${isOverride ? ' perm-override' : ''}" data-perm-row="${escHtml(perm)}">
                    <label class="check-field">
                        <input type="checkbox" class="toggle-switch" id="${rowId}" data-perm="${escHtml(perm)}" ${granted ? 'checked' : ''}>
                        <span class="check-label">${escHtml(permLabel(perm))}</span>
                        <span class="form-hint perm-key">${Utils.valueHtml(perm)}</span>
                    </label>
                    <span class="row-end">
                        <span class="perm-status" id="${rowId}-status" aria-live="polite"></span>
                        ${isOverride ? `<span class="perm-changed">${escHtml(changedText)}</span>
                            <button type="button" class="btn-link btn-revert" data-perm="${escHtml(perm)}"
                                aria-label="${escHtml(_('permissions.reset_one', { name: permLabel(perm) }))}">${escHtml(_('permissions.reset'))}</button>` : ''}
                    </span>
                </li>`;
            }
            html += '</ul></section>';
        }

        container.innerHTML = html;
        $('btn-reset-overrides').disabled = roleOverrides.length === 0;
    }

    function setRowStatus(perm, text, kind) {
        const row = document.querySelector(`[data-perm-row="${CSS.escape(perm)}"]`);
        const el = row && row.querySelector('.perm-status');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('is-ok', kind === 'ok');
        el.classList.toggle('is-error', kind === 'error');
    }

    // Reload and redraw, keeping focus on the control the user was on
    async function refresh(focusPerm, focusKind) {
        await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
        const role = currentRole();
        if (!role) return;
        renderRoleInfo(role);
        renderMatrix(role);
        if (focusPerm) {
            const sel = focusKind === 'revert'
                ? `.btn-revert[data-perm="${CSS.escape(focusPerm)}"]`
                : `input[data-perm="${CSS.escape(focusPerm)}"]`;
            const el = document.querySelector(sel) || document.querySelector(`input[data-perm="${CSS.escape(focusPerm)}"]`);
            if (el) el.focus({ preventScroll: true });
        }
    }

    // ── Event handlers ─────────────────────────────────────────────────

    async function selectRole(name) {
        selectedRole = name;
        const role = currentRole();
        if (!role) return;
        const url = new URL(window.location.href);
        url.searchParams.set('role', name);
        history.replaceState(null, '', url);
        try {
            await Promise.all([loadEffectivePerms(selectedRole), loadOverrides()]);
            renderRoleInfo(role);
            renderMatrix(role);
        } catch (err) {
            showLoadError();
        }
    }

    async function onToggle(e) {
        const toggle = e.target;
        if (!toggle.classList.contains('toggle-switch') || !selectedRole) return;

        const perm = toggle.dataset.perm;
        const granted = toggle.checked;

        toggle.disabled = true;
        setRowStatus(perm, _('permissions.saving'));
        try {
            await apiFetch('/api/panel/role-permissions', {
                method: 'POST',
                body: JSON.stringify({ role: selectedRole, permission: perm, granted }),
            });
            await refresh(perm, 'toggle');
            setRowStatus(perm, _('permissions.saved'), 'ok');
        } catch (err) {
            toggle.checked = !granted;
            toggle.disabled = false;
            setRowStatus(perm, _('permissions.save_failed') + ' ' + err.message, 'error');
        }
    }

    async function onRevert(e) {
        const btn = e.target.closest('.btn-revert');
        if (!btn || !selectedRole) return;

        const perm = btn.dataset.perm;
        btn.disabled = true;
        setRowStatus(perm, _('permissions.saving'));
        try {
            await apiFetch('/api/panel/role-permissions/' + encodeURIComponent(selectedRole) + '/' + encodeURIComponent(perm), {
                method: 'DELETE',
            });
            await refresh(perm, 'toggle');
            setRowStatus(perm, _('permissions.reverted'), 'ok');
        } catch (err) {
            btn.disabled = false;
            setRowStatus(perm, _('permissions.save_failed') + ' ' + err.message, 'error');
        }
    }

    async function onResetAllOverrides() {
        const role = currentRole();
        if (!role) return;
        const roleOverrides = overrides.filter(o => o.role === selectedRole);
        if (roleOverrides.length === 0) return;

        const confirmed = await Modal.confirm({
            title: _('permissions.reset_overrides'),
            message: _('permissions.confirm_reset_named', { role: roleLabel(role.name) }),
            confirmLabel: _('permissions.reset_overrides'),
            danger: true,
        });
        if (!confirmed) return;

        const btn = $('btn-reset-overrides');
        btn.disabled = true;
        try {
            for (const o of roleOverrides) {
                await apiFetch('/api/panel/role-permissions/' + encodeURIComponent(selectedRole) + '/' + encodeURIComponent(o.permission), {
                    method: 'DELETE',
                });
            }
            toast(_('permissions.all_reverted'), 'success');
        } catch (err) {
            toast(_('permissions.save_failed') + ' ' + err.message, 'error');
        }
        await refresh().catch(() => showLoadError());
    }

    function showLoadError() {
        $('permissions-loading').hidden = true;
        $('permissions-error').hidden = false;
        $('permissions-matrix').hidden = true;
        $('permissions-danger').hidden = true;
    }

    // ── Init ───────────────────────────────────────────────────────────

    async function load() {
        $('permissions-loading').hidden = false;
        $('permissions-error').hidden = true;
        try {
            await Promise.all([loadRoles(), loadOverrides()]);
        } catch (err) {
            showLoadError();
            return;
        }
        $('permissions-loading').hidden = true;

        // Open the role from ?role=, else the first role that can be changed
        const wanted = new URL(window.location.href).searchParams.get('role');
        const first = allRoles.find(r => r.name === wanted) || allRoles.find(r => !r.is_super_admin);
        selectedRole = first ? first.name : '';
        populateRoleSelect();
        if (selectedRole) await selectRole(selectedRole);
        else $('permissions-empty').hidden = false;
    }

    function init() {
        const roleSelect = $('role-select');
        if (roleSelect) roleSelect.addEventListener('change', (e) => { if (e.target.value) selectRole(e.target.value); });

        const matrix = $('permissions-matrix');
        if (matrix) {
            matrix.addEventListener('change', onToggle);
            matrix.addEventListener('click', onRevert);
        }

        const resetBtn = $('btn-reset-overrides');
        if (resetBtn) resetBtn.addEventListener('click', onResetAllOverrides);

        const retry = $('permissions-retry');
        if (retry) retry.addEventListener('click', load);

        load();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
