/**
 * BetterDesk Console - BetterDesk Go Server API Client
 * Full client for the BetterDesk Go server REST API (34+ endpoints).
 * Used when serverBackend is set to 'betterdesk'.
 *
 * Auth: X-API-Key header (reads the same .api_key file as hbbs).
 * The Go server accepts X-API-Key for all authenticated endpoints.
 */

const axios = require('axios');
const http = require('http');
const https = require('https');
const fs = require('fs');
const config = require('../config/config');
const { assertSafeGoApiRelativePath, assertSafeApiId } = require('../lib/goApiPath');

// Determine whether the Go API URL uses HTTPS so we only set the appropriate
// agent. Setting httpsAgent on plain HTTP connections can trigger spurious
// EPROTO / "wrong version number" errors on some axios/Node.js versions.
const _isApiHttps = (config.betterdeskApiUrl || '').startsWith('https://');

// Axios instance for BetterDesk Go API
const apiClient = axios.create({
    baseURL: config.betterdeskApiUrl,
    timeout: config.betterdeskApiTimeout,
    headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.betterdeskApiKey
    },
    ...(_isApiHttps
        ? { httpsAgent: new https.Agent({ rejectUnauthorized: !config.allowSelfSignedCerts }) }
        : { httpAgent: new http.Agent({ keepAlive: true }) }
    ),
});

apiClient.interceptors.request.use((requestConfig) => {
    if (requestConfig.url) {
        requestConfig.url = assertSafeGoApiRelativePath(String(requestConfig.url));
    }
    return requestConfig;
});

// Retry once on 401 by reloading API key from file (handles race condition
// where Go server generated the key after Node.js cached an empty value).
let _keyReloaded = false;
let _tlsMismatchWarned = false;
apiClient.interceptors.response.use(undefined, async (error) => {
    // Detect TLS mismatch: Node.js sends HTTP but Go server expects HTTPS (issue #104)
    if (!_tlsMismatchWarned && error.response?.status === 400) {
        const body = typeof error.response.data === 'string' ? error.response.data : '';
        if (body.includes('HTTP request to an HTTPS server') || body.includes('Client sent an HTTP request')) {
            _tlsMismatchWarned = true;
            console.error('[BetterDesk API] ⚠ TLS MISMATCH: Go server has TLS_API=Y enabled on port ' +
                (config.betterdeskApiUrl || '21121') + ' but this console connects via HTTP.');
            console.error('[BetterDesk API]   Fix: remove TLS_API=Y from Go server environment or add -tls-api removal.');
            console.error('[BetterDesk API]   The API port must stay HTTP for console↔Go communication. See issue #104.');
        }
    }
    if (error.response?.status === 401 && !_keyReloaded) {
        _keyReloaded = true;
        try {
            const fresh = fs.readFileSync(config.apiKeyPath, 'utf8').trim();
            if (fresh && fresh !== config.betterdeskApiKey) {
                apiClient.defaults.headers['X-API-Key'] = fresh;
                config.betterdeskApiKey = fresh;
                console.log('API key reloaded from', config.apiKeyPath);
                // Retry the original request with new key
                error.config.headers['X-API-Key'] = fresh;
                return apiClient.request(error.config);
            }
        } catch (_) { /* file not found — nothing to reload */ }
    }
    return Promise.reject(error);
});

// ---------------------------------------------------------------------------
// Helper: normalise Go API flat responses into { success, data } shape
// that the Node.js panel expects.
// ---------------------------------------------------------------------------
function wrap(data) {
    if (data && typeof data === 'object' && 'error' in data) {
        return { success: false, error: data.error };
    }
    return { success: true, data };
}

// ========================== Health / Stats ==================================

/**
 * GET /api/health
 */
async function getHealth() {
    try {
        const { data } = await apiClient.get('/health');
        // Go server returns status:'ok'; normalise to status:'running' for panel compatibility
        return { ...data, status: 'running', backend: 'betterdesk' };
    } catch (err) {
        return { status: 'unreachable', backend: 'betterdesk', error: err.message };
    }
}

/**
 * GET /api/server/stats
 */
async function getServerStats() {
    try {
        const { data } = await apiClient.get('/server/stats');
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ========================== Peers (Devices) =================================

/**
 * GET /api/peers  — full device list
 * Returns array of peer objects already normalised.
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 */
async function getAllPeers(options = {}) {
    try {
        const params = new URLSearchParams();
        if (options.includeDeleted) params.set('include_deleted', 'true');
        const qs = params.toString();
        const url = `/peers${qs ? '?' + qs : ''}`;
        const { data } = await apiClient.get(url);
        // Go server returns flat array or { peers: [...] }
        const peers = Array.isArray(data) ? data : (data.peers || []);
        return peers.map(normalisePeer);
    } catch (err) {
        console.warn('BetterDesk API getAllPeers error:', err.message);
        return [];
    }
}

/**
 * Resolve a peer by ID, including soft-deleted rows when active lookup misses.
 */
async function getPeerIncludingDeleted(id) {
    const active = await getPeer(id);
    if (active) return active;
    const peers = await getAllPeers({ includeDeleted: true });
    return peers.find((p) => p.id === id) || null;
}

/**
 * GET /api/peers/:id
 */
async function getPeer(id) {
    try {
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}`);
        return normalisePeer(data);
    } catch (err) {
        return null;
    }
}

/**
 * DELETE /api/peers/:id
 * @param {string} id - Peer ID
 * @param {object} [options] - Optional: { revoke: bool, cascade: bool, hard: bool }
 */
async function deletePeer(id, options = {}) {
    try {
        const params = new URLSearchParams();
        if (options.revoke) params.set('revoke', 'true');
        if (options.cascade) params.set('cascade', 'true');
        if (options.hard) params.set('hard', 'true');
        const qs = params.toString();
        const url = `/peers/${encodeURIComponent(id)}${qs ? '?' + qs : ''}`;
        const { data } = await apiClient.delete(url);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/peers/:id/ban
 */
async function banPeer(id, reason = '') {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/ban`, { reason });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/peers/:id/unban
 */
async function unbanPeer(id) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/unban`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/peers/:id/connection-mode
 */
async function getConnectionMode(id) {
    try {
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}/connection-mode`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return { ...wrap(err.response.data), status: err.response.status };
        return { success: false, error: err.message, status: err.response?.status || 502 };
    }
}

/**
 * POST /api/peers/:id/connection-mode
 */
async function setConnectionMode(id, body) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/connection-mode`, body);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return { ...wrap(err.response.data), status: err.response.status };
        return { success: false, error: err.message, status: err.response?.status || 502 };
    }
}

/**
 * POST /api/peers/:id/restore — restore a soft-deleted peer
 */
async function restorePeer(id) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/restore`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/peers/:id/change-id
 */
async function changePeerId(oldId, newId) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(oldId)}/change-id`, { new_id: newId });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== Status ==========================================

/**
 * GET /api/peers/status/summary
 */
async function getStatusSummary() {
    try {
        const { data } = await apiClient.get('/peers/status/summary');
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/peers/online
 */
async function getOnlinePeers() {
    try {
        const { data } = await apiClient.get('/peers/online');
        const peers = Array.isArray(data) ? data : (data.peers || []);
        return peers;
    } catch (err) {
        console.warn('BetterDesk API getOnlinePeers error:', err.message);
        return [];
    }
}

/**
 * GET /api/peers/:id/status
 */
async function getPeerStatus(id) {
    try {
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}/status`);
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/peers/:id/telemetry
 */
async function getPeerTelemetry(id) {
    try {
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}/telemetry`);
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/peers/:id/telemetry/refresh
 */
async function refreshPeerHardware(id) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/telemetry/refresh`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/peers/:id/telemetry/command
 */
async function queuePeerTelemetryCommand(id, command, args = {}) {
    try {
        const { data } = await apiClient.post(`/peers/${encodeURIComponent(id)}/telemetry/command`, {
            command,
            args,
        });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== Blocklist ========================================

/**
 * GET /api/blocklist
 */
async function getBlocklist() {
    try {
        const { data } = await apiClient.get('/blocklist');
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/blocklist
 */
async function addBlocklistEntry(entry) {
    try {
        const { data } = await apiClient.post('/blocklist', { entry });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * DELETE /api/blocklist/:entry
 */
async function removeBlocklistEntry(entry) {
    try {
        const { data } = await apiClient.delete(`/blocklist/${encodeURIComponent(entry)}`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== Tags =============================================

/**
 * PUT /api/peers/:id/tags
 */
async function setPeerTags(id, tags) {
    try {
        // Ensure tags is sent as an array (Go server now accepts both string and array)
        const payload = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
        const { data } = await apiClient.put(`/peers/${encodeURIComponent(id)}/tags`, { tags: payload });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * PATCH /api/peers/:id - Update peer fields (note, user, tags)
 */
async function updatePeer(id, fields) {
    try {
        const { data } = await apiClient.patch(`/peers/${encodeURIComponent(id)}`, fields);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== Remote targets ==================================

function normaliseRemoteTarget(target) {
    const value = target || {};
    const protocol = String(value.protocol || '').toLowerCase();
    return {
        ...value,
        id: String(value.id || ''),
        hostname: value.name || value.host || '',
        display_name: value.name || value.host || '',
        platform: value.platform || '',
        os: value.platform || '',
        device_type: protocol,
        remote_target: true,
        remote_protocol: protocol,
        soft_deleted: value.enabled === false,
        online: false,
        status: value.enabled === false ? 'DISABLED' : 'OFFLINE',
        last_online: value.last_test_at || '',
        note: value.host ? `${value.host}:${value.port || ''}` : '',
    };
}

async function getAllRemoteTargets(options = {}) {
    try {
        const { data } = await apiClient.get('/remote-targets', {
            params: {
                org_id: options.orgId || '',
                include_disabled: options.includeDisabled ? 'true' : 'false'
            }
        });
        const targets = Array.isArray(data) ? data : (data.targets || []);
        return targets.map(normaliseRemoteTarget);
    } catch (err) {
        console.warn('BetterDesk API getAllRemoteTargets error:', err.message);
        return [];
    }
}

async function testRemoteTarget(payload) {
    try {
        const { data } = await apiClient.post('/remote-targets/test', payload);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function getRemoteTarget(id) {
    try {
        const { data } = await apiClient.get(`/remote-targets/${encodeURIComponent(id)}`);
        return normaliseRemoteTarget(data);
    } catch (_) {
        return null;
    }
}

async function createRemoteTarget(payload) {
    try {
        const { data } = await apiClient.post('/remote-targets', payload);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function updateRemoteTarget(id, payload) {
    try {
        const { data } = await apiClient.patch(`/remote-targets/${encodeURIComponent(id)}`, payload);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function deleteRemoteTarget(id) {
    try {
        const { data } = await apiClient.delete(`/remote-targets/${encodeURIComponent(id)}`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function getRemoteTargetCredentialStatus(id) {
    try {
        const { data } = await apiClient.get(`/remote-targets/${encodeURIComponent(id)}/credentials`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function setRemoteTargetCredentials(id, payload) {
    try {
        const { data } = await apiClient.put(`/remote-targets/${encodeURIComponent(id)}/credentials`, payload);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function clearRemoteTargetCredentials(id) {
    try {
        const { data } = await apiClient.delete(`/remote-targets/${encodeURIComponent(id)}/credentials`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

async function acceptRemoteTargetCertificate(id, fingerprint) {
    try {
        const { data } = await apiClient.post(
            `/remote-targets/${encodeURIComponent(id)}/certificate/accept`,
            { fingerprint }
        );
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/tags/:tag/peers
 */
async function getPeersByTag(tag) {
    try {
        const { data } = await apiClient.get(`/tags/${encodeURIComponent(tag)}/peers`);
        const peers = Array.isArray(data) ? data : (data.peers || []);
        return peers.map(normalisePeer);
    } catch (err) {
        return [];
    }
}

// ========================== Audit ============================================

/**
 * GET /api/audit/events?limit=N
 */
async function getAuditEvents(limit = 100) {
    try {
        const { data } = await apiClient.get('/audit/events', { params: { limit } });
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// RustDesk Client API audit (consolidated onto the Go server, port 21121).
// After the API-port consolidation the RustDesk clients report connection /
// file / alarm audit events to the Go server, so the panel must read them
// back from Go to stay consistent (especially on SQLite where Go and Node
// use separate database files). Each getter returns { data, total } or null
// on failure so callers can fall back to the local Node database.

/**
 * GET /api/audit/conn — connection audit events from the Go server.
 */
async function getClientAuditConnections(filters = {}) {
    try {
        const { data } = await apiClient.get('/audit/conn', { params: filters });
        return { data: data.data || [], total: data.total || 0 };
    } catch (err) {
        console.warn('BetterDesk API getClientAuditConnections error:', err.message);
        return null;
    }
}

/**
 * GET /api/audit/file — file-transfer audit events from the Go server.
 */
async function getClientAuditFiles(filters = {}) {
    try {
        const { data } = await apiClient.get('/audit/file', { params: filters });
        return { data: data.data || [], total: data.total || 0 };
    } catch (err) {
        console.warn('BetterDesk API getClientAuditFiles error:', err.message);
        return null;
    }
}

/**
 * GET /api/audit/alarm — security alarm audit events from the Go server.
 */
async function getClientAuditAlarms(filters = {}) {
    try {
        const { data } = await apiClient.get('/audit/alarm', { params: filters });
        return { data: data.data || [], total: data.total || 0 };
    } catch (err) {
        console.warn('BetterDesk API getClientAuditAlarms error:', err.message);
        return null;
    }
}

// ========================== Config ===========================================

/**
 * GET /api/config/:key
 */
async function getConfig(key) {
    try {
        const { data } = await apiClient.get(`/config/${encodeURIComponent(key)}`);
        return wrap(data);
    } catch (err) {
        return { success: false, error: err.message };
    }
}

/**
 * PUT /api/config/:key
 */
async function setConfig(key, value) {
    try {
        const { data } = await apiClient.put(`/config/${encodeURIComponent(key)}`, { value });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/peers/:id/availability — server-observed status transitions for one local day (#455).
 */
async function getPeerAvailability(id, { day, tzOffset } = {}) {
    try {
        const params = {};
        if (day) params.day = day;
        if (tzOffset !== undefined && tzOffset !== null && tzOffset !== '') {
            params.tz_offset = tzOffset;
        }
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}/availability`, { params });
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * GET /api/peers/:id/connection-sessions — server-observed remote-control sessions.
 */
async function getPeerConnectionSessions(id, { limit } = {}) {
    try {
        const params = {};
        if (limit) params.limit = limit;
        const { data } = await apiClient.get(
            `/peers/${encodeURIComponent(id)}/connection-sessions`,
            { params }
        );
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== Server Info ======================================

/**
 * Combined server info for the panel settings page
 */
async function getServerInfo() {
    try {
        const [healthRes, statsRes] = await Promise.all([
            apiClient.get('/health').catch(() => ({ data: {} })),
            apiClient.get('/server/stats').catch(() => ({ data: {} }))
        ]);
        return {
            health: healthRes.data,
            stats: statsRes.data,
            backend: 'betterdesk'
        };
    } catch (err) {
        return null;
    }
}

// ========================== Sync (no-op for BetterDesk) ======================

/**
 * In BetterDesk mode the Go server owns the peer map, so status sync
 * is not needed. This is a no-op kept for interface compatibility.
 */
async function syncOnlineStatus(/* db */) {
    return { synced: 0, skipped: true, reason: 'betterdesk_manages_state' };
}

// ===================== Panel grouping and catalog (strangler P2/P3) ==========
//
// Go owns the writes for device groups, their members and ACL, folders and
// per-user device grants, and it owns the panel catalog definition
// (docs/important/console-backend-strangler.md). The console keeps its screens
// and its response shapes; these helpers are the only place it talks to those
// endpoints.
//
// Every call carries the panel trust statement (services/panelTrust.js) when the
// bridge is configured. Without it Go would authorize these requests as the
// API key's role, which is an administrator — a viewer's session could then
// write a group. With it, Go enforces the operator's own role and permissions.

const panelTrust = require('./panelTrust');

/**
 * Request options for a panel-originated call: the trust statement for this
 * exact method and path, plus the JSON content type the API key client sets.
 * Returns undefined headers when the bridge is off, so axios keeps its own.
 */
function panelCallConfig(method, path, req) {
    const identity = req ? panelTrust.identityFromRequest(req) : null;
    if (!identity) return undefined;
    const headers = panelTrust.panelTrustHeaders(identity, method, path);
    return Object.keys(headers).length ? { headers } : undefined;
}

/** Panel section catalog, permission vocabulary and role defaults (stage P3). */
async function getPanelCatalog(config) {
    try {
        const { data } = await apiClient.get('/panel/catalog', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** List device groups with ACL and member counts. */
async function listPanelDeviceGroups(config) {
    try {
        const { data } = await apiClient.get('/panel/device-groups', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** Create or update a device group (and its ACL) in one call. */
async function savePanelDeviceGroup(payload, config) {
    try {
        const { data } = await apiClient.post('/panel/device-groups', payload, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** Delete a device group. */
async function deletePanelDeviceGroup(guid, config) {
    try {
        const safeGuid = assertSafeApiId(guid, 'guid');
        const { data } = await apiClient.delete(`/panel/device-groups/${encodeURIComponent(safeGuid)}`, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** Read a group's membership. */
async function getPanelDeviceGroupPeers(guid, config) {
    try {
        const safeGuid = assertSafeApiId(guid, 'guid');
        const { data } = await apiClient.get(
            `/panel/device-groups/${encodeURIComponent(safeGuid)}/peers`, config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** Replace a group's membership. */
async function setPanelDeviceGroupPeers(guid, peers, config) {
    try {
        const safeGuid = assertSafeApiId(guid, 'guid');
        const { data } = await apiClient.put(
            `/panel/device-groups/${encodeURIComponent(safeGuid)}/peers`,
            { peers: Array.isArray(peers) ? peers : [] },
            config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** Read a group's ACL. */
async function getPanelDeviceGroupAcl(guid, config) {
    try {
        const safeGuid = assertSafeApiId(guid, 'guid');
        const { data } = await apiClient.get(
            `/panel/device-groups/${encodeURIComponent(safeGuid)}/acl`, config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** Replace a group's ACL. */
async function setPanelDeviceGroupAcl(guid, acl, config) {
    try {
        const safeGuid = assertSafeApiId(guid, 'guid');
        const { data } = await apiClient.put(
            `/panel/device-groups/${encodeURIComponent(safeGuid)}/acl`,
            {
                allowed_users: Array.isArray(acl?.allowed_users) ? acl.allowed_users : [],
                allowed_user_groups: Array.isArray(acl?.allowed_user_groups) ? acl.allowed_user_groups : [],
            },
            config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** List folders plus the device → folder assignments. */
async function listPanelFolders(config) {
    try {
        const { data } = await apiClient.get('/panel/folders', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function createPanelFolder(folder, config) {
    try {
        const { data } = await apiClient.post('/panel/folders', folder, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

async function updatePanelFolder(id, folder, config) {
    try {
        const { data } = await apiClient.put(`/panel/folders/${Number(id)}`, folder, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

async function deletePanelFolder(id, config) {
    try {
        const { data } = await apiClient.delete(`/panel/folders/${Number(id)}`, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** Assign a device to a folder (folderId 0 clears the assignment). */
async function setPanelDeviceFolder(deviceId, folderId, config) {
    try {
        const safeId = assertSafeApiId(deviceId, 'device id');
        const { data } = await apiClient.put(
            `/panel/devices/${encodeURIComponent(safeId)}/folder`,
            { folder_id: Number(folderId) || 0 },
            config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

/** Direct device grants for one user. */
async function listPanelUserGrants(userId, config) {
    try {
        const { data } = await apiClient.get(`/panel/users/${Number(userId)}/grants`, config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function setPanelUserGrants(userId, peers, config) {
    try {
        const { data } = await apiClient.put(
            `/panel/users/${Number(userId)}/grants`,
            { peers: Array.isArray(peers) ? peers : [] },
            config,
        );
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, status: e.response?.status };
    }
}

// ========================== Helpers ==========================================

/**
 * Normalise a Go-server peer object to the shape the panel expects.
 *
 * Go server /api/peers returns (see db.Peer struct + peerResponse):
 *   id, uuid, pk, ip, user, hostname, os, version, status,
 *   nat_type, last_online, created_at, disabled, banned,
 *   ban_reason, banned_at, soft_deleted, deleted_at, note, tags,
 *   live_online (bool), signal_ready (bool),
 *   live_status ("online"|"degraded"|"critical"|"offline")
 *
 * Panel expected shape: id, hostname, username, platform, ip, note,
 *   online (bool), signal_ready (bool), banned (bool), created_at, last_online, ban_reason,
 *   folder_id, tags[], status_tier, uuid, disabled, os, version
 */
const NO_SIGNAL_THRESHOLD_MS = 5 * 60 * 1000;

function isRecentLastOnline(lastOnline) {
    if (!lastOnline) return false;
    const t = new Date(lastOnline).getTime();
    return Number.isFinite(t) && (Date.now() - t) < NO_SIGNAL_THRESHOLD_MS;
}

function normalisePeer(peer) {
    if (!peer) return peer;

    const liveOnline = !!(peer.live_online);
    const banned = !!(peer.banned);
    const lastOnline = peer.last_online || '';
    const rawDeviceType = String(peer.device_type || '').trim().toLowerCase();
    const deviceType = rawDeviceType || 'rustdesk';

    // Parse tags: Go server sends comma-separated string or JSON array
    let tags = [];
    if (Array.isArray(peer.tags)) {
        tags = peer.tags;
    } else if (typeof peer.tags === 'string' && peer.tags) {
        try {
            const parsed = JSON.parse(peer.tags);
            tags = Array.isArray(parsed) ? parsed : [peer.tags];
        } catch {
            tags = peer.tags.split(',').map(t => t.trim()).filter(Boolean);
        }
    }

    return {
        id: peer.id || '',
        hostname: peer.hostname || '',
        display_name: peer.display_name || '',
        username: peer.user || '',
        platform: peer.os || '',
        os: peer.os || '',
        version: peer.version || '',
        ip: peer.ip || '',
        note: peer.note || '',
        online: liveOnline,
        signal_ready: peer.signal_ready !== false && liveOnline,
        banned,
        // os_agent / CDAP endpoints use HTTP heartbeat + CDAP WS, not RustDesk UDP
        // :21116 — don't show "No signal" when CDAP is connected.
        no_signal: !liveOnline && !banned && isRecentLastOnline(lastOnline)
            && !(peer.device_type === 'os_agent' && peer.cdap_connected)
            && !(peer.device_type === 'mesh_agent' && peer.mesh_connected),
        created_at: peer.created_at || '',
        last_online: lastOnline,
        ban_reason: peer.ban_reason || '',
        banned_at: peer.banned_at || null,
        folder_id: peer.folder_id || null,
        tags,
        status_tier: peer.live_status || peer.status_text || (peer.live_online ? 'online' : 'offline'),
        uuid: peer.uuid || '',
        nat_type: peer.nat_type || 0,
        disabled: !!(peer.disabled || peer.soft_deleted),
        soft_deleted: !!(peer.soft_deleted),
        deleted_at: peer.deleted_at || null,
        device_type: deviceType,
        client_type: deviceType,
        cdap_connected: !!peer.cdap_connected,
        mesh_connected: !!peer.mesh_connected,
        mesh_node_id: peer.mesh_node_id || '',
        linked_peer_id: peer.linked_peer_id || ''
    };
}

async function getMeshStatus() {
    try {
        const { data } = await apiClient.get('/mesh/status');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, data: { enabled: false } };
    }
}

// ---------------------------------------------------------------------------
// CDAP (Custom Device Automation Protocol) endpoints
// ---------------------------------------------------------------------------

async function getCDAPStatus() {
    try {
        const { data } = await apiClient.get('/cdap/status');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCDAPDevices() {
    try {
        const { data } = await apiClient.get('/cdap/devices');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCDAPDeviceInfo(id) {
    try {
        const { data } = await apiClient.get(`/cdap/devices/${encodeURIComponent(id)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCDAPDeviceManifest(id) {
    try {
        const { data } = await apiClient.get(`/cdap/devices/${encodeURIComponent(id)}/manifest`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCDAPDeviceState(id) {
    try {
        const { data } = await apiClient.get(`/cdap/devices/${encodeURIComponent(id)}/state`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function sendCDAPCommand(id, widgetId, action, value, reason) {
    try {
        const { data } = await apiClient.post(`/cdap/devices/${encodeURIComponent(id)}/command`, {
            widget_id: widgetId,
            action,
            value,
            reason: reason || ''
        });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

async function getCDAPAlerts(deviceId) {
    try {
        const params = deviceId ? { device_id: deviceId } : {};
        const { data } = await apiClient.get('/cdap/alerts', { params });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, alerts: [], total: 0 };
    }
}

async function getLinkedPeers(id) {
    try {
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(id)}/linked`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, linked: [], total: 0 };
    }
}

async function linkDevice(id, linkedPeerId) {
    try {
        const { data } = await apiClient.patch(`/peers/${encodeURIComponent(id)}`, {
            linked_peer_id: linkedPeerId || ''
        });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ========================== Device Tokens ====================================

/**
 * GET /api/tokens
 */
async function listDeviceTokens(includeRevoked) {
    try {
        const params = includeRevoked ? { include_revoked: 'true' } : {};
        const { data } = await apiClient.get('/tokens', { params });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/tokens
 */
async function createDeviceToken(body) {
    try {
        const { data } = await apiClient.post('/tokens', body);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * GET /api/tokens/:id
 */
async function getDeviceToken(id) {
    try {
        const safeId = assertSafeApiId(id, 'tokenId');
        const { data } = await apiClient.get(`/tokens/${encodeURIComponent(safeId)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * PUT /api/tokens/:id
 */
async function updateDeviceToken(id, body) {
    try {
        const safeId = assertSafeApiId(id, 'tokenId');
        const { data } = await apiClient.put(`/tokens/${encodeURIComponent(safeId)}`, body);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * DELETE /api/tokens/:id
 */
async function revokeDeviceToken(id) {
    try {
        const safeId = assertSafeApiId(id, 'tokenId');
        const { data } = await apiClient.delete(`/tokens/${encodeURIComponent(safeId)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/tokens/generate-bulk
 */
async function bulkGenerateTokens(body) {
    try {
        const { data } = await apiClient.post('/tokens/generate-bulk', body);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/tokens/:id/bind
 */
async function bindTokenToPeer(id, peerId) {
    try {
        const safeId = assertSafeApiId(id, 'tokenId');
        const safePeerId = assertSafeApiId(peerId, 'peerId');
        const { data } = await apiClient.post(`/tokens/${encodeURIComponent(safeId)}/bind`, { peer_id: safePeerId });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * GET /api/enrollment/mode
 */
async function getEnrollmentMode() {
    try {
        const { data } = await apiClient.get('/enrollment/mode');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * PUT /api/enrollment/mode
 */
async function setEnrollmentMode(mode) {
    try {
        const { data } = await apiClient.put('/enrollment/mode', { mode });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ---------------------------------------------------------------------------
// Enrollment — pending device management (proxied from Go server)
// ---------------------------------------------------------------------------

/**
 * Get list of pending enrollment requests from Go server.
 */
async function getEnrollmentPending() {
    try {
        const { data } = await apiClient.get('/enrollment/pending');
        return { success: true, data: data.devices || [], count: data.count || 0 };
    } catch (e) {
        return { success: false, error: e.message, data: [], count: 0 };
    }
}

/**
 * Get approved/rejected Go enrollment history (#351).
 * @param {string} [status] - "approved" | "rejected" | omit for both
 */
async function getEnrollmentHistory(status) {
    try {
        const params = {};
        if (status) params.status = status;
        const { data } = await apiClient.get('/enrollment/history', { params });
        return { success: true, data: data.devices || [], count: data.count || 0 };
    } catch (e) {
        return { success: false, error: e.message, data: [], count: 0 };
    }
}

/**
 * Approve a pending enrollment request on Go server.
 * @param {string} deviceId - Device ID to approve
 * @param {string} displayName - Operator-assigned display name
 * @param {string} syncMode - Sync mode: silent, standard, turbo
 * @param {string} tags - Comma-separated tag list
 */
async function approveEnrollment(deviceId, displayName, syncMode, tags) {
    try {
        const { data } = await apiClient.post(`/enrollment/approve/${encodeURIComponent(deviceId)}`, {
            display_name: displayName || '',
            sync_mode: syncMode || 'standard',
            tags: tags || ''
        });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Reject a pending enrollment request on Go server.
 * @param {string} deviceId - Device ID to reject
 * @param {boolean} ban - Also ban the device so it cannot retry
 */
async function rejectEnrollment(deviceId, ban) {
    try {
        const { data } = await apiClient.post(`/enrollment/reject/${encodeURIComponent(deviceId)}`, {
            ban: !!ban
        });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Clear enrollment rejection lock so the device can re-request enrollment (#351).
 * @param {string} deviceId
 */
async function clearEnrollmentRejection(deviceId) {
    try {
        const { data } = await apiClient.post(`/enrollment/clear-rejection/${encodeURIComponent(deviceId)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Mint a one-time pairing code (operator). The plaintext code is returned once and never
 * stored; the server keeps only its sha256.
 */
async function createPairingCode(label) {
    try {
        const { data } = await apiClient.post('/pairing/codes', { label: label || '' });
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message, status: e.response && e.response.status };
    }
}

/**
 * List active pairing codes (no plaintext).
 */
async function listPairingCodes() {
    try {
        const { data } = await apiClient.get('/pairing/codes');
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message, status: e.response && e.response.status };
    }
}

/**
 * Revoke a pairing code before it is redeemed.
 */
async function revokePairingCode(id) {
    try {
        const { data } = await apiClient.delete(`/pairing/codes/${encodeURIComponent(id)}`);
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message, status: e.response && e.response.status };
    }
}

/**
 * Get branding configuration from Go server (public endpoint).
 */
async function getBranding() {
    try {
        const { data } = await apiClient.get('/branding');
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Save branding configuration to Go server.
 */
async function saveBranding(brandingData) {
    try {
        const { data } = await apiClient.post('/branding', brandingData);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Get unattended access policy for a peer device.
 */
async function getAccessPolicy(id) {
    try {
        const safeId = assertSafeApiId(id, 'peerId');
        const { data } = await apiClient.get(`/peers/${encodeURIComponent(safeId)}/access-policy`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Save unattended access policy for a peer device.
 */
async function saveAccessPolicy(id, policy) {
    try {
        const safeId = assertSafeApiId(id, 'peerId');
        const { data } = await apiClient.put(`/peers/${encodeURIComponent(safeId)}/access-policy`, policy);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Delete unattended access policy for a peer device.
 */
async function deleteAccessPolicy(id) {
    try {
        const safeId = assertSafeApiId(id, 'peerId');
        const { data } = await apiClient.delete(`/peers/${encodeURIComponent(safeId)}/access-policy`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Fetch org vault connect password for Web Remote auto-fill (#367).
 * Propagates HTTP errors so callers can distinguish 404/403.
 */
async function getPeerConnectPassword(id) {
    const safeId = assertSafeApiId(id, 'peerId');
    const { data } = await apiClient.get(`/peers/${encodeURIComponent(safeId)}/connect-password`);
    return data;
}

// ── RBAC: Roles & Permissions (Phase 52) ─────────────────────

/**
 * List all built-in roles with their default permission sets.
 */
async function listRoles() {
    try {
        const { data } = await apiClient.get('/roles');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Get effective permissions for a specific role (defaults + overrides).
 */
async function getRolePermissions(role) {
    try {
        const safeRole = assertSafeApiId(role, 'role');
        const { data } = await apiClient.get(`/roles/${encodeURIComponent(safeRole)}/permissions`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * List all custom permission overrides from the DB.
 */
async function listRolePermissionOverrides(role) {    try {
        const url = role ? `/role-permissions?role=${encodeURIComponent(role)}` : '/role-permissions';
        const { data } = await apiClient.get(url);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Set a custom permission override for a role.
 * @param {string} role
 * @param {string} permission
 * @param {boolean} granted
 */
async function setRolePermission(role, permission, granted) {
    try {
        const safeRole = assertSafeApiId(role, 'role');
        const safePermission = assertSafeApiId(permission, 'permission');
        const { data } = await apiClient.post('/role-permissions', { role: safeRole, permission: safePermission, granted });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Delete a custom permission override (revert to default).
 */
async function deleteRolePermission(role, permission) {
    try {
        const safeRole = assertSafeApiId(role, 'role');
        const safePermission = assertSafeApiId(permission, 'permission');
        const { data } = await apiClient.delete(`/role-permissions/${encodeURIComponent(safeRole)}/${encodeURIComponent(safePermission)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ========================== Help Requests ====================================

/**
 * GET /api/help/requests — list help requests
 * @param {{ status?: string, device_id?: string, limit?: number }} filter
 */
async function listHelpRequests(filter = {}) {
    try {
        const params = {};
        if (filter.status) params.status = filter.status;
        if (filter.device_id) params.device_id = filter.device_id;
        if (filter.limit) params.limit = filter.limit;
        const { data } = await apiClient.get('/help/requests', { params });
        const requests = Array.isArray(data) ? data : (data.requests || []);
        return { success: true, data: requests };
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/help/requests/:id/acknowledge
 */
async function acknowledgeHelpRequest(id) {
    try {
        const safeId = assertSafeApiId(id, 'requestId');
        const { data } = await apiClient.post(`/help/requests/${encodeURIComponent(safeId)}/acknowledge`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

/**
 * POST /api/help/requests/:id/resolve
 */
async function resolveHelpRequest(id) {
    try {
        const safeId = assertSafeApiId(id, 'requestId');
        const { data } = await apiClient.post(`/help/requests/${encodeURIComponent(safeId)}/resolve`);
        return wrap(data);
    } catch (err) {
        if (err.response?.data) return wrap(err.response.data);
        return { success: false, error: err.message };
    }
}

// ========================== LDAP Configuration =============================

/**
 * GET /api/auth/ldap/config — Get LDAP configuration (password masked)
 */
async function getLDAPConfig() {
    try {
        const { data } = await apiClient.get('/auth/ldap/config');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * PUT /api/auth/ldap/config — Save LDAP configuration
 */
async function saveLDAPConfig(config) {
    try {
        const { data } = await apiClient.put('/auth/ldap/config', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/auth/ldap/test — Test LDAP connection
 */
async function testLDAPConnection(config) {
    try {
        const { data } = await apiClient.post('/auth/ldap/test', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ========================== OIDC Configuration =============================

/**
 * GET /api/auth/oidc/config — Get OIDC configuration (secret masked)
 */
async function getOIDCConfig() {
    try {
        const { data } = await apiClient.get('/auth/oidc/config');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * PUT /api/auth/oidc/config — Save OIDC configuration
 */
async function saveOIDCConfig(config) {
    try {
        const { data } = await apiClient.put('/auth/oidc/config', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/auth/oidc/test — Test OIDC discovery
 */
async function testOIDCDiscovery(config) {
    try {
        const { data } = await apiClient.post('/auth/oidc/test', config);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * GET /api/auth/oidc/status — Check if OIDC is enabled (public)
 */
async function getOIDCStatus() {
    try {
        const { data } = await apiClient.get('/auth/oidc/status');
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * POST /api/auth/oidc/exchange — Exchange one-time OIDC auth code for JWT + user identity
 */
async function exchangeOIDCCode(code) {
    try {
        const { data } = await apiClient.post('/auth/oidc/exchange', { code });
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/**
 * Absolute http(s) URL check for IdP authorize redirects (issue #298).
 * Go returns 302 Location to the identity provider — never follow it from Node.
 */
function isAbsoluteHttpUrl(value) {
    if (typeof value !== 'string' || !value) return false;
    try {
        const u = new URL(value);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Proxy IdP callback to Go (panel :5000/:5443 → Go API).
 * GET /api/auth/oidc/callback and GET /api/oidc/callback (#304).
 *
 * Forwards status, Location (panel session redirect or errors), Content-Type,
 * and body (HTML success page for RustDesk client OIDC). Does not follow
 * redirects — the browser must see Go's 302 Location.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function proxyOIDCCallback(req, res) {
    const qs = new URLSearchParams();
    const query = req.query || {};
    for (const key of Object.keys(query)) {
        const val = query[key];
        if (typeof val === 'string') {
            qs.set(key, val);
        } else if (Array.isArray(val) && typeof val[0] === 'string') {
            qs.set(key, val[0]);
        }
    }
    const suffix = qs.toString();
    // Prefer canonical Go path; /api/oidc/callback is also registered on Go.
    const path = `/auth/oidc/callback${suffix ? `?${suffix}` : ''}`;

    try {
        const response = await apiClient.get(path, {
            maxRedirects: 0,
            validateStatus: () => true,
            responseType: 'arraybuffer',
            timeout: Math.max(config.betterdeskApiTimeout || 15000, 30000),
            headers: {
                Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            },
            transformRequest: [(data, headers) => {
                // GET must not advertise JSON content-type from the shared client.
                if (headers) {
                    delete headers['Content-Type'];
                    delete headers['content-type'];
                }
                return data;
            }],
        });

        const ct = response.headers['content-type'] || response.headers['Content-Type'];
        if (ct) {
            res.setHeader('Content-Type', ct);
        }
        const location = response.headers.location || response.headers.Location;
        if (location) {
            res.setHeader('Location', location);
        }
        const cacheControl = response.headers['cache-control'];
        if (cacheControl) {
            res.setHeader('Cache-Control', cacheControl);
        }

        const status = Number(response.status) || 502;
        const body = response.data != null ? Buffer.from(response.data) : Buffer.alloc(0);
        res.status(status).send(body);
    } catch (err) {
        console.error('[OIDC] callback proxy failed:', err.message);
        if (!res.headersSent) {
            res.status(502).type('text/plain').send('OIDC callback proxy failed');
        }
    }
}

/**
 * GET /api/auth/oidc/authorize — Server-to-server: capture Go's 302 Location (IdP URL).
 * The browser must never be redirected to BETTERDESK_API_URL (often localhost).
 */
async function startOIDCAuthorize(returnUrl) {
    const qs = new URLSearchParams();
    if (returnUrl) qs.set('return_url', String(returnUrl));
    const suffix = qs.toString();
    const path = `/auth/oidc/authorize${suffix ? `?${suffix}` : ''}`;

    const extractLocation = (headers) => {
        if (!headers) return '';
        return headers.location || headers.Location || '';
    };

    try {
        const response = await apiClient.get(path, {
            maxRedirects: 0,
            validateStatus: (status) => status >= 200 && status < 400,
        });
        const location = extractLocation(response.headers);
        if (!isAbsoluteHttpUrl(location)) {
            return { success: false, error: 'OIDC authorize did not return an IdP redirect URL' };
        }
        return { success: true, data: { auth_url: location } };
    } catch (e) {
        const location = extractLocation(e.response?.headers);
        if (isAbsoluteHttpUrl(location)) {
            return { success: true, data: { auth_url: location } };
        }
        const bodyErr = e.response?.data?.error;
        return { success: false, error: typeof bodyErr === 'string' ? bodyErr : e.message };
    }
}

/** POST /api/strategies/assign */
async function assignStrategy(payload) {
    try {
        const { data } = await apiClient.post('/strategies/assign', payload);
        return wrap(data);
    } catch (e) {
        if (e.response?.data) return wrap(e.response.data);
        return { success: false, error: e.message };
    }
}

/** GET /api/strategies/:guid */
async function getStrategy(guid) {
    try {
        const { data } = await apiClient.get(`/strategies/${encodeURIComponent(guid)}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message };
    }
}

/** PUT /api/strategies/:guid/status — body is raw true/false JSON */
async function setStrategyStatus(guid, enabled) {
    try {
        const { data } = await apiClient.put(
            `/strategies/${encodeURIComponent(guid)}/status`,
            enabled,
            { headers: { 'Content-Type': 'application/json' } }
        );
        return wrap(data);
    } catch (e) {
        if (e.response?.data) return wrap(e.response.data);
        return { success: false, error: e.message };
    }
}

/** GET /api/devices — Pro admin device list (id + guid) */
async function listProDevices(params = {}) {
    try {
        const qs = new URLSearchParams();
        if (params.id) qs.set('id', params.id);
        if (params.pageSize) qs.set('pageSize', String(params.pageSize));
        const suffix = qs.toString();
        const { data } = await apiClient.get(`/devices${suffix ? '?' + suffix : ''}`);
        return wrap(data);
    } catch (e) {
        return { success: false, error: e.message, data: { total: 0, data: [] } };
    }
}

module.exports = {
    // Health / Stats
    getHealth,
    getServerStats,
    getServerInfo,
    // Peers
    getAllPeers,
    getPeer,
    getPeerIncludingDeleted,
    deletePeer,
    banPeer,
    unbanPeer,
    getConnectionMode,
    setConnectionMode,
    restorePeer,
    changePeerId,
    // Status
    getStatusSummary,
    getOnlinePeers,
    getPeerStatus,
    getPeerTelemetry,
    refreshPeerHardware,
    queuePeerTelemetryCommand,
    // Blocklist
    getBlocklist,
    addBlocklistEntry,
    removeBlocklistEntry,
    // Tags
    setPeerTags,
    getPeersByTag,
    // Peer update
    updatePeer,
    // RDP/VNC remote targets
    getAllRemoteTargets,
    testRemoteTarget,
    getRemoteTarget,
    createRemoteTarget,
    updateRemoteTarget,
    deleteRemoteTarget,
    getRemoteTargetCredentialStatus,
    setRemoteTargetCredentials,
    clearRemoteTargetCredentials,
    acceptRemoteTargetCertificate,
    // Audit
    getAuditEvents,
    getClientAuditConnections,
    getClientAuditFiles,
    getClientAuditAlarms,
    // Config
    getConfig,
    setConfig,
    getPeerAvailability,
    getPeerConnectionSessions,
    // Sync (no-op)
    syncOnlineStatus,
    // CDAP
    getCDAPStatus,
    getCDAPDevices,
    getCDAPDeviceInfo,
    getCDAPDeviceManifest,
    getCDAPDeviceState,
    sendCDAPCommand,
    getCDAPAlerts,
    getMeshStatus,
    getLinkedPeers,
    linkDevice,
    // Device Tokens
    listDeviceTokens,
    createDeviceToken,
    getDeviceToken,
    updateDeviceToken,
    revokeDeviceToken,
    bulkGenerateTokens,
    bindTokenToPeer,
    getEnrollmentMode,
    setEnrollmentMode,
    // Enrollment — pending devices
    getEnrollmentPending,
    getEnrollmentHistory,
    approveEnrollment,
    rejectEnrollment,
    clearEnrollmentRejection,
    // Branding (Go server)
    getBranding: getBranding,
    saveBranding: saveBranding,
    createPairingCode,
    listPairingCodes,
    revokePairingCode,
    // Access Policies (Unattended Access)
    getAccessPolicy,
    saveAccessPolicy,
    deleteAccessPolicy,
    getPeerConnectPassword,
    // RBAC: Roles & Permissions (Phase 52)
    listRoles,
    getRolePermissions,
    listRolePermissionOverrides,
    setRolePermission,
    deleteRolePermission,
    // LDAP Configuration
    getLDAPConfig,
    saveLDAPConfig,
    testLDAPConnection,
    // OIDC Configuration
    getOIDCConfig,
    saveOIDCConfig,
    testOIDCDiscovery,
    getOIDCStatus,
    exchangeOIDCCode,
    startOIDCAuthorize,
    proxyOIDCCallback,
    assignStrategy,
    getStrategy,
    setStrategyStatus,
    listProDevices,
    // Help Requests
    listHelpRequests,
    acknowledgeHelpRequest,
    resolveHelpRequest,
    // Panel catalog and grouping (strangler P2/P3)
    getPanelCatalog,
    listPanelDeviceGroups,
    savePanelDeviceGroup,
    deletePanelDeviceGroup,
    getPanelDeviceGroupPeers,
    setPanelDeviceGroupPeers,
    getPanelDeviceGroupAcl,
    setPanelDeviceGroupAcl,
    listPanelFolders,
    createPanelFolder,
    updatePanelFolder,
    deletePanelFolder,
    setPanelDeviceFolder,
    listPanelUserGrants,
    setPanelUserGrants,
    // Helpers
    normalisePeer,
    // Raw axios client (for services that need direct API access)
    apiClient,
};
