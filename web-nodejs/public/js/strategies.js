/**
 * BetterDesk Console — access control strategies (RustDesk Pro).
 *
 * Strategies link a user group to a device group and push security settings to
 * the matching clients. They used to live in a card halfway down the Devices
 * page, where nobody found them; this page keeps the same logic and the same
 * endpoints, with the list as the page's only content.
 *
 * The API is unchanged: /api/panel/strategies and /api/panel/user-groups,
 * /api/device-groups, /api/devices for the pickers in the edit and assign
 * dialogs.
 */
(function () {
    'use strict';

    const RUSTDESK_STRATEGY_PERM_KEYS = [
        { key: 'enable-file-transfer', labelKey: 'devices.strategy_perm_file_transfer' },
        { key: 'disable-clipboard', labelKey: 'devices.strategy_perm_disable_clipboard' },
        { key: 'enable-clipboard', labelKey: 'devices.strategy_perm_enable_clipboard' },
        { key: 'enable-audio', labelKey: 'devices.strategy_perm_audio' },
        { key: 'enable-tunnel', labelKey: 'devices.strategy_perm_tunnel' },
        { key: 'enable-camera', labelKey: 'devices.strategy_perm_camera' },
        { key: 'enable-remote-restart', labelKey: 'devices.strategy_perm_restart' },
        { key: 'enable-block-input', labelKey: 'devices.strategy_perm_block_input' },
    ];

    let accessStrategies = [];
    let strategiesLoaded = false;
    let availableUserGroups = [];
    let userGroupsLoaded = false;
    let deviceGroups = [];
    let devices = [];

    /** Collapse concurrent requests for the same endpoint into one. */
    const pendingRequests = new Map();
    function fetchOnce(endpoint, fetcher) {
        if (pendingRequests.has(endpoint)) return pendingRequests.get(endpoint);
        const request = fetcher().finally(() => pendingRequests.delete(endpoint));
        pendingRequests.set(endpoint, request);
        return request;
    }

    function listFrom(payload, key) {
        if (!payload) return [];
        if (Array.isArray(payload[key])) return payload[key];
        if (payload.data && Array.isArray(payload.data[key])) return payload.data[key];
        return [];
    }

    // ── Data ──────────────────────────────────────────────────────────────

    async function loadUserGroups() {
        try {
            const response = await fetchOnce('/api/panel/user-groups', () => Utils.api('/api/panel/user-groups'));
            availableUserGroups = listFrom(response, 'groups');
        } catch (error) {
            availableUserGroups = [];
            console.error('Failed to load user groups:', error);
        }
        userGroupsLoaded = true;
    }

    async function ensureUserGroupsLoaded() {
        if (!userGroupsLoaded) await loadUserGroups();
    }

    async function loadDeviceGroups() {
        try {
            const response = await fetchOnce('/api/device-groups', () => Utils.api('/api/device-groups'));
            deviceGroups = listFrom(response, 'groups');
        } catch (error) {
            deviceGroups = [];
            console.error('Failed to load device groups:', error);
        }
    }

    async function loadDevices() {
        if (devices.length) return;
        try {
            const response = await fetchOnce('/api/devices', () => Utils.api('/api/devices'));
            devices = listFrom(response, 'devices');
        } catch (error) {
            devices = [];
            console.error('Failed to load devices:', error);
        }
    }

    async function loadStrategies() {
        try {
            const response = await fetchOnce('/api/panel/strategies', () => Utils.api('/api/panel/strategies'));
            accessStrategies = listFrom(response, 'strategies');
        } catch (error) {
            console.error('Failed to load strategies:', error);
            accessStrategies = [];
        }
        strategiesLoaded = true;
        renderStrategies();
    }

    // ── List ──────────────────────────────────────────────────────────────

    function renderStrategies() {
        const container = document.getElementById('devices-strategies-list');
        if (!container) return;
        if (!strategiesLoaded) {
            container.innerHTML = `<div class="empty-state-inline">${_('devices.loading_strategies')}</div>`;
            return;
        }
        if (!accessStrategies.length) {
            container.innerHTML = `<div class="empty-state">
                <span class="material-icons" aria-hidden="true">policy</span>
                <h3>${_('devices.no_strategies')}</h3>
                <p>${_('devices.strategies_hint')}</p>
            </div>`;
            return;
        }

        const userGroupName = (guid) => {
            const group = availableUserGroups.find(item => item.guid === guid);
            return group ? group.name : (guid || _('devices.strategy_any_user_group'));
        };
        const deviceGroupName = (guid) => {
            const group = deviceGroups.find(item => item.guid === guid);
            return group ? group.name : (guid || _('devices.strategy_any_device_group'));
        };

        container.innerHTML = accessStrategies.map(strategy => {
            const enabled = strategy.enabled !== false;
            const permCount = Object.keys(strategy.permissions || {}).length;
            return `<div class="strategy-manager-item ${enabled ? '' : 'strategy-disabled'}" data-guid="${Utils.escapeHtml(strategy.guid)}">
                <div class="strategy-manager-main">
                    <span class="material-icons" aria-hidden="true">policy</span>
                    <div class="strategy-manager-text">
                        <strong>${Utils.escapeHtml(strategy.name)}</strong>
                        <span>${Utils.escapeHtml(userGroupName(strategy.user_group_guid))} → ${Utils.escapeHtml(deviceGroupName(strategy.device_group_guid))}</span>
                        <span class="strategy-perm-count">${_('devices.strategy_permissions_count', { count: permCount }) || permCount + ' settings'}</span>
                        <span class="strategy-assign-count" data-guid="${Utils.escapeHtml(strategy.guid)}">${_('devices.strategy_assign_none')}</span>
                    </div>
                </div>
                <span class="strategy-status-badge ${enabled ? 'enabled' : 'disabled'}">${enabled ? _('devices.strategy_enabled') : _('devices.strategy_disabled')}</span>
                <div class="strategy-manager-actions">
                    <button type="button" class="action-btn" data-action="assign-strategy" data-guid="${Utils.escapeHtml(strategy.guid)}" title="${_('devices.strategy_assign')}" aria-label="${_('devices.strategy_assign')}">
                        <span class="material-icons" aria-hidden="true">link</span>
                    </button>
                    <button type="button" class="action-btn" data-action="edit-strategy" data-guid="${Utils.escapeHtml(strategy.guid)}" title="${_('devices.edit_strategy')}" aria-label="${_('devices.edit_strategy')}">
                        <span class="material-icons" aria-hidden="true">edit</span>
                    </button>
                    <button type="button" class="action-btn danger" data-action="delete-strategy" data-guid="${Utils.escapeHtml(strategy.guid)}" title="${_('devices.delete_strategy')}" aria-label="${_('devices.delete_strategy')}">
                        <span class="material-icons" aria-hidden="true">delete</span>
                    </button>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('[data-action="edit-strategy"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const strategy = accessStrategies.find(item => item.guid === btn.dataset.guid);
                if (strategy) showStrategyModal(strategy);
            });
        });
        container.querySelectorAll('[data-action="assign-strategy"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const strategy = accessStrategies.find(item => item.guid === btn.dataset.guid);
                if (strategy) showStrategyAssignModal(strategy);
            });
        });
        container.querySelectorAll('[data-action="delete-strategy"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const strategy = accessStrategies.find(item => item.guid === btn.dataset.guid);
                if (strategy) deleteStrategy(strategy);
            });
        });
        refreshStrategyAssignCounts();
    }

    async function refreshStrategyAssignCounts() {
        const badges = document.querySelectorAll('.strategy-assign-count[data-guid]');
        await Promise.all(Array.from(badges).map(async (el) => {
            try {
                const resp = await Utils.api(`/api/panel/strategies/${encodeURIComponent(el.dataset.guid)}`);
                const st = resp?.data?.strategy || resp?.strategy || {};
                const text = _('devices.strategy_assign_counts', {
                    peers: st.peer_count || 0,
                    users: st.user_count || 0,
                    groups: st.device_group_count || 0,
                });
                el.textContent = (st.peer_count || st.user_count || st.device_group_count)
                    ? text
                    : _('devices.strategy_assign_none');
            } catch (_) {
                el.textContent = _('devices.strategy_assign_none');
            }
        }));
    }

    // ── Assign dialog ─────────────────────────────────────────────────────

    function renderAssignCheckboxList(items, selectedKeys, inputClass, labelFn) {
        if (!items.length) {
            return `<div class="empty-state-inline">${_('common.no_results') || 'No items'}</div>`;
        }
        return items.map(item => {
            const checked = selectedKeys.includes(item.key) ? 'checked' : '';
            return `<label class="strategy-assign-option">
                <input type="checkbox" class="${inputClass}" value="${Utils.escapeHtml(item.key)}" ${checked}>
                <span>${Utils.escapeHtml(labelFn(item))}</span>
            </label>`;
        }).join('');
    }

    async function showStrategyAssignModal(strategy) {
        await Promise.all([loadDeviceGroups(), loadDevices()]);
        let panelUsers = [];
        try {
            const usersResp = await Utils.api('/api/users');
            panelUsers = usersResp.users || usersResp.data?.users || [];
        } catch (_) { panelUsers = []; }

        let detail = { peer_ids: [], user_names: [], group_guids: [] };
        try {
            const resp = await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}`);
            detail = resp?.data?.strategy || detail;
        } catch (_) { /* keep the empty default */ }

        const deviceItems = devices.slice(0, 500).map(d => ({
            key: d.id,
            label: `${d.id}${d.hostname ? ' — ' + d.hostname : ''}`,
        }));
        const userItems = panelUsers.map(u => ({
            key: u.username || u.name || String(u.id),
            label: u.username || u.name || String(u.id),
        }));
        const groupItems = deviceGroups.map(g => ({ key: g.guid, label: g.name || g.guid }));

        Modal.show({
            title: (_('devices.strategy_assign_title') || 'Assign strategy').replace('{name}', strategy.name),
            content: `
                <form id="strategy-assign-form" class="device-group-form">
                    <p class="form-hint">${_('devices.strategy_assign_hint')}</p>
                    <div class="form-group">
                        <label>${_('devices.strategy_assign_devices')}</label>
                        <div class="strategy-assign-list">${renderAssignCheckboxList(deviceItems, detail.peer_ids || [], 'strategy-assign-peer', i => i.label)}</div>
                    </div>
                    <div class="form-group">
                        <label>${_('devices.strategy_assign_users')}</label>
                        <div class="strategy-assign-list">${renderAssignCheckboxList(userItems, detail.user_names || [], 'strategy-assign-user', i => i.label)}</div>
                    </div>
                    <div class="form-group">
                        <label>${_('devices.strategy_assign_groups')}</label>
                        <div class="strategy-assign-list">${renderAssignCheckboxList(groupItems, detail.group_guids || [], 'strategy-assign-group', i => i.label)}</div>
                    </div>
                </form>
            `,
            size: 'large',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => saveStrategyAssignments(strategy) }
            ],
        });
    }

    async function saveStrategyAssignments(strategy) {
        const peers = Array.from(document.querySelectorAll('.strategy-assign-peer:checked')).map(el => el.value);
        const users = Array.from(document.querySelectorAll('.strategy-assign-user:checked')).map(el => el.value);
        const groups = Array.from(document.querySelectorAll('.strategy-assign-group:checked')).map(el => el.value);
        if (!peers.length && !users.length && !groups.length) {
            Notifications.error(_('devices.strategy_assign_hint'));
            return;
        }
        try {
            await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}/assign`, {
                method: 'POST',
                body: { peers, users, groups },
            });
            Notifications.success(_('devices.strategy_assign_saved'));
            Modal.close();
            await refreshStrategyAssignCounts();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    // ── Edit dialog ───────────────────────────────────────────────────────

    function renderStrategyPermissionOptions(permissions = {}) {
        return RUSTDESK_STRATEGY_PERM_KEYS.map(item => {
            const current = permissions[item.key];
            const checked = current === 'Y' || current === true;
            const denied = current === 'N' || current === false;
            return `<label class="strategy-perm-option">
                <span>${Utils.escapeHtml(_(item.labelKey))}</span>
                <select class="form-input strategy-perm-select" data-perm-key="${Utils.escapeHtml(item.key)}">
                    <option value="" ${!checked && !denied ? 'selected' : ''}>${_('devices.strategy_perm_default')}</option>
                    <option value="Y" ${checked ? 'selected' : ''}>${_('devices.strategy_perm_allow')}</option>
                    <option value="N" ${denied ? 'selected' : ''}>${_('devices.strategy_perm_deny')}</option>
                </select>
            </label>`;
        }).join('');
    }

    function readStrategyPermissionsFromForm() {
        const permissions = {};
        document.querySelectorAll('.strategy-perm-select').forEach(select => {
            const key = select.dataset.permKey;
            const value = select.value;
            if (key && (value === 'Y' || value === 'N')) permissions[key] = value;
        });
        return permissions;
    }

    async function showStrategyModal(strategy = null) {
        await ensureUserGroupsLoaded();
        await loadDeviceGroups();
        const editing = !!strategy;
        const userGroupOptions = [
            `<option value="">${Utils.escapeHtml(_('devices.strategy_any_user_group'))}</option>`,
            ...availableUserGroups.map(group => `<option value="${Utils.escapeHtml(group.guid)}" ${strategy?.user_group_guid === group.guid ? 'selected' : ''}>${Utils.escapeHtml(group.name)}</option>`)
        ].join('');
        const deviceGroupOptions = [
            `<option value="">${Utils.escapeHtml(_('devices.strategy_any_device_group'))}</option>`,
            ...deviceGroups.map(group => `<option value="${Utils.escapeHtml(group.guid)}" ${strategy?.device_group_guid === group.guid ? 'selected' : ''}>${Utils.escapeHtml(group.name)}</option>`)
        ].join('');

        Modal.show({
            title: editing ? _('devices.edit_strategy') : _('devices.create_strategy'),
            content: `
                <form id="strategy-form" class="device-group-form">
                    <div class="form-group">
                        <label for="strategy-name">${_('devices.strategy_name')}</label>
                        <input type="text" id="strategy-name" class="form-input" maxlength="80" required value="${Utils.escapeHtml(strategy?.name || '')}">
                    </div>
                    <div class="form-group">
                        <label for="strategy-user-group">${_('devices.strategy_user_group')}</label>
                        <select id="strategy-user-group" class="form-input">${userGroupOptions}</select>
                    </div>
                    <div class="form-group">
                        <label for="strategy-device-group">${_('devices.strategy_device_group')}</label>
                        <select id="strategy-device-group" class="form-input">${deviceGroupOptions}</select>
                    </div>
                    <label class="toggle-row">
                        <input type="checkbox" id="strategy-enabled" ${strategy?.enabled !== false ? 'checked' : ''}>
                        <span>${_('devices.strategy_enabled_label')}</span>
                    </label>
                    <div class="form-group">
                        <label>${_('devices.strategy_permissions')}</label>
                        <div class="strategy-perm-grid">${renderStrategyPermissionOptions(strategy?.permissions || {})}</div>
                        <p class="form-hint">${_('devices.strategy_permissions_hint')}</p>
                    </div>
                </form>
            `,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => saveStrategy(strategy) }
            ],
            onOpen: () => document.getElementById('strategy-name')?.focus()
        });
    }

    async function saveStrategy(strategy = null) {
        const name = document.getElementById('strategy-name')?.value.trim() || '';
        if (!name) {
            Notifications.error(_('devices.strategy_name_required'));
            return;
        }
        const payload = {
            name,
            user_group_guid: document.getElementById('strategy-user-group')?.value || '',
            device_group_guid: document.getElementById('strategy-device-group')?.value || '',
            enabled: !!document.getElementById('strategy-enabled')?.checked,
            permissions: readStrategyPermissionsFromForm(),
        };
        try {
            const url = strategy
                ? `/api/panel/strategies/${encodeURIComponent(strategy.guid)}`
                : '/api/panel/strategies';
            await Utils.api(url, { method: strategy ? 'PATCH' : 'POST', body: payload });
            Notifications.success(strategy ? _('devices.strategy_updated') : _('devices.strategy_created'));
            Modal.close();
            await loadStrategies();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    async function deleteStrategy(strategy) {
        const confirmed = await Modal.confirm({
            title: _('devices.delete_strategy'),
            message: (_('devices.delete_strategy_confirm') || 'Delete strategy {name}?').replace('{name}', strategy.name),
            confirmLabel: _('actions.delete'),
            danger: true,
        });
        if (!confirmed) return;
        try {
            await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}`, { method: 'DELETE' });
            Notifications.success(_('devices.strategy_deleted'));
            await loadStrategies();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    // ── Boot ──────────────────────────────────────────────────────────────

    function init() {
        document.getElementById('add-strategy-btn')
            ?.addEventListener('click', () => showStrategyModal());
        // Group names appear in the list, so they load alongside it.
        loadUserGroups();
        loadDeviceGroups();
        loadStrategies();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
