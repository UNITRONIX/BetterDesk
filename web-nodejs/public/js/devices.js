/**
 * BetterDesk Console - Devices Page
 */

(function() {
    'use strict';
    
    document.addEventListener('DOMContentLoaded', init);
    
    // State
    let devices = [];
    let filteredDevices = [];
    let folders = [];
    let selectedIds = new Set();
    let currentFilter = 'all';
    let currentFolder = 'all';
    let currentSort = { field: 'last_online', order: 'desc' };
    let currentPage = 1;
    let perPage = 20;
    let searchQuery = '';
    let draggedDeviceId = null;
    
    // Elements
    let tableBody, pagination, emptyState, bulkActions, selectedCountEl;
    
    function init() {
        // Cache elements
        tableBody = document.getElementById('devices-tbody');
        pagination = document.getElementById('pagination');
        emptyState = document.getElementById('devices-empty');
        bulkActions = document.getElementById('bulk-actions');
        selectedCountEl = document.getElementById('selected-count');
        
        // Load data
        loadFolders();
        loadDevices();
        
        // Event listeners
        initSearch();
        initFilters();
        initSorting();
        initSync();
        initFolders();
        initDragDrop();
        attachFolderDropEvents();  // For static folders
        initColumnVisibility();    // Column show/hide toggle
        
        // Refresh handler
        window.addEventListener('app:refresh', () => {
            loadFolders();
            loadDevices();
        });
    }
    
    /**
     * Load devices from API
     */
    async function loadDevices() {
        try {
            const response = await Utils.api('/api/devices');
            devices = response.devices || [];
            
            // Update count
            document.getElementById('devices-count').textContent = devices.length;
            
            applyFilters();
            
        } catch (error) {
            console.error('Failed to load devices:', error);
            Notifications.error(_('errors.load_devices_failed'));
        }
    }
    
    /**
     * Apply current filters and render
     */
    function applyFilters() {
        filteredDevices = devices.filter(device => {
            // Folder filter
            if (currentFolder === 'unassigned' && device.folder_id !== null) return false;
            if (currentFolder !== 'all' && currentFolder !== 'unassigned') {
                if (device.folder_id !== parseInt(currentFolder, 10)) return false;
            }
            
            // Status filter
            if (currentFilter === 'online' && !device.online) return false;
            if (currentFilter === 'offline' && (device.online || device.banned)) return false;
            if (currentFilter === 'banned' && !device.banned) return false;
            
            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const match = 
                    device.id?.toLowerCase().includes(q) ||
                    device.hostname?.toLowerCase().includes(q) ||
                    device.username?.toLowerCase().includes(q) ||
                    device.note?.toLowerCase().includes(q) ||
                    device.platform?.toLowerCase().includes(q);
                if (!match) return false;
            }
            
            return true;
        });
        
        // Sort
        sortDevices();
        
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

        const userRole = window.BetterDesk?.user?.role || 'viewer';
        const isManager = userRole === 'admin' || userRole === 'operator';
        
        tableBody.innerHTML = pageDevices.map(device => {
            
            let actionsHtml = `
                <button class="action-btn connect" title="${_('actions.connect')}" data-action="connect" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">link</span>
                </button>
                <button class="action-btn connect-desktop" title="${_('actions.connect_desktop')}" data-action="connect-desktop" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">computer</span>
                </button>
                <button class="action-btn info" title="${_('actions.details')}" data-action="details" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">info</span>
                </button>
            `;

            if (isManager) {
                actionsHtml += `
                <button class="action-btn" title="${_('actions.edit')}" data-action="edit" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">edit</span>
                </button>
                <button class="action-btn" title="${_('devices.change_id')}" data-action="change-id" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">badge</span>
                </button>
                <button class="action-btn ${device.banned ? 'unban' : 'ban'}" title="${device.banned ? _('actions.unban') : _('actions.ban')}" 
                    data-action="toggle-ban" data-id="${Utils.escapeHtml(device.id)}" data-banned="${device.banned}">
                    <span class="material-icons">${device.banned ? 'check_circle' : 'block'}</span>
                </button>
                <button class="action-btn danger" title="${_('actions.delete')}" data-action="delete" data-id="${Utils.escapeHtml(device.id)}">
                    <span class="material-icons">delete</span>
                </button>
                `;
            }

            return `
            <tr data-id="${Utils.escapeHtml(device.id)}" class="${device.banned ? 'banned-row' : ''}" draggable="true">
                <td class="drag-handle-cell">
                    <span class="drag-handle material-icons">drag_indicator</span>
                </td>
                <td data-column="id">
                    <div class="device-id">
                        <span class="device-id-text">${Utils.escapeHtml(device.id)}</span>
                        <button class="btn-icon-sm copy-btn" title="${_('actions.copy')}" data-copy="${Utils.escapeHtml(device.id)}">
                            <span class="material-icons">content_copy</span>
                        </button>
                    </div>
                </td>
                <td data-column="hostname">${Utils.escapeHtml(device.note || device.hostname || '-')}</td>
                <td data-column="platform">
                    <div class="platform-icon">
                        <span class="material-icons">${Utils.getPlatformIcon(device.platform)}</span>
                        <span>${Utils.escapeHtml(device.platform || '-')}</span>
                    </div>
                </td>
                <td data-column="last_online">
                    <div class="last-seen">
                        <div class="last-seen-time">${Utils.formatDate(device.last_online)}</div>
                        <div class="last-seen-ago">${Utils.formatRelativeTime(device.last_online)}</div>
                    </div>
                </td>
                <td data-column="status">
                    ${device.banned 
                        ? `<span class="status-badge banned"><span class="status-dot"></span>${_('status.banned')}</span>`
                        : device.online 
                            ? `<span class="status-badge online"><span class="status-dot"></span>${_('status.online')}</span>`
                            : `<span class="status-badge offline"><span class="status-dot"></span>${_('status.offline')}</span>`
                    }
                </td>
                <td data-column="actions">
                    <div class="device-actions">
                        ${actionsHtml}
                    </div>
                </td>
            </tr>
        `}).join('');
        
        // Re-apply column visibility to newly rendered rows
        applyColumnVisibility();
        
        // Attach event listeners
        attachRowEventListeners();
    }
    
    /**
     * Attach event listeners to table rows
     */
    function attachRowEventListeners() {
        // Copy ID
        tableBody.querySelectorAll('.device-id-copy').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.copy;
                await Utils.copyToClipboard(id);
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 2000);
                Notifications.success(_('common.copied'));
            });
        });
        
        // Checkboxes
        tableBody.querySelectorAll('.device-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
                const id = cb.dataset.id;
                if (cb.checked) {
                    selectedIds.add(id);
                } else {
                    selectedIds.delete(id);
                }
                updateSelectionUI();
            });
        });
        
        // Action buttons
        tableBody.querySelectorAll('.action-btn').forEach(btn => {
            btn.addEventListener('click', () => handleAction(btn.dataset.action, btn.dataset.id, btn.dataset));
        });
    }
    
    /**
     * Handle device actions
     */
    async function handleAction(action, deviceId, data) {
        switch (action) {
            case 'connect':
                connectToDevice(deviceId);
                break;
                
            case 'connect-desktop':
                connectDesktopClient(deviceId);
                break;
                
            case 'details':
                showDeviceDetails(deviceId);
                break;
                
            case 'edit':
                showEditModal(deviceId);
                break;
                
            case 'toggle-ban':
                await toggleBan(deviceId, data.banned === 'true');
                break;
                
            case 'change-id':
                await changeDeviceId(deviceId);
                break;
                
            case 'delete':
                await deleteDevice(deviceId);
                break;
        }
    }
    
    /**
     * Connect to device via web remote client
     */
    function connectToDevice(deviceId) {
        window.location.href = '/remote/' + encodeURIComponent(deviceId);
    }

    /**
     * Connect to device via RustDesk desktop client (rustdesk:// protocol)
     */
    function connectDesktopClient(deviceId) {
        window.open('rustdesk://' + encodeURIComponent(deviceId), '_blank');
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
                        <span class="detail-value">${Utils.escapeHtml(device.hostname || device.note || '-')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.platform')}:</span>
                        <span class="detail-value">${Utils.escapeHtml(device.platform || '-')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('status.label')}:</span>
                        <span class="detail-value">${device.banned ? _('status.banned') : device.online ? _('status.online') : _('status.offline')}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">${_('devices.last_online')}:</span>
                        <span class="detail-value">${Utils.formatDate(device.last_online)}</span>
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
     * Toggle device ban status
     */
    async function toggleBan(deviceId, currentlyBanned) {
        const action = currentlyBanned ? 'unban' : 'ban';
        const confirmed = await Modal.confirm({
            title: _(`devices.${action}_title`),
            message: _(`devices.${action}_confirm`, { id: deviceId }),
            confirmLabel: _(currentlyBanned ? 'actions.unban' : 'actions.ban'),
            danger: !currentlyBanned
        });
        
        if (!confirmed) return;
        
        try {
            await Utils.api(`/api/devices/${deviceId}/${action}`, { method: 'POST' });
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
                body: { newId: newId.toUpperCase() }
            });
            Notifications.success(_('devices.change_id_success'));
            loadDevices();
        } catch (error) {
            Notifications.error(error.message || _('errors.change_id_failed'));
        }
    }
    
    /**
     * Delete device using standard Modal.confirm
     */
    async function deleteDevice(deviceId) {
        const confirmed = await Modal.confirm({
            title: _('devices.delete_title'),
            message: _('devices.delete_warning') + ' ' + deviceId + '\n\n' + _('devices.delete_permanent'),
            confirmLabel: _('actions.delete'),
            confirmIcon: 'delete',
            danger: true
        });
        
        if (!confirmed) return false;
        
        try {
            await Utils.api(`/api/devices/${deviceId}`, { method: 'DELETE' });
            Notifications.success(_('devices.delete_success'));
            loadDevices();
            return true;
        } catch (error) {
            Notifications.error(error.message || _('errors.delete_failed'));
            return false;
        }
    }
    
    /**
     * Show edit modal allowing user to change Note/Hostname alias
     */
    function showEditModal(deviceId) {
        const device = devices.find(d => d.id === deviceId);
        if (!device) return;
        
        const content = `
            <form id="edit-device-form" class="device-edit-form">
                <div class="form-group">
                    <label class="form-label">${_('devices.id')}</label>
                    <input type="text" class="form-input" value="${Utils.escapeHtml(device.id)}" readonly disabled style="background: var(--bg-tertiary); cursor: not-allowed; opacity: 0.7;">
                </div>
                <div class="form-group">
                    <label class="form-label" for="edit-device-note">${_('devices.note')} / Alias</label>
                    <input type="text" id="edit-device-note" class="form-input" value="${Utils.escapeHtml(device.note || '')}" placeholder="Enter an alias or note...">
                    <p class="form-hint">This will be displayed as the hostname if set.</p>
                </div>
            </form>
        `;
        
        Modal.show({
            title: _('actions.edit') + ' ' + _('devices.details'),
            content: content,
            size: 'medium',
            buttons: [
                { label: _('actions.cancel'), class: 'btn-secondary', onClick: () => Modal.close() },
                { label: _('actions.save'), class: 'btn-primary', onClick: async () => {
                    const newNote = document.getElementById('edit-device-note').value;
                    try {
                        await Utils.api(`/api/devices/${deviceId}`, {
                            method: 'PATCH',
                            body: { note: newNote }
                        });
                        Notifications.success(_('common.saved'));
                        Modal.close();
                        loadDevices();
                    } catch (err) {
                        Notifications.error(err.message || _('errors.server_error'));
                    }
                }}
            ],
            onOpen: () => {
                setTimeout(() => {
                    const input = document.getElementById('edit-device-note');
                    if (input) input.focus();
                }, 100);
            }
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
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentFilter = btn.dataset.filter;
                currentPage = 1;
                applyFilters();
            });
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
    
    // ==================== Folder Functions ====================
    
    /**
     * Load folders from API
     */
    async function loadFolders() {
        try {
            const response = await Utils.api('/api/folders');
            folders = response.folders || [];
            renderFolders();
            updateFolderCounts();
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
        
        container.innerHTML = folders.map(folder => `
            <div class="folder-item ${currentFolder == folder.id ? 'active' : ''}" 
                 data-folder="${folder.id}" 
                 style="--folder-color: ${folder.color}">
                <span class="material-icons folder-icon" style="color: ${folder.color}">folder</span>
                <span class="folder-name">${Utils.escapeHtml(folder.name)}</span>
                <span class="folder-count">${folder.device_count || 0}</span>
                <div class="folder-actions">
                    <button class="btn-icon-sm folder-edit" data-id="${folder.id}" title="${_('actions.edit')}">
                        <span class="material-icons">edit</span>
                    </button>
                    <button class="btn-icon-sm folder-delete" data-id="${folder.id}" title="${_('actions.delete')}">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </div>
        `).join('');
        
        // Attach folder event listeners
        container.querySelectorAll('.folder-item').forEach(el => {
            el.addEventListener('click', (e) => {
                // In collapsed mode, always select folder (ignore edit/delete buttons)
                const sidebar = document.getElementById('folders-sidebar');
                const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
                
                if (isCollapsed || !e.target.closest('.folder-actions')) {
                    selectFolder(el.dataset.folder);
                }
            });
        });
        
        container.querySelectorAll('.folder-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Don't trigger edit in collapsed mode
                const sidebar = document.getElementById('folders-sidebar');
                if (sidebar && sidebar.classList.contains('collapsed')) return;
                
                e.stopPropagation();
                editFolder(btn.dataset.id);
            });
        });
        
        container.querySelectorAll('.folder-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                // Don't trigger delete in collapsed mode
                const sidebar = document.getElementById('folders-sidebar');
                if (sidebar && sidebar.classList.contains('collapsed')) return;
                
                e.stopPropagation();
                deleteFolder(btn.dataset.id);
            });
        });
        
        // Attach drag & drop events for all folder items
        attachFolderDropEvents();
    }
    
    /**
     * Update folder counts
     */
    function updateFolderCounts() {
        // All devices count
        const allCount = document.getElementById('folder-count-all');
        if (allCount) allCount.textContent = devices.length;
        
        // Unassigned count
        const unassignedCount = document.getElementById('folder-count-unassigned');
        if (unassignedCount) {
            const count = devices.filter(d => d.folder_id === null).length;
            unassignedCount.textContent = count;
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
        currentPage = 1;
        
        // Update active state
        document.querySelectorAll('.folder-item').forEach(el => {
            el.classList.toggle('active', el.dataset.folder == folderId);
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
        document.querySelectorAll('.folder-item[data-folder="all"], .folder-item[data-folder="unassigned"]').forEach(el => {
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
            menu.classList.toggle('show');
        });

        // Close on outside click — use contains() to handle child elements
        document.addEventListener('click', (e) => {
            if (!btn.contains(e.target) && !menu.contains(e.target)) {
                menu.classList.remove('show');
            }
        });

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
    }
    
    /**
     * Show add folder modal
     */
    function showAddFolderModal() {
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
                document.getElementById('folder-name')?.focus();
            }
        });
    }
    
    /**
     * Edit folder
     */
    async function editFolder(folderId) {
        const folder = folders.find(f => f.id === parseInt(folderId, 10));
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
        
        if (!name) {
            Notifications.error(_('folders.name_required'));
            return;
        }
        
        try {
            if (folderId) {
                await Utils.api(`/api/folders/${folderId}`, {
                    method: 'PATCH',
                    body: { name, color }
                });
                Notifications.success(_('folders.updated'));
            } else {
                await Utils.api('/api/folders', {
                    method: 'POST',
                    body: { name, color }
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
        const folder = folders.find(f => f.id === parseInt(folderId, 10));
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
    
    /**
     * Initialize drag & drop - row drag events only (called once)
     */
    function initDragDrop() {
        // Handle drag start on rows
        tableBody?.addEventListener('dragstart', (e) => {
            const row = e.target.closest('tr');
            if (!row) return;
            
            draggedDeviceId = row.dataset.id;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedDeviceId);
        });
        
        tableBody?.addEventListener('dragend', (e) => {
            const row = e.target.closest('tr');
            if (row) row.classList.remove('dragging');
            draggedDeviceId = null;
            
            // Remove drop indicators
            document.querySelectorAll('.folder-item.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
        });
    }
    
    /**
     * Attach drag events to folder items (called after renderFolders)
     */
    function attachFolderDropEvents() {
        // Handle drop on ALL folders (static + dynamic)
        document.querySelectorAll('.folder-item').forEach(folder => {
            // Skip if already has drag handlers (check with data attribute)
            if (folder.dataset.dragAttached) return;
            folder.dataset.dragAttached = 'true';
            
            folder.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                folder.classList.add('drag-over');
            });
            
            folder.addEventListener('dragleave', () => {
                folder.classList.remove('drag-over');
            });
            
            folder.addEventListener('drop', async (e) => {
                e.preventDefault();
                folder.classList.remove('drag-over');
                
                const deviceId = e.dataTransfer.getData('text/plain');
                if (!deviceId) return;
                
                const targetFolder = folder.dataset.folder;
                let folderId = null;
                
                if (targetFolder === 'all') {
                    return; // Can't drop on "all"
                } else if (targetFolder === 'unassigned') {
                    folderId = null;
                } else {
                    folderId = parseInt(targetFolder, 10);
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
                    Notifications.error(error.message || _('errors.server_error'));
                }
            });
        });
    }
    
})();
