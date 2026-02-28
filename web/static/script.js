// BetterDesk Console v1.5.0 - Enhanced UI with Sidebar Navigation
// Global variables
let allDevices = [];
let currentDeviceId = null;
let authToken = null;
let userRole = null;
let username = null;
let publicKeyCache = null;
let refreshIntervalId = null;

// Initialize on page load
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication
    if (!checkAuth()) return;
    
    // Setup user info in sidebar
    setupUserInfo();
    
    // Setup sidebar navigation
    setupSidebar();
    
    // Load initial data
    loadDevices();
    loadStats();
    
    // Load server config first, then start auto-refresh with configured interval
    loadServerConfigAndStartRefresh();
});

// Load server config and start auto-refresh with configured interval
async function loadServerConfigAndStartRefresh() {
    try {
        const response = await fetch('/api/server/config', {
            headers: getAuthHeaders()
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.config) {
                serverConfig = data.config;
                console.log('Server config loaded:', serverConfig);
            }
        }
    } catch (error) {
        console.warn('Could not load server config, using defaults');
    }
    
    // Start auto-refresh with configured interval (default 5 seconds, min 3 seconds)
    const refreshInterval = Math.max(3, serverConfig.heartbeat_interval_secs || 5) * 1000;
    console.log('Starting auto-refresh every', refreshInterval, 'ms');
    
    // Clear any existing interval
    if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
    }
    
    refreshIntervalId = setInterval(() => {
        const dashboardSection = document.getElementById('dashboard');
        if (dashboardSection && dashboardSection.classList.contains('active')) {
            loadDevices();
            loadStats();
        }
    }, refreshInterval);
}

// Authentication check
function checkAuth() {
    authToken = localStorage.getItem('authToken');
    userRole = localStorage.getItem('role');
    username = localStorage.getItem('username');
    
    if (!authToken) {
        window.location.href = '/login';
        return false;
    }
    
    return true;
}

// Setup user info in sidebar
function setupUserInfo() {
    document.getElementById('sidebarUsername').textContent = username || 'User';
    document.getElementById('sidebarRole').textContent = userRole || 'viewer';
    
    // Show admin-only sections
    if (userRole === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = '';
        });
    }
}

// Setup sidebar navigation
function setupSidebar() {
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', function(e) {
            // Skip if this is a link (like Client Generator)
            if (this.hasAttribute('href') && this.getAttribute('href') !== '#') {
                return; // Allow normal navigation
            }
            
            e.preventDefault();
            const sectionId = this.dataset.section;
            
            // Skip if no section ID (e.g., for external links)
            if (!sectionId) {
                return;
            }
            
            // Update active states
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            // Show selected section
            const targetSection = document.getElementById(sectionId);
            if (targetSection) {
                document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
                targetSection.classList.add('active');
                
                // Load section-specific data
                if (sectionId === 'users' && userRole === 'admin') {
                    loadUsers();
                }
                if (sectionId === 'settings' && userRole === 'admin') {
                    loadServerSettings();
                }
            }
        });
    });
}

// Get auth headers for API calls
function getAuthHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
    };
}

// Handle authentication errors
function handleAuthError(error, response) {
    if (response && response.status === 401) {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        window.location.href = '/login';
        return true;
    }
    return false;
}

// Logout function
async function logout() {
    try {
        await fetch('/api/auth/logout', {
            method: 'POST',
            headers: getAuthHeaders()
        });
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        localStorage.removeItem('authToken');
        localStorage.removeItem('username');
        localStorage.removeItem('role');
        window.location.href = '/login';
    }
}

// ============================================================================
// DASHBOARD - DEVICE MANAGEMENT
// ============================================================================

// Load devices from API
async function loadDevices() {
    if (!checkAuth()) return;
    
    try {
        const response = await fetch('/api/devices', {
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const data = await response.json();
        
        if (data.success) {
            allDevices = data.devices;
            renderDevices(allDevices);
            updateNavStats(allDevices);
        } else {
            showToast('Error loading devices: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to load devices', 'error');
    }
}

// Load statistics
async function loadStats() {
    if (!checkAuth()) return;
    
    try {
        const response = await fetch('/api/stats', {
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('statTotal').textContent = data.stats.total;
            document.getElementById('statActive').textContent = data.stats.active;
            document.getElementById('statInactive').textContent = data.stats.inactive;
            document.getElementById('statBanned').textContent = data.stats.banned || 0;
            document.getElementById('statNotes').textContent = data.stats.with_notes;
        }
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Update navigation stats
function updateNavStats(devices) {
    const total = devices.length;
    const active = devices.filter(d => d.online).length;
    
    const totalDevicesEl = document.querySelector('#totalDevices span');
    const activeDevicesEl = document.querySelector('#activeDevices span');
    
    if (totalDevicesEl) totalDevicesEl.textContent = total;
    if (activeDevicesEl) activeDevicesEl.textContent = active;
}

// Render devices table
function renderDevices(devices) {
    const tbody = document.getElementById('devicesTableBody');
    
    if (devices.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="loading">
                    <i class="fas fa-inbox"></i>
                    <span>No devices found</span>
                </td>
            </tr>
        `;
        return;
    }
    
    tbody.innerHTML = devices.map(device => {
        const isBanned = device.is_banned === true || device.is_banned === 1;
        const rowClass = isBanned ? 'style="opacity: 0.6; background: rgba(255, 0, 0, 0.05);"' : '';
        
        const canEdit = userRole === 'admin' || userRole === 'operator';
        const canBan = userRole === 'admin' || userRole === 'operator';
        
        // Handle detailed status (online/degraded/critical/offline)
        const statusDetail = device.status_detail || (device.online ? 'online' : 'offline');
        let statusClass = 'status-inactive';
        let statusIcon = 'fa-circle';
        let statusText = 'Offline';
        
        switch (statusDetail) {
            case 'online':
                statusClass = 'status-active';
                statusIcon = 'fa-circle';
                statusText = 'Online';
                break;
            case 'degraded':
                statusClass = 'status-warning';
                statusIcon = 'fa-exclamation-circle';
                statusText = 'Degraded';
                break;
            case 'critical':
                statusClass = 'status-critical';
                statusIcon = 'fa-exclamation-triangle';
                statusText = 'Critical';
                break;
            default:
                statusClass = 'status-inactive';
                statusIcon = 'fa-circle';
                statusText = 'Offline';
        }
        
        return `
        <tr ${rowClass}>
            <td>
                <strong>${escapeHtml(device.id)}</strong>
                ${isBanned ? '<br><span class="status-badge" style="background: #e74c3c; font-size: 0.75rem; margin-top: 4px;"><i class="fas fa-ban"></i> BANNED</span>' : ''}
            </td>
            <td>${escapeHtml(device.note || device.hostname || '') || '<span style="color: var(--text-secondary);">No alias/hostname</span>'}</td>
            <td>
                <span class="status-badge ${statusClass}">
                    <i class="fas ${statusIcon}"></i>
                    ${statusText}
                </span>
            </td>
            <td>${formatDate(device.created_at)}</td>
            <td>
                <button class="action-btn connect" onclick="connectDevice('${escapeHtml(device.id)}')" title="Connect" ${isBanned ? 'disabled style="opacity: 0.3; cursor: not-allowed;"' : ''}>
                    <i class="fas fa-plug"></i>
                </button>
                <button class="action-btn details" onclick="showDetails('${escapeHtml(device.id)}')" title="Details">
                    <i class="fas fa-info-circle"></i>
                </button>
                ${canEdit ? `
                <button class="action-btn edit" onclick="editDevice('${escapeHtml(device.id)}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                ` : ''}
                ${canBan ? (isBanned ? 
                    `<button class="action-btn" onclick="unbanDevice('${escapeHtml(device.id)}')" title="Unban" style="background: #27ae60;">
                        <i class="fas fa-check-circle"></i>
                    </button>` :
                    `<button class="action-btn" onclick="banDevice('${escapeHtml(device.id)}')" title="Ban" style="background: #e74c3c;">
                        <i class="fas fa-ban"></i>
                    </button>`
                ) : ''}
                ${canEdit ? `
                <button class="action-btn delete" onclick="deleteDevice('${escapeHtml(device.id)}')" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
                ` : ''}
            </td>
        </tr>
    `}).join('');
}

// Filter devices by search
function filterDevices() {
    const searchTerm = document.getElementById('searchInput').value.toLowerCase();
    
    if (!searchTerm) {
        renderDevices(allDevices);
        return;
    }
    
    const filtered = allDevices.filter(device => 
        device.id.toLowerCase().includes(searchTerm) ||
        (device.note && device.note.toLowerCase().includes(searchTerm)) ||
        (device.hostname && device.hostname.toLowerCase().includes(searchTerm))
    );
    
    renderDevices(filtered);
}

// Get custom URL scheme for RustDesk connections
// Users with personalized clients can set this via Settings or localStorage
function getCustomScheme() {
    // Priority: localStorage > default
    return localStorage.getItem('rustdeskScheme') || 'rustdesk';
}

// Set custom URL scheme (call from Settings page or browser console)
// Example: setCustomScheme('mycompany-rustdesk')
function setCustomScheme(scheme) {
    if (!scheme || typeof scheme !== 'string') {
        console.error('Invalid scheme. Must be a non-empty string.');
        return false;
    }
    // Remove :// if user included it
    scheme = scheme.replace('://', '').trim();
    localStorage.setItem('rustdeskScheme', scheme);
    showToast(`Custom scheme set to: ${scheme}://`);
    return true;
}

// Clear custom scheme (revert to default rustdesk://)
function clearCustomScheme() {
    localStorage.removeItem('rustdeskScheme');
    showToast('Reverted to default rustdesk:// scheme');
}

// Connect to device using configured URL scheme
function connectDevice(deviceId) {
    const scheme = getCustomScheme();
    window.location.href = `${scheme}://${deviceId}`;
    showToast(`Connecting to ${deviceId}...`);
}

// Show device details
function showDetails(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) return;
    
    const isBanned = device.is_banned === true || device.is_banned === 1;
    
    const detailsContent = document.getElementById('detailsContent');
    detailsContent.innerHTML = `
        <div class="detail-item">
            <div class="detail-label">ID:</div>
            <div class="detail-value">${escapeHtml(device.id)}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">GUID:</div>
            <div class="detail-value">${escapeHtml(device.guid) || 'N/A'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">UUID:</div>
            <div class="detail-value">${escapeHtml(device.uuid) || 'N/A'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Status:</div>
            <div class="detail-value">
                <span class="status-badge ${device.status_detail === 'online' || device.status_detail === 'degraded' || device.status_detail === 'critical' ? 
                    (device.status_detail === 'degraded' ? 'status-warning' : 
                     device.status_detail === 'critical' ? 'status-critical' : 'status-active') : 'status-inactive'}">
                    <i class="fas ${device.status_detail === 'degraded' ? 'fa-exclamation-circle' : 
                                    device.status_detail === 'critical' ? 'fa-exclamation-triangle' : 'fa-circle'}"></i>
                    ${device.status_detail === 'degraded' ? 'Degraded' :
                      device.status_detail === 'critical' ? 'Critical' :
                      device.online ? 'Online' : 'Offline'}
                </span>
            </div>
        </div>
        ${isBanned ? `
        <div class="detail-item" style="background: rgba(231, 76, 60, 0.1); padding: 12px; border-radius: 8px; margin: 12px 0;">
            <div class="detail-label" style="color: #e74c3c; font-weight: bold;"><i class="fas fa-ban"></i> BAN STATUS:</div>
            <div class="detail-value" style="color: #e74c3c; font-weight: bold;">BANNED</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Banned At:</div>
            <div class="detail-value">${device.banned_at ? formatDate(device.banned_at) : 'N/A'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Banned By:</div>
            <div class="detail-value">${escapeHtml(device.banned_by) || 'N/A'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Ban Reason:</div>
            <div class="detail-value">${escapeHtml(device.ban_reason) || 'No reason provided'}</div>
        </div>
        ` : ''}
        <div class="detail-item">
            <div class="detail-label">Note/Hostname:</div>
            <div class="detail-value">${escapeHtml(device.note || device.hostname) || 'No note/hostname'}</div>
        </div>
        <div class="detail-item">
            <div class="detail-label">Created:</div>
            <div class="detail-value">${formatDate(device.created_at)}</div>
        </div>
    `;
    
    openModal('detailsModal');
}

// Edit device
function editDevice(deviceId) {
    const device = allDevices.find(d => d.id === deviceId);
    if (!device) return;
    
    currentDeviceId = deviceId;
    document.getElementById('editDeviceId').value = deviceId;
    document.getElementById('editNewId').value = '';
    document.getElementById('editNote').value = device.note || '';
    
    // Show ID history if available
    const historyGroup = document.getElementById('idHistoryGroup');
    const historyList = document.getElementById('idHistoryList');
    
    if (device.previous_ids && device.previous_ids.length > 0) {
        historyGroup.style.display = 'block';
        historyList.innerHTML = device.previous_ids.map(id => 
            `<span class="id-history-item">${escapeHtml(id)}</span>`
        ).join(' → ');
        if (device.id_changed_at) {
            historyList.innerHTML += `<br><small class="text-muted">Last changed: ${device.id_changed_at}</small>`;
        }
    } else {
        historyGroup.style.display = 'none';
        historyList.innerHTML = '';
    }
    
    openModal('editModal');
}

// Save device changes
async function saveDevice() {
    if (!checkAuth()) return;
    
    const newId = document.getElementById('editNewId').value.trim();
    const note = document.getElementById('editNote').value.trim();
    
    if (note.length > 500) {
        showToast('Note is too long (max 500 characters)', 'error');
        return;
    }
    
    const data = { note };
    if (newId) data.new_id = newId;
    
    try {
        const response = await fetch(`/api/device/${currentDeviceId}`, {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify(data)
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Device updated successfully');
            closeEditModal();
            await loadDevices();
            await loadStats();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to update device', 'error');
    }
}

// Delete device
function deleteDevice(deviceId) {
    if (!checkAuth()) return;
    
    if (!confirm(`⚠️ Are you sure you want to permanently delete device ${deviceId}?`)) {
        return;
    }

    // Call the delete API endpoint
    fetch(`/api/device/${deviceId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    }).then(response => {
        if (handleAuthError(null, response)) return;
        return response.json();
    }).then(result => {
        if (result && result.success) {
            showToast('Device deleted successfully');
            loadDevices();
            loadStats();
        } else {
            showToast('Error: ' + (result?.error || 'Unknown error'), 'error');
        }
    }).catch(error => {
        console.error('Error:', error);
        showToast('Failed to delete device', 'error');
    });
}

// Confirm delete - (No longer used as we trigger confirm natively above, but kept for legacy UI compatibility)
async function confirmDelete() {
    if (!checkAuth() || !currentDeviceId) return;
    
    try {
        const response = await fetch(`/api/device/${currentDeviceId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Device deleted successfully');
            closeDeleteModal();
            await loadDevices();
            await loadStats();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to delete device', 'error');
    }
}

// Ban device
async function banDevice(deviceId) {
    if (!checkAuth()) return;
    
    const reason = prompt(`⚠️ BAN DEVICE: ${deviceId}\n\nEnter ban reason (optional):`);
    if (reason === null) return;
    
    try {
        const response = await fetch(`/api/device/${deviceId}/ban`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                reason: reason || '',
                banned_by: username
            })
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`Device ${deviceId} banned successfully`);
            await loadDevices();
            await loadStats();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to ban device', 'error');
    }
}

// Unban device
async function unbanDevice(deviceId) {
    if (!checkAuth()) return;
    
    if (!confirm(`✓ UNBAN DEVICE: ${deviceId}\n\nAre you sure?`)) return;
    
    try {
        const response = await fetch(`/api/device/${deviceId}/unban`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`Device ${deviceId} unbanned successfully`);
            await loadDevices();
            await loadStats();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to unban device', 'error');
    }
}

// Refresh devices manually
async function refreshDevices() {
    showToast('Refreshing devices...');
    await loadDevices();
    await loadStats();
}

// ============================================================================
// PUBLIC KEY SECTION
// ============================================================================

async function verifyPasswordForKey() {
    const password = document.getElementById('keyPassword').value;
    
    if (!password) {
        showToast('Please enter your password', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/verify-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ password: password })
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            // Password correct, fetch public key
            const keyResponse = await fetch('/api/public-key', {
                headers: getAuthHeaders()
            });
            
            if (handleAuthError(null, keyResponse)) return;
            
            const keyData = await keyResponse.json();
            
            if (keyData.success) {
                publicKeyCache = keyData.key;
                document.getElementById('publicKeyDisplay').textContent = keyData.key;
                document.getElementById('keyPasswordPrompt').style.display = 'none';
                document.getElementById('keyContent').style.display = 'block';
                document.getElementById('keyPassword').value = '';
                showToast('Public key revealed');
            } else {
                showToast('Error loading key: ' + keyData.error, 'error');
            }
        } else {
            showToast('Incorrect password', 'error');
            document.getElementById('keyPassword').value = '';
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to verify password', 'error');
    }
}

function copyPublicKey() {
    const keyText = document.getElementById('publicKeyDisplay').textContent;
    navigator.clipboard.writeText(keyText).then(() => {
        showToast('Public key copied to clipboard');
    }).catch(err => {
        showToast('Failed to copy', 'error');
    });
}

function lockKey() {
    publicKeyCache = null;
    document.getElementById('keyPasswordPrompt').style.display = 'block';
    document.getElementById('keyContent').style.display = 'none';
    document.getElementById('keyPassword').value = '';
}

// ============================================================================
// SETTINGS - PASSWORD CHANGE
// ============================================================================

async function changePassword(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (newPassword !== confirmPassword) {
        showToast('New passwords do not match', 'error');
        return;
    }
    
    if (newPassword.length < 8) {
        showToast('Password must be at least 8 characters', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({
                old_password: currentPassword,
                new_password: newPassword
            })
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast('Password changed successfully');
            document.getElementById('passwordForm').reset();
            // New token issued, update local storage
            if (result.token) {
                authToken = result.token;
                localStorage.setItem('authToken', result.token);
            }
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to change password', 'error');
    }
}

// ============================================================================
// USER MANAGEMENT (ADMIN ONLY)
// ============================================================================

async function loadUsers() {
    if (!checkAuth()) return;
    if (userRole !== 'admin') return;
    
    try {
        const response = await fetch('/api/users', {
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const data = await response.json();
        
        if (data.success) {
            renderUsers(data.users);
        } else {
            showToast('Error loading users: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to load users', 'error');
    }
}

function renderUsers(users) {
    const tbody = document.getElementById('usersTableBody');
    
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading">No users found</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const statusClass = user.is_active ? 'status-active' : 'status-inactive';
        const statusText = user.is_active ? 'Active' : 'Inactive';
        
        let roleClass = 'role-viewer';
        if (user.role === 'admin') roleClass = 'role-admin';
        else if (user.role === 'operator') roleClass = 'role-operator';
        
        const lastLogin = user.last_login ? formatDate(user.last_login) : 'Never';
        
        return `
            <tr>
                <td><strong>${escapeHtml(user.username)}</strong></td>
                <td><span class="role-badge ${roleClass}">${user.role}</span></td>
                <td>${lastLogin}</td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>
                    <button class="action-btn edit" onclick="showEditUserModal(${user.id}, '${escapeHtml(user.username)}', '${user.role}', ${user.is_active})" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="action-btn delete" onclick="showDeleteUserModal(${user.id}, '${escapeHtml(user.username)}')" title="Delete">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

// Add User Modal
function showAddUserModal() {
    openModal('addUserModal');
}

function closeAddUserModal() {
    closeModal('addUserModal');
    document.getElementById('newUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('newUserRole').value = 'viewer';
}

async function createUser() {
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    
    if (!username || !password) {
        showToast('Username and password are required', 'error');
        return;
    }
    
    if (password.length < 8) {
        showToast('Password must be at least 8 characters', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/users', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ username, password, role })
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`User ${username} created successfully`);
            closeAddUserModal();
            loadUsers();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to create user', 'error');
    }
}

// Edit/Delete User (placeholders - to be implemented with proper modals)
function showEditUserModal(userId, username, role, isActive) {
    showToast('Edit user functionality - coming soon');
}

function showDeleteUserModal(userId, username) {
    if (!confirm(`⚠️ DELETE USER: ${username}\n\nAre you sure?`)) return;
    deleteUser(userId);
}

async function deleteUser(userId) {
    try {
        const response = await fetch(`/api/users/${userId}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const result = await response.json();
        
        if (result.success) {
            showToast('User deleted successfully');
            loadUsers();
        } else {
            showToast('Error: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error:', error);
        showToast('Failed to delete user', 'error');
    }
}

// ============================================================================
// MODAL FUNCTIONS
// ============================================================================

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function closeEditModal() {
    closeModal('editModal');
    currentDeviceId = null;
}

function closeDeleteModal() {
    closeModal('deleteModal');
    currentDeviceId = null;
}

function closeDetailsModal() {
    closeModal('detailsModal');
}

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('active');
    }
}

// ============================================================================
// SERVER SETTINGS (ADMIN ONLY)
// ============================================================================

// Global server config cache
let serverConfig = {
    peer_timeout_secs: 60,
    heartbeat_interval_secs: 5,
    warning_threshold: 2,
    critical_threshold: 4
};

async function loadServerSettings() {
    if (!checkAuth()) return;
    if (userRole !== 'admin') return;
    
    try {
        const response = await fetch('/api/server/config', {
            headers: getAuthHeaders()
        });
        
        if (handleAuthError(null, response)) return;
        
        const data = await response.json();
        
        if (data.success && data.config) {
            serverConfig = data.config;
            
            // Update form fields
            document.getElementById('peerTimeoutSecs').value = serverConfig.peer_timeout_secs || 60;
            document.getElementById('heartbeatIntervalSecs').value = serverConfig.heartbeat_interval_secs || 5;
            document.getElementById('warningThreshold').value = serverConfig.warning_threshold || 2;
            document.getElementById('criticalThreshold').value = serverConfig.critical_threshold || 4;
            
            console.log('Server settings loaded:', serverConfig);
        }
    } catch (error) {
        console.error('Error loading server settings:', error);
    }
}

async function saveServerSettings(event) {
    event.preventDefault();
    
    if (!checkAuth()) return;
    if (userRole !== 'admin') {
        showToast('Only admins can change server settings', 'error');
        return;
    }
    
    const newConfig = {
        peer_timeout_secs: parseInt(document.getElementById('peerTimeoutSecs').value) || 60,
        heartbeat_interval_secs: parseInt(document.getElementById('heartbeatIntervalSecs').value) || 5,
        warning_threshold: parseInt(document.getElementById('warningThreshold').value) || 2,
        critical_threshold: parseInt(document.getElementById('criticalThreshold').value) || 4
    };
    
    // Validation
    if (newConfig.peer_timeout_secs < 10 || newConfig.peer_timeout_secs > 300) {
        showToast('Peer timeout must be between 10 and 300 seconds', 'error');
        return;
    }
    if (newConfig.heartbeat_interval_secs < 1 || newConfig.heartbeat_interval_secs > 30) {
        showToast('Heartbeat interval must be between 1 and 30 seconds', 'error');
        return;
    }
    if (newConfig.critical_threshold <= newConfig.warning_threshold) {
        showToast('Critical threshold must be greater than warning threshold', 'error');
        return;
    }
    
    try {
        const response = await fetch('/api/server/config', {
            method: 'POST',
            headers: {
                ...getAuthHeaders(),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newConfig)
        });
        
        if (handleAuthError(null, response)) return;
        
        const data = await response.json();
        
        if (data.success) {
            serverConfig = newConfig;
            showToast('Server settings saved successfully');
        } else {
            showToast('Error: ' + (data.error || 'Failed to save settings'), 'error');
        }
    } catch (error) {
        console.error('Error saving server settings:', error);
        showToast('Failed to save server settings', 'error');
    }
}

// Get peer timeout for online status calculation (in milliseconds)
function getPeerTimeoutMs() {
    return (serverConfig.peer_timeout_secs || 60) * 1000;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    const icon = toast.querySelector('i');
    
    if (type === 'error') {
        icon.className = 'fas fa-exclamation-circle';
        icon.style.color = 'var(--danger-color)';
    } else {
        icon.className = 'fas fa-check-circle';
        icon.style.color = 'var(--success-color)';
    }
    
    document.getElementById('toastMessage').textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const options = { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return date.toLocaleDateString('en-US', options);
}
