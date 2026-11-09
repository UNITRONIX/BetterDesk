/**
 * BetterDesk Console - Devices Page
 */

(function() {
    'use strict';

    function remoteText(key, fallback) {
        const value = _(key);
        return value && value !== key ? value : fallback;
    }
    
    // Fallback if Utils.sanitizeColor is missing (old utils.js on server)
    function _sanitizeColorFallback(c) {
        if (!c || typeof c !== 'string') return '#808080';
        if (/^#[0-9A-Fa-f]{3,6}$/.test(c)) return c;
        return '#808080';
    }

    function deviceStatusInfo(d) {
        if (d.soft_deleted) {
            return { className: 'deleted', label: _('devices.deleted_badge'), title: '' };
        }
        if (d.banned) {
            return { className: 'banned', label: _('status.banned'), title: '' };
        }
        if (d.online) {
            return { className: 'online', label: _('status.online'), title: '' };
        }
        if (d.no_signal) {
            return {
                className: 'no_signal',
                label: _('status.no_signal'),
                title: _('devices.no_signal_tooltip')
            };
        }
        return { className: 'offline', label: _('status.offline'), title: '' };
    }

    // Map device_type to Material Icons
    function getDeviceTypeIcon(type) {
        switch ((type || '').toLowerCase()) {
            case 'betterdesk': return 'desktop_windows';
            case 'betterdesk-support': return 'support_agent';
            case 'desktop':  return 'desktop_windows';
            case 'scada':    return 'precision_manufacturing';
            case 'iot':      return 'sensors';
            case 'os_agent': return 'terminal';
            case 'mesh_agent': return 'hub';
            case 'rdp':      return 'desktop_windows';
            case 'vnc':      return 'computer';
            case 'mobile':   return 'phone_android';
            case 'rustdesk': return 'connected_tv';
            default:         return 'devices';
        }
    }

    function getDeviceTypeLabel(type) {
        switch ((type || '').toLowerCase()) {
            case 'betterdesk': return 'BetterDesk';
            case 'betterdesk-support': return 'BetterDesk Support';
            case 'rustdesk': return 'RustDesk';
            case 'rdp': return 'RDP';
            case 'vnc': return 'VNC';
            case 'mobile': return _('devices.type_mobile');
            case 'desktop': return _('devices.filter_type_desktop');
            case 'scada': return 'SCADA';
            case 'iot': return 'IoT';
            case 'os_agent': return _('devices.filter_type_agent');
            case 'mesh_agent': return _('devices.type_mesh_agent');
            default: {
                // Unknown types: words with a capital first letter, not the raw value
                const t = String(type || '').replace(/[_-]+/g, ' ').trim();
                return t ? t.charAt(0).toUpperCase() + t.slice(1) : '-';
            }
        }
    }
    
    document.addEventListener('DOMContentLoaded', init);
    
    // State
    let devices = [];
    let filteredDevices = [];
    let folders = [];
    let deviceGroups = [];
    let accessStrategies = [];
    let strategiesLoaded = false;
    let availableUserGroups = [];
    let userGroupsLoaded = false;
    let availableTags = [];
    let selectedTags = new Set();
    let selectedIds = new Set();
    let currentFilter = 'all';
    let currentFolder = 'all';
    let currentGroup = 'all';
    let currentSort = { field: 'last_online', order: 'desc' };
    let currentPage = 1;
    let perPage = 20;
    let searchQuery = '';
    let showDeleted = false;
    let draggedDeviceId = null;
    let lastDragClientY = null;
    let dragScrollRafId = null;
    let dragImageEl = null;
    const DRAG_SCROLL_EDGE_PX = 56;
    const DRAG_SCROLL_MIN_SPEED = 4;
    const DRAG_SCROLL_MAX_SPEED = 20;
    const STORAGE_PER_PAGE = 'bd_devices_per_page';
    const STORAGE_SHOW_DELETED = 'bd_devices_show_deleted';
    const PER_PAGE_OPTIONS = [10, 20, 50, 100];
    let contextMenuState = null;
    let hScrollSyncing = false;
    const pendingRequests = new Map();
    const LOAD_STAGGER_MS = 120;
    const DEVICES_REFRESH_INTERVAL_MS = 60000;
    let devicesRefreshTimer = null;
    let devicesVisibilityHandler = null;
    
    function fetchOnce(endpoint, fetcher) {
        if (pendingRequests.has(endpoint)) return pendingRequests.get(endpoint);
        const request = fetcher().finally(() => pendingRequests.delete(endpoint));
        pendingRequests.set(endpoint, request);
        return request;
    }

    function scheduleLoad(fn, index) {
        setTimeout(fn, index * LOAD_STAGGER_MS);
    }
    
    // Elements
    let tableBody, pagination, emptyState, bulkActions, selectedCountEl;
    let contextMenuEl, tableScrollEl, hScrollFloatEl, hScrollSpacerEl;
    
    function init() {
        // Cache elements
        tableBody = document.getElementById('devices-tbody');
        pagination = document.getElementById('pagination');
        emptyState = document.getElementById('devices-empty');
        bulkActions = document.getElementById('bulk-actions');
        selectedCountEl = document.getElementById('selected-count');
        
        // Load data (staggered to avoid rate-limit bursts on page entry)
        scheduleLoad(loadFolders, 0);
        scheduleLoad(loadUserGroups, 1);
        scheduleLoad(loadDeviceGroups, 2);
        scheduleLoad(loadStrategies, 3);
        scheduleLoad(loadTags, 4);
        scheduleLoad(loadDevices, 5);
        
        // Event listeners
        initSearch();
        initFilters();
        initShowDeletedToggle();
        initTagFilter();
        initManageTags();
        initSorting();
        initSync();
        document.getElementById('add-remote-target-btn')?.addEventListener('click', () => showRemoteTargetModal());
        initFolders();
        initDeviceGroups();
        initStrategies();
        initDragDrop();
        attachFolderDropEvents();  // For static folder chips
        attachGroupDropEvents();   // For static group chips
        initColumnVisibility();    // Column show/hide toggle
        initKebabGlobalClose();    // Close kebab/context menus on outside click
        initContextMenu();
        initPerPage();
        initTableHScroll();

        const savedPerPage = parseInt(localStorage.getItem(STORAGE_PER_PAGE) || '', 10);
        if (PER_PAGE_OPTIONS.includes(savedPerPage)) {
            perPage = savedPerPage;
            const perPageSelect = document.getElementById('per-page-select');
            if (perPageSelect) perPageSelect.value = String(perPage);
        }

        showDeleted = localStorage.getItem(STORAGE_SHOW_DELETED) === '1';
        const showDeletedInput = document.getElementById('show-deleted-input');
        if (showDeletedInput) showDeletedInput.checked = showDeleted;
        
        // Refresh handler
        window.addEventListener('app:refresh', () => {
            loadFolders();
            loadUserGroups();
            loadDeviceGroups();
            loadStrategies();
            loadTags();
            loadDevices();
        });

        // Listen for changes from DeviceDetail panel
        document.addEventListener('deviceDetail:changed', () => {
            loadFolders();
            loadUserGroups();
            loadDeviceGroups();
            loadTags();
            loadDevices();
        });

        // Real-time device status push via WebSocket
        initDeviceStatusWS();
        initDevicesBackgroundRefresh();
    }

    /**
     * Keep the list reconciled with the server without competing with the
     * WebSocket status updates. The visibility check avoids background
     * requests while the tab is not being viewed.
     */
    function initDevicesBackgroundRefresh() {
        stopDevicesBackgroundRefresh();

        devicesRefreshTimer = window.setInterval(() => {
            if (!document.hidden) loadDevices();
        }, DEVICES_REFRESH_INTERVAL_MS);

        devicesVisibilityHandler = () => {
            if (!document.hidden) loadDevices();
        };
        document.addEventListener('visibilitychange', devicesVisibilityHandler);
        window.addEventListener('beforeunload', stopDevicesBackgroundRefresh, { once: true });
    }

    function stopDevicesBackgroundRefresh() {
        if (devicesRefreshTimer !== null) {
            window.clearInterval(devicesRefreshTimer);
            devicesRefreshTimer = null;
        }
        if (devicesVisibilityHandler) {
            document.removeEventListener('visibilitychange', devicesVisibilityHandler);
            devicesVisibilityHandler = null;
        }
    }

    /**
     * Connect to WebSocket for real-time device status updates.
     * Updates device status dots and badges without full page reload.
     */
    function initDeviceStatusWS() {
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${proto}//${location.host}/ws/device-status`;
        let ws = null;
        let retryDelay = 3000;

        function connect() {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                retryDelay = 3000;
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    if (data.type === 'device_status') {
                        updateDeviceStatusInPlace(data.device_id, data.status);
                        document.dispatchEvent(new CustomEvent('devices:live-status', {
                            detail: { id: data.device_id, status: data.status }
                        }));
                    } else if (data.type === 'device_id_changed') {
                        document.dispatchEvent(new CustomEvent('devices:id-changed', {
                            detail: { old_id: data.old_id, new_id: data.new_id, source: data.source || '' }
                        }));
                        loadDevices();
                    }
                } catch (_) {}
            };

            ws.onclose = () => {
                setTimeout(connect, retryDelay);
                retryDelay = Math.min(retryDelay * 2, 60000);
            };

            ws.onerror = () => {
                ws.close();
            };
        }

        connect();
    }

    /**
     * Update a single device's status indicator without reloading the entire table.
     */
    function updateDeviceStatusInPlace(deviceId, status) {
        const row = tableBody?.querySelector(`tr[data-id="${CSS.escape(String(deviceId))}"]`);
        if (!row) return;
        // A banned or deleted device keeps that status; a disconnect push must not relabel it
        const known = devices.find(d => d.id === deviceId);
        if (known && (known.banned || known.soft_deleted)) return;

        const normalizedStatus = String(status || '').toLowerCase();
        const statusClassName = ['online', 'offline', 'no_signal', 'degraded', 'critical'].includes(normalizedStatus)
            ? normalizedStatus
            : 'offline';
        const statusText = _('status.' + statusClassName);
        const statusLabel = statusText === 'status.' + statusClassName ? statusClassName : statusText;

        const dot = row.querySelector('.device-status-dot');
        if (dot) {
            dot.className = 'device-status-dot';
            dot.classList.add(statusClassName);
            dot.title = statusLabel;
        }

        const badge = row.querySelector('[data-column="status"] .status');
        if (badge) {
            badge.className = `status ${statusClassName}`;
            badge.textContent = statusLabel;
        }

        // Also update the device in our local state
        const dev = devices.find(d => d.id === deviceId);
        if (dev) {
            dev.status = status;
            dev.live_status = statusClassName;
            dev.live_online = statusClassName === 'online';
            dev.online = statusClassName === 'online';
            dev.no_signal = statusClassName === 'no_signal';
            renderDevicesSummary();
        }
    }

    /**
     * Close all open kebab menus when clicking outside
     */
    function initKebabGlobalClose() {
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.kebab-wrapper')) {
                closeAllKebabMenus();
            }
            if (!e.target.closest('.devices-context-menu')) {
                closeContextMenu();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const opener = menuOpener;
                const hadMenu = !!document.querySelector('.kebab-menu.open') || (contextMenuEl && !contextMenuEl.hidden);
                closeAllKebabMenus();
                closeContextMenu();
                if (hadMenu && opener && document.contains(opener)) opener.focus();
            }
        });

        // Scrolling the page or the table moves the button a menu hangs off, so the
        // menu closes. Scrolls that leave that button where it was keep it open:
        // scrolling a long menu itself, and the scroll that brought a half-hidden
        // menu button into view as it was clicked or focused (that scroll event
        // arrives a frame after the menu opened).
        document.addEventListener('scroll', (e) => {
            const target = e.target;
            if (target && target.nodeType === 1 && target.closest('.kebab-menu, .devices-context-menu')) return;
            if (menuAnchorUnmoved()) return;
            closeAllKebabMenus();
            closeContextMenu();
        }, true);
        window.addEventListener('resize', () => {
            closeAllKebabMenus();
            closeContextMenu();
            updateTableHScroll();
        });

        // Dedicated backdrop dismiss (phone bottom-sheet); do not rely only on document click
        const overlay = document.getElementById('kebab-overlay');
        if (overlay) {
            overlay.addEventListener('click', (e) => {
                e.preventDefault();
                closeAllKebabMenus();
            });
        }
    }

    function closeAllKebabMenus() {
        menuAnchor = null;
        document.querySelectorAll('.kebab-menu.open').forEach(m => {
            m.classList.remove('open');
            m.style.top = '';
            m.style.left = '';
        });
        document.querySelectorAll('.kebab-btn[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
        const overlay = document.getElementById('kebab-overlay');
        if (overlay) overlay.classList.remove('open');
    }

    // Button that opened the current menu; Escape returns focus to it
    let menuOpener = null;
    // The button an open menu was placed against, and where it was then
    let menuAnchor = null;

    function rememberMenuAnchor(el) {
        if (!el || !document.contains(el)) {
            menuAnchor = null;
            return;
        }
        const r = el.getBoundingClientRect();
        menuAnchor = { el, top: r.top, left: r.left };
    }

    function menuAnchorUnmoved() {
        if (!menuAnchor || !document.contains(menuAnchor.el)) return false;
        const r = menuAnchor.el.getBoundingClientRect();
        return Math.abs(r.top - menuAnchor.top) < 1 && Math.abs(r.left - menuAnchor.left) < 1;
    }

    /**
     * Keyboard support for an open menu: focus the first item, move with
     * the arrow keys, Home and End.
     */
    function focusMenu(menu, opener) {
        menuOpener = opener || null;
        const items = () => Array.from(menu.querySelectorAll('button:not([disabled]), [role="menuitem"], a[href]'));
        const first = items()[0];
        if (first) first.focus({ preventScroll: true });
        if (menu.dataset.keysBound) return;
        menu.dataset.keysBound = '1';
        menu.addEventListener('keydown', (e) => {
            const list = items();
            const i = list.indexOf(document.activeElement);
            let next = null;
            if (e.key === 'ArrowDown') next = list[(i + 1) % list.length];
            else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length];
            else if (e.key === 'Home') next = list[0];
            else if (e.key === 'End') next = list[list.length - 1];
            else if (e.key === 'Tab') {
                closeAllKebabMenus();
                closeContextMenu();
                return;
            }
            if (next) {
                e.preventDefault();
                next.focus();
            }
        });
    }

    /** Phone bottom-sheet overlay CSS only applies at ≤600px */
    function useKebabOverlay() {
        return window.innerWidth <= 600;
    }

    /** Touch / mobile shell: avoid HTML5 drag stealing taps (#410) */
    function shouldDisableRowDrag() {
        if (document.body.classList.contains('is-mobile-shell')) return true;
        if (window.DeviceCapabilities && window.DeviceCapabilities.isTouch()) return true;
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
        return false;
    }

    /** Floating hscroll conflicts with bottom nav on touch + Desktop-site widths */
    function shouldHideHScrollFloat() {
        if (window.innerWidth <= 600) return true;
        if (!document.body.classList.contains('is-mobile-shell')) return false;
        if (document.body.classList.contains('is-touch')) return true;
        if (window.DeviceCapabilities && window.DeviceCapabilities.isTouch()) return true;
        if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
        return false;
    }

    /** Whether the signed-in user may do this (hides actions that would only fail) */
    function can(permission) {
        return !(window.Utils && typeof Utils.can === 'function') || Utils.can(permission);
    }

    function menuItem(action, eid, icon, label, extra = '') {
        return `
            <button type="button" class="kebab-menu-item${extra ? ' ' + extra : ''}" data-action="${action}" data-id="${eid}">
                <span class="material-icons" aria-hidden="true">${icon}</span>
                <span>${label}</span>
            </button>`;
    }

    /** Join menu groups with dividers, leaving out empty groups */
    function menuGroups(groups) {
        return groups.map(g => g.join('')).filter(Boolean).join('<div class="kebab-divider"></div>');
    }

    function buildDeviceMenuItemsHtml(device) {
        const eid = Utils.escapeHtml(device.id);
        const banned = !!device.banned;
        if (device.remote_target) {
            const connect = [];
            if (can('remote_target.connect')) connect.push(menuItem('web-remote', eid, Utils.ICONS.connect, _('actions.web_remote') || 'Web Remote', 'connect-desktop'));
            const manage = [menuItem('details', eid, 'info', _('actions.details'), 'info')];
            if (can('remote_target.edit')) manage.push(menuItem('edit', eid, 'edit', _('actions.edit')));
            if (can('device.edit')) {
                manage.push(menuItem('manage-tags', eid, Utils.ICONS.tags, _('devices.manage_device_tags') || 'Manage tags'));
                manage.push(menuItem('groups', eid, Utils.ICONS.groups, _('devices.manage_groups') || 'Manage Groups'));
            }
            const danger = can('remote_target.delete') ? [menuItem('delete', eid, 'delete', _('actions.delete'), 'danger')] : [];
            return menuGroups([connect, manage, danger]);
        }
        if (device.soft_deleted) {
            const restore = [];
            if (can('device.delete')) {
                restore.push(menuItem('restore', eid, Utils.ICONS.restore, _('devices.restore_action')));
                restore.push(menuItem('permanent-delete', eid, 'delete_forever', _('devices.permanent_delete_title'), 'danger'));
            }
            return menuGroups([[menuItem('details', eid, 'info', _('actions.details'), 'info')], restore]);
        }
        const canConnect = can('device.connect');
        const isMesh = String(device.device_type || '').toLowerCase() === 'mesh_agent';
        const meshOnline = isMesh && (device.mesh_connected || device.online);
        const mesh = [];
        if (meshOnline) {
            if (can('mesh.terminal')) mesh.push(menuItem('mesh-terminal', eid, 'terminal', _('mesh.terminal') || 'Terminal'));
            if (can('mesh.files') && canConnect) mesh.push(menuItem('mesh-files', eid, Utils.ICONS.files, _('mesh.files') || 'File browser'));
            if (canConnect) mesh.push(menuItem('mesh-run-command', eid, 'play_arrow', _('mesh.run_command') || 'Run command'));
            if (can('cdap.command')) mesh.push(menuItem('mesh-link-peer', eid, 'link', _('mesh.link_peer') || 'Link peer'));
            if (canConnect) {
                mesh.push(menuItem('mesh-share', eid, Utils.ICONS.guest_link, _('mesh.share_link') || 'Guest desktop link'));
                mesh.push(menuItem('mesh-port-tcp', eid, 'settings_ethernet', _('mesh.port_tcp') || 'TCP port relay'));
                mesh.push(menuItem('mesh-port-udp', eid, 'settings_ethernet', _('mesh.port_udp') || 'UDP port relay'));
            }
            if (can('mesh.power')) {
                mesh.push(menuItem('mesh-power-wake', eid, 'power_settings_new', _('mesh.power_wake') || 'Wake'));
                mesh.push(menuItem('mesh-power-sleep', eid, 'bedtime', _('mesh.power_sleep') || 'Sleep'));
                mesh.push(menuItem('mesh-power-reset', eid, 'restart_alt', _('mesh.power_reset') || 'Reset'));
                mesh.push(menuItem('mesh-power-off', eid, 'power_off', _('mesh.power_off') || 'Power off'));
            }
        } else if (isMesh && can('mesh.power')) {
            mesh.push(menuItem('mesh-power-wake', eid, 'power_settings_new', _('mesh.power_wake') || 'Wake'));
        }
        const connect = [];
        if (canConnect) connect.push(menuItem('web-remote', eid, Utils.ICONS.connect, _('actions.web_remote') || 'Web Remote', 'connect-desktop'));
        if (can('guest.create')) connect.push(menuItem('guest-access', eid, Utils.ICONS.guest_link, _('guest_access.menu') || 'Guest access link'));
        const viewers = [];
        if (canConnect) {
            viewers.push(menuItem('cdap-viewer', eid, 'photo_camera', _('actions.cdap_viewer') || 'CDAP Snapshot Viewer'));
            viewers.push(menuItem('connect-desktop', eid, Utils.ICONS.connect_app, _('actions.connect_desktop') || 'Desktop Client'));
        }
        const manage = [menuItem('details', eid, 'info', _('actions.details'), 'info')];
        if (can('device.edit')) {
            manage.push(menuItem('edit', eid, 'edit', _('actions.edit')));
            manage.push(menuItem('manage-tags', eid, Utils.ICONS.tags, _('devices.manage_device_tags') || 'Manage tags'));
            manage.push(menuItem('groups', eid, Utils.ICONS.groups, _('devices.manage_groups') || 'Manage Groups'));
            manage.push(menuItem('access-policy', eid, Utils.ICONS.access_policy, _('devices.access_policy') || 'Access Policy'));
        }
        if (can('device.ban')) {
            manage.push(`
            <button type="button" class="kebab-menu-item ${banned ? 'unban' : 'ban'}" data-action="toggle-ban" data-id="${eid}" data-banned="${banned}">
                <span class="material-icons" aria-hidden="true">${banned ? Utils.ICONS.unban : Utils.ICONS.ban}</span>
                <span>${banned ? _('actions.unban') : _('actions.ban')}</span>
            </button>`);
        }
        const danger = can('device.delete') ? [menuItem('delete', eid, 'delete', _('actions.delete'), 'danger')] : [];
        const open = mesh.length ? [connect.concat(mesh), viewers] : [connect.concat(viewers)];
        return menuGroups(open.concat([manage, danger]));
    }

    function initContextMenu() {
        contextMenuEl = document.getElementById('devices-context-menu');
        if (!contextMenuEl) return;

        contextMenuEl.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn || !contextMenuState) return;
            e.stopPropagation();
            const action = btn.dataset.action;
            const state = contextMenuState;
            if (menuOpener && document.contains(menuOpener)) menuOpener.focus({ preventScroll: true });
            closeContextMenu();

            if (state.type === 'device') {
                handleAction(action, btn.dataset.id || state.id, btn.dataset);
            } else if (state.type === 'folder') {
                if (action === 'edit') editFolder(state.id);
                else if (action === 'delete') deleteFolder(state.id);
            } else if (state.type === 'group') {
                const group = deviceGroups.find(item => item.guid === state.guid);
                if (!group) return;
                if (action === 'edit') showDeviceGroupModal(group);
                else if (action === 'delete') deleteDeviceGroup(group);
                else if (action === 'commercialization') openGroupCommercializationModal(group);
            }
        });

    }

    /** Folders and groups are changed through routes that require device.edit */
    function canManageFilters() {
        return can('device.edit');
    }

    function buildChipContextMenuHtml(type) {
        const billing = type === 'group' && can('billing.manage') ? `
            <button type="button" class="kebab-menu-item" data-action="commercialization">
                ${Utils.icon('billing')}
                <span>${_('devices.group_commercialization') || 'Commercialization'}</span>
            </button>` : '';
        return `${billing}
            <button type="button" class="kebab-menu-item" data-action="edit">
                ${Utils.icon('edit')}
                <span>${_('actions.edit')}</span>
            </button>
            <div class="kebab-divider"></div>
            <button type="button" class="kebab-menu-item danger" data-action="delete">
                ${Utils.icon('delete')}
                <span>${_('actions.delete')}</span>
            </button>`;
    }

    function positionContextMenu(clientX, clientY) {
        if (!contextMenuEl) return;
        const menuWidth = contextMenuEl.offsetWidth || 180;
        const menuHeight = contextMenuEl.offsetHeight || 120;
        let left = clientX;
        let top = clientY;
        if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
        if (top + menuHeight > window.innerHeight - 8) top = window.innerHeight - menuHeight - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;
        contextMenuEl.style.left = left + 'px';
        contextMenuEl.style.top = top + 'px';
    }

    function openContextMenu(clientX, clientY, html, state, opener) {
        if (!contextMenuEl) return;
        closeAllKebabMenus();
        contextMenuState = state;
        contextMenuEl.innerHTML = html;
        contextMenuEl.hidden = false;
        contextMenuEl.classList.add('open');
        positionContextMenu(clientX, clientY);
        menuOpener = opener || null;
        if (opener) focusMenu(contextMenuEl, opener);
        rememberMenuAnchor(opener);
    }

    function closeContextMenu() {
        if (!contextMenuEl) return;
        if (!document.querySelector('.kebab-menu.open')) menuAnchor = null;
        contextMenuEl.classList.remove('open');
        contextMenuEl.hidden = true;
        contextMenuEl.innerHTML = '';
        contextMenuEl.style.left = '';
        contextMenuEl.style.top = '';
        contextMenuState = null;
    }

    function attachDeviceRowContextMenu() {
        if (!tableBody) return;
        tableBody.querySelectorAll('tr[data-id]').forEach(row => {
            row.addEventListener('contextmenu', (e) => {
                if (e.target.closest('.kebab-wrapper') || e.target.closest('.copy-btn')) return;
                e.preventDefault();
                const deviceId = row.dataset.id;
                const device = devices.find(d => d.id === deviceId) ||
                    filteredDevices.find(d => d.id === deviceId);
                if (!device) return;
                openContextMenu(e.clientX, e.clientY, buildDeviceMenuItemsHtml(device), {
                    type: 'device',
                    id: deviceId,
                    linked_peer_id: device.linked_peer_id || '',
                    deviceName: device.display_name || device.hostname || ''
                });
            });
        });
    }

    /** Folder or group "…" button: same menu as right-click, placed under the button */
    function openChipMenuFromButton(e, btn, state) {
        e.preventDefault();
        e.stopPropagation();
        const open = contextMenuEl && !contextMenuEl.hidden && menuOpener === btn;
        closeContextMenu();
        if (open) return;
        const rect = btn.getBoundingClientRect();
        openContextMenu(rect.left, rect.bottom + 4, buildChipContextMenuHtml(state.type), state, btn);
    }

    function attachChipContextMenu(el, state) {
        if (!canManageFilters()) return;
        el.addEventListener('contextmenu', (e) => {
            if (e.target.closest('.chip-action') || e.target.closest('.chip-actions')) return;
            e.preventDefault();
            e.stopPropagation();
            openContextMenu(e.clientX, e.clientY, buildChipContextMenuHtml(state.type), state);
        });
    }

    function initPerPage() {
        const select = document.getElementById('per-page-select');
        if (!select) return;
        select.addEventListener('change', () => {
            const value = parseInt(select.value, 10);
            if (!PER_PAGE_OPTIONS.includes(value)) return;
            perPage = value;
            currentPage = 1;
            try { localStorage.setItem(STORAGE_PER_PAGE, String(perPage)); } catch (_) {}
            renderDevices();
            renderPagination();
        });
    }

    function initTableHScroll() {
        tableScrollEl = document.getElementById('devices-table-scroll');
        hScrollFloatEl = document.getElementById('devices-hscroll-float');
        hScrollSpacerEl = document.getElementById('devices-hscroll-spacer');
        if (!tableScrollEl || !hScrollFloatEl || !hScrollSpacerEl) return;

        tableScrollEl.addEventListener('scroll', () => {
            if (hScrollSyncing) return;
            hScrollSyncing = true;
            hScrollFloatEl.scrollLeft = tableScrollEl.scrollLeft;
            hScrollSyncing = false;
        });

        hScrollFloatEl.addEventListener('scroll', () => {
            if (hScrollSyncing) return;
            hScrollSyncing = true;
            tableScrollEl.scrollLeft = hScrollFloatEl.scrollLeft;
            hScrollSyncing = false;
        });

        if (typeof ResizeObserver !== 'undefined') {
            const ro = new ResizeObserver(() => updateTableHScroll());
            ro.observe(tableScrollEl);
            const table = document.getElementById('devices-table');
            if (table) ro.observe(table);
            const tableContainer = document.querySelector('.devices-table-container');
            if (tableContainer) ro.observe(tableContainer);
        }

        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            mainContent.addEventListener('scroll', updateTableHScroll, { passive: true });
        }
        window.addEventListener('scroll', updateTableHScroll, { passive: true });
    }

    function updateTableHScroll() {
        if (!tableScrollEl || !hScrollFloatEl || !hScrollSpacerEl) return;
        const table = document.getElementById('devices-table');
        const tableContainer = document.querySelector('.devices-table-container');
        const mainContent = document.querySelector('.main-content');
        if (!table || !tableContainer) return;

        if (shouldHideHScrollFloat()) {
            hScrollFloatEl.classList.remove('visible');
            return;
        }

        const scrollWidth = table.scrollWidth;
        const clientWidth = tableScrollEl.clientWidth;
        const needsHScroll = scrollWidth > clientWidth + 1;
        hScrollSpacerEl.style.width = scrollWidth + 'px';

        if (!needsHScroll) {
            hScrollFloatEl.classList.remove('visible');
            hScrollFloatEl.scrollLeft = 0;
            tableScrollEl.scrollLeft = 0;
            return;
        }

        const containerRect = tableContainer.getBoundingClientRect();
        const viewportRect = mainContent
            ? mainContent.getBoundingClientRect()
            : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };

        const tableInView = containerRect.bottom > viewportRect.top + 8 &&
            containerRect.top < viewportRect.bottom - 8;

        if (!tableInView) {
            hScrollFloatEl.classList.remove('visible');
            return;
        }

        const barHeight = hScrollFloatEl.offsetHeight || 22;
        hScrollFloatEl.style.left = containerRect.left + 'px';
        hScrollFloatEl.style.width = containerRect.width + 'px';
        hScrollFloatEl.style.top = (viewportRect.bottom - barHeight) + 'px';
        hScrollFloatEl.style.bottom = 'auto';
        hScrollFloatEl.classList.add('visible');
    }

    /**
     * Position a fixed kebab menu relative to its trigger button.
     * Flips upward if there is not enough space below.
     * Skips on mobile (≤600px) where CSS bottom-sheet handles positioning.
     */
    function positionKebabMenu(btn, menu) {
        if (window.innerWidth <= 600) return;

        // Force reflow so offsetHeight is accurate (menu just became display:block)
        menu.style.visibility = 'hidden';
        const prevDisplay = menu.style.display;
        menu.style.display = 'block';
        const menuHeight = menu.offsetHeight;
        const menuWidth = menu.offsetWidth || 180;
        menu.style.display = prevDisplay;
        menu.style.visibility = '';

        const rect = btn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;

        let top, left;

        // Vertical: prefer below, flip above if not enough space
        if (spaceBelow >= menuHeight + 8) {
            top = rect.bottom + 4;
        } else {
            top = rect.top - menuHeight - 4;
        }
        // Clamp to viewport bounds
        if (top < 8) top = 8;
        if (top + menuHeight > window.innerHeight - 8) {
            top = window.innerHeight - menuHeight - 8;
        }

        // Dynamically constrain max-height to available viewport space
        const availableHeight = window.innerHeight - top - 8;
        if (menuHeight > availableHeight) {
            menu.style.maxHeight = availableHeight + 'px';
        } else {
            menu.style.maxHeight = '';
        }

        // Horizontal: align right edge to button right edge
        left = rect.right - menuWidth;
        if (left < 8) left = 8;
        if (left + menuWidth > window.innerWidth - 8) {
            left = window.innerWidth - menuWidth - 8;
        }

        menu.style.top = top + 'px';
        menu.style.left = left + 'px';
    }
    
    /**
     * Load devices from API
     */
    async function loadDevices() {
        try {
            const qs = showDeleted ? '?includeDeleted=true' : '';
            const endpoint = '/api/devices' + qs;
            const response = await fetchOnce(endpoint, () => Utils.api(endpoint));
            devices = response.devices || [];
            
            // Update count
            document.getElementById('devices-count').textContent = devices.length;
            renderDevicesSummary();
            
            // Update folder counts now that devices are loaded
            updateFolderCounts();
            updateGroupCounts();
            
            applyFilters();
            
        } catch (error) {
            console.error('Failed to load devices:', error);
            Notifications.error(_('errors.load_devices_failed'));
        }
    }

    function normalizeTags(value) {
        if (!value) return [];
        if (Array.isArray(value)) return value.map(String).map(t => t.trim()).filter(Boolean);
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed.map(String).map(t => t.trim()).filter(Boolean);
            } catch (_) {}
            return value.split(',').map(t => t.trim()).filter(Boolean);
        }
        return [];
    }

    function normalizeGuids(value) {
        if (!value) return [];
        const raw = Array.isArray(value) ? value : String(value || '').split(',');
        const seen = new Set();
        const guids = [];
        raw.forEach(item => {
            const guid = typeof item === 'object' ? String(item.guid || '').trim() : String(item || '').trim();
            if (guid && !seen.has(guid)) {
                seen.add(guid);
                guids.push(guid);
            }
        });
        return guids;
    }

    async function loadUserGroups() {
        // The route needs user.view or device.edit; without them there is nothing to show
        if (!can('device.edit') && !can('user.view')) {
            availableUserGroups = [];
            userGroupsLoaded = true;
            return;
        }
        try {
            const response = await fetchOnce('/api/panel/user-groups', () => Utils.api('/api/panel/user-groups'));
            availableUserGroups = response.groups || [];
            userGroupsLoaded = true;
        } catch (error) {
            availableUserGroups = [];
            userGroupsLoaded = true;
            console.error('Failed to load user groups:', error);
        }
    }

    async function ensureUserGroupsLoaded() {
        if (!userGroupsLoaded) await loadUserGroups();
    }

    function renderUserGroupAccessOptions(selectedGuids) {
        const selected = new Set(normalizeGuids(selectedGuids));
        if (!availableUserGroups.length) {
            return `<div class="tag-filter-empty user-group-empty">
                <span>${_('devices.no_user_groups') || 'No user groups'}</span>
                <button type="button" class="btn btn-secondary btn-sm" id="dg-manage-user-groups-empty">
                    <span class="material-icons">group_add</span>
                    ${_('devices.manage_user_groups') || 'Manage user groups'}
                </button>
            </div>`;
        }
        return availableUserGroups.map(group => `
            <label class="group-membership-option compact">
                <input type="checkbox" class="dg-user-group" value="${Utils.escapeHtml(group.guid)}" ${selected.has(group.guid) ? 'checked' : ''}>
                <span class="material-icons">group</span>
                <span>${Utils.escapeHtml(group.name || group.guid)}</span>
            </label>`).join('');
    }

    function deviceMatchesGroup(device, group) {
        if (!device || !group) return false;
        if ((group.source_type || 'manual') === 'tag') {
            const tag = String(group.tag_filter || '').toLowerCase();
            return tag && normalizeTags(device.tags).some(t => t.toLowerCase() === tag);
        }
        const groups = Array.isArray(device.groups) ? device.groups : [];
        return groups.some(g => g.guid === group.guid);
    }

    /** Compare folder ids from API/Postgres (number or string) with chip dataset values. */
    function folderIdsEqual(a, b) {
        if (a == null || a === '' || Number(a) === 0) {
            return b == null || b === '' || Number(b) === 0;
        }
        return Number(a) === Number(b);
    }

    function findFolderById(folderId) {
        if (folderId == null || folderId === '') return null;
        const target = Number(folderId);
        if (!Number.isFinite(target)) return null;
        return folders.find(f => Number(f.id) === target) || null;
    }

    /** "30 devices, 14 online" next to the page title (deleted devices not counted) */
    function renderDevicesSummary() {
        const el = document.getElementById('devices-summary');
        if (!el) return;
        const live = devices.filter(d => !d.soft_deleted);
        const online = live.filter(d => d.online).length;
        let text = el.querySelector('.devices-summary-text');
        if (!text) {
            text = document.createElement('span');
            text.className = 'devices-summary-text';
            el.appendChild(text);
        }
        text.textContent = _('devices.summary', { count: live.length, online });
    }

    /** Tags as tag tokens (Utils.tagsHtml); none: the muted dash */
    function renderTagsCell(device) {
        const tags = normalizeTags(device.tags);
        if (tags.length === 0) {
            return `<span class="device-tags-empty">${Utils.emptyHtml()}</span>`;
        }
        // Every tag carries its name as title: a tag cut off in a narrow column can still be read
        return `<span class="device-tags"><span class="tag-set">${tags.map(t => Utils.tagHtml(t, { title: t })).join('')}</span></span>`;
    }
    
    /** Text the search box looks through: ID, names, user, platform, type, tags, note, IP */
    function deviceSearchText(device) {
        return [
            device.id,
            device.display_name,
            device.hostname,
            device.username,
            device.platform || device.os,
            device.device_type || 'rustdesk',
            normalizeTags(device.tags).join(' '),
            device.note,
            device.ip,
            device.linked_peer_id
        ].filter(Boolean).join(' ').toLowerCase();
    }

    /**
     * Apply current filters and render
     */
    function applyFilters() {
        filteredDevices = devices.filter(device => {
            if (!showDeleted && device.soft_deleted) return false;

            // Folder filter
            if (currentFolder === 'unassigned' && device.folder_id) return false;
            if (currentFolder !== 'all' && currentFolder !== 'unassigned') {
                if (!folderIdsEqual(device.folder_id, currentFolder)) return false;
            }

            // Device group filter (manual or dynamic)
            if (currentGroup !== 'all') {
                const group = deviceGroups.find(g => g.guid === currentGroup);
                if (!group || !deviceMatchesGroup(device, group)) return false;
            }

            // Tag filters: all selected tags must be present
            if (selectedTags.size > 0) {
                const tags = normalizeTags(device.tags).map(t => t.toLowerCase());
                for (const tag of selectedTags) {
                    if (!tags.includes(tag.toLowerCase())) return false;
                }
            }
            
            // Status filter
            if (currentFilter === 'online' && !device.online) return false;
            if (currentFilter === 'offline' && (device.online || device.banned)) return false;
            if (currentFilter === 'banned' && !device.banned) return false;
            if (currentFilter === 'mesh_agent' && String(device.device_type || '').toLowerCase() !== 'mesh_agent') return false;
            
            // Search filter: every word must appear somewhere (any order)
            if (searchQuery) {
                const haystack = deviceSearchText(device);
                const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
                if (!words.every(word => haystack.includes(word))) return false;
            }
            
            return true;
        });
        
        // Sort
        sortDevices();
        document.querySelectorAll('.devices-table th.sortable').forEach(th => {
            const sorted = th.dataset.sort === currentSort.field;
            th.classList.toggle('sort-asc', sorted && currentSort.order === 'asc');
            th.classList.toggle('sort-desc', sorted && currentSort.order === 'desc');
            th.setAttribute('aria-sort', sorted ? (currentSort.order === 'asc' ? 'ascending' : 'descending') : 'none');
        });

        // Render
        renderDevices();
        renderPagination();
        updateEmptyState();
    }
    
    /**
     * Sort devices
     */
    function sortDevices() {
        const { field, order } = currentSort;
        
        filteredDevices.sort((a, b) => {
            let valA = a[field];
            let valB = b[field];
            
            // Handle nulls
            if (valA === null || valA === undefined) valA = '';
            if (valB === null || valB === undefined) valB = '';
            
            // String comparison
            if (typeof valA === 'string') {
                valA = valA.toLowerCase();
                valB = valB.toLowerCase();
            }
            
            // Date comparison
            if (field === 'last_online') {
                valA = new Date(valA || 0).getTime();
                valB = new Date(valB || 0).getTime();
            }
            
            if (valA < valB) return order === 'asc' ? -1 : 1;
            if (valA > valB) return order === 'asc' ? 1 : -1;
            return 0;
        });
    }
    
    /**
     * Render devices table
     */
    function renderDevices() {
        if (!tableBody) return;
        
        const start = (currentPage - 1) * perPage;
        const end = start + perPage;
        const pageDevices = filteredDevices.slice(start, end);
        
        if (pageDevices.length === 0) {
            tableBody.innerHTML = '';
            return;
        }
        
        tableBody.innerHTML = pageDevices.map(device => {
            const eid = Utils.escapeHtml(device.id);
            const statusInfo = deviceStatusInfo(device);
            const sc = statusInfo.className;
            const rowDraggable = (!device.soft_deleted && can('device.edit') && !shouldDisableRowDrag()) ? 'true' : 'false';
            return `
            <tr data-id="${eid}" class="${device.banned ? 'banned-row' : ''}${device.soft_deleted ? ' deleted-row' : ''}" draggable="${rowDraggable}">
                <td data-column="id">
                    <div class="device-id">
                        <span class="device-id-text mono">${eid}</span>
                        <button type="button" class="copy-btn" title="${_('actions.copy')}" aria-label="${_('actions.copy')} ${eid}" data-copy="${eid}">
                            <span class="material-icons" aria-hidden="true">content_copy</span>
                        </button>
                    </div>
                </td>
                <td data-column="hostname">
                    <button type="button" class="device-open" data-open-detail="${eid}">${Utils.escapeHtml(device.display_name || device.hostname || device.note || '-')}</button>
                    ${device.soft_deleted ? `<span class="device-deleted-badge">${Utils.escapeHtml(_('devices.deleted_badge'))}</span>` : ''}
                </td>
                <td data-column="device_type">
                    ${device.device_type ? Utils.tagHtml(getDeviceTypeLabel(device.device_type)) : Utils.emptyHtml()}
                    ${device.linked_peer_id ? `<span class="mesh-linked-badge" title="${Utils.escapeHtml(_('mesh.linked_peer') || 'Linked device')}">↔ <span class="mono">${Utils.escapeHtml(device.linked_peer_id)}</span></span>` : ''}
                </td>
                <td data-column="platform">${Utils.platformHtml(device.platform || device.os)}</td>
                <td data-column="last_online">${Utils.timeHtml(device.last_online, { empty: _('time.never') })}</td>
                <td data-column="status">
                    <span class="status ${sc}"${statusInfo.title ? ` title="${Utils.escapeHtml(statusInfo.title)}"` : ''}>${statusInfo.label}</span>
                </td>
                <td data-column="tags">${renderTagsCell(device)}</td>
                <td data-column="actions">
                    <div class="kebab-wrapper">
                        <button type="button" class="kebab-btn" title="${_('devices.actions')}" aria-label="${_('devices.actions')}: ${Utils.escapeHtml(device.display_name || device.hostname || device.id)}" aria-haspopup="menu" aria-expanded="false">
                            <span class="material-icons" aria-hidden="true">more_vert</span>
                        </button>
                        <div class="kebab-menu" role="menu">${buildDeviceMenuItemsHtml(device)}</div>
                    </div>
                </td>
            </tr>`;
        }).join('');
        
        // Re-apply column visibility to newly rendered rows
        applyColumnVisibility();
        
        // Attach event listeners
        attachRowEventListeners();
        attachDeviceRowContextMenu();
        requestAnimationFrame(updateTableHScroll);
    }
    
    /**
     * Attach event listeners to table rows
     */
    function attachRowEventListeners() {
        // Copy ID
        tableBody.querySelectorAll('.copy-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.copy;
                await Utils.copyToClipboard(id);
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 2000);
                Notifications.success(_('common.copied'));
            });
        });

        // Kebab menu toggle
        tableBody.querySelectorAll('.kebab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const menu = btn.nextElementSibling;
                const wasOpen = menu.classList.contains('open');
                closeAllKebabMenus();
                if (!wasOpen) {
                    menu.classList.add('open');
                    btn.setAttribute('aria-expanded', 'true');
                    positionKebabMenu(btn, menu);
                    // Overlay styles only exist at ≤600px — do not leave a ghost .open class wider
                    if (useKebabOverlay()) {
                        const overlay = document.getElementById('kebab-overlay');
                        if (overlay) overlay.classList.add('open');
                    }
                    focusMenu(menu, btn);
                    rememberMenuAnchor(btn);
                }
            });
        });

        // Kebab menu item actions
        tableBody.querySelectorAll('.kebab-menu-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Move focus back to the row's menu button before a dialog opens,
                // so closing the dialog returns there.
                const opener = btn.closest('.kebab-wrapper')?.querySelector('.kebab-btn');
                if (opener) opener.focus({ preventScroll: true });
                closeAllKebabMenus();
                const row = btn.closest('tr[data-id]');
                const deviceId = btn.dataset.id || row && row.dataset.id;
                const device = devices.find(d => d.id === deviceId) ||
                    filteredDevices.find(d => d.id === deviceId);
                handleAction(btn.dataset.action, deviceId, device || btn.dataset);
            });
        });

        function openRowDetail(e, row) {
            // Controls in the row keep their own action
            if (e.target.closest('a, button, input, select, textarea, label, .kebab-wrapper, .copy-btn, .device-open')) return;
            // Selecting text (an ID, a host name) is not a click on the row
            const selection = window.getSelection && window.getSelection();
            if (selection && !selection.isCollapsed && row.contains(selection.anchorNode)) return;
            const deviceId = row.dataset.id;
            if (deviceId && typeof DeviceDetail !== 'undefined') {
                DeviceDetail.open(deviceId);
            }
        }

        // The name opens the detail panel (keyboard and single click)
        tableBody.querySelectorAll('.device-open[data-open-detail]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof DeviceDetail !== 'undefined') DeviceDetail.open(btn.dataset.openDetail);
            });
        });

        // A click anywhere on the row opens the detail panel (the name is the
        // keyboard way to the same panel)
        tableBody.querySelectorAll('tr[data-id]').forEach(row => {
            row.classList.add('is-clickable');
            row.addEventListener('click', (e) => openRowDetail(e, row));
        });
    }
    
    /**
     * Handle device actions
     */
    /**
     * Try to add a remote session tab in an existing RDClient window via BroadcastChannel.
     * Falls back to opening a new browser tab if no RDClient page is listening.
     */
    /**
     * Phone screens: the web viewer only runs on a wider screen, so ask first
     * whether to open it anyway (for example to turn the phone sideways) or to
     * hand the ID to the RustDesk app.
     */
    function showPhoneConnectChoice(deviceId, data) {
        const isRemoteTarget = String(deviceId).startsWith('rt_') || !!(data && data.remote_target);
        const row = (title, text, choice, buttonLabel) => `
            <li class="list-row connect-choice">
                <span class="row-main">
                    <span class="row-title">${Utils.escapeHtml(title)}</span>
                    <span class="row-sub">${Utils.escapeHtml(text)}</span>
                </span>
                <span class="row-end"><button type="button" class="btn btn-sm" data-connect-choice="${choice}">${Utils.escapeHtml(buttonLabel)}</button></span>
            </li>`;
        Modal.show({
            title: _('devices.connect_phone_title'),
            content: `
                <p>${Utils.escapeHtml(_('devices.connect_phone_intro'))}</p>
                <ul class="list connect-choice-list">
                    ${row(_('devices.connect_phone_web'), _('devices.connect_phone_web_desc'), 'web', _('devices.connect_phone_web_action'))}
                    ${isRemoteTarget ? '' : row(_('devices.connect_phone_app'), _('devices.connect_phone_app_desc'), 'app', _('devices.connect_phone_app_action'))}
                </ul>`,
            buttons: [{ label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() }],
            closable: true
        });
        document.querySelectorAll('[data-connect-choice]').forEach(btn => {
            btn.addEventListener('click', () => {
                const choice = btn.dataset.connectChoice;
                Modal.close();
                if (choice === 'app') {
                    window.location.href = 'rustdesk://' + encodeURIComponent(deviceId);
                } else {
                    window.open(`/remote/${encodeURIComponent(deviceId)}`, '_blank');
                }
            });
        });
    }

    function _tryAddRemoteTab(deviceId, data) {
        if (window.DeviceCapabilities && window.DeviceCapabilities.isPhone()) {
            showPhoneConnectChoice(deviceId, data);
            return;
        }

        if (typeof BroadcastChannel === 'undefined') {
            window.open(`/remote/${encodeURIComponent(deviceId)}`, '_blank');
            return;
        }

        const bc = new BroadcastChannel('betterdesk-remote');
        let handled = false;

        // Listen for acknowledgment from remote page
        bc.onmessage = (ev) => {
            if (ev.data && ev.data.type === 'pong') {
                // Remote page exists — send the add-session command
                handled = true;
                bc.postMessage({
                    type: 'add-session',
                    deviceId: deviceId,
                    deviceName: (data && data.deviceName) || ''
                });
                bc.close();
            } else if (ev.data && ev.data.type === 'session-added') {
                handled = true;
                bc.close();
            }
        };

        // Ping to check if a remote page is open
        bc.postMessage({ type: 'ping' });

        // Timeout: if no response within 300ms, open new tab
        setTimeout(() => {
            if (!handled) {
                bc.close();
                window.open(`/remote/${encodeURIComponent(deviceId)}`, '_blank');
            }
        }, 300);
    }

    async function handleAction(action, deviceId, data) {
        switch (action) {
            case 'web-remote':
                _tryAddRemoteTab(deviceId, data);
                break;

            case 'cdap-viewer':
                window.open(`/remote-cdap/${encodeURIComponent(deviceId)}`, '_blank');
                break;

            case 'connect-desktop':
                connectDesktopClient(deviceId);
                break;

            case 'mesh-terminal':
                if (typeof openMeshTerminal === 'function') {
                    openMeshTerminal(deviceId);
                } else {
                    Notifications.error(_('mesh.terminal_unavailable') || 'Terminal module not loaded');
                }
                break;

            case 'mesh-files':
                window.open('/remote/' + encodeURIComponent(deviceId) + '?transport=mesh&panel=files', '_blank');
                break;

            case 'mesh-run-command':
                showMeshRunCommandModal(deviceId);
                break;

            case 'mesh-link-peer':
                showMeshLinkPeerModal(deviceId, data);
                break;

            case 'mesh-share':
                showMeshShareModal(deviceId);
                break;
            case 'guest-access':
                showGuestAccessModal([deviceId]);
                break;

            case 'mesh-port-tcp':
                if (typeof openMeshPortForward === 'function') {
                    openMeshPortForward(deviceId, false);
                } else {
                    Notifications.error(_('mesh.port_unavailable') || 'Port relay module not loaded');
                }
                break;

            case 'mesh-port-udp':
                if (typeof openMeshPortForward === 'function') {
                    openMeshPortForward(deviceId, true);
                } else {
                    Notifications.error(_('mesh.port_unavailable') || 'Port relay module not loaded');
                }
                break;

            case 'mesh-power-wake':
                meshPowerAction(deviceId, 'wake');
                break;

            case 'mesh-power-sleep':
                meshPowerAction(deviceId, 'sleep');
                break;

            case 'mesh-power-reset':
                meshPowerAction(deviceId, 'reset');
                break;

            case 'mesh-power-off':
                meshPowerAction(deviceId, 'off');
                break;

            case 'remote-viewer':
                // Legacy action: route through the unified web remote client.
                _tryAddRemoteTab(deviceId, data);
                break;

            case 'details':
                if (typeof DeviceDetail !== 'undefined') {
                    DeviceDetail.open(deviceId);
                } else {
                    showDeviceDetails(deviceId);
                }
                break;
                
            case 'edit':
                if (devices.find(d => d.id === deviceId)?.remote_target) {
                    showRemoteTargetModal(deviceId);
                } else {
                    showEditModal(deviceId);
                }
                break;

            case 'manage-tags':
                if (devices.find(d => d.id === deviceId)?.remote_target) {
                    showEditModal(deviceId);
                } else {
                    showEditModal(deviceId, { focusTags: true });
                }
                break;

            case 'groups':
                showDeviceMembershipModal(deviceId);
                break;
                
            case 'toggle-ban':
                // Kebab passes device object (boolean); context menu passes dataset (string)
                await toggleBan(deviceId, data.banned === true || data.banned === 'true');
                break;
                
            case 'change-id':
                await changeDeviceId(deviceId);
                break;
                
            case 'delete':
                if (devices.find(d => d.id === deviceId)?.remote_target) {
                    await deleteRemoteTarget(deviceId);
                } else {
                    await deleteDevice(deviceId);
                }
                break;

            case 'restore':
                await restoreDevice(deviceId);
                break;

            case 'permanent-delete':
                await permanentDeleteDevice(deviceId);
                break;

            case 'access-policy':
                showAccessPolicyModal(deviceId);
                break;
        }
    }

    async function deleteRemoteTarget(deviceId) {
        const confirmed = await Modal.confirm({
            title: remoteText('devices.remote_delete_title', 'Delete remote target'),
            message: remoteText('devices.remote_delete_confirm', 'Delete this RDP/VNC target?'),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;
        try {
            await Utils.api(`/api/remote-targets/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
            Notifications.success(_('devices.delete_success') || 'Remote target deleted');
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.delete_failed'));
        }
    }

    // RDP/VNC target sheet: the fields the API takes, read from the form
    function readRemoteTargetForm(form) {
        return {
            name: form.elements.name.value.trim(),
            protocol: form.elements.protocol.value,
            platform: form.elements.platform.value.trim(),
            host: form.elements.host.value.trim(),
            port: Number(form.elements.port.value),
            username: form.elements.username.value.trim(),
            credential_mode: form.elements.credential_mode.value,
            tls_mode: form.elements.tls_mode.value,
            cert_fingerprint: form.elements.cert_fingerprint.value.trim()
        };
    }

    async function submitRemoteTargetForm(deviceId) {
        const form = document.getElementById('remote-target-form');
        if (!form || form.dataset.busy === 'true') return;
        if (!form.reportValidity()) return;
        // A target created by an earlier attempt (whose password step failed) is updated, not created twice
        const targetIdBefore = deviceId || form.dataset.createdId || '';
        const currentDevice = deviceId && devices.find(d => d.id === deviceId);
        const payload = { ...readRemoteTargetForm(form), enabled: form.elements.enabled.checked };
        const passwordField = form.elements.password;
        const password = passwordField.value;
        passwordField.removeAttribute('aria-invalid');
        if (payload.credential_mode === 'saved' && !password && currentDevice?.credential_mode !== 'saved') {
            passwordField.setAttribute('aria-invalid', 'true');
            passwordField.focus();
            Modal.setStatus(remoteText('devices.remote_password_required', 'Enter the password to save.'), 'error');
            return;
        }
        form.dataset.busy = 'true';
        Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'), '');
        try {
            const url = targetIdBefore
                ? `/api/remote-targets/${encodeURIComponent(targetIdBefore)}`
                : '/api/remote-targets';
            const savedTarget = await Utils.api(url, {
                method: targetIdBefore ? 'PATCH' : 'POST',
                body: payload
            });
            const targetId = targetIdBefore || savedTarget?.id;
            if (!targetIdBefore && targetId) form.dataset.createdId = targetId;
            try {
                if (payload.credential_mode === 'saved' && password) {
                    await Utils.api(`/api/remote-targets/${encodeURIComponent(targetId)}/credentials`, {
                        method: 'PUT',
                        body: { username: payload.username, password }
                    });
                } else if (payload.credential_mode !== 'saved' && currentDevice?.credential_mode === 'saved') {
                    await Utils.api(`/api/remote-targets/${encodeURIComponent(targetId)}/credentials`, {
                        method: 'DELETE'
                    });
                }
            } catch (credentialError) {
                // The target itself is saved: show it in the list, keep the sheet open to try again
                loadDevices();
                Modal.setStatus(fillRemoteText('devices.remote_password_not_saved', 'The target is saved, but the password is not: {error}',
                    { error: credentialError.message || _('errors.save_failed') }), 'error');
                return;
            }
            Modal.close();
            Notifications.success(remoteText('devices.remote_saved', 'RDP/VNC target saved.'));
            loadDevices();
        } catch (error) {
            Modal.setStatus(error.message || _('errors.save_failed'), 'error');
        } finally {
            delete form.dataset.busy;
        }
    }

    // Asks the server whether it reaches host and port; the answer shows in the sheet
    async function testRemoteTargetForm() {
        const form = document.getElementById('remote-target-form');
        if (!form) return;
        const host = form.elements.host;
        const port = form.elements.port;
        if (!host.reportValidity() || !port.reportValidity()) return;
        const payload = readRemoteTargetForm(form);
        // The test needs a name; people may test before they name the target
        if (!payload.name) payload.name = payload.host;
        const where = { host: payload.host, port: payload.port };
        Modal.setStatus(remoteText('devices.remote_testing', 'Testing the connection…'), '');
        try {
            await Utils.api('/api/remote-targets/test', { method: 'POST', body: payload });
            Modal.setStatus(fillRemoteText('devices.remote_test_success', 'Reached {host} on port {port}.', where), 'ok');
        } catch (error) {
            const message = String(error.message || '');
            let text;
            if (/not allowed/i.test(message)) {
                text = remoteText('devices.remote_test_not_allowed', 'This server is not allowed to connect to that address.');
            } else if (!message || /unreachable|timeout/i.test(message)) {
                text = fillRemoteText('devices.remote_test_failed', 'Could not reach {host} on port {port}.', where);
            } else {
                text = message;
            }
            Modal.setStatus(text, 'error');
        }
    }

    function fillRemoteText(key, fallback, params) {
        return remoteText(key, fallback).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
    }

    // Add or edit an RDP/VNC target: a side sheet (GUIDE.md "Dialogs and sheets")
    function showRemoteTargetModal(deviceId = null) {
        const device = deviceId && devices.find(d => d.id === deviceId);
        const title = device
            ? remoteText('devices.remote_edit_title', 'Edit RDP/VNC target')
            : remoteText('devices.remote_add_title', 'Add RDP/VNC target');
        const escape = (value) => Utils.escapeHtml(String(value ?? ''));
        const protocol = device?.remote_protocol === 'vnc' ? 'vnc' : 'rdp';
        const credentialMode = ['saved', 'prompt', 'none'].includes(device?.credential_mode) ? device.credential_mode : 'prompt';
        const tlsMode = ['required', 'preferred', 'disabled'].includes(device?.tls_mode) ? device.tls_mode : 'required';
        const hasSavedPassword = device?.credential_mode === 'saved';
        const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${escape(label)}</option>`;
        const content = `
            <form id="remote-target-form" class="remote-target-form form-stack" novalidate>
                <div class="form-group">
                    <label class="form-label" for="rt-name">${escape(remoteText('devices.remote_name', 'Display name'))}</label>
                    <input class="form-input" id="rt-name" name="name" required maxlength="160" aria-describedby="rt-name-hint" value="${escape(device?.name || device?.display_name || '')}">
                    <p class="form-hint" id="rt-name-hint">${escape(remoteText('devices.remote_name_hint', 'How it appears in the device list.'))}</p>
                </div>
                <section class="form-section" aria-labelledby="rt-connection">
                    <h3 class="form-section-title" id="rt-connection">${escape(remoteText('devices.remote_section_connection', 'Connection'))}</h3>
                    <div class="form-group">
                        <label class="form-label" for="rt-protocol">${escape(remoteText('devices.remote_protocol', 'Technology'))}</label>
                        <select class="form-select is-medium" id="rt-protocol" name="protocol" aria-describedby="rt-protocol-hint">
                            ${option('rdp', 'RDP', protocol)}
                            ${option('vnc', 'VNC', protocol)}
                        </select>
                        <p class="form-hint" id="rt-protocol-hint">${escape(remoteText('devices.remote_protocol_hint', 'RDP for Windows computers, VNC for most Linux and macOS screens.'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rt-host">${escape(remoteText('devices.remote_host', 'Host or IP'))}</label>
                        <input class="form-input is-host" id="rt-host" name="host" required maxlength="253" autocomplete="off" spellcheck="false" aria-describedby="rt-host-hint" value="${escape(device?.host || '')}">
                        <p class="form-hint" id="rt-host-hint">${escape(remoteText('devices.remote_host_hint', 'The address this server uses to reach the computer.'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rt-port">${escape(remoteText('devices.remote_port', 'Port'))}</label>
                        <input class="form-input is-short" id="rt-port" name="port" type="number" inputmode="numeric" min="1" max="65535" required aria-describedby="rt-port-hint" value="${escape(device?.port || (protocol === 'vnc' ? 5900 : 3389))}">
                        <p class="form-hint" id="rt-port-hint">${escape(remoteText('devices.remote_port_hint', 'RDP usually uses 3389, VNC 5900.'))}</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rt-platform">${escape(remoteText('devices.remote_platform', 'Operating system'))}</label>
                        <input class="form-input is-medium" id="rt-platform" name="platform" maxlength="80" aria-describedby="rt-platform-hint" value="${escape(device?.platform || '')}">
                        <p class="form-hint" id="rt-platform-hint">${escape(remoteText('devices.remote_platform_hint', 'Shown in the device list, for example Windows 11 or Ubuntu.'))}</p>
                    </div>
                </section>
                <section class="form-section" aria-labelledby="rt-signin">
                    <h3 class="form-section-title" id="rt-signin">${escape(remoteText('devices.remote_section_signin', 'Sign-in'))}</h3>
                    <div class="form-group">
                        <label class="form-label" for="rt-username">${escape(remoteText('devices.remote_username', 'Username'))}</label>
                        <input class="form-input is-medium" id="rt-username" name="username" autocomplete="off" spellcheck="false" value="${escape(device?.username || '')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="rt-credential-mode">${escape(remoteText('devices.remote_credentials', 'Password'))}</label>
                        <select class="form-select is-host" id="rt-credential-mode" name="credential_mode" aria-controls="rt-password-group">
                            ${option('prompt', remoteText('devices.remote_prompt_password', 'Ask at every connection'), credentialMode)}
                            ${option('saved', remoteText('devices.remote_save_password', 'Save on this server'), credentialMode)}
                            ${option('none', remoteText('devices.remote_no_password', 'No password'), credentialMode)}
                        </select>
                    </div>
                    <div class="form-group" id="rt-password-group"${credentialMode === 'saved' ? '' : ' hidden'}>
                        <label class="form-label" for="rt-password">${escape(remoteText('devices.remote_password', 'Saved password'))}</label>
                        <input class="form-input is-medium" id="rt-password" name="password" type="password" autocomplete="new-password" aria-describedby="rt-password-hint">
                        <p class="form-hint" id="rt-password-hint">${escape(remoteText('devices.remote_password_hint', 'Stored encrypted on this server and filled in at each connection.'))}${hasSavedPassword ? ' ' + escape(remoteText('devices.remote_password_keep_hint', 'Leave empty to keep the saved password.')) : ''}</p>
                    </div>
                </section>
                <section class="form-section" aria-labelledby="rt-security">
                    <h3 class="form-section-title" id="rt-security">${escape(remoteText('devices.remote_section_security', 'Security'))}</h3>
                    <div class="form-group">
                        <label class="form-label" for="rt-tls">${escape(remoteText('devices.remote_tls', 'TLS encryption'))}</label>
                        <select class="form-select is-host" id="rt-tls" name="tls_mode" aria-controls="rt-fingerprint-group">
                            ${option('required', remoteText('devices.remote_tls_required', 'Required'), tlsMode)}
                            ${option('preferred', remoteText('devices.remote_tls_preferred', 'When the computer supports it'), tlsMode)}
                            ${option('disabled', remoteText('devices.remote_tls_disabled', 'Off'), tlsMode)}
                        </select>
                    </div>
                    <div class="form-group" id="rt-fingerprint-group"${tlsMode === 'disabled' ? ' hidden' : ''}>
                        <label class="form-label" for="rt-fingerprint">${escape(remoteText('devices.remote_fingerprint', 'Trusted certificate fingerprint'))}</label>
                        <input class="form-input" id="rt-fingerprint" name="cert_fingerprint" maxlength="128" autocomplete="off" spellcheck="false" aria-describedby="rt-fingerprint-hint" value="${escape(device?.cert_fingerprint || '')}">
                        <p class="form-hint" id="rt-fingerprint-hint">${escape(remoteText('devices.remote_fingerprint_hint', 'SHA-256. Leave empty to confirm the certificate at the first connection.'))}</p>
                    </div>
                </section>
                <div class="form-section">
                    <label class="check-field">
                        <input type="checkbox" name="enabled"${device?.enabled !== false ? ' checked' : ''}>
                        <span class="check-label">${escape(remoteText('devices.remote_enabled', 'Enabled'))}</span>
                        <span class="form-hint">${escape(remoteText('devices.remote_enabled_hint', 'When off, the target stays in the list but nobody can connect to it.'))}</span>
                    </label>
                </div>
                <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
            </form>`;
        Modal.sheet({
            title,
            subtitle: remoteText('devices.remote_sheet_desc', 'A computer without the BetterDesk client. People connect to it in the browser, through this server.'),
            content,
            status: true,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: remoteText('devices.remote_test', 'Test connection'), class: 'btn-secondary', id: 'rt-test-btn', onClick: () => testRemoteTargetForm() },
                { label: _('actions.save'), class: 'btn-primary', id: 'rt-save-btn', onClick: () => submitRemoteTargetForm(deviceId) }
            ]
        });
        const form = document.getElementById('remote-target-form');
        if (!form) return;
        // Enter in a field saves
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            submitRemoteTargetForm(deviceId);
        });
        // The password field only when the password is saved here; the fingerprint only with TLS
        const syncConditional = () => {
            form.querySelector('#rt-password-group').hidden = form.elements.credential_mode.value !== 'saved';
            form.querySelector('#rt-fingerprint-group').hidden = form.elements.tls_mode.value === 'disabled';
        };
        form.elements.credential_mode.addEventListener('change', syncConditional);
        form.elements.tls_mode.addEventListener('change', syncConditional);
        // Switching the technology moves the port along while it is still the other one's default
        form.elements.protocol.addEventListener('change', () => {
            const port = form.elements.port;
            const defaults = { rdp: '3389', vnc: '5900' };
            if (!port.value || Object.values(defaults).includes(port.value)) port.value = defaults[form.elements.protocol.value];
        });
        // A test result or error belongs to the values it was made with
        form.addEventListener('input', () => Modal.setStatus(''));
    }
    
    /**
     * Connect to device via RustDesk desktop client (rustdesk:// protocol)
     */
    function connectDesktopClient(deviceId) {
        window.open('rustdesk://' + encodeURIComponent(deviceId), '_blank');
    }

    // New or edit a device group: a side sheet (GUIDE.md "Dialogs and sheets")
    async function showDeviceGroupModal(group = null) {
        await ensureUserGroupsLoaded();
        const editing = !!group;
        const esc = (value) => Utils.escapeHtml(String(value ?? ''));
        const sourceType = group?.source_type || 'manual';
        const isDynamic = sourceType === 'tag';
        const selectedUserGroups = new Set(normalizeGuids(group?.allowed_groups || group?.allowed_user_groups));
        const allowedUsersValue = Array.isArray(group?.allowed_users) ? group.allowed_users.join(', ') : String(group?.allowed_users || '');
        const tagOptions = availableTags.map(tag => `<option value="${esc(tag)}"></option>`).join('');
        const userGroupsHtml = availableUserGroups.length
            ? `<div role="group" aria-labelledby="dg-user-groups-label" aria-describedby="dg-user-groups-hint"><ul class="list group-membership-list">${availableUserGroups.map(item => `
                    <li class="list-row">
                        <label class="check-field">
                            <input type="checkbox" class="dg-user-group" value="${esc(item.guid)}"${selectedUserGroups.has(item.guid) ? ' checked' : ''}>
                            <span class="check-label">${esc(item.name || item.guid)}</span>
                        </label>
                    </li>`).join('')}</ul></div>`
            : `<p class="form-hint">${esc(_('devices.no_user_groups') || 'No user groups')}</p>`;
        const content = `
            <form id="device-group-form" class="device-group-form form-stack" novalidate>
                <div class="form-group">
                    <label class="form-label" for="dg-name">${esc(_('devices.group_name') || 'Group name')}</label>
                    <input type="text" id="dg-name" class="form-input is-medium" maxlength="80" required aria-describedby="dg-name-hint" value="${esc(group?.name || '')}">
                    <p class="form-hint" id="dg-name-hint">${esc(remoteText('devices.group_name_hint', 'For example Media PCs.'))}</p>
                </div>
                <section class="form-section" aria-labelledby="dg-members-title">
                    <h3 class="form-section-title" id="dg-members-title">${esc(remoteText('devices.group_section_members', 'Members'))}</h3>
                    <label class="check-field">
                        <input type="checkbox" id="dg-dynamic" aria-controls="dg-tag-row"${isDynamic ? ' checked' : ''}>
                        <span class="check-label">${esc(_('devices.dynamic_group') || 'Dynamic group from tag')}</span>
                        <span class="form-hint">${esc(remoteText('devices.dynamic_group_off_hint', 'When off, you add devices yourself, for example by dragging them onto the group.'))}</span>
                    </label>
                    <div class="form-group" id="dg-tag-row"${isDynamic ? '' : ' hidden'}>
                        <label class="form-label" for="dg-tag">${esc(_('devices.tag_filter') || 'Tag filter')}</label>
                        <input type="text" id="dg-tag" class="form-input is-medium" maxlength="50" list="dg-tag-options" autocomplete="off" aria-describedby="dg-tag-hint" value="${esc(group?.tag_filter || '')}">
                        <datalist id="dg-tag-options">${tagOptions}</datalist>
                        <p class="form-hint" id="dg-tag-hint">${esc(_('devices.dynamic_group_hint') || 'Devices with this tag join automatically.')}</p>
                    </div>
                </section>
                <section class="form-section" aria-labelledby="dg-access-title">
                    <h3 class="form-section-title" id="dg-access-title">${esc(remoteText('devices.group_section_access', 'Who can see it'))}</h3>
                    <div class="form-group">
                        <label class="form-label" for="dg-users">${esc(_('devices.group_allowed_users') || 'Allowed users')}</label>
                        <input type="text" id="dg-users" class="form-input" autocomplete="off" spellcheck="false" aria-describedby="dg-users-hint" value="${esc(allowedUsersValue)}">
                        <p class="form-hint" id="dg-users-hint">${esc(remoteText('devices.group_allowed_users_hint_list', 'Usernames, separated by commas. Leave empty to keep the group visible to everyone with device permissions.'))}</p>
                    </div>
                    <div class="form-group">
                        <span class="form-label" id="dg-user-groups-label">${esc(_('devices.group_allowed_user_groups') || 'Allowed user groups')}</span>
                        ${userGroupsHtml}
                        <p class="form-hint" id="dg-user-groups-hint">${esc(_('devices.group_allowed_user_groups_hint') || 'Users in selected user groups can access this device group.')}
                            <a class="dg-manage-user-groups" href="/users#user-groups">${esc(_('devices.manage_user_groups') || 'Manage user groups')}</a></p>
                    </div>
                </section>
                <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
            </form>`;

        let busy = false;
        const save = async () => {
            const form = document.getElementById('device-group-form');
            if (!form || busy) return;
            const nameInput = form.querySelector('#dg-name');
            const tagInput = form.querySelector('#dg-tag');
            const dynamic = form.querySelector('#dg-dynamic').checked;
            nameInput.removeAttribute('aria-invalid');
            tagInput.removeAttribute('aria-invalid');
            const payload = {
                guid: group?.guid || '',
                name: nameInput.value.trim(),
                source_type: dynamic ? 'tag' : 'manual',
                tag_filter: tagInput.value.trim(),
                allowed_users: form.querySelector('#dg-users').value,
                allowed_groups: Array.from(form.querySelectorAll('.dg-user-group:checked')).map(input => input.value)
            };
            if (group?.team_id) {
                payload.team_id = group.team_id;
            }
            if (!payload.name) {
                nameInput.setAttribute('aria-invalid', 'true');
                nameInput.focus();
                Modal.setStatus(_('common.name_required') || 'Name is required', 'error');
                return;
            }
            if (payload.source_type === 'tag' && !payload.tag_filter) {
                tagInput.setAttribute('aria-invalid', 'true');
                tagInput.focus();
                Modal.setStatus(_('devices.group_tag_required') || 'Tag filter is required', 'error');
                return;
            }
            busy = true;
            Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
            try {
                await Utils.api('/api/device-groups', {
                    method: 'POST',
                    body: payload
                });
                Modal.close();
                Notifications.success(_('devices.group_saved') || 'Device group saved');
                loadDeviceGroups();
            } catch (err) {
                Modal.setStatus(err.message || _('errors.server_error'), 'error');
            } finally {
                busy = false;
            }
        };

        Modal.sheet({
            title: editing ? (_('devices.edit_group') || 'Edit device group') : (_('devices.create_group') || 'Create device group'),
            subtitle: remoteText('devices.group_sheet_desc', 'A set of devices you can filter the list by, apply access rules to and limit to some people.'),
            content,
            status: true,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: save }
            ]
        });

        const form = document.getElementById('device-group-form');
        if (!form) return;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            save();
        });
        // The tag field only for a group filled from a tag
        const dynamicInput = form.querySelector('#dg-dynamic');
        const tagRow = form.querySelector('#dg-tag-row');
        dynamicInput.addEventListener('change', () => {
            tagRow.hidden = !dynamicInput.checked;
        });
        form.addEventListener('input', () => Modal.setStatus(''));
    }

    async function showDeviceMembershipModal(deviceId) {
        try {
            const response = await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/groups`);
            const groups = response.groups || [];
            const memberships = response.memberships || [];
            const selected = new Set(memberships.map(group => group.guid));
            const manualGroups = groups.filter(group => (group.source_type || 'manual') !== 'tag');
            const dynamicGroups = groups.filter(group => (group.source_type || 'manual') === 'tag' && selected.has(group.guid));

            const manualHtml = manualGroups.length ? manualGroups.map(group => `
                    <li class="list-row">
                        <label class="check-field">
                            <input type="checkbox" value="${Utils.escapeHtml(group.guid)}" ${selected.has(group.guid) ? 'checked' : ''}>
                            <span class="check-label">${Utils.escapeHtml(group.name)}</span>
                        </label>
                    </li>`).join('')
                : `<li class="list-row is-empty">${Utils.escapeHtml(_('devices.no_groups'))}</li>`;

            const dynamicHtml = dynamicGroups.length ? `
                <div class="form-group">
                    <span class="form-label" id="dg-dynamic-label">${_('devices.dynamic_memberships')}</span>
                    <p class="form-hint">${Utils.escapeHtml(_('devices.dynamic_memberships_hint'))}</p>
                    <ul class="list" aria-labelledby="dg-dynamic-label">
                        ${dynamicGroups.map(group => `
                        <li class="list-row"><span class="row-main">${Utils.escapeHtml(group.name)}${group.tag_filter
                            ? `<span class="row-sub">${Utils.escapeHtml(_('devices.tag_filter'))}: ${Utils.escapeHtml(group.tag_filter)}</span>` : ''}</span></li>`).join('')}
                    </ul>
                </div>` : '';

            let saving = false;
            Modal.show({
                title: _('devices.manage_groups'),
                content: `
                    <div class="device-edit-form device-group-memberships">
                        ${deviceDialogFactsHtml(devices.find(d => d.id === deviceId), deviceId)}
                        <fieldset class="form-group">
                            <legend class="form-label">${_('devices.manual_groups')}</legend>
                            <p class="form-hint">${Utils.escapeHtml(_('devices.manual_groups_hint'))}</p>
                            <ul class="list group-membership-list">${manualHtml}</ul>
                        </fieldset>
                        ${dynamicHtml}
                    </div>`,
                size: 'medium',
                buttons: [
                    { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                    {
                        label: _('actions.save'), class: 'btn-primary', onClick: async () => {
                            if (saving) return;
                            const groupGuids = Array.from(document.querySelectorAll('.modal-overlay.open .group-membership-list input:checked')).map(input => input.value);
                            const saveBtn = document.querySelector('.modal-overlay.open .modal-footer .btn-primary');
                            saving = true;
                            deviceDialogStatus('');
                            if (saveBtn) saveBtn.disabled = true;
                            try {
                                await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/groups`, {
                                    method: 'PUT',
                                    body: { groupGuids }
                                });
                                Notifications.success(_('devices.groups_saved'));
                                Modal.close();
                                loadDevices();
                                loadDeviceGroups();
                            } catch (err) {
                                saving = false;
                                if (saveBtn) saveBtn.disabled = false;
                                deviceDialogStatus(err.message || _('errors.server_error'), true);
                            }
                        }
                    }
                ],
                onOpen: () => deviceDialogStatus('')
            });
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    function showMeshRunCommandModal(deviceId) {
        Modal.show({
            title: (_('mesh.run_command_title') || 'Run command') + ' — ' + deviceId,
            content: `
                <div class="form-group">
                    <label for="mesh-cmd-input">${_('mesh.command_placeholder') || 'Command'}</label>
                    <textarea id="mesh-cmd-input" class="form-input" rows="4" placeholder="whoami"></textarea>
                </div>
                <label class="toggle-row">
                    <input type="checkbox" id="mesh-cmd-shell" checked>
                    <span>${_('mesh.run_as_shell') || 'Run in shell'}</span>
                </label>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                {
                    label: _('actions.run') || 'Run',
                    class: 'btn-primary',
                    onClick: async () => {
                        const command = document.getElementById('mesh-cmd-input').value;
                        if (!command.trim()) return;
                        const shell = document.getElementById('mesh-cmd-shell').checked;
                        try {
                            await Utils.api('/api/mesh/devices/' + encodeURIComponent(deviceId) + '/exec', {
                                method: 'POST',
                                body: { command: command.trim(), shell },
                            });
                            Notifications.success(_('mesh.command_sent') || 'Command sent');
                            Modal.close();
                        } catch (err) {
                            Notifications.error(err.message || (_('mesh.command_failed') || 'Failed'));
                        }
                    },
                },
            ],
        });
    }

    async function showMeshLinkPeerModal(deviceId, data) {
        const linkedId = data && data.linked_peer_id ? String(data.linked_peer_id) : '';
        Modal.show({
            title: (_('mesh.link_peer_title') || 'Link mesh agent') + ' — ' + deviceId,
            content: `
                <p class="form-hint">${_('mesh.link_peer_hint') || 'Enter RustDesk or CDAP peer ID on the same host. Leave empty to unlink.'}</p>
                <div class="form-group">
                    <label for="mesh-link-peer-id">${_('mesh.linked_peer') || 'Linked device'}</label>
                    <input type="text" id="mesh-link-peer-id" class="form-input" value="${Utils.escapeHtml(linkedId)}" placeholder="PEER_ID">
                </div>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                {
                    label: _('actions.save'),
                    class: 'btn-primary',
                    onClick: async () => {
                        const peerId = document.getElementById('mesh-link-peer-id').value.trim();
                        try {
                            await Utils.api('/api/cdap/devices/' + encodeURIComponent(deviceId) + '/link', {
                                method: 'POST',
                                body: { linked_peer_id: peerId },
                            });
                            Notifications.success(_('mesh.link_saved') || 'Link updated');
                            Modal.close();
                            loadDevices();
                        } catch (err) {
                            Notifications.error(err.message || _('errors.server_error'));
                        }
                    },
                },
            ],
        });
    }

    async function meshPowerAction(deviceId, action) {
        const labels = { wake: _('mesh.power_wake') || 'Wake', sleep: _('mesh.power_sleep') || 'Sleep', reset: _('mesh.power_reset') || 'Reset', off: _('mesh.power_off') || 'Power off' };
        const label = labels[action] || action;
        const confirmed = await Modal.confirm({
            title: (_('mesh.power_confirm') || 'Send power action') + ': ' + label + '?',
            message: fillRemoteText('mesh.power_confirm_message', 'The device {id} gets the command "{action}" through its MeshAgent.', { id: deviceId, action: label }),
            confirmLabel: label,
            danger: action !== 'wake'
        });
        if (!confirmed) return;
        try {
            await Utils.api('/api/mesh/devices/' + encodeURIComponent(deviceId) + '/power', {
                method: 'POST',
                body: { action },
            });
            Notifications.success(_('mesh.power_sent') || 'Power command sent');
        } catch (err) {
            Notifications.error(err.message || _('errors.server_error'));
        }
    }

    async function showGuestAccessModal(peerIds) {
        const ids = (peerIds || []).filter(Boolean);
        if (!ids.length) return;
        Modal.show({
            title: _('guest_access.create_title') || 'Create guest access link',
            content: `
                <p class="form-hint">${_('guest_access.create_hint') || 'Time-limited RdClient link. Recipients can connect only to the selected devices — no Console login, no full device list.'}</p>
                <div class="form-group">
                    <label>${_('guest_access.devices') || 'Devices'}</label>
                    <div class="form-hint" style="margin:0;">${ids.map((id) => Utils.escapeHtml(id)).join(', ')}</div>
                </div>
                <div class="form-group">
                    <label for="guest-access-ttl">${_('guest_access.ttl') || 'Valid for (minutes)'}</label>
                    <input type="number" id="guest-access-ttl" class="form-input" min="15" max="1440" value="120">
                </div>
                <div class="form-group">
                    <label for="guest-access-label">${_('guest_access.label') || 'Label (optional)'}</label>
                    <input type="text" id="guest-access-label" class="form-input" maxlength="120" placeholder="">
                </div>
                <div class="form-group">
                    <label class="checkbox-label">
                        <input type="checkbox" id="guest-access-view-only" checked>
                        ${_('guest_access.view_only') || 'View only'}
                    </label>
                </div>
                <div class="form-group" id="guest-access-result" style="display:none;">
                    <label>${_('guest_access.url') || 'Share URL'}</label>
                    <input type="text" id="guest-access-url" class="form-input" readonly>
                </div>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                {
                    label: _('guest_access.create') || 'Create link',
                    class: 'btn-primary',
                    onClick: async () => {
                        const ttl = parseInt(document.getElementById('guest-access-ttl').value, 10) || 120;
                        const label = (document.getElementById('guest-access-label') || {}).value || '';
                        const viewOnly = !!(document.getElementById('guest-access-view-only') || {}).checked;
                        try {
                            const resp = await Utils.api('/api/guest/access-links', {
                                method: 'POST',
                                body: {
                                    peer_ids: ids,
                                    ttl_minutes: ttl,
                                    view_only: viewOnly,
                                    label: label,
                                },
                            });
                            const data = resp.data || resp;
                            const path = data.path || '';
                            const full = window.location.origin + path;
                            const result = document.getElementById('guest-access-result');
                            const urlInput = document.getElementById('guest-access-url');
                            if (result && urlInput) {
                                urlInput.value = full;
                                result.style.display = 'block';
                                urlInput.select();
                            }
                            Notifications.success(_('guest_access.created') || 'Guest link created');
                        } catch (err) {
                            Notifications.error(err.message || _('errors.server_error'));
                        }
                    },
                },
            ],
        });
    }

    async function showMeshShareModal(deviceId) {
        Modal.show({
            title: (_('mesh.share_link_title') || 'Guest desktop link') + ' — ' + deviceId,
            content: `
                <p class="form-hint">${_('mesh.share_link_hint') || 'Time-limited link for view-only remote desktop (no panel login required).'}</p>
                <div class="form-group">
                    <label for="mesh-share-ttl">${_('mesh.share_ttl') || 'Valid for (minutes)'}</label>
                    <input type="number" id="mesh-share-ttl" class="form-input" min="15" max="1440" value="120">
                </div>
                <div class="form-group" id="mesh-share-result" style="display:none;">
                    <label>${_('mesh.share_url') || 'Share URL'}</label>
                    <input type="text" id="mesh-share-url" class="form-input" readonly>
                </div>`,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                {
                    label: _('mesh.share_create') || 'Create link',
                    class: 'btn-primary',
                    onClick: async () => {
                        const ttl = parseInt(document.getElementById('mesh-share-ttl').value, 10) || 120;
                        try {
                            const resp = await Utils.api('/api/mesh/devices/' + encodeURIComponent(deviceId) + '/share', {
                                method: 'POST',
                                body: { ttl_minutes: ttl, view_only: true },
                            });
                            const data = resp.data || resp;
                            const path = data.path || '';
                            const full = window.location.origin + path;
                            const result = document.getElementById('mesh-share-result');
                            const urlInput = document.getElementById('mesh-share-url');
                            if (result && urlInput) {
                                urlInput.value = full;
                                result.style.display = 'block';
                            }
                            Notifications.success(_('mesh.share_created') || 'Link created');
                        } catch (err) {
                            Notifications.error(err.message || _('errors.server_error'));
                        }
                    },
                },
            ],
        });
    }

    /**
     * Show device details modal
     */
    async function showDeviceDetails(deviceId) {
        try {
            const device = await Utils.api(`/api/devices/${deviceId}`);
            
            const content = `
                <div class="device-details">
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.id')}:</span>
                        <span class="detail-value"><strong>${Utils.escapeHtml(device.id)}</strong></span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.hostname')}:</span>
                        <span class="detail-value">${Utils.escapeHtml(device.display_name || device.hostname || device.note || '-')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.platform')}:</span>
                        <span class="detail-value">${Utils.escapeHtml(device.platform || '-')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('status.label')}:</span>
                        <span class="detail-value">${deviceStatusInfo(device).label}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.last_online')}:</span>
                        <span class="detail-value">${Utils.formatDate(device.last_online, { empty: _('time.never') })}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.created')}:</span>
                        <span class="detail-value">${Utils.formatDate(device.created_at)}</span>
                    </div>
                    ${device.ban_reason ? `
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.ban_reason')}:</span>
                        <span class="detail-value">${Utils.escapeHtml(device.ban_reason)}</span>
                    </div>
                    ` : ''}
                </div>
            `;
            
            Modal.show({
                title: _('devices.details'),
                content: content,
                size: 'medium',
                buttons: [
                    { label: _('actions.ok'), class: 'btn-primary', onClick: () => Modal.close() }
                ]
            });
        } catch (error) {
            Notifications.error(error.message || _('errors.load_device_failed'));
        }
    }

    /**
     * Access policy of one device (unattended access, password, schedule,
     * allowed operators): a side sheet (GUIDE.md "Dialogs and sheets")
     */
    async function showAccessPolicyModal(deviceId) {
        try {
            const resp = await Utils.api(`/api/devices/${deviceId}/access-policy`);
            const policy = resp.data || resp;
            const esc = (value) => Utils.escapeHtml(String(value ?? ''));

            const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const activeDays = (policy.schedule_days || '').split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
            const scheduleOn = !!policy.schedule_enabled;
            const dayCheckboxes = days.map(d => {
                const label = _('days.' + d) || d.charAt(0).toUpperCase() + d.slice(1);
                return `<label class="checkbox-row day-checkbox"><input type="checkbox" name="schedule_day" value="${d}"${activeDays.includes(d) ? ' checked' : ''}><span>${esc(label)}</span></label>`;
            }).join('');
            const timeZone = policy.schedule_timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
            const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
            const zoneOptions = zones.map(zone => `<option value="${esc(zone)}"></option>`).join('');
            const passwordState = policy.password_set
                ? Utils.statusHtml('good', _('devices.password_configured') || 'Password set')
                : Utils.statusHtml('neutral', _('devices.no_password') || 'No password');
            const updated = policy.updated_by
                ? `<p class="form-hint access-policy-updated">${esc(_('devices.last_updated_by') || 'Last updated by')}: ${Utils.userHtml(policy.updated_by)}${policy.updated_at ? ', ' + Utils.timeHtml(policy.updated_at, { relative: false }) : ''}</p>`
                : '';

            const content = `
                <form id="access-policy-form" class="access-policy-form form-stack" novalidate>
                    <section class="form-section" aria-labelledby="ap-unattended-title">
                        <h3 class="form-section-title" id="ap-unattended-title">${esc(_('devices.unattended_access') || 'Unattended access')}</h3>
                        <label class="check-field">
                            <input type="checkbox" id="ap-unattended"${policy.unattended_enabled ? ' checked' : ''}>
                            <span class="check-label">${esc(_('devices.enable_unattended') || 'Enable unattended access')}</span>
                            <span class="form-hint">${esc(remoteText('devices.unattended_hint', 'Operators can connect without someone on the device accepting.'))}</span>
                        </label>
                    </section>
                    <section class="form-section" aria-labelledby="ap-password-title">
                        <h3 class="form-section-title" id="ap-password-title">${esc(_('devices.access_password') || 'Access password')}</h3>
                        <p class="access-policy-state">${passwordState}</p>
                        ${policy.password_set ? `<label class="check-field">
                            <input type="checkbox" id="ap-clear-password" aria-controls="ap-password-group">
                            <span class="check-label">${esc(_('devices.clear_password') || 'Clear password')}</span>
                            <span class="form-hint">${esc(remoteText('devices.clear_password_hint', 'Removes the saved password from this device.'))}</span>
                        </label>` : '<input type="checkbox" id="ap-clear-password" hidden>'}
                        <div class="form-group" id="ap-password-group">
                            <label class="form-label" for="ap-password">${esc(policy.password_set ? remoteText('devices.access_password_new', 'New password') : remoteText('devices.access_password_set', 'Password'))}</label>
                            <input type="password" id="ap-password" class="form-input is-medium" autocomplete="new-password" aria-describedby="ap-password-hint">
                            <p class="form-hint" id="ap-password-hint">${esc(policy.password_set
                                ? remoteText('devices.access_password_keep_hint', 'Leave empty to keep the current password.')
                                : remoteText('devices.access_password_hint', 'Leave empty to set no password.'))}</p>
                        </div>
                    </section>
                    <section class="form-section" aria-labelledby="ap-schedule-title">
                        <h3 class="form-section-title" id="ap-schedule-title">${esc(_('devices.access_schedule') || 'Access schedule')}</h3>
                        <label class="check-field">
                            <input type="checkbox" id="ap-schedule" aria-controls="ap-schedule-fields"${scheduleOn ? ' checked' : ''}>
                            <span class="check-label">${esc(_('devices.enable_schedule') || 'Enable time-based access')}</span>
                            <span class="form-hint">${esc(remoteText('devices.schedule_hint', 'Allows connections only on the chosen days, between the start and end time.'))}</span>
                        </label>
                        <div class="form-section" id="ap-schedule-fields"${scheduleOn ? '' : ' hidden'}>
                            <div class="form-group">
                                <span class="form-label" id="ap-days-label">${esc(_('devices.allowed_days') || 'Allowed days')}</span>
                                <div class="day-checkboxes" role="group" aria-labelledby="ap-days-label">${dayCheckboxes}</div>
                            </div>
                            <div class="access-policy-times">
                                <div class="form-group">
                                    <label class="form-label" for="ap-start-time">${esc(_('devices.start_time') || 'Start time')}</label>
                                    <input type="time" id="ap-start-time" class="form-input" value="${esc(policy.schedule_start_time || '08:00')}">
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="ap-end-time">${esc(_('devices.end_time') || 'End time')}</label>
                                    <input type="time" id="ap-end-time" class="form-input" value="${esc(policy.schedule_end_time || '18:00')}">
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="ap-timezone">${esc(_('devices.timezone') || 'Timezone')}</label>
                                <input type="text" id="ap-timezone" class="form-input is-host" list="ap-timezone-options" autocomplete="off" spellcheck="false" aria-describedby="ap-timezone-hint" value="${esc(timeZone)}">
                                <datalist id="ap-timezone-options">${zoneOptions}</datalist>
                                <p class="form-hint" id="ap-timezone-hint">${esc(remoteText('devices.timezone_hint', 'The days and times count in this time zone, for example Europe/Berlin.'))}</p>
                            </div>
                        </div>
                    </section>
                    <section class="form-section" aria-labelledby="ap-operators-title">
                        <h3 class="form-section-title" id="ap-operators-title">${esc(_('devices.allowed_operators') || 'Allowed operators')}</h3>
                        <div class="form-group">
                            <label class="form-label" for="ap-operators">${esc(remoteText('devices.allowed_operators_field', 'Usernames'))}</label>
                            <input type="text" id="ap-operators" class="form-input" autocomplete="off" spellcheck="false" aria-describedby="ap-operators-hint" value="${esc(policy.allowed_operators || '')}">
                            <p class="form-hint" id="ap-operators-hint">${esc(_('devices.operators_hint') || 'Comma-separated usernames. Leave empty to allow all operators.')}</p>
                        </div>
                    </section>
                    ${updated}
                    <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
                </form>
            `;

            let busy = false;
            const save = async () => {
                const form = document.getElementById('access-policy-form');
                if (!form || busy) return;
                const selectedDays = Array.from(form.querySelectorAll('input[name="schedule_day"]:checked')).map(cb => cb.value);
                const payload = {
                    unattended_enabled: form.querySelector('#ap-unattended').checked,
                    password: form.querySelector('#ap-password').value,
                    clear_password: form.querySelector('#ap-clear-password').checked,
                    schedule_enabled: form.querySelector('#ap-schedule').checked,
                    schedule_days: selectedDays.join(','),
                    schedule_start_time: form.querySelector('#ap-start-time').value,
                    schedule_end_time: form.querySelector('#ap-end-time').value,
                    schedule_timezone: form.querySelector('#ap-timezone').value,
                    allowed_operators: form.querySelector('#ap-operators').value
                };
                // A password typed before "Clear password" was ticked is not sent
                if (payload.clear_password) payload.password = '';

                busy = true;
                Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
                try {
                    await Utils.api(`/api/devices/${deviceId}/access-policy`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    Modal.close();
                    Notifications.success(_('devices.access_policy_saved') || 'Access policy saved');
                } catch (err) {
                    Modal.setStatus(err.message || remoteText('devices.access_policy_save_failed', 'Could not save the access policy.'), 'error');
                } finally {
                    busy = false;
                }
            };

            Modal.sheet({
                title: fillRemoteText('devices.access_policy_title', 'Access policy for {id}', { id: deviceId }),
                subtitle: remoteText('devices.access_policy_desc', 'Who can connect to this device and when, without someone on the device accepting.'),
                content,
                status: true,
                buttons: [
                    { label: _('actions.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                    { label: _('actions.save'), class: 'btn-primary', onClick: save }
                ]
            });

            const form = document.getElementById('access-policy-form');
            if (!form) return;
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                save();
            });
            // The schedule fields only with the schedule on; the new password only while it is not being cleared
            const scheduleChk = form.querySelector('#ap-schedule');
            const scheduleFields = form.querySelector('#ap-schedule-fields');
            scheduleChk.addEventListener('change', () => {
                scheduleFields.hidden = !scheduleChk.checked;
            });
            const clearChk = form.querySelector('#ap-clear-password');
            const passwordGroup = form.querySelector('#ap-password-group');
            clearChk.addEventListener('change', () => {
                passwordGroup.hidden = clearChk.checked;
            });
            form.addEventListener('input', () => Modal.setStatus(''));

        } catch (error) {
            Notifications.error(error.message || 'Failed to load access policy');
        }
    }

    /**
     * Toggle device ban status
     */
    /**
     * Ask before banning (with an optional reason) or unbanning.
     * Resolves to { reason } when confirmed, null when cancelled.
     * Shared with the device panel (deviceDetail.js).
     */
    function confirmBanChange(deviceId, currentlyBanned, deviceName) {
        const label = deviceName ? `${deviceName} (${deviceId})` : deviceId;
        if (currentlyBanned) {
            return Modal.confirm({
                title: _('devices.unban_title'),
                message: _('devices.unban_effect', { device: label }),
                confirmLabel: _('actions.unban'),
                danger: false
            }).then(ok => (ok ? { reason: '' } : null));
        }
        const inputId = Utils.generateId();
        return new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                resolve(value);
            };
            const submit = () => {
                const reason = (document.getElementById(inputId)?.value || '').trim();
                Modal.close();
                finish({ reason });
            };
            Modal.show({
                title: _('devices.ban_title'),
                content: `
                    <p class="ban-dialog-effect">${Utils.escapeHtml(_('devices.ban_effect', { device: label }))}</p>
                    <div class="form-group">
                        <label class="form-label" for="${inputId}">${Utils.escapeHtml(_('devices.ban_reason_label'))}</label>
                        <input type="text" id="${inputId}" class="form-input" maxlength="500" autocomplete="off" aria-describedby="${inputId}-hint">
                        <p class="form-hint" id="${inputId}-hint">${Utils.escapeHtml(_('devices.ban_reason_hint'))}</p>
                    </div>`,
                buttons: [
                    { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => { Modal.close(); finish(null); } },
                    { label: _('actions.ban'), class: 'btn-danger', onClick: submit }
                ],
                closable: true,
                onClose: () => finish(null)
            });
            document.getElementById(inputId)?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    submit();
                }
            });
        });
    }

    async function toggleBan(deviceId, currentlyBanned) {
        const action = currentlyBanned ? 'unban' : 'ban';
        const device = devices.find(d => d.id === deviceId);
        const answer = await confirmBanChange(deviceId, currentlyBanned, device && (device.display_name || device.hostname));
        if (!answer) return;

        try {
            await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/${action}`, {
                method: 'POST',
                body: currentlyBanned ? {} : { reason: answer.reason }
            });
            Notifications.success(_(`devices.${action}_success`));
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _(`errors.${action}_failed`));
        }
    }
    
    /**
     * Change device ID
     */
    async function changeDeviceId(deviceId) {
        const device = devices.find(d => d.id === deviceId);
        if (device?.online) {
            const proceed = await Modal.confirm({
                title: _('devices.change_id_title'),
                message: _('devices.change_id_online_warn'),
                confirmLabel: _('devices.change_id'),
                danger: false
            });
            if (!proceed) return;
        }

        const newId = await Modal.prompt({
            title: _('devices.change_id_title'),
            label: _('devices.new_id'),
            placeholder: 'NEWID123',
            hint: _('devices.change_id_hint')
        });
        
        if (!newId) return;
        
        // Validate
        if (newId.length < 6 || newId.length > 16) {
            Notifications.error(_('devices.id_length_error'));
            return;
        }
        
        if (!/^[A-Z0-9_-]+$/i.test(newId)) {
            Notifications.error(_('devices.id_format_error'));
            return;
        }
        
        try {
            await Utils.api(`/api/devices/${deviceId}/change-id`, {
                method: 'POST',
                body: { newId }
            });
            Notifications.success(_('devices.change_id_success'));
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.change_id_failed'));
        }
    }
    
    /**
     * Delete device with delayed confirmation
     */
    async function deleteDevice(deviceId) {
        const device = devices.find(d => d.id === deviceId);
        if (device?.soft_deleted) {
            await permanentDeleteDevice(deviceId);
            return;
        }

        // A centred dialog from modal.js (Escape, focus trap and focus return come
        // from there). Delete unlocks after a 3 second countdown.
        return new Promise((resolve) => {
            const safeId = String(deviceId).replace(/[^A-Za-z0-9_-]/g, '_');
            const hardId = `hard-delete-check-${safeId}`;
            const revokeId = `revoke-check-${safeId}`;
            const confirmId = `confirm-delete-btn-${safeId}`;
            const deleteLabel = _('actions.delete');
            let timer = null;
            let settled = false;
            const finish = (value) => {
                if (timer) clearInterval(timer);
                timer = null;
                if (!settled) {
                    settled = true;
                    resolve(value);
                }
            };
            const content = `
                <div class="form-stack delete-device-form">
                    <p class="delete-warning">${_('devices.delete_confirm', { id: Utils.escapeHtml(deviceId) })}</p>
                    <p class="delete-info form-hint">${_('devices.delete_reserved_hint')}</p>
                    <label class="check-field">
                        <input type="checkbox" id="${hardId}">
                        <span class="check-label">${_('devices.delete_hard_option')}</span>
                        <span class="form-hint">${_('devices.delete_hard_hint')}</span>
                    </label>
                    <label class="check-field">
                        <input type="checkbox" id="${revokeId}">
                        <span class="check-label">${_('devices.revoke_option')}</span>
                        <span class="form-hint">${_('devices.revoke_hint')}</span>
                    </label>
                </div>`;
            Modal.show({
                title: _('devices.delete_title'),
                content,
                className: 'delete-confirm-modal',
                buttons: [
                    { label: _('actions.cancel'), class: 'btn-secondary cancel-btn', onClick: () => { Modal.close(); finish(false); } },
                    { label: `${deleteLabel} (3)`, class: 'btn-danger confirm-delete-btn', id: confirmId, onClick: () => onConfirm() }
                ],
                onClose: () => finish(false)
            });
            const confirmBtn = document.getElementById(confirmId);
            const cancelBtn = confirmBtn && confirmBtn.parentElement.querySelector('.cancel-btn');
            if (confirmBtn) confirmBtn.disabled = true;
            // Start on Cancel, as before: the first thing Enter does here is not deleting
            if (cancelBtn) cancelBtn.focus();

            let countdown = 3;
            timer = setInterval(() => {
                countdown--;
                if (!confirmBtn || !document.contains(confirmBtn)) {
                    clearInterval(timer);
                    return;
                }
                if (countdown <= 0) {
                    clearInterval(timer);
                    timer = null;
                    confirmBtn.disabled = false;
                    confirmBtn.textContent = deleteLabel;
                } else {
                    confirmBtn.textContent = `${deleteLabel} (${countdown})`;
                }
            }, 1000);

            const onConfirm = async () => {
                if (!confirmBtn || confirmBtn.disabled) return;
                const hard = document.getElementById(hardId)?.checked === true;
                const revoke = document.getElementById(revokeId)?.checked === true;
                Modal.close();
                if (timer) clearInterval(timer);
                settled = true;

                try {
                    const params = new URLSearchParams();
                    if (hard) params.set('hard', 'true');
                    if (revoke) params.set('revoke', 'true');
                    const qs = params.toString();
                    const url = `/api/devices/${encodeURIComponent(deviceId)}${qs ? '?' + qs : ''}`;
                    await Utils.api(url, { method: 'DELETE' });
                    let msg;
                    if (hard) {
                        msg = _('devices.permanent_delete_success');
                    } else if (revoke) {
                        msg = _('devices.revoke_success');
                    } else {
                        msg = _('devices.delete_soft_success_hint');
                    }
                    Notifications.success(msg);
                    loadDevices();
                    resolve(true);
                } catch (error) {
                    Notifications.error(error.message || _('errors.delete_failed'));
                    resolve(false);
                }
            };
        });
    }

    async function restoreDevice(deviceId) {
        const confirmed = await Modal.confirm({
            title: _('devices.restore_title'),
            message: _('devices.restore_confirm', { id: deviceId }),
            confirmLabel: _('devices.restore_action'),
            danger: false
        });
        if (!confirmed) return;

        try {
            await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/restore`, { method: 'POST' });
            Notifications.success(_('devices.restore_success'));
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('devices.restore_failed'));
        }
    }

    async function permanentDeleteDevice(deviceId) {
        const confirmed = await Modal.confirm({
            title: _('devices.permanent_delete_title'),
            message: _('devices.permanent_delete_confirm', { id: deviceId }),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}?hard=true`, { method: 'DELETE' });
            Notifications.success(_('devices.permanent_delete_success'));
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.delete_failed'));
        }
    }
    
    /** ID and hostname at the top of a device dialog, so it is clear which device it changes */
    function deviceDialogFactsHtml(device, deviceId) {
        const id = device ? device.id : deviceId;
        return `
                <dl class="facts device-dialog-facts">
                    <dt>${_('devices.id')}</dt>
                    <dd><span class="mono">${Utils.escapeHtml(id)}</span></dd>
                    ${device ? `<dt>${_('devices.hostname')}</dt>
                    <dd>${Utils.escapeHtml(device.hostname || '-')}</dd>` : ''}
                </dl>`;
    }

    /**
     * Message line in the open dialog's footer, next to its buttons: says why saving failed.
     * Created when the dialog opens so screen readers announce later changes.
     */
    function deviceDialogStatus(message = '', isError = false) {
        const footer = document.querySelector('.modal-overlay.open .modal-footer');
        if (!footer) return;
        let el = footer.querySelector('.device-dialog-status');
        if (!el) {
            el = document.createElement('p');
            el.className = 'form-status modal-footer-start device-dialog-status';
            el.setAttribute('aria-live', 'polite');
            footer.prepend(el);
        }
        el.textContent = message;
        el.classList.toggle('is-error', !!isError);
    }

    /**
     * Show edit modal. With options.focusTags (row menu > Manage tags) it shows only the tags.
     */
    // Editing happens in the device panel (deviceDetail.js): name, note, folder and tags
    // in place, Cancel / Save in its footer. Kept under this name for other callers.
    function showEditModal(deviceId, options = {}) {
        if (typeof DeviceDetail !== 'undefined' && typeof DeviceDetail.edit === 'function') {
            DeviceDetail.edit(deviceId, { focusTags: !!(options && options.focusTags) });
        }
    }

    window.BetterDeskDevices = window.BetterDeskDevices || {};
    window.BetterDeskDevices.showEditModal = showEditModal;
    window.BetterDeskDevices.confirmBanChange = confirmBanChange;
    window.BetterDeskDevices.connect = (deviceId, data) => _tryAddRemoteTab(deviceId, data);

    function countDevicesWithTag(tag) {
        const expected = String(tag || '').trim().toLowerCase();
        if (!expected) return 0;
        return devices.filter(device =>
            normalizeTags(device.tags).some(t => t.toLowerCase() === expected)
        ).length;
    }

    function countGroupsWithTag(tag) {
        const expected = String(tag || '').trim().toLowerCase();
        if (!expected) return 0;
        return deviceGroups.filter(group =>
            (group.source_type || 'manual') === 'tag'
            && String(group.tag_filter || '').trim().toLowerCase() === expected
        ).length;
    }

    // Tags across all devices, with rename and delete per tag: a side sheet, so
    // the rename prompt and the delete confirm open on top of it and the list
    // is redrawn in place afterwards
    function showManageTagsModal() {
        const renderList = () => {
            if (!availableTags.length) {
                return `<p class="state manage-tags-empty">${Utils.escapeHtml(_('devices.no_tags'))}</p>`;
            }
            return `<ul class="list manage-tags-list">${availableTags.map((tag, i) => {
                const deviceCount = countDevicesWithTag(tag);
                const groupCount = countGroupsWithTag(tag);
                const metaParts = [
                    `${deviceCount} ${deviceCount === 1 ? _('devices.tag_device_one') : _('devices.tag_device_many')}`
                ];
                if (groupCount > 0) {
                    metaParts.push(`${groupCount} ${groupCount === 1 ? _('devices.tag_group_one') : _('devices.tag_group_many')}`);
                }
                return `<li class="list-row manage-tags-row" data-tag="${Utils.escapeHtml(tag)}">
                    <span class="row-main manage-tags-info">
                        <span class="row-title manage-tags-name" id="manage-tag-name-${i}">${Utils.escapeHtml(tag)}</span>
                        <span class="row-sub manage-tags-meta">${Utils.escapeHtml(metaParts.join(', '))}</span>
                    </span>
                    <span class="row-end manage-tags-actions">
                        <button type="button" class="btn btn-sm manage-tag-rename" data-tag="${Utils.escapeHtml(tag)}" aria-describedby="manage-tag-name-${i}">${Utils.escapeHtml(_('devices.rename_tag'))}</button>
                        <button type="button" class="btn btn-sm btn-danger-quiet manage-tag-delete" data-tag="${Utils.escapeHtml(tag)}" aria-describedby="manage-tag-name-${i}">${Utils.escapeHtml(_('devices.delete_tag'))}</button>
                    </span>
                </li>`;
            }).join('')}</ul>`;
        };

        // Reload everything a tag change touches and draw the list again; focus
        // goes to the row of `focusTag` (or the row now at `focusIndex`)
        const refresh = async ({ focusTag = '', focusIndex = 0, action = 'rename' } = {}) => {
            await loadTags();
            await loadDeviceGroups();
            await loadDevices();
            const host = document.getElementById('manage-tags-host');
            if (!host) return;
            host.innerHTML = renderList();
            bindActions();
            const rows = Array.from(host.querySelectorAll('.manage-tags-row'));
            const row = rows.find(item => item.dataset.tag === focusTag) || rows[Math.min(focusIndex, rows.length - 1)];
            const target = row && row.querySelector(action === 'delete' ? '.manage-tag-delete' : '.manage-tag-rename');
            if (target) target.focus();
            else host.closest('[role="dialog"]')?.focus();
        };

        const bindActions = () => {
            const host = document.getElementById('manage-tags-host');
            if (!host) return;
            host.querySelectorAll('.manage-tag-rename').forEach(button => {
                button.addEventListener('click', async () => {
                    const from = button.dataset.tag;
                    if (!from) return;
                    const to = await Modal.prompt({
                        title: _('devices.rename_tag') || 'Rename tag',
                        label: _('devices.rename_tag_prompt') || 'New tag name',
                        value: from,
                        hint: _('devices.rename_tag_hint') || 'Renames this tag on all devices you can see and updates matching dynamic groups.',
                        confirmLabel: _('actions.save')
                    });
                    if (to === null) return;
                    const cleaned = String(to || '').trim();
                    if (!cleaned) {
                        Modal.setStatus(_('devices.tag_name_required') || 'Tag name is required', 'error');
                        return;
                    }
                    if (cleaned === from) return;
                    Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
                    try {
                        const result = await Utils.api('/api/tags/rename', {
                            method: 'POST',
                            body: { from, to: cleaned }
                        });
                        if (selectedTags.has(from)) {
                            selectedTags.delete(from);
                            selectedTags.add(result?.to || cleaned);
                        }
                        await refresh({ focusTag: result?.to || cleaned });
                        Modal.setStatus(
                            (_('devices.tag_renamed') || 'Tag renamed')
                            + ` (${result?.updatedDevices || 0})`, 'ok'
                        );
                    } catch (err) {
                        Modal.setStatus(err.message || _('errors.server_error'), 'error');
                    }
                });
            });

            host.querySelectorAll('.manage-tag-delete').forEach(button => {
                button.addEventListener('click', async () => {
                    const tag = button.dataset.tag;
                    if (!tag) return;
                    const index = availableTags.indexOf(tag);
                    const deviceCount = countDevicesWithTag(tag);
                    const groupCount = countGroupsWithTag(tag);
                    const confirmMsg = (_('devices.delete_tag_confirm') || 'Remove tag "{tag}" from {count} device(s)? Dynamic groups that use this tag will become empty until updated.')
                        .replace('{tag}', tag)
                        .replace('{count}', String(deviceCount))
                        .replace('{groups}', String(groupCount));
                    const confirmed = await Modal.confirm({
                        title: _('devices.delete_tag') || 'Delete tag',
                        message: confirmMsg,
                        danger: true,
                        confirmLabel: _('actions.delete')
                    });
                    if (!confirmed) return;
                    Modal.setStatus(remoteText('devices.tag_deleting', 'Deleting…'));
                    try {
                        const result = await Utils.api('/api/tags/delete', {
                            method: 'POST',
                            body: { tag }
                        });
                        selectedTags.delete(tag);
                        await refresh({ focusIndex: Math.max(index, 0), action: 'delete' });
                        Modal.setStatus(
                            (_('devices.tag_deleted') || 'Tag deleted')
                            + ` (${result?.updatedDevices || 0})`, 'ok'
                        );
                    } catch (err) {
                        Modal.setStatus(err.message || _('errors.server_error'), 'error');
                    }
                });
            });
        };

        Modal.sheet({
            title: _('devices.manage_tags') || 'Manage tags',
            subtitle: _('devices.tags_manage_hint') || 'Rename or delete tags across all devices you can see. Removing a tag from one device is done in Edit / Device details.',
            content: `<div id="manage-tags-host">${renderList()}</div>`,
            status: true,
            buttons: [
                { label: _('actions.close'), class: 'btn-secondary', onClick: () => Modal.close() }
            ]
        });
        bindActions();
    }

    function initManageTags() {
        const btn = document.getElementById('manage-tags-btn');
        if (!btn) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            // The button sits in the tag filter menu: close it and let the dialog return focus to its button
            const menu = document.getElementById('tags-filter-menu');
            const opener = document.getElementById('tags-filter-btn');
            if (menu && menu.contains(btn)) {
                menu.classList.remove('show');
                if (opener) {
                    opener.setAttribute('aria-expanded', 'false');
                    opener.focus({ preventScroll: true });
                }
            }
            showManageTagsModal();
        });
    }
    
    /**
     * Render pagination
     */
    function renderPagination() {
        const totalPages = Math.ceil(filteredDevices.length / perPage);
        const paginationInfo = document.getElementById('pagination-info');
        const paginationControls = document.getElementById('pagination-controls');
        
        // Update info
        const start = Math.min((currentPage - 1) * perPage + 1, filteredDevices.length);
        const end = Math.min(currentPage * perPage, filteredDevices.length);
        paginationInfo.textContent = `${_('devices.showing')} ${start}-${end} ${_('devices.of')} ${filteredDevices.length}`;
        
        // Generate controls
        let html = '';
        
        html += `<button class="pagination-btn" ${currentPage === 1 ? 'disabled' : ''} data-page="${currentPage - 1}">
            <span class="material-icons">chevron_left</span>
        </button>`;
        
        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
                html += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
            } else if (i === currentPage - 2 || i === currentPage + 2) {
                html += `<span style="padding: 0 4px;">...</span>`;
            }
        }
        
        html += `<button class="pagination-btn" ${currentPage === totalPages ? 'disabled' : ''} data-page="${currentPage + 1}">
            <span class="material-icons">chevron_right</span>
        </button>`;
        
        paginationControls.innerHTML = html;
        
        // Event listeners
        paginationControls.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const page = parseInt(btn.dataset.page);
                if (page && page !== currentPage && page >= 1 && page <= totalPages) {
                    currentPage = page;
                    renderDevices();
                    renderPagination();
                }
            });
        });
    }
    
    /**
     * Update empty state
     */
    function updateEmptyState() {
        const tableContainer = document.querySelector('.devices-table-container');
        
        if (filteredDevices.length === 0) {
            tableContainer.classList.add('hidden');
            emptyState.classList.remove('hidden');
        } else {
            tableContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');
        }
    }
    
    /**
     * Initialize search
     */
    function initSearch() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;

        // Honor ?search= from Enrollment Requests "View device" links (#351).
        const urlSearch = new URLSearchParams(window.location.search).get('search');
        if (urlSearch) {
            searchQuery = urlSearch.trim();
            searchInput.value = searchQuery;
        }
        // ?open=<id> (from the global search) opens that device's details
        const openId = new URLSearchParams(window.location.search).get('open');
        if (openId) {
            window.addEventListener('load', () => {
                if (typeof DeviceDetail !== 'undefined') DeviceDetail.open(openId);
            });
        }
        
        searchInput.addEventListener('input', Utils.debounce((e) => {
            searchQuery = e.target.value.trim();
            currentPage = 1;
            applyFilters();
        }, 300));
    }
    
    /**
     * Initialize filters
     */
    function initFilters() {
        // ?status=online|offline|banned|mesh_agent preselects a status filter (links from the overview)
        const wanted = new URLSearchParams(window.location.search).get('status');
        const preset = wanted && document.querySelector(`.filter-btn[data-filter="${CSS.escape(wanted)}"]`);
        // The status filter is a segmented control: the pressed segment carries aria-pressed
        const select = (chosen) => document.querySelectorAll('.filter-btn').forEach(b => {
            b.classList.toggle('active', b === chosen);
            b.setAttribute('aria-pressed', String(b === chosen));
        });
        if (preset) {
            select(preset);
            currentFilter = wanted;
        }
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                select(btn);
                currentFilter = btn.dataset.filter;
                currentPage = 1;
                applyFilters();
            });
        });
    }

    function initShowDeletedToggle() {
        const input = document.getElementById('show-deleted-input');
        if (!input) return;
        input.addEventListener('change', () => {
            showDeleted = !!input.checked;
            localStorage.setItem(STORAGE_SHOW_DELETED, showDeleted ? '1' : '0');
            currentPage = 1;
            loadDevices();
        });
    }
    
    /**
     * Initialize sorting
     */
    function initSorting() {
        document.querySelectorAll('th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (currentSort.field === field) {
                    currentSort.order = currentSort.order === 'asc' ? 'desc' : 'asc';
                } else {
                    currentSort.field = field;
                    currentSort.order = 'asc';
                }
                applyFilters();
            });
        });
    }
    
    /**
     * Initialize selection
     */
    function initSelection() {
        const selectAll = document.getElementById('select-all');
        if (!selectAll) return;
        
        selectAll.addEventListener('change', () => {
            const checkboxes = tableBody.querySelectorAll('.device-checkbox');
            checkboxes.forEach(cb => {
                cb.checked = selectAll.checked;
                const id = cb.dataset.id;
                if (selectAll.checked) {
                    selectedIds.add(id);
                } else {
                    selectedIds.delete(id);
                }
            });
            updateSelectionUI();
        });
    }
    
    /**
     * Update selection UI
     */
    function updateSelectionUI() {
        if (selectedIds.size > 0) {
            bulkActions.classList.remove('hidden');
            selectedCountEl.textContent = selectedIds.size;
        } else {
            bulkActions.classList.add('hidden');
        }
        
        // Update select all checkbox
        const selectAll = document.getElementById('select-all');
        const checkboxes = tableBody.querySelectorAll('.device-checkbox');
        selectAll.checked = checkboxes.length > 0 && selectedIds.size === checkboxes.length;
        selectAll.indeterminate = selectedIds.size > 0 && selectedIds.size < checkboxes.length;
    }
    
    /**
     * Initialize bulk actions
     */
    function initBulkActions() {
        document.getElementById('clear-selection')?.addEventListener('click', () => {
            selectedIds.clear();
            tableBody.querySelectorAll('.device-checkbox').forEach(cb => cb.checked = false);
            document.getElementById('select-all').checked = false;
            updateSelectionUI();
        });
        
        document.getElementById('bulk-delete')?.addEventListener('click', async () => {
            const count = selectedIds.size;
            const confirmed = await Modal.confirm({
                title: _('devices.bulk_delete_title'),
                message: _('devices.bulk_delete_confirm', { count }),
                confirmLabel: _('actions.delete'),
                confirmIcon: 'delete',
                danger: true
            });
            
            if (!confirmed) return;
            
            try {
                await Utils.api('/api/devices/bulk-delete', {
                    method: 'POST',
                    body: { ids: Array.from(selectedIds) }
                });
                Notifications.success(_('devices.bulk_delete_success', { count }));
                selectedIds.clear();
                loadDevices();
            } catch (error) {
                Notifications.error(error.message || _('errors.bulk_delete_failed'));
            }
        });
    }
    
    /**
     * Initialize sync button
     */
    function initSync() {
        document.getElementById('sync-btn')?.addEventListener('click', async () => {
            try {
                await Utils.api('/api/sync-status', { method: 'POST' });
                Notifications.success(_('devices.sync_success'));
                loadDevices();
            } catch (error) {
                Notifications.error(error.message || _('errors.sync_failed'));
            }
        });
    }

    // ==================== Tag and Device Group Filters ====================

    async function loadTags() {
        try {
            const response = await fetchOnce('/api/tags', () => Utils.api('/api/tags'));
            availableTags = response.tags || [];
            renderTagFilters();
        } catch (error) {
            console.error('Failed to load tags:', error);
        }
    }

    function renderTagFilters() {
        const menu = document.getElementById('tags-filter-options') || document.getElementById('tags-filter-menu');
        const btn = document.getElementById('tags-filter-btn');
        if (!menu) return;

        if (!availableTags.length) {
            menu.innerHTML = `<div class="tag-filter-empty">${_('devices.no_tags') || 'No tags'}</div>`;
        } else {
            menu.innerHTML = availableTags.map(tag => {
                const checked = selectedTags.has(tag) ? 'checked' : '';
                return `<label class="tag-filter-option">
                    <input type="checkbox" value="${Utils.escapeHtml(tag)}" ${checked}>
                    <span>${Utils.escapeHtml(tag)}</span>
                </label>`;
            }).join('');
        }

        menu.querySelectorAll('input[type="checkbox"]').forEach(input => {
            input.addEventListener('change', () => {
                if (input.checked) selectedTags.add(input.value);
                else selectedTags.delete(input.value);
                currentPage = 1;
                updateTagFilterButton();
                applyFilters();
            });
        });

        updateTagFilterButton();
    }

    /** "Tags: scanner" on the button while a tag filter is on */
    function updateTagFilterButton() {
        const btn = document.getElementById('tags-filter-btn');
        if (btn) btn.classList.toggle('tag-filter-active', selectedTags.size > 0);
        const summary = document.getElementById('tags-filter-summary');
        if (!summary) return;
        const list = Array.from(selectedTags);
        summary.textContent = list.length === 0 ? ''
            : ': ' + (list.length === 1 ? list[0] : _('devices.tags_selected', { count: list.length }));
    }

    /** Escape closes a toolbar dropdown and puts focus back on its button */
    function closeOnEscape(btn, menu) {
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !menu.classList.contains('show')) return;
            menu.classList.remove('show');
            btn.setAttribute('aria-expanded', 'false');
            btn.focus();
        });
    }

    function initTagFilter() {
        const btn = document.getElementById('tags-filter-btn');
        const menu = document.getElementById('tags-filter-menu');
        if (!btn || !menu) return;
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.setAttribute('aria-expanded', String(menu.classList.toggle('show')));
        });
        menu.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
                btn.setAttribute('aria-expanded', 'false');
            }
        });
        closeOnEscape(btn, menu);
    }

    async function loadDeviceGroups() {
        try {
            const response = await fetchOnce('/api/device-groups', () => Utils.api('/api/device-groups'));
            deviceGroups = response.groups || [];
            window._betterdesk_device_groups = deviceGroups;
            renderDeviceGroups();
            updateGroupCounts();
        } catch (error) {
            console.error('Failed to load device groups:', error);
        }
    }

    function renderDeviceGroups() {
        const container = document.getElementById('custom-device-groups');
        if (!container) return;
        container.innerHTML = deviceGroups.map(group => {
            const isDynamic = (group.source_type || 'manual') === 'tag';
            const guid = Utils.escapeHtml(group.guid);
            const name = Utils.escapeHtml(group.name);
            return `<li class="filter-item">
                <span class="group-chip filter-option ${currentGroup === group.guid ? 'active' : ''} ${isDynamic ? 'dynamic' : ''}" data-group="${guid}" role="button" tabindex="0" title="${Utils.escapeHtml(isDynamic ? (_('devices.dynamic_group_hint') || 'Dynamic tag group') + ': ' + group.tag_filter : group.name)}">
                    <span class="chip-label">${name}</span>
                    <span class="chip-count">${group.member_count || 0}</span>
                </span>
                ${canManageFilters() ? `<button type="button" class="chip-menu-btn btn-icon" data-type="group" data-group="${guid}"
                        aria-label="${_('devices.actions')}: ${name}" aria-haspopup="menu">
                    <span class="material-icons" aria-hidden="true">more_vert</span>
                </button>` : ''}
            </li>`;
        }).join('');

        container.querySelectorAll('.group-chip').forEach(el => {
            el.addEventListener('click', (event) => {
                if (event.target.closest('.group-chip-action')) return;
                selectDeviceGroup(el.dataset.group);
            });
            el.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                selectDeviceGroup(el.dataset.group);
            });
            attachChipContextMenu(el, { type: 'group', guid: el.dataset.group });
        });

        container.querySelectorAll('.chip-menu-btn').forEach(btn => {
            btn.addEventListener('click', (event) => openChipMenuFromButton(event, btn, { type: 'group', guid: btn.dataset.group }));
        });

        attachGroupDropEvents();
    }

    async function deleteDeviceGroup(group) {
        const confirmed = await Modal.confirm({
            title: _('devices.delete_group') || 'Delete group',
            message: (_('devices.delete_group_confirm') || 'Delete device group {name}?').replace('{name}', group.name),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;

        try {
            await Utils.api(`/api/device-groups/${encodeURIComponent(group.guid)}`, { method: 'DELETE' });
            Notifications.success(_('devices.group_deleted') || 'Device group deleted');
            if (currentGroup === group.guid) selectDeviceGroup('all');
            loadDeviceGroups();
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    /**
     * Commercialization depends on org→default device group; packages attach to groups.
     * A side sheet on Devices: assign an existing support package to this group, or create one and assign it.
     */
    async function openGroupCommercializationModal(group) {
        if (!group?.guid) return;
        let packages = [];
        try {
            const data = await Utils.api('/api/panel/billing/packages');
            packages = data.packages || [];
        } catch (e) {
            Notifications.error(e.message || _('errors.server_error'));
            return;
        }

        const esc = (value) => Utils.escapeHtml(String(value ?? ''));
        const startNew = !packages.length;
        const pkgOptions = packages.map((p) =>
            `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.included_minutes || 0)} min)</option>`
        ).join('');

        const bodyHtml = `
            <form id="gc-form" class="form-stack" novalidate>
                <p class="form-hint">${esc(_('devices.group_commercialization_hint') || 'Assign a support package to this group. All devices in the group share the package pool.')}</p>
                <div class="form-group">
                    <span class="form-label" id="gc-mode-label">${esc(_('devices.group_commercialization_mode') || 'Action')}</span>
                    <div role="radiogroup" aria-labelledby="gc-mode-label">
                        <ul class="choice-list">
                            <li><label class="choice">
                                <input type="radio" name="gc-mode" value="existing" aria-controls="gc-existing-wrap"${startNew ? ' disabled' : ' checked'}>
                                <span class="choice-title">${esc(_('devices.group_commercialization_assign_existing') || 'Assign existing package')}</span>
                                ${startNew ? `<span class="choice-desc">${esc(remoteText('devices.group_billing_no_packages', 'There are no packages yet.'))}</span>` : ''}
                            </label></li>
                            <li><label class="choice">
                                <input type="radio" name="gc-mode" value="new" aria-controls="gc-new-wrap"${startNew ? ' checked' : ''}>
                                <span class="choice-title">${esc(_('devices.group_commercialization_create_new') || 'Create new package and assign')}</span>
                            </label></li>
                        </ul>
                    </div>
                </div>
                <div id="gc-existing-wrap" class="form-group"${startNew ? ' hidden' : ''}>
                    <label class="form-label" for="gc-package">${esc(_('commercialization.contracts.package') || 'Package')}</label>
                    <select id="gc-package" class="form-select is-host"${packages.length ? '' : ' disabled'}>
                        ${pkgOptions || `<option value="">${esc(_('commercialization.contracts.no_packages') || 'No packages yet')}</option>`}
                    </select>
                </div>
                <section id="gc-new-wrap" class="form-section" aria-labelledby="gc-new-title"${startNew ? '' : ' hidden'}>
                    <h3 class="form-section-title" id="gc-new-title">${esc(remoteText('devices.group_billing_new_section', 'New package'))}</h3>
                    <div class="form-group">
                        <label class="form-label" for="gc-name">${esc(_('commercialization.packages.name') || 'Name')}</label>
                        <input type="text" id="gc-name" class="form-input is-medium" maxlength="128" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="gc-desc">${esc(_('commercialization.packages.description') || 'Description')}</label>
                        <textarea id="gc-desc" class="form-textarea" rows="2" maxlength="512"></textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="gc-minutes">${esc(_('commercialization.packages.included_minutes') || 'Included minutes')}</label>
                        <input type="number" id="gc-minutes" class="form-input is-short" value="600" min="1" step="1" inputmode="numeric">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="gc-overage">${esc(_('commercialization.packages.overage_rate') || 'Overage rate')}</label>
                        <input type="number" id="gc-overage" class="form-input is-short" value="100" min="0" step="0.01" inputmode="decimal">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="gc-currency">${esc(_('commercialization.packages.currency') || 'Currency')}</label>
                        <input type="text" id="gc-currency" class="form-input is-short" value="PLN" maxlength="8" autocomplete="off" spellcheck="false" aria-describedby="gc-currency-hint">
                        <p class="form-hint" id="gc-currency-hint">${esc(remoteText('devices.group_billing_currency_hint', 'Three-letter code, for example EUR.'))}</p>
                    </div>
                </section>
                <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
            </form>
        `;

        return new Promise((resolve) => {
            let busy = false;
            const save = async () => {
                if (busy) return;
                const form = document.getElementById('gc-form');
                if (!form) return;
                const nameInput = form.querySelector('#gc-name');
                nameInput.removeAttribute('aria-invalid');
                const showErr = (msg) => Modal.setStatus(msg, 'error');
                busy = true;
                try {
                    const mode = form.querySelector('input[name="gc-mode"]:checked')?.value || 'existing';
                    let packageId = form.querySelector('#gc-package')?.value;
                    if (mode === 'new') {
                        const name = nameInput.value.trim();
                        if (!name) {
                            nameInput.setAttribute('aria-invalid', 'true');
                            nameInput.focus();
                            showErr(_('commercialization.packages.prompt_name') || 'Package name required');
                            return;
                        }
                        Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
                        await Utils.api('/api/panel/billing/packages', {
                            method: 'POST',
                            body: {
                                name,
                                description: form.querySelector('#gc-desc')?.value?.trim() || '',
                                included_minutes: parseInt(form.querySelector('#gc-minutes')?.value, 10) || 600,
                                overage_rate: parseFloat(form.querySelector('#gc-overage')?.value) || 0,
                                currency: (form.querySelector('#gc-currency')?.value || 'PLN').trim().toUpperCase()
                            }
                        });
                        const list = await Utils.api('/api/panel/billing/packages');
                        const match = (list.packages || []).find((p) => p.name === name);
                        packageId = match?.id;
                        if (!packageId) {
                            showErr(_('errors.server_error') || 'Failed to create package');
                            return;
                        }
                    }
                    if (!packageId) {
                        showErr(_('commercialization.contracts.no_packages') || 'Select a package');
                        return;
                    }
                    Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
                    await Utils.api('/api/panel/billing/contracts', {
                        method: 'POST',
                        body: {
                            target_type: 'device_group',
                            target_key: group.guid,
                            package_id: packageId
                        }
                    });
                    Modal.close();
                    Notifications.success(_('devices.group_commercialization_saved') || 'Package assigned to group');
                    resolve(true);
                } catch (e) {
                    showErr(e.message || _('errors.server_error'));
                } finally {
                    busy = false;
                }
            };

            Modal.sheet({
                title: fillRemoteText('devices.group_billing_title', 'Support package for {name}', { name: group.name }),
                content: bodyHtml,
                status: true,
                buttons: [
                    {
                        label: _('actions.cancel') || 'Cancel',
                        class: 'btn-secondary',
                        start: true,
                        onClick: () => { Modal.close(); resolve(false); }
                    },
                    {
                        label: _('actions.save') || 'Save',
                        class: 'btn-primary',
                        onClick: save
                    }
                ],
                onClose: () => resolve(false)
            });

            const form = document.getElementById('gc-form');
            if (!form) return;
            form.addEventListener('submit', (event) => {
                event.preventDefault();
                save();
            });
            // The package choice or the new package's fields, whichever applies
            const existingWrap = form.querySelector('#gc-existing-wrap');
            const newWrap = form.querySelector('#gc-new-wrap');
            form.querySelectorAll('input[name="gc-mode"]').forEach(radio => {
                radio.addEventListener('change', () => {
                    const isNew = form.querySelector('input[name="gc-mode"]:checked')?.value === 'new';
                    existingWrap.hidden = isNew;
                    newWrap.hidden = !isNew;
                });
            });
            form.addEventListener('input', () => Modal.setStatus(''));
        });
    }

    function updateGroupCounts() {
        const allCount = document.getElementById('group-count-all');
        if (allCount) allCount.textContent = devices.length;
        for (const group of deviceGroups) {
            const count = devices.filter(device => deviceMatchesGroup(device, group)).length;
            const chip = Array.from(document.querySelectorAll('.group-chip[data-group]')).find(el => el.dataset.group === group.guid);
            const countEl = chip ? chip.querySelector('.chip-count') : null;
            if (countEl) countEl.textContent = count;
        }
    }

    function selectDeviceGroup(groupGuid) {
        currentGroup = groupGuid || 'all';
        currentFolder = 'all';
        currentPage = 1;
        document.querySelectorAll('.group-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.group === currentGroup);
        });
        // With a group chosen, no folder entry is marked; "All devices" clears both.
        document.querySelectorAll('.folder-chip').forEach(el => {
            el.classList.toggle('active', currentGroup === 'all' && el.dataset.folder === 'all');
        });
        applyFilters();
    }

    function initDeviceGroups() {
        document.getElementById('add-device-group-btn')?.addEventListener('click', () => showDeviceGroupModal());
        document.querySelector('.group-chip[data-group="all"]')?.addEventListener('click', () => selectDeviceGroup('all'));
    }

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

    async function loadStrategies() {
        try {
            const response = await fetchOnce('/api/panel/strategies', () => Utils.api('/api/panel/strategies'));
            accessStrategies = response.strategies || [];
            strategiesLoaded = true;
            renderStrategies();
        } catch (error) {
            console.error('Failed to load strategies:', error);
            strategiesLoaded = true;
            accessStrategies = [];
            renderStrategies();
        }
    }

    function renderStrategies() {
        const container = document.getElementById('devices-strategies-list');
        if (!container) return;
        const countEl = document.getElementById('devices-strategies-count');
        if (countEl) {
            countEl.textContent = strategiesLoaded && accessStrategies.length
                ? _('devices.strategies_count', { count: accessStrategies.length })
                : '';
        }
        if (!strategiesLoaded) {
            container.innerHTML = `<p class="state">${_('devices.loading_strategies')}</p>`;
            return;
        }
        if (!accessStrategies.length) {
            container.innerHTML = `<p class="state">${_('devices.no_strategies')}</p>`;
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
        const esc = Utils.escapeHtml;
        const canEdit = can('device.edit');

        // One row per rule: who it is for, how many client settings it sets, where it is applied
        const rows = accessStrategies.map((strategy, index) => {
            const enabled = strategy.enabled !== false;
            const permCount = Object.keys(strategy.permissions || {}).length;
            const guid = esc(strategy.guid);
            const menuId = `strategy-menu-${index}`;
            const nearEnd = accessStrategies.length > 3 && index >= accessStrategies.length - 2;
            const menu = canEdit ? `<span class="menu-anchor">
                    <button type="button" class="kebab-btn" data-menu-button aria-haspopup="menu" aria-expanded="false"
                        aria-controls="${menuId}" aria-label="${esc(_('devices.strategy_actions_for', { name: strategy.name }))}">
                        <span class="material-icons" aria-hidden="true">more_vert</span>
                    </button>
                    <span class="menu menu-end${nearEnd ? ' menu-up' : ''}" id="${menuId}" role="menu">
                        <button type="button" class="menu-item" role="menuitem" data-action="assign-strategy" data-guid="${guid}">${Utils.icon('link')}${_('devices.strategy_assign')}</button>
                        <button type="button" class="menu-item" role="menuitem" data-action="edit-strategy" data-guid="${guid}">${Utils.icon('edit')}${_('actions.edit')}</button>
                        <span class="menu-divider" role="separator"></span>
                        <button type="button" class="menu-item danger" role="menuitem" data-action="delete-strategy" data-guid="${guid}">${Utils.icon('delete')}${_('actions.delete')}</button>
                    </span>
                </span>` : '';
            return `<tr class="${enabled ? '' : 'strategy-disabled'}" data-guid="${guid}">
                <td class="strategy-name">${esc(strategy.name)}</td>
                <td>${esc(userGroupName(strategy.user_group_guid))} <span aria-hidden="true">→</span><span class="sr-only">,</span> ${esc(deviceGroupName(strategy.device_group_guid))}</td>
                <td class="strategy-perm-count">${esc(_('devices.strategy_permissions_count', { count: permCount }))}</td>
                <td><span class="strategy-assign-count" data-guid="${guid}">${_('devices.strategy_assign_none')}</span></td>
                <td>${Utils.statusHtml(enabled ? 'good' : 'neutral', enabled ? _('devices.strategy_enabled') : _('devices.strategy_disabled'))}</td>
                <td class="actions">${menu}</td>
            </tr>`;
        }).join('');

        container.innerHTML = `<div class="table-scroll"><table class="data-table strategies-table">
            <thead><tr>
                <th scope="col">${_('devices.strategy_col_rule')}</th>
                <th scope="col">${_('devices.strategy_col_scope')}</th>
                <th scope="col">${_('devices.strategy_permissions')}</th>
                <th scope="col">${_('devices.strategy_col_assigned')}</th>
                <th scope="col">${_('devices.strategy_col_status')}</th>
                <th scope="col" class="actions"><span class="sr-only">${_('common.actions')}</span></th>
            </tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;

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

    function renderAssignCheckboxList(items, selectedKeys, inputClass, labelFn, emptyText, labelledBy) {
        if (!items.length) {
            return `<p class="form-hint">${Utils.escapeHtml(emptyText || _('common.no_results') || 'No items')}</p>`;
        }
        return `<div role="group" aria-labelledby="${labelledBy}"><ul class="list group-membership-list strategy-assign-list">${items.map(item => {
            const key = item.key;
            const checked = selectedKeys.includes(key) ? ' checked' : '';
            return `<li class="list-row strategy-assign-row" data-label="${Utils.escapeHtml(String(labelFn(item)).toLowerCase())}">
                <label class="check-field">
                    <input type="checkbox" class="${inputClass}" value="${Utils.escapeHtml(key)}"${checked}>
                    <span class="check-label">${Utils.escapeHtml(labelFn(item))}</span>
                </label>
            </li>`;
        }).join('')}</ul></div>`;
    }

    // Where an access rule applies (devices, users, device groups): a side sheet,
    // the pick lists are long
    async function showStrategyAssignModal(strategy) {
        if (!deviceGroups.length) await loadDeviceGroups();
        let panelUsers = [];
        try {
            const usersResp = await Utils.api('/api/users');
            panelUsers = usersResp.users || usersResp.data?.users || usersResp.data || [];
        } catch (_) { panelUsers = []; }

        let detail = { peer_ids: [], user_names: [], group_guids: [] };
        try {
            const resp = await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}`);
            detail = resp?.data?.strategy || resp?.strategy || detail;
        } catch (_) {}

        const esc = (value) => Utils.escapeHtml(String(value ?? ''));
        const deviceItems = (devices || []).slice(0, 500).map(d => ({
            key: d.id,
            label: `${d.id}${d.hostname ? ', ' + d.hostname : ''}`,
        }));
        const userItems = panelUsers.map(u => ({
            key: u.username || u.name || String(u.id),
            label: u.username || u.name || String(u.id),
        }));
        const groupItems = deviceGroups.map(g => ({ key: g.guid, label: g.name || g.guid }));
        // A filter above a long device list
        const deviceFilter = deviceItems.length > 8 ? `
            <div class="form-group">
                <label class="form-label" for="strategy-assign-filter">${esc(remoteText('devices.strategy_assign_filter', 'Find devices'))}</label>
                <input type="search" id="strategy-assign-filter" class="form-input is-medium" autocomplete="off" spellcheck="false" aria-describedby="strategy-assign-filter-hint" aria-controls="strategy-assign-devices-list">
                <p class="form-hint" id="strategy-assign-filter-hint">${esc(remoteText('devices.strategy_assign_filter_hint', 'Type part of an ID or name. Ticked devices stay ticked when they are hidden.'))}</p>
            </div>` : '';

        Modal.sheet({
            title: (_('devices.strategy_assign_title') || 'Assign strategy').replace('{name}', strategy.name),
            content: `
                <form id="strategy-assign-form" class="form-stack" novalidate>
                    <p class="form-hint">${esc(_('devices.strategy_assign_hint'))}</p>
                    <section class="form-section" aria-labelledby="strategy-assign-devices-title">
                        <h3 class="form-section-title" id="strategy-assign-devices-title">${esc(_('devices.strategy_assign_devices'))}</h3>
                        ${deviceFilter}
                        <div id="strategy-assign-devices-list">${renderAssignCheckboxList(deviceItems, detail.peer_ids || [], 'strategy-assign-peer', i => i.label, remoteText('devices.strategy_assign_no_devices', 'No devices.'), 'strategy-assign-devices-title')}</div>
                        <p class="form-hint" id="strategy-assign-no-match" hidden>${esc(remoteText('devices.strategy_assign_no_match', 'No device matches.'))}</p>
                    </section>
                    <section class="form-section" aria-labelledby="strategy-assign-users-title">
                        <h3 class="form-section-title" id="strategy-assign-users-title">${esc(_('devices.strategy_assign_users'))}</h3>
                        ${renderAssignCheckboxList(userItems, detail.user_names || [], 'strategy-assign-user', i => i.label, remoteText('devices.strategy_assign_no_users', 'No users.'), 'strategy-assign-users-title')}
                    </section>
                    <section class="form-section" aria-labelledby="strategy-assign-groups-title">
                        <h3 class="form-section-title" id="strategy-assign-groups-title">${esc(_('devices.strategy_assign_groups'))}</h3>
                        ${renderAssignCheckboxList(groupItems, detail.group_guids || [], 'strategy-assign-group', i => i.label, remoteText('devices.strategy_assign_no_groups', 'No device groups yet.'), 'strategy-assign-groups-title')}
                    </section>
                    <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
                </form>
            `,
            status: true,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => saveStrategyAssignments(strategy) }
            ],
        });

        const form = document.getElementById('strategy-assign-form');
        if (!form) return;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            saveStrategyAssignments(strategy);
        });
        const filter = form.querySelector('#strategy-assign-filter');
        if (filter) {
            // Enter in the filter does not save
            filter.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') event.preventDefault();
            });
            filter.addEventListener('input', () => {
                const q = filter.value.trim().toLowerCase();
                let shown = 0;
                form.querySelectorAll('#strategy-assign-devices-list .strategy-assign-row').forEach(row => {
                    row.hidden = !!q && !row.dataset.label.includes(q);
                    if (!row.hidden) shown++;
                });
                form.querySelector('#strategy-assign-no-match').hidden = shown > 0;
            });
        }
        form.addEventListener('change', () => Modal.setStatus(''));
    }

    async function saveStrategyAssignments(strategy) {
        const form = document.getElementById('strategy-assign-form');
        if (!form || form.dataset.busy === 'true') return;
        const peers = Array.from(form.querySelectorAll('.strategy-assign-peer:checked')).map(el => el.value);
        const users = Array.from(form.querySelectorAll('.strategy-assign-user:checked')).map(el => el.value);
        const groups = Array.from(form.querySelectorAll('.strategy-assign-group:checked')).map(el => el.value);
        if (!peers.length && !users.length && !groups.length) {
            Modal.setStatus(remoteText('devices.strategy_assign_none_selected', 'Tick at least one device, user or device group.'), 'error');
            return;
        }
        form.dataset.busy = 'true';
        Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
        try {
            await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}/assign`, {
                method: 'POST',
                body: { peers, users, groups },
            });
            Modal.close();
            Notifications.success(_('devices.strategy_assign_saved'));
            await refreshStrategyAssignCounts();
        } catch (error) {
            Modal.setStatus(error.message || _('errors.server_error'), 'error');
        } finally {
            form.dataset.busy = '';
        }
    }

    function renderStrategyPermissionOptions(permissions = {}) {
        return RUSTDESK_STRATEGY_PERM_KEYS.map(item => {
            const current = permissions[item.key];
            const checked = current === 'Y' || current === true;
            const denied = current === 'N' || current === false;
            const selectId = `strategy-perm-${item.key}`;
            return `<div class="strategy-perm-option">
                <label for="${selectId}">${Utils.escapeHtml(_(item.labelKey))}</label>
                <select class="form-select strategy-perm-select" id="${selectId}" data-perm-key="${Utils.escapeHtml(item.key)}">
                    <option value="" ${!checked && !denied ? 'selected' : ''}>${_('devices.strategy_perm_default')}</option>
                    <option value="Y" ${checked ? 'selected' : ''}>${_('devices.strategy_perm_allow')}</option>
                    <option value="N" ${denied ? 'selected' : ''}>${_('devices.strategy_perm_deny')}</option>
                </select>
            </div>`;
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

    // Add or edit an access rule: a side sheet (GUIDE.md "Dialogs and sheets")
    async function showStrategyModal(strategy = null) {
        await ensureUserGroupsLoaded();
        if (!deviceGroups.length) await loadDeviceGroups();
        const editing = !!strategy;
        const esc = (value) => Utils.escapeHtml(String(value ?? ''));
        const userGroupOptions = [
            `<option value="">${esc(_('devices.strategy_any_user_group'))}</option>`,
            ...availableUserGroups.map(group => `<option value="${esc(group.guid)}" ${strategy?.user_group_guid === group.guid ? 'selected' : ''}>${esc(group.name)}</option>`)
        ].join('');
        const deviceGroupOptions = [
            `<option value="">${esc(_('devices.strategy_any_device_group'))}</option>`,
            ...deviceGroups.map(group => `<option value="${esc(group.guid)}" ${strategy?.device_group_guid === group.guid ? 'selected' : ''}>${esc(group.name)}</option>`)
        ].join('');

        Modal.sheet({
            title: editing ? _('devices.edit_strategy') : _('devices.create_strategy'),
            subtitle: remoteText('devices.strategy_sheet_desc', 'Client settings that apply when someone from a user group works on a device in a device group.'),
            content: `
                <form id="strategy-form" class="form-stack" novalidate>
                    <div class="form-group">
                        <label class="form-label" for="strategy-name">${esc(_('devices.strategy_name'))}</label>
                        <input type="text" id="strategy-name" class="form-input is-medium" maxlength="80" required value="${esc(strategy?.name || '')}">
                    </div>
                    <section class="form-section" aria-labelledby="strategy-scope-title">
                        <h3 class="form-section-title" id="strategy-scope-title">${esc(remoteText('devices.strategy_section_scope', 'Who and where'))}</h3>
                        <div class="form-group">
                            <label class="form-label" for="strategy-user-group">${esc(_('devices.strategy_user_group'))}</label>
                            <select id="strategy-user-group" class="form-select is-host" aria-describedby="strategy-groups-hint">${userGroupOptions}</select>
                        </div>
                        <div class="form-group">
                            <label class="form-label" for="strategy-device-group">${esc(_('devices.strategy_device_group'))}</label>
                            <select id="strategy-device-group" class="form-select is-host" aria-describedby="strategy-groups-hint">${deviceGroupOptions}</select>
                            <p class="form-hint" id="strategy-groups-hint">${esc(_('devices.strategy_groups_hint'))}</p>
                        </div>
                    </section>
                    <section class="form-section" aria-labelledby="strategy-perms-title">
                        <h3 class="form-section-title" id="strategy-perms-title">${esc(_('devices.strategy_permissions'))}</h3>
                        <p class="form-hint">${esc(_('devices.strategy_permissions_hint'))}</p>
                        <div class="strategy-perm-grid" role="group" aria-labelledby="strategy-perms-title">${renderStrategyPermissionOptions(strategy?.permissions || {})}</div>
                    </section>
                    <div class="form-section">
                        <label class="check-field">
                            <input type="checkbox" id="strategy-enabled" ${strategy?.enabled !== false ? 'checked' : ''}>
                            <span class="check-label">${esc(_('devices.strategy_enabled_label'))}</span>
                            <span class="form-hint">${esc(remoteText('devices.strategy_enabled_hint', 'When off, the rule is kept but not applied.'))}</span>
                        </label>
                    </div>
                    <button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
                </form>
            `,
            status: true,
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', start: true, onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => saveStrategy(strategy) }
            ]
        });

        const form = document.getElementById('strategy-form');
        if (!form) return;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            saveStrategy(strategy);
        });
        form.addEventListener('input', () => Modal.setStatus(''));
    }

    async function saveStrategy(strategy = null) {
        const form = document.getElementById('strategy-form');
        if (!form || form.dataset.busy === 'true') return;
        const nameInput = form.querySelector('#strategy-name');
        const name = nameInput?.value.trim() || '';
        nameInput?.removeAttribute('aria-invalid');
        if (!name) {
            nameInput?.setAttribute('aria-invalid', 'true');
            nameInput?.focus();
            Modal.setStatus(_('devices.strategy_name_required'), 'error');
            return;
        }
        const payload = {
            name,
            user_group_guid: document.getElementById('strategy-user-group')?.value || '',
            device_group_guid: document.getElementById('strategy-device-group')?.value || '',
            enabled: !!document.getElementById('strategy-enabled')?.checked,
            permissions: readStrategyPermissionsFromForm(),
        };
        form.dataset.busy = 'true';
        Modal.setStatus(remoteText('devices.remote_saving', 'Saving…'));
        try {
            const url = strategy
                ? `/api/panel/strategies/${encodeURIComponent(strategy.guid)}`
                : '/api/panel/strategies';
            await Utils.api(url, { method: strategy ? 'PATCH' : 'POST', body: payload });
            Modal.close();
            Notifications.success(strategy ? _('devices.strategy_updated') : _('devices.strategy_created'));
            strategiesLoaded = false;
            await loadStrategies();
        } catch (error) {
            Modal.setStatus(error.message || _('errors.server_error'), 'error');
        } finally {
            form.dataset.busy = '';
        }
    }

    async function deleteStrategy(strategy) {
        const confirmed = await Modal.confirm({
            title: _('devices.delete_strategy'),
            message: (_('devices.delete_strategy_confirm') || 'Delete strategy {name}?').replace('{name}', strategy.name),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        if (!confirmed) return;
        try {
            await Utils.api(`/api/panel/strategies/${encodeURIComponent(strategy.guid)}`, { method: 'DELETE' });
            Notifications.success(_('devices.strategy_deleted'));
            strategiesLoaded = false;
            await loadStrategies();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }

    function initStrategies() {
        document.getElementById('add-strategy-btn')?.addEventListener('click', () => showStrategyModal());
    }
    
    // ==================== Folder Functions ====================
    
    /**
     * Load folders from API
     */
    async function loadFolders() {
        try {
            const response = await fetchOnce('/api/folders', () => Utils.api('/api/folders'));
            folders = response.folders || [];
            // Expose folders globally for DeviceDetail panel
            window._betterdesk_folders = folders;
            renderFolders();
            updateBulkMoveSelect();
        } catch (error) {
            console.error('Failed to load folders:', error);
        }
    }
    
    /**
     * Render folders list
     */
    function renderFolders() {
        const container = document.getElementById('custom-folders');
        if (!container) return;
        
        if (folders.length === 0) {
            container.innerHTML = '';
            attachFolderDropEvents();
            return;
        }
        
        container.innerHTML = folders.map(folder => {
            const safeColor = (Utils.sanitizeColor || _sanitizeColorFallback)(folder.color);
            const name = Utils.escapeHtml(folder.name);
            return `
            <li class="filter-item">
                <span class="folder-chip filter-option ${currentFolder == folder.id ? 'active' : ''}"
                     data-folder="${folder.id}"
                     role="button"
                     tabindex="0"
                     style="--folder-color: ${safeColor}">
                    <span class="folder-mark" aria-hidden="true"></span>
                    <span class="chip-label">${name}</span>
                    <span class="chip-count">${folder.device_count || 0}</span>
                </span>
                ${canManageFilters() ? `<button type="button" class="chip-menu-btn btn-icon" data-type="folder" data-id="${folder.id}"
                        aria-label="${_('devices.actions')}: ${name}" aria-haspopup="menu">
                    <span class="material-icons" aria-hidden="true">more_vert</span>
                </button>` : ''}
            </li>
        `}).join('');
        
        // Attach folder click listeners
        container.querySelectorAll('.folder-chip').forEach(el => {
            el.addEventListener('click', (e) => {
                if (!e.target.closest('.chip-actions')) {
                    selectFolder(el.dataset.folder);
                }
            });
            el.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                if (e.target.closest('.chip-actions')) return;
                e.preventDefault();
                selectFolder(el.dataset.folder);
            });
            attachChipContextMenu(el, { type: 'folder', id: el.dataset.folder });
        });
        
        container.querySelectorAll('.chip-menu-btn').forEach(btn => {
            btn.addEventListener('click', (e) => openChipMenuFromButton(e, btn, { type: 'folder', id: btn.dataset.id }));
        });

        // Attach drag & drop events for all folder chips
        attachFolderDropEvents();
    }
    
    /**
     * Update folder counts
     */
    function updateFolderCounts() {
        // All devices count
        const allCount = document.getElementById('folder-count-all');
        if (allCount) allCount.textContent = devices.length;
        
        // Unassigned count (devices without folder_id — null, undefined, or missing)
        const unassignedCount = document.getElementById('folder-count-unassigned');
        if (unassignedCount) {
            const count = devices.filter(d => !d.folder_id).length;
            unassignedCount.textContent = count;
        }
        
        // Update custom folder counts from devices array
        for (const folder of folders) {
            const el = document.querySelector(`.folder-chip[data-folder="${folder.id}"] .chip-count`);
            if (el) {
                const count = devices.filter(d => folderIdsEqual(d.folder_id, folder.id)).length;
                el.textContent = count;
            }
        }
    }
    
    /**
     * Update bulk move select options
     */
    function updateBulkMoveSelect() {
        const select = document.getElementById('bulk-move-folder');
        if (!select) return;
        
        select.innerHTML = `
            <option value="">${_('folders.move_to')}...</option>
            <option value="0">${_('folders.unassigned')}</option>
            ${folders.map(f => `<option value="${f.id}">${Utils.escapeHtml(f.name)}</option>`).join('')}
        `;
        
        // Add change listener
        select.addEventListener('change', async function() {
            if (!this.value || selectedIds.size === 0) return;
            
            try {
                await Utils.api(`/api/folders/${this.value}/devices`, {
                    method: 'POST',
                    body: { deviceIds: Array.from(selectedIds) }
                });
                Notifications.success(_('folders.devices_moved'));
                this.value = '';
                selectedIds.clear();
                updateSelectionUI();
                loadDevices();
                loadFolders();
            } catch (error) {
                Notifications.error(error.message || _('errors.server_error'));
            }
        });
    }
    
    /**
     * Select folder
     */
    function selectFolder(folderId) {
        currentFolder = folderId;
        currentGroup = 'all';
        currentPage = 1;
        
        // Update active state
        document.querySelectorAll('.folder-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.folder == folderId);
        });
        document.querySelectorAll('.group-chip').forEach(el => {
            el.classList.toggle('active', el.dataset.group === 'all');
        });
        
        applyFilters();
    }
    
    /**
     * Initialize folder event listeners
     */
    function initFolders() {
        // Add folder button
        document.getElementById('add-folder-btn')?.addEventListener('click', showAddFolderModal);
        
        // Special folder clicks
        document.querySelectorAll('.folder-chip[data-folder="all"], .folder-chip[data-folder="unassigned"]').forEach(el => {
            el.addEventListener('click', () => selectFolder(el.dataset.folder));
        });
    }
    
    /**
     * Initialize column visibility toggle
     */
    function initColumnVisibility() {
        const btn = document.getElementById('columns-btn');
        const menu = document.getElementById('columns-menu');
        if (!btn || !menu) return;

        // Restore saved preferences
        const saved = localStorage.getItem('devices-visible-columns');
        if (saved) {
            try {
                const hidden = JSON.parse(saved);
                menu.querySelectorAll('input[data-column]').forEach(cb => {
                    cb.checked = !hidden.includes(cb.dataset.column);
                });
            } catch (e) { /* ignore parse errors */ }
        }

        // Toggle dropdown on button click
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.setAttribute('aria-expanded', String(menu.classList.toggle('show')));
        });

        // Close on outside click — use contains() to handle child elements
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
                btn.setAttribute('aria-expanded', 'false');
            }
        });
        closeOnEscape(btn, menu);

        // Checkbox change — stop propagation so click doesn't bubble to document
        menu.querySelectorAll('input[data-column]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                saveColumnPreferences();
                applyColumnVisibility();
            });
        });

        // Prevent menu clicks from closing dropdown
        menu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Apply initial state
        applyColumnVisibility();
    }

    /**
     * Save column visibility preferences to localStorage
     */
    function saveColumnPreferences() {
        const menu = document.getElementById('columns-menu');
        if (!menu) return;
        const hidden = [];
        menu.querySelectorAll('input[data-column]').forEach(cb => {
            if (!cb.checked) hidden.push(cb.dataset.column);
        });
        localStorage.setItem('devices-visible-columns', JSON.stringify(hidden));
    }

    /**
     * Apply column visibility to table headers and cells
     */
    function applyColumnVisibility() {
        const menu = document.getElementById('columns-menu');
        if (!menu) return;

        const hiddenColumns = [];
        menu.querySelectorAll('input[data-column]').forEach(cb => {
            if (!cb.checked) hiddenColumns.push(cb.dataset.column);
        });

        // Apply to <th> elements
        document.querySelectorAll('.devices-table th[data-column]').forEach(th => {
            th.classList.toggle('column-hidden', hiddenColumns.includes(th.dataset.column));
        });

        // Apply to <td> elements
        document.querySelectorAll('.devices-table td[data-column]').forEach(td => {
            td.classList.toggle('column-hidden', hiddenColumns.includes(td.dataset.column));
        });
        requestAnimationFrame(updateTableHScroll);
    }
    
    function selectedFolderUserGroupGuids() {
        return Array.from(document.querySelectorAll('#folder-user-groups-list input:checked')).map(input => input.value);
    }

    function renderFolderUserGroupOptions(selectedGuids) {
        const container = document.getElementById('folder-user-groups-list');
        if (!container) return;
        container.innerHTML = renderUserGroupAccessOptions(selectedGuids || []);
    }

    /**
     * Show add folder modal
     */
    async function showAddFolderModal() {
        await ensureUserGroupsLoaded();
        const template = document.getElementById('folder-form-template');
        if (!template) return;
        
        const content = template.content.cloneNode(true);
        const formHtml = content.querySelector('form').outerHTML;
        
        Modal.show({
            title: _('folders.create'),
            content: formHtml,
            size: 'small',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => submitFolderForm() }
            ],
            onOpen: () => {
                initColorPicker();
                renderFolderUserGroupOptions([]);
                document.getElementById('folder-name')?.focus();
            }
        });
    }
    
    /**
     * Edit folder
     */
    async function editFolder(folderId) {
        await ensureUserGroupsLoaded();
        const folder = findFolderById(folderId);
        if (!folder) return;
        
        const template = document.getElementById('folder-form-template');
        if (!template) return;
        
        const content = template.content.cloneNode(true);
        const formHtml = content.querySelector('form').outerHTML;
        
        Modal.show({
            title: _('folders.edit'),
            content: formHtml,
            size: 'small',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: () => submitFolderForm(folderId) }
            ],
            onOpen: () => {
                initColorPicker();
                document.getElementById('folder-name').value = folder.name;
                document.getElementById('folder-color').value = folder.color;
                document.getElementById('folder-allowed-users').value = (folder.allowed_users || []).join(', ');
                renderFolderUserGroupOptions(folder.allowed_groups || []);
                
                // Set active color
                document.querySelectorAll('.color-option').forEach(btn => {
                    btn.classList.toggle('active', btn.dataset.color === folder.color);
                });
            }
        });
    }
    
    /**
     * Initialize color picker
     */
    function initColorPicker() {
        document.querySelectorAll('.color-option').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.color-option').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById('folder-color').value = btn.dataset.color;
            });
        });
    }
    
    /**
     * Submit folder form
     */
    async function submitFolderForm(folderId = null) {
        const name = document.getElementById('folder-name')?.value.trim();
        const color = document.getElementById('folder-color')?.value;
        const allowedUsers = document.getElementById('folder-allowed-users')?.value || '';
        const allowedGroups = selectedFolderUserGroupGuids();
        
        if (!name) {
            Notifications.error(_('folders.name_required'));
            return;
        }
        
        try {
            if (folderId) {
                await Utils.api(`/api/folders/${folderId}`, {
                    method: 'PATCH',
                    body: { name, color, allowed_users: allowedUsers, allowed_groups: allowedGroups }
                });
                Notifications.success(_('folders.updated'));
            } else {
                await Utils.api('/api/folders', {
                    method: 'POST',
                    body: { name, color, allowed_users: allowedUsers, allowed_groups: allowedGroups }
                });
                Notifications.success(_('folders.created'));
            }
            
            Modal.close();
            loadFolders();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    /**
     * Delete folder
     */
    async function deleteFolder(folderId) {
        const folder = findFolderById(folderId);
        if (!folder) return;
        
        const confirmed = await Modal.confirm({
            title: _('folders.delete'),
            message: _('folders.delete_confirm'),
            confirmLabel: _('actions.delete'),
            danger: true
        });
        
        if (!confirmed) return;
        
        try {
            await Utils.api(`/api/folders/${folderId}`, { method: 'DELETE' });
            Notifications.success(_('folders.delete_success'));
            
            // If current folder was deleted, switch to all
            if (currentFolder == folderId) {
                selectFolder('all');
            }
            
            loadFolders();
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.server_error'));
        }
    }
    
    // ==================== Drag & Drop ====================

    function stopDragAutoScroll() {
        if (dragScrollRafId != null) {
            cancelAnimationFrame(dragScrollRafId);
            dragScrollRafId = null;
        }
        lastDragClientY = null;
    }

    function dragScrollSpeed(depthPx) {
        const t = Math.min(1, Math.max(0, depthPx / DRAG_SCROLL_EDGE_PX));
        return DRAG_SCROLL_MIN_SPEED + t * (DRAG_SCROLL_MAX_SPEED - DRAG_SCROLL_MIN_SPEED);
    }

    function tickDragAutoScroll() {
        dragScrollRafId = null;
        if (!draggedDeviceId || lastDragClientY == null) return;

        const mainContent = document.querySelector('.main-content');
        if (!mainContent || mainContent.scrollHeight <= mainContent.clientHeight) {
            dragScrollRafId = requestAnimationFrame(tickDragAutoScroll);
            return;
        }

        const rect = mainContent.getBoundingClientRect();
        const y = lastDragClientY;
        let delta = 0;

        if (y < rect.top + DRAG_SCROLL_EDGE_PX) {
            delta = -dragScrollSpeed(rect.top + DRAG_SCROLL_EDGE_PX - y);
        } else if (y > rect.bottom - DRAG_SCROLL_EDGE_PX) {
            delta = dragScrollSpeed(y - (rect.bottom - DRAG_SCROLL_EDGE_PX));
        }

        if (delta !== 0) {
            mainContent.scrollTop += delta;
        }

        dragScrollRafId = requestAnimationFrame(tickDragAutoScroll);
    }

    function startDragAutoScroll() {
        if (dragScrollRafId != null) return;
        dragScrollRafId = requestAnimationFrame(tickDragAutoScroll);
    }

    function onDocumentDragOver(e) {
        if (!draggedDeviceId) return;
        lastDragClientY = e.clientY;
        positionDragImage(e.clientX, e.clientY);
    }

    // The browser's own drag image is faded and, on scaled Windows displays,
    // drawn away from the pointer. It is replaced by a transparent pixel and
    // the preview below follows the pointer instead.
    const blankDragImage = new Image();
    blankDragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    /** Put the preview just below and after the pointer (before it in RTL) */
    function positionDragImage(x, y) {
        if (!dragImageEl || (x === 0 && y === 0)) return;
        const gap = 12;
        const left = dragImageEl.dataset.rtl === 'true' ? x - dragImageEl.offsetWidth - gap : x + gap;
        dragImageEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(y + gap)}px)`;
        dragImageEl.hidden = false;
    }

    /**
     * Drag preview: the device's OS mark, its name and its ID, shown next to
     * the pointer while a row is dragged and removed on dragend.
     */
    function removeDragImage() {
        if (dragImageEl) {
            dragImageEl.remove();
            dragImageEl = null;
        }
    }

    function buildDragImage(deviceId) {
        removeDragImage();
        const device = devices.find(d => d.id === deviceId);
        const name = device ? (device.display_name || device.hostname || device.note || '') : '';
        const el = document.createElement('div');
        el.className = 'device-drag-image';
        el.setAttribute('aria-hidden', 'true');
        el.hidden = true;
        el.innerHTML = `
            <span class="device-drag-box">
                ${Utils.getPlatformIconHtml(device && (device.platform || device.os))}
                <span class="device-drag-text">
                    ${name ? `<span class="device-drag-name">${Utils.escapeHtml(name)}</span>` : ''}
                    <span class="device-drag-id mono">${Utils.escapeHtml(deviceId)}</span>
                </span>
            </span>`;
        document.body.appendChild(el);
        el.dataset.rtl = String(getComputedStyle(el).direction === 'rtl');
        dragImageEl = el;
        return el;
    }

    /** Put back everything a row drag changed (also called on drop: the row may be re-rendered before dragend) */
    function endRowDrag() {
        tableBody?.querySelectorAll('tr.dragging').forEach(row => row.classList.remove('dragging'));
        draggedDeviceId = null;
        stopDragAutoScroll();
        removeDragImage();
        document.querySelectorAll('.folder-chip.drag-over, .group-chip.drag-over').forEach(el => {
            el.classList.remove('drag-over');
        });
    }

    /** Whether a folder entry takes a dropped device ("All devices" does not) */
    function folderAcceptsDrop(folder) {
        return folder.dataset.folder !== 'all';
    }

    /** Whether a group entry takes a dropped device (tag groups fill themselves; "All groups" only removes from the open group) */
    function groupAcceptsDrop(chip) {
        const target = chip.dataset.group;
        if (target === 'all') return currentGroup !== 'all';
        const group = deviceGroups.find(item => item.guid === target);
        return !!group && (group.source_type || 'manual') !== 'tag';
    }

    /** dragover/dragleave on a folder or group entry: mark it while a device row is over it */
    function wireDropTarget(el, accepts) {
        el.addEventListener('dragover', (e) => {
            if (!draggedDeviceId || !accepts(el)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over');
        });
        el.addEventListener('dragleave', (e) => {
            // Moving onto the label or count inside the entry is not leaving it
            if (e.relatedTarget && el.contains(e.relatedTarget)) return;
            el.classList.remove('drag-over');
        });
    }

    /**
     * Initialize drag & drop - row drag events only (called once)
     */
    function initDragDrop() {
        // Track pointer Y during HTML5 drag (mousemove is unreliable while dragging)
        document.addEventListener('dragover', onDocumentDragOver, true);

        // Handle drag start on rows
        tableBody?.addEventListener('dragstart', (e) => {
            if (shouldDisableRowDrag() || !can('device.edit')) {
                e.preventDefault();
                return;
            }
            const row = e.target.closest('tr');
            if (!row) return;

            draggedDeviceId = row.dataset.id;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedDeviceId);
            if (typeof e.dataTransfer.setDragImage === 'function') {
                buildDragImage(draggedDeviceId);
                e.dataTransfer.setDragImage(blankDragImage, 0, 0);
                positionDragImage(e.clientX, e.clientY);
            }
            lastDragClientY = e.clientY;
            startDragAutoScroll();
        });

        tableBody?.addEventListener('dragend', endRowDrag);
    }
    
    /**
     * Attach drag events to folder items (called after renderFolders)
     */
    function attachFolderDropEvents() {
        // Handle drop on ALL folders (static + dynamic)
        document.querySelectorAll('.folder-chip').forEach(folder => {
            // Skip if already has drag handlers (check with data attribute)
            if (folder.dataset.dragAttached) return;
            folder.dataset.dragAttached = 'true';

            wireDropTarget(folder, folderAcceptsDrop);

            folder.addEventListener('drop', async (e) => {
                e.preventDefault();
                endRowDrag();

                const deviceId = e.dataTransfer.getData('text/plain');
                if (!deviceId) return;
                
                const targetFolder = folder.dataset.folder;
                let folderId = null;
                
                if (targetFolder === 'all') {
                    return; // Can't drop on "all"
                } else if (targetFolder === 'unassigned') {
                    folderId = null;
                } else {
                    folderId = Number(targetFolder);
                    if (!Number.isFinite(folderId)) return;
                }
                
                try {
                    await Utils.api(`/api/devices/${deviceId}/folder`, {
                        method: 'PATCH',
                        body: { folderId }
                    });
                    
                    Notifications.success(_('folders.device_assigned'));
                    loadDevices();
                    loadFolders();
                } catch (error) {
                    console.error('Folder assignment failed:', error);
                    Notifications.error(error.message || _('errors.server_error'));
                }
            });
        });
    }

    async function setDeviceManualGroups(deviceId, groupGuids) {
        await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/groups`, {
            method: 'PUT',
            body: { groupGuids }
        });
    }

    async function getDeviceManualGroupGuids(deviceId) {
        const device = devices.find(item => item.id === deviceId);
        if (device && Array.isArray(device.groups)) {
            return device.groups
                .filter(group => (group.source_type || 'manual') !== 'tag')
                .map(group => group.guid)
                .filter(Boolean);
        }
        const response = await Utils.api(`/api/devices/${encodeURIComponent(deviceId)}/groups`);
        return (response.memberships || [])
            .filter(group => (group.source_type || 'manual') !== 'tag')
            .map(group => group.guid)
            .filter(Boolean);
    }

    /**
     * Attach drag events to group chips (called after renderDeviceGroups).
     */
    function attachGroupDropEvents() {
        document.querySelectorAll('.group-chip[data-group]').forEach(chip => {
            if (chip.dataset.groupDropAttached) return;
            chip.dataset.groupDropAttached = 'true';

            wireDropTarget(chip, groupAcceptsDrop);

            chip.addEventListener('drop', async (e) => {
                e.preventDefault();
                endRowDrag();

                const deviceId = e.dataTransfer.getData('text/plain');
                if (!deviceId) return;

                const targetGroup = chip.dataset.group;
                try {
                    if (targetGroup === 'all') {
                        if (currentGroup === 'all') return;
                        const manualGuids = await getDeviceManualGroupGuids(deviceId);
                        const nextGuids = manualGuids.filter(guid => guid !== currentGroup);
                        if (nextGuids.length === manualGuids.length) return;
                        await setDeviceManualGroups(deviceId, nextGuids);
                        Notifications.success(_('devices.group_membership_removed') || 'Removed from group');
                    } else {
                        const group = deviceGroups.find(item => item.guid === targetGroup);
                        if (!group || (group.source_type || 'manual') === 'tag') return;
                        const manualGuids = await getDeviceManualGroupGuids(deviceId);
                        if (manualGuids.includes(targetGroup) && manualGuids.length === 1) return;
                        // One manual group per device — replace previous membership.
                        await setDeviceManualGroups(deviceId, [targetGroup]);
                        Notifications.success(_('devices.group_membership_added') || 'Added to group');
                    }
                    loadDevices();
                    loadDeviceGroups();
                } catch (error) {
                    console.error('Group assignment failed:', error);
                    Notifications.error(error.message || _('errors.server_error'));
                }
            });
        });
    }
    
})();
