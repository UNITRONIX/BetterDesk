/**
 * BetterDesk Console - RustDesk Client API Routes
 * 
 * RustDesk-compatible API endpoints.
 * Runs on a dedicated port (default 21121) for WAN access.
 * 
 * Protocol Reference — Phase 1 (Core):
 *   POST /api/login           - Authenticate (username+password or TFA code)
 *   POST /api/logout          - Revoke token
 *   GET  /api/currentUser     - Get current user info (Bearer auth)
 *   GET  /api/login-options   - List available login methods
 *   POST /api/sysinfo         - Report device system info
 *   POST /api/heartbeat       - Periodic heartbeat with metrics
 *   GET  /api/peers           - List peers with sysinfo + status
 *   GET  /api/server-key      - Get RS public key (Ed25519 base64)
 * 
 * Protocol Reference — Phase 2 (Audit):
 *   POST /api/audit/conn      - Report connection event
 *   POST /api/audit/file      - Report file transfer event
 *   POST /api/audit/alarm     - Report security alarm
 *   GET  /api/audit/conn      - Query connection events
 *   GET  /api/audit/file      - Query file transfer events
 *   GET  /api/audit/alarm     - Query alarm events
 * 
 * Protocol Reference — Phase 3 (Groups & Strategies):
 *   GET/POST   /api/user-groups     - User group management
 *   GET/POST   /api/device-group    - Device group management
 *   GET        /api/device-group/accessible - Accessible device groups
 *   GET        /api/strategies      - Access control strategies
 * 
 * @author UNITRONIX
 * @version 2.0.0
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const authService = require('../services/authService');
const db = require('../services/database');
const config = require('../config/config');

// ==================== Constants ====================

/** Valid connection types for audit events */
const CONN_TYPES = [0, 1, 2, 3, 4]; // Remote, FileTransfer, PortForward, Camera, Terminal

/** Valid alarm types */
const ALARM_TYPES = [0, 1, 2, 3, 4, 5, 6]; // AccessAttempt, BruteForce, IPViolation, Unauthorized, PortScan, MaliciousFile, Custom

/** Maximum lengths for string fields (input sanitization) */
const MAX_ID_LEN = 32;
const MAX_HOSTNAME_LEN = 256;
const MAX_STRING_LEN = 512;
const MAX_PATH_LEN = 1024;

// Throttle sysinfo request logging: only log once per device per 5 minutes
const _sysinfoLogTimes = new Map();
function shouldLogSysinfoRequest(deviceId) {
    const now = Date.now();
    const last = _sysinfoLogTimes.get(deviceId) || 0;
    if (now - last > 5 * 60 * 1000) {
        _sysinfoLogTimes.set(deviceId, now);
        // Prune old entries to prevent memory leak
        if (_sysinfoLogTimes.size > 1000) {
            for (const [k, v] of _sysinfoLogTimes) {
                if (now - v > 10 * 60 * 1000) _sysinfoLogTimes.delete(k);
            }
        }
        return true;
    }
    return false;
}

// ==================== Helper Functions ====================

/**
 * Extract client IP from request (uses Express trust proxy)
 */
function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Extract Bearer token from Authorization header
 */
function extractBearerToken(req) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
        return null;
    }
    return auth.substring(7).trim();
}

/**
 * Build a RustDesk-compatible user payload
 */
function buildUserPayload(user) {
    return {
        name: user.username,
        email: '',
        note: '',
        status: 1, // kNormal
        grp: '',
        is_admin: user.role === 'admin'
    };
}

/**
 * Authenticate request via Bearer token — returns user or null
 */
async function authenticateRequest(req) {
    const token = extractBearerToken(req);
    if (!token) return null;
    return authService.validateAccessToken(token);
}

/**
 * Middleware: require Bearer auth
 */
async function requireAuth(req, res, next) {
    const user = await authenticateRequest(req);
    if (!user) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    req.authUser = user;
    next();
}

/**
 * Middleware: require admin role
 */
function requireAdmin(req, res, next) {
    if (!req.authUser || req.authUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin privileges required' });
    }
    next();
}

/**
 * Sanitize string input — truncate and strip control chars
 */
function sanitizeStr(val, maxLen = MAX_STRING_LEN) {
    if (typeof val !== 'string') return '';
    // Strip control characters except newline/tab
    return val.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').substring(0, maxLen);
}

/**
 * Validate device ID format (alphanumeric, max length)
 */
function isValidDeviceId(id) {
    return typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LEN && /^[a-zA-Z0-9_-]+$/.test(id);
}

// ==================== Phase 0: Core Auth Endpoints ====================

/**
 * GET /api/login-options
 * Returns available login methods.
 * RustDesk client calls this to check for OIDC providers.
 * We only support account-password.
 */
router.get('/api/login-options', (req, res) => {
    res.json(['']);
});

/**
 * POST /api/heartbeat
 * RustDesk client sends periodic heartbeat with CPU/memory/disk metrics.
 * Stores metrics data and updates peer online status.
 * Device must exist in peer table (prevents phantom entries).
 */
router.post('/api/heartbeat', async (req, res) => {
    const body = req.body || {};

    // Extract and validate device ID
    const deviceId = sanitizeStr(body.id || body.uuid || '', MAX_ID_LEN);
    if (!deviceId || !isValidDeviceId(deviceId)) {
        return res.json({ modified_at: new Date().toISOString() });
    }

    // Verify the device exists in the peer table (prevents spoofing phantom devices)
    const existingDevice = await db.getDevice(deviceId);
    if (!existingDevice) {
        return res.json({ modified_at: new Date().toISOString() });
    }

    // Reject heartbeats from banned devices
    if (existingDevice.banned) {
        return res.json({ error: 'BANNED' });
    }

    // Parse metric data from heartbeat payload
    const cpuUsage = typeof body.cpu === 'number' ? Math.min(100, Math.max(0, body.cpu)) : 0;
    const memoryUsage = typeof body.memory === 'number' ? Math.min(100, Math.max(0, body.memory)) : 0;
    const diskUsage = typeof body.disk === 'number' ? Math.min(100, Math.max(0, body.disk)) : 0;

    try {
        await db.insertPeerMetric(deviceId, cpuUsage, memoryUsage, diskUsage);
        await db.updatePeerOnlineStatus(deviceId);
    } catch (err) {
        console.warn('[API:HEARTBEAT] Failed to store metrics:', err.message);
    }

    // Check if we need sysinfo update (missing or stale > 1 hour)
    try {
        const sysinfo = await db.getPeerSysinfo(deviceId);
        if (!sysinfo) {
            // No sysinfo - request client to send it (JSON with "sysinfo" key)
            if (shouldLogSysinfoRequest(deviceId)) {
                console.log(`[API:HEARTBEAT] Requesting sysinfo from ${deviceId} (missing)`);
            }
            return res.json({ modified_at: new Date().toISOString(), sysinfo: true });
        }
        
        // Check if sysinfo is older than 1 hour
        const updatedAt = new Date(sysinfo.updated_at).getTime();
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        if (updatedAt < oneHourAgo) {
            if (shouldLogSysinfoRequest(deviceId)) {
                console.log(`[API:HEARTBEAT] Requesting sysinfo refresh from ${deviceId} (stale)`);
            }
            return res.json({ modified_at: new Date().toISOString(), sysinfo: true });
        }
    } catch (err) {
        // On error, just continue with normal response
    }

    return res.json({ modified_at: new Date().toISOString() });
});

/**
 * POST /api/sysinfo
 * RustDesk client reports hardware/software info.
 * Parses and stores CPU, RAM, OS, hostname, displays, encoding, features.
 * Device must exist in peer table (prevents phantom entries).
 * 
 * IMPORTANT: Response must be plain text (not JSON):
 *   - "SYSINFO_UPDATED" → client activates PRO mode
 *   - "ID_NOT_FOUND" → client retries immediately
 *   - Anything else → client waits 120s before retry
 */
router.post('/api/sysinfo', async (req, res) => {
    const body = req.body || {};

    // Extract and validate device ID
    const deviceId = sanitizeStr(body.id || body.uuid || '', MAX_ID_LEN);
    if (!deviceId || !isValidDeviceId(deviceId)) {
        console.log('[API:SYSINFO] Invalid device ID:', deviceId);
        return res.type('text/plain').send('ID_NOT_FOUND');
    }

    // Verify the device exists in the peer table (prevents overwriting unknown devices)
    const existingDevice = await db.getDevice(deviceId);
    if (!existingDevice) {
        console.log(`[API:SYSINFO] Device not found: ${deviceId} (must register first)`);
        return res.type('text/plain').send('ID_NOT_FOUND');
    }

    // Reject sysinfo from banned devices
    if (existingDevice.banned) {
        console.log(`[API:SYSINFO] Rejected sysinfo from banned device: ${deviceId}`);
        return res.type('text/plain').send('ID_NOT_FOUND');
    }

    try {
        // RustDesk sends cpu and memory as formatted strings, parse them
        // cpu: "Intel Core i7-12700K, 5.2GHz, 24/16 cores"
        // memory: "31.87GB"
        const cpuRaw = sanitizeStr(body.cpu || '', MAX_STRING_LEN);
        const memoryRaw = sanitizeStr(body.memory || '', 64);

        // Parse CPU: extract name, frequency, cores
        let cpuName = '';
        let cpuCores = 0;
        let cpuFreqGhz = 0;
        if (cpuRaw) {
            // Parse comma-separated parts: "Intel Core i7-12700K, 5.2GHz, 24/16 cores"
            // Uses split instead of complex regex to avoid ReDoS backtracking.
            const cpuParts = cpuRaw.split(',').map(s => s.trim());
            const cpuMatch = cpuParts.length >= 1 ? [null, cpuParts[0]] : null;
            if (cpuMatch) {
                const ghzPart = cpuParts.find(p => /^\d+\.?\d*GHz$/i.test(p));
                const coresPart = cpuParts.find(p => /^\d+\/?\d*\s*cores?$/i.test(p));
                if (ghzPart) cpuMatch[2] = ghzPart.replace(/GHz$/i, '');
                if (coresPart) {
                    const cm = coresPart.match(/^(\d+)\/?(\d+)?/);
                    if (cm) { cpuMatch[3] = cm[1]; cpuMatch[4] = cm[2]; }
                }
            }
            if (cpuMatch) {
                cpuName = cpuMatch[1]?.trim() || cpuRaw;
                cpuFreqGhz = parseFloat(cpuMatch[2]) || 0;
                cpuCores = parseInt(cpuMatch[3]) || parseInt(cpuMatch[4]) || 0;
            } else {
                cpuName = cpuRaw; // Use raw if pattern doesn't match
            }
        }

        // Parse memory: "31.87GB" → 31.87
        let memoryGb = 0;
        if (memoryRaw) {
            const memMatch = memoryRaw.match(/^(\d+\.?\d*)\s*GB$/i);
            if (memMatch) {
                memoryGb = parseFloat(memMatch[1]) || 0;
            } else if (typeof body.memory === 'number') {
                memoryGb = body.memory;
            }
        }

        // Parse sysinfo fields from RustDesk client payload
        const sysinfo = {
            hostname: sanitizeStr(body.hostname || '', MAX_HOSTNAME_LEN),
            username: sanitizeStr(body.username || '', MAX_HOSTNAME_LEN),
            platform: sanitizeStr(body.platform || body.os || '', MAX_STRING_LEN),
            version: sanitizeStr(body.version || '', 64),
            cpu_name: cpuName || sanitizeStr(body.cpu_name || '', MAX_STRING_LEN),
            cpu_cores: cpuCores || (typeof body.cpu_num === 'number' ? Math.max(0, Math.min(1024, body.cpu_num)) : 0),
            cpu_freq_ghz: cpuFreqGhz || (typeof body.cpu_freq === 'number' ? Math.max(0, Math.min(100, body.cpu_freq)) : 0),
            memory_gb: memoryGb || (typeof body.memory_total === 'number' ? Math.max(0, Math.min(65536, body.memory_total)) : 0),
            os_full: sanitizeStr(body.os || body.os_full || '', MAX_STRING_LEN),
            displays: Array.isArray(body.displays) ? body.displays.slice(0, 10) : [],
            encoding: Array.isArray(body.encoding) ? body.encoding.slice(0, 20) : [],
            features: typeof body.features === 'object' && body.features !== null ? body.features : {},
            platform_additions: typeof body.platform_additions === 'object' && body.platform_additions !== null ? body.platform_additions : {}
        };

        // Limit serialized size of complex objects to prevent storage abuse (M-6)
        const maxJsonLen = 4096;
        const displaysJson = JSON.stringify(sysinfo.displays);
        const encodingJson = JSON.stringify(sysinfo.encoding);
        const featuresJson = JSON.stringify(sysinfo.features);
        if (displaysJson.length > maxJsonLen) sysinfo.displays = sysinfo.displays.slice(0, 4);
        if (encodingJson.length > maxJsonLen) sysinfo.encoding = sysinfo.encoding.slice(0, 5);
        if (featuresJson.length > maxJsonLen) sysinfo.features = {};

        await db.upsertPeerSysinfo(deviceId, sysinfo);
        console.log(`[API:SYSINFO] ✓ PRO activated for ${deviceId}: ${sysinfo.hostname} (${sysinfo.platform}) CPU: ${sysinfo.cpu_name} RAM: ${sysinfo.memory_gb}GB`);

        // Return plain text "SYSINFO_UPDATED" to activate PRO mode in client
        return res.type('text/plain').send('SYSINFO_UPDATED');
    } catch (err) {
        console.warn('[API:SYSINFO] Failed to store sysinfo:', err.message);
        // Return error but still indicate the ID was found (client won't retry immediately)
        return res.type('text/plain').send('ERROR');
    }
});

/**
 * POST /api/sysinfo_ver
 * RustDesk client checks if sysinfo needs to be re-uploaded.
 * Returns hash of current sysinfo; if client's hash matches, skip upload.
 * Empty response or any error triggers full sysinfo upload.
 */
router.post('/api/sysinfo_ver', async (req, res) => {
    const body = req.body || {};
    const deviceId = sanitizeStr(body.id || body.uuid || '', MAX_ID_LEN);
    
    if (!deviceId || !isValidDeviceId(deviceId)) {
        return res.type('text/plain').send('');
    }

    try {
        const sysinfo = await db.getPeerSysinfo(deviceId);
        if (sysinfo && sysinfo.raw_json) {
            // Generate hash of stored sysinfo for comparison (SHA256 truncated)
            const hash = require('crypto').createHash('sha256')
                .update(JSON.stringify(sysinfo.raw_json))
                .digest('hex')
                .substring(0, 16);
            return res.type('text/plain').send(hash);
        }
    } catch (err) {
        console.warn('[API:SYSINFO_VER] Error:', err.message);
    }

    // No sysinfo found - trigger upload
    return res.type('text/plain').send('');
});

/**
 * GET /api/ab
 * Address book — return stored address book for the authenticated user.
 * RustDesk expects: { data: "<json-string-with-tags-and-peers>", licensed_devices: 0 }
 */
router.get('/api/ab', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const abRecord = await db.getAddressBook(user.id, 'legacy');
    const abData = (abRecord && abRecord.data) ? String(abRecord.data) : '{}';
    return res.json({ data: abData, licensed_devices: 0 });
});

/**
 * POST /api/ab
 * Address book update — save the address book data from the client.
 * RustDesk sends: { data: "<json-string>" }
 */
router.post('/api/ab', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { data } = req.body || {};
    if (data !== undefined) {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        await db.saveAddressBook(user.id, dataStr, 'legacy');
        console.log(`[API:AB] Saved legacy address book for user ${user.username} (${dataStr.length} bytes)`);
    }
    return res.json({});
});

/**
 * GET /api/ab/personal
 * Personal address book — return stored personal AB.
 */
router.get('/api/ab/personal', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const abRecord = await db.getAddressBook(user.id, 'personal');
    const abData = (abRecord && abRecord.data) ? String(abRecord.data) : '{}';
    return res.json({ data: abData });
});

/**
 * GET /api/audit
 * Audit log — returns combined audit summary from all audit sources.
 */
router.get('/api/audit', async (req, res) => {
    const user = await authenticateRequest(req);
    if (!user) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    // Return combined recent audit events
    try {
        const conns = await db.getAuditConnections({ limit: 50 });
        const files = await db.getAuditFiles({ limit: 50 });
        const alarms = await db.getAuditAlarms({ limit: 50 });
        return res.json({
            data: {
                connections: conns,
                files: files,
                alarms: alarms
            }
        });
    } catch (err) {
        console.error('[API:AUDIT] Error:', err.message);
        return res.json({ data: { connections: [], files: [], alarms: [] } });
    }
});

/**
 * POST /api/ab/personal
 * Personal address book update — save personal AB data.
 */
router.post('/api/ab/personal', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const { data } = req.body || {};
    if (data !== undefined) {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        await db.saveAddressBook(user.id, dataStr, 'personal');
        console.log(`[API:AB] Saved personal address book for user ${user.username} (${dataStr.length} bytes)`);
    }
    return res.json({});
});

/**
 * GET /api/ab/tags
 * Address book tags — return tags from legacy address book.
 */
router.get('/api/ab/tags', async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const tags = await db.getAddressBookTags(user.id);
    return res.json({ data: tags });
});

/**
 * GET /api/users
 * List users — return current user only (for RustDesk client with Bearer token).
 * Falls through to panel routes if no Bearer token but session exists.
 */
router.get('/api/users', async (req, res, next) => {
    const token = extractBearerToken(req);
    // If no Bearer token, fallthrough to panel routes (may have session cookie)
    if (!token) {
        return next('route');
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    return res.json({
        data: [{
            name: user.username,
            email: '',
            note: '',
            status: 1,
            is_admin: user.role === 'admin',
            group_name: 'Default'
        }],
        total: 1
    });
});

/**
 * GET /api/peers
 * List peers/devices with sysinfo, metrics, and online status.
 * Returns RustDesk-compatible peer data merged with sysinfo.
 * Falls through to panel routes if no Bearer token but session exists.
 */
router.get('/api/peers', async (req, res, next) => {
    const token = extractBearerToken(req);
    // If no Bearer token, fallthrough to panel routes (may have session cookie)
    if (!token) {
        return next('route');
    }
    const user = await authService.validateAccessToken(token);
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        // Get all devices from peer table
        const devices = await db.getAllDevices({
            search: req.query.search || '',
            status: req.query.status || ''
        });

        // Build sysinfo lookup map
        const allSysinfo = await db.getAllPeerSysinfo();
        const sysinfoMap = {};
        for (const si of allSysinfo) {
            sysinfoMap[si.peer_id] = si;
        }

        // Merge devices with sysinfo
        const enrichedPeers = devices.map(device => {
            const si = sysinfoMap[device.id] || {};
            return {
                id: device.id,
                hostname: si.hostname || device.hostname || '',
                username: si.username || device.username || '',
                platform: si.platform || device.platform || '',
                version: si.version || '',
                ip: device.ip || '',
                online: device.online,
                last_online: device.last_online || '',
                created_at: device.created_at || '',
                note: device.note || '',
                banned: device.banned,
                pk: device.pk || '',
                cpu: si.cpu_name || '',
                memory: si.memory_gb || 0,
                os: si.os_full || '',
                displays: si.displays || [],
                folder_id: device.folder_id
            };
        });

        // Pagination
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.page_size, 10) || 100));
        const start = (page - 1) * pageSize;
        const paged = enrichedPeers.slice(start, start + pageSize);

        return res.json({
            data: paged,
            total: enrichedPeers.length
        });
    } catch (err) {
        console.error('[API:PEERS] Error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * GET /api/device-group/accessible
 * Returns accessible device groups for the current user.
 */
router.get('/api/device-group/accessible', requireAuth, async (req, res) => {
    try {
        const groups = await db.getAllDeviceGroups();
        return res.json({
            data: groups.map(g => ({
                guid: g.guid,
                name: g.name,
                note: g.note || '',
                team_id: g.team_id || '',
                accessed_count: g.member_count || 0
            })),
            total: groups.length
        });
    } catch (err) {
        console.error('[API:DEVICE-GROUP] Error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * GET /api/device-group
 * List all device groups.
 */
router.get('/api/device-group', requireAuth, async (req, res) => {
    try {
        const groups = await db.getAllDeviceGroups();
        return res.json({
            data: groups.map(g => ({
                guid: g.guid,
                name: g.name,
                note: g.note || '',
                team_id: g.team_id || '',
                member_count: g.member_count || 0
            })),
            total: groups.length
        });
    } catch (err) {
        console.error('[API:DEVICE-GROUP] Error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * POST /api/device-group
 * Create or update a device group (admin only).
 */
router.post('/api/device-group', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { guid, name, note, team_id } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        if (guid) {
            // Update existing
            const updated = await db.updateDeviceGroup(guid, {
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                note: sanitizeStr(note || '', MAX_STRING_LEN),
                team_id: sanitizeStr(team_id || '', 64)
            });
            if (!updated) {
                return res.status(404).json({ error: 'Group not found' });
            }
            return res.json(updated);
        } else {
            // Create new
            const created = await db.createDeviceGroup({
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                note: sanitizeStr(note || '', MAX_STRING_LEN),
                team_id: sanitizeStr(team_id || '', 64)
            });
            return res.json(created);
        }
    } catch (err) {
        console.error('[API:DEVICE-GROUP] Create/update error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/user/group
 * Get current user group info.
 */
router.get('/api/user/group', requireAuth, async (req, res) => {
    try {
        const groups = await db.getAllUserGroups();
        if (groups.length === 0) {
            return res.json({ data: { name: 'Default', guid: 'default' } });
        }
        // Return the first user group (user group assignment is future work)
        return res.json({
            data: {
                name: groups[0].name,
                guid: groups[0].guid
            }
        });
    } catch (err) {
        return res.json({ data: { name: 'Default', guid: 'default' } });
    }
});

/**
 * GET /api/software/client-download-link
 * Client download link — return empty.
 */
router.get('/api/software/client-download-link', (req, res) => {
    return res.json({});
});

/**
 * GET /api/software
 * Software update check — return empty.
 */
router.get('/api/software', (req, res) => {
    return res.json({});
});

/**
 * POST /api/login
 * RustDesk-compatible login endpoint.
 * 
 * Request body (initial login):
 *   { username, password, id, uuid, autoLogin, type: "account" }
 * 
 * Request body (2FA verification):
 *   { username, tfaCode, secret, id, uuid, type: "email_code" }
 * 
 * Response types:
 *   { type: "access_token", access_token, user } — success
 *   { type: "tfa_check", tfa_type: "totp", secret } — 2FA required
 */
router.post('/api/login', async (req, res) => {
    const ip = getClientIp(req);

    try {
        const body = req.body || {};
        console.log('[API:LOGIN] Request body keys:', Object.keys(body).join(', '), 'IP:', ip);

        const {
            username,
            password,
            id: clientId,
            uuid: clientUuid,
            type: reqType,
            tfaCode,
            verificationCode,
            secret: tfaSecret,
            deviceInfo
        } = body;

        // Support both field names: tfaCode (our API) and verificationCode (RustDesk client)
        const totpCode = tfaCode || verificationCode;

        // ── TFA verification step ──
        if (totpCode && tfaSecret) {
            return handleTfaVerification(req, res, ip, totpCode);
        }

        // ── Initial login step ──
        if (!username || !password) {
            return res.status(400).json({ error: 'Missing credentials' });
        }

        // Check brute-force protection
        const bruteCheck = authService.checkBruteForce(username, ip);
        if (bruteCheck.blocked) {
            await db.logAction(null, 'api_login_blocked', `User: ${username}, IP: ${ip}, Reason: ${bruteCheck.reason}`, ip);
            return res.status(429).json({
                error: bruteCheck.reason,
                retry_after: bruteCheck.retryAfter
            });
        }

        // Check if the connecting device is banned (clientId = device ID)
        const sanitizedClientId = sanitizeStr(clientId || '', MAX_ID_LEN);
        if (sanitizedClientId && isValidDeviceId(sanitizedClientId)) {
            const device = await db.getDevice(sanitizedClientId);
            if (device && device.banned) {
                console.log(`[API:LOGIN] Rejected login from banned device: ${sanitizedClientId}`);
                await db.logAction(null, 'api_login_banned_device', `Device: ${sanitizedClientId}, User: ${username}`, ip);
                return res.status(403).json({ error: 'Device is banned' });
            }
        }

        // Authenticate
        const user = await authService.authenticate(username, password);

        if (!user) {
            authService.recordAttempt(username, ip, false);
            await db.logAction(null, 'api_login_failed', `User: ${username}`, ip);

            // Generic error — don't reveal whether user exists
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if TOTP 2FA is required
        if (user.totpRequired) {
            // Generate a temporary secret for the TFA session
            const tfaSessionSecret = require('crypto').randomBytes(16).toString('hex');

            // Store TFA session in memory (short-lived)
            if (!req.app.locals._tfaSessions) {
                req.app.locals._tfaSessions = new Map();
            }
            req.app.locals._tfaSessions.set(tfaSessionSecret, {
                userId: user.id,
                username: user.username,
                role: user.role,
                clientId: clientId || '',
                clientUuid: clientUuid || '',
                ip,
                createdAt: Date.now()
            });

            // Cleanup old TFA sessions (>5 min)
            cleanupTfaSessions(req.app.locals._tfaSessions);

            await db.logAction(user.id, 'api_login_tfa_required', `Client: ${clientId || 'unknown'}`, ip);

            return res.json({
                type: 'tfa_check',
                tfa_type: 'totp',
                secret: tfaSessionSecret
            });
        }

        // No 2FA — issue token directly
        authService.recordAttempt(username, ip, true);
        const token = await authService.generateAccessToken(user.id, clientId, clientUuid, ip);
        await db.updateLastLogin(user.id);
        await db.logAction(user.id, 'api_login_success', `Client: ${clientId || 'unknown'}`, ip);

        return res.json({
            type: 'access_token',
            access_token: token,
            user: buildUserPayload(user)
        });

    } catch (err) {
        console.error('RustDesk API login error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * Handle TFA verification (second step of login)
 */
async function handleTfaVerification(req, res, ip, totpCode) {
    try {
        const {
            verificationCode,
            tfaCode,
            secret: tfaSecret,
            id: clientId,
            uuid: clientUuid
        } = req.body;

        const code = totpCode || tfaCode || verificationCode;

        const sessions = req.app.locals._tfaSessions;
        if (!sessions || !sessions.has(tfaSecret)) {
            return res.status(401).json({ error: 'TFA session expired or invalid' });
        }

        const session = sessions.get(tfaSecret);

        // Verify TOTP code
        const verified = authService.verifyTotpCode(session.userId, code);

        if (!verified) {
            authService.recordAttempt(session.username, ip, false);
            await db.logAction(session.userId, 'api_tfa_failed', `Client: ${session.clientId || 'unknown'}`, ip);
            return res.status(401).json({ error: 'Invalid verification code' });
        }

        // TFA passed — clean up session and issue token
        sessions.delete(tfaSecret);

        authService.recordAttempt(session.username, ip, true);
        const token = await authService.generateAccessToken(
            session.userId,
            clientId || session.clientId,
            clientUuid || session.clientUuid,
            ip
        );
        await db.updateLastLogin(session.userId);
        await db.logAction(session.userId, 'api_login_success', `Client: ${clientId || session.clientId || 'unknown'} (2FA: totp)`, ip);

        return res.json({
            type: 'access_token',
            access_token: token,
            user: buildUserPayload({
                username: session.username,
                role: session.role
            })
        });

    } catch (err) {
        console.error('RustDesk API TFA error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
}

/**
 * POST /api/logout
 * Revoke the Bearer token.
 * RustDesk client sends { id, uuid } in body.
 */
router.post('/api/logout', async (req, res) => {
    const ip = getClientIp(req);

    try {
        const token = extractBearerToken(req);
        const { id: clientId, uuid: clientUuid } = req.body || {};

        if (token) {
            // Validate token to get user info for logging
            const user = await authService.validateAccessToken(token);
            if (user) {
                await authService.revokeClientTokens(user.id, clientId, clientUuid);
                await db.logAction(user.id, 'api_logout', `Client: ${clientId || 'unknown'}`, ip);
            }
        }

        // Always return success (don't reveal token validity)
        return res.json({});

    } catch (err) {
        console.error('RustDesk API logout error:', err);
        return res.json({});
    }
});

/**
 * GET/POST /api/currentUser
 * Returns current user info based on Bearer token.
 * RustDesk client uses POST after login, GET for refresh.
 */
router.all('/api/currentUser', async (req, res) => {
    try {
        const token = extractBearerToken(req);

        if (!token) {
            return res.status(401).json({ error: 'Authorization required' });
        }

        const user = await authService.validateAccessToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }

        return res.json({
            name: user.username,
            email: '',
            note: '',
            status: 1,
            is_admin: user.role === 'admin'
        });

    } catch (err) {
        console.error('RustDesk API currentUser error:', err);
        return res.status(500).json({ error: 'Server error' });
    }
});

// ==================== Internal Helpers ====================

/**
 * Cleanup expired TFA sessions (>5 min old)
 */
function cleanupTfaSessions(sessions) {
    if (!sessions) return;
    const maxAge = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    for (const [key, session] of sessions) {
        if (now - session.createdAt > maxAge) {
            sessions.delete(key);
        }
    }
}

// ==================== Security: Server Key Endpoint ====================

/**
 * GET /api/server-key
 * Returns the RustDesk Rendezvous Server Ed25519 public key (base64).
 * This key is used by clients to verify peer identity (signed_id_pk).
 * Public key is inherently safe to expose — no auth required.
 */
router.get('/api/server-key', (req, res) => {
    try {
        if (!fs.existsSync(config.pubKeyPath)) {
            return res.json({ key: '' });
        }
        const key = fs.readFileSync(config.pubKeyPath, 'utf8').trim();
        // Validate: should decode to 32 bytes (Ed25519 public key)
        const decoded = Buffer.from(key, 'base64');
        if (decoded.length !== 32) {
            console.warn('[API:SERVER-KEY] Invalid RS public key length:', decoded.length);
            return res.json({ key: '' });
        }
        return res.json({ key });
    } catch (err) {
        console.warn('[API:SERVER-KEY] Error reading public key:', err.message);
        return res.json({ key: '' });
    }
});

/**
 * GET /api/server-key/fingerprint
 * Returns SHA-256 fingerprint of RS public key for out-of-band verification.
 */
router.get('/api/server-key/fingerprint', (req, res) => {
    try {
        if (!fs.existsSync(config.pubKeyPath)) {
            return res.json({ fingerprint: '', algorithm: 'SHA-256' });
        }
        const key = fs.readFileSync(config.pubKeyPath, 'utf8').trim();
        const hash = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex');
        return res.json({
            fingerprint: hash.match(/.{2}/g).join(':').toUpperCase(),
            algorithm: 'SHA-256'
        });
    } catch (err) {
        return res.json({ fingerprint: '', algorithm: 'SHA-256' });
    }
});

// ==================== Phase 2: Audit Endpoints ====================

/**
 * POST /api/audit/conn
 * Report a connection event from RustDesk client.
 * Body: { host_id, host_uuid, peer_id, peer_name, action, conn_type, session_id, ip }
 */
router.post('/api/audit/conn', async (req, res) => {
    try {
        const body = req.body || {};

        // Validate required fields (host_id may be string or number from RustDesk client)
        const hostId = body.host_id != null ? String(body.host_id) : '';
        if (!hostId) {
            return res.status(400).json({ error: 'host_id is required' });
        }

        // Validate conn_type if provided
        const connType = typeof body.conn_type === 'number' ? body.conn_type : 0;
        if (!CONN_TYPES.includes(connType)) {
            return res.status(400).json({ error: 'Invalid conn_type' });
        }

        await db.insertAuditConnection({
            host_id: sanitizeStr(hostId, MAX_ID_LEN),
            host_uuid: sanitizeStr(body.host_uuid != null ? String(body.host_uuid) : '', MAX_ID_LEN),
            peer_id: sanitizeStr(body.peer_id != null ? String(body.peer_id) : '', MAX_ID_LEN),
            peer_name: sanitizeStr(body.peer_name || '', MAX_HOSTNAME_LEN),
            action: sanitizeStr(body.action || 'connect', 32),
            conn_type: connType,
            session_id: sanitizeStr(body.session_id || '', 64),
            ip: sanitizeStr(body.ip || getClientIp(req), 64)
        });

        return res.json({});
    } catch (err) {
        console.error('[API:AUDIT/CONN] Error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/audit/conn
 * Query connection audit events.
 * Query params: host_id, peer_id, action, limit, offset
 */
router.get('/api/audit/conn', requireAuth, async (req, res) => {
    try {
        const filters = {
            host_id: req.query.host_id || '',
            peer_id: req.query.peer_id || '',
            action: req.query.action || '',
            limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100)),
            offset: Math.max(0, parseInt(req.query.offset, 10) || 0)
        };

        const data = await db.getAuditConnections(filters);
        const total = await db.countAuditConnections(filters);

        return res.json({ data, total });
    } catch (err) {
        console.error('[API:AUDIT/CONN] Query error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * POST /api/audit/file
 * Report a file transfer event.
 * Body: { host_id, host_uuid, peer_id, direction, path, is_file, num_files, files, ip, peer_name }
 */
router.post('/api/audit/file', async (req, res) => {
    try {
        const body = req.body || {};

        if (!body.host_id || typeof body.host_id !== 'string') {
            return res.status(400).json({ error: 'host_id is required' });
        }

        await db.insertAuditFile({
            host_id: sanitizeStr(body.host_id, MAX_ID_LEN),
            host_uuid: sanitizeStr(body.host_uuid || '', MAX_ID_LEN),
            peer_id: sanitizeStr(body.peer_id || '', MAX_ID_LEN),
            direction: [0, 1].includes(body.direction) ? body.direction : 0,
            path: sanitizeStr(body.path || '', MAX_PATH_LEN),
            is_file: body.is_file !== false,
            num_files: typeof body.num_files === 'number' ? Math.max(0, Math.min(10000, body.num_files)) : 0,
            files: Array.isArray(body.files) ? body.files.slice(0, 100).map(f => ({
                name: sanitizeStr(typeof f === 'object' && f !== null ? (f.name || '') : String(f || ''), MAX_PATH_LEN),
                size: typeof f === 'object' && f !== null && typeof f.size === 'number' ? Math.max(0, f.size) : 0
            })) : [],
            ip: sanitizeStr(body.ip || getClientIp(req), 64),
            peer_name: sanitizeStr(body.peer_name || '', MAX_HOSTNAME_LEN)
        });

        return res.json({});
    } catch (err) {
        console.error('[API:AUDIT/FILE] Error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/audit/file
 * Query file transfer audit events.
 */
router.get('/api/audit/file', requireAuth, async (req, res) => {
    try {
        const filters = {
            host_id: req.query.host_id || '',
            peer_id: req.query.peer_id || '',
            limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100)),
            offset: Math.max(0, parseInt(req.query.offset, 10) || 0)
        };

        const data = await db.getAuditFiles(filters);
        const total = await db.countAuditFiles(filters);

        return res.json({ data, total });
    } catch (err) {
        console.error('[API:AUDIT/FILE] Query error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * POST /api/audit/alarm
 * Report a security alarm event.
 * Body: { alarm_type, alarm_name, host_id, peer_id, ip, details }
 */
router.post('/api/audit/alarm', async (req, res) => {
    try {
        const body = req.body || {};

        const alarmType = typeof body.alarm_type === 'number' ? body.alarm_type : 0;
        if (!ALARM_TYPES.includes(alarmType)) {
            return res.status(400).json({ error: 'Invalid alarm_type (0-6)' });
        }

        await db.insertAuditAlarm({
            alarm_type: alarmType,
            alarm_name: sanitizeStr(body.alarm_name || '', MAX_STRING_LEN),
            host_id: sanitizeStr(body.host_id || '', MAX_ID_LEN),
            peer_id: sanitizeStr(body.peer_id || '', MAX_ID_LEN),
            ip: sanitizeStr(body.ip || getClientIp(req), 64),
            details: body.details || {}
        });

        return res.json({});
    } catch (err) {
        console.error('[API:AUDIT/ALARM] Error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/audit/alarm
 * Query security alarm events.
 */
router.get('/api/audit/alarm', requireAuth, async (req, res) => {
    try {
        const filters = {
            alarm_type: req.query.alarm_type !== undefined ? parseInt(req.query.alarm_type, 10) : undefined,
            host_id: req.query.host_id || '',
            limit: Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100)),
            offset: Math.max(0, parseInt(req.query.offset, 10) || 0)
        };

        const data = await db.getAuditAlarms(filters);
        const total = await db.countAuditAlarms(filters);

        return res.json({ data, total });
    } catch (err) {
        console.error('[API:AUDIT/ALARM] Query error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

// ==================== Phase 3: User Groups ====================

/**
 * GET /api/user-groups
 * List all user groups.
 */
router.get('/api/user-groups', requireAuth, async (req, res) => {
    try {
        const groups = await db.getAllUserGroups();
        return res.json({
            data: groups.map(g => ({
                guid: g.guid,
                name: g.name,
                note: g.note || '',
                team_id: g.team_id || ''
            })),
            total: groups.length
        });
    } catch (err) {
        console.error('[API:USER-GROUPS] Error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * POST /api/user-groups
 * Create or update a user group (admin only).
 */
router.post('/api/user-groups', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { guid, name, note, team_id } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Group name is required' });
        }

        if (guid) {
            const updated = await db.updateUserGroup(guid, {
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                note: sanitizeStr(note || '', MAX_STRING_LEN),
                team_id: sanitizeStr(team_id || '', 64)
            });
            if (!updated) {
                return res.status(404).json({ error: 'Group not found' });
            }
            return res.json(updated);
        } else {
            const created = await db.createUserGroup({
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                note: sanitizeStr(note || '', MAX_STRING_LEN),
                team_id: sanitizeStr(team_id || '', 64)
            });
            return res.json(created);
        }
    } catch (err) {
        console.error('[API:USER-GROUPS] Create/update error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

// ==================== Phase 3: Strategies ====================

/**
 * GET /api/strategies
 * List all access control strategies.
 */
router.get('/api/strategies', requireAuth, async (req, res) => {
    try {
        const strategies = await db.getAllStrategies();
        return res.json({
            data: strategies.map(s => ({
                guid: s.guid,
                name: s.name,
                user_group_guid: s.user_group_guid || '',
                device_group_guid: s.device_group_guid || '',
                enabled: s.enabled === 1,
                permissions: s.permissions || {}
            })),
            total: strategies.length
        });
    } catch (err) {
        console.error('[API:STRATEGIES] Error:', err.message);
        return res.json({ data: [], total: 0 });
    }
});

/**
 * POST /api/strategies
 * Create or update a strategy (admin only).
 */
router.post('/api/strategies', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { guid, name, user_group_guid, device_group_guid, enabled, permissions } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            return res.status(400).json({ error: 'Strategy name is required' });
        }

        if (guid) {
            const updated = await db.updateStrategy(guid, {
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                user_group_guid: sanitizeStr(user_group_guid || '', 64),
                device_group_guid: sanitizeStr(device_group_guid || '', 64),
                enabled,
                permissions: typeof permissions === 'object' ? permissions : {}
            });
            if (!updated) {
                return res.status(404).json({ error: 'Strategy not found' });
            }
            return res.json(updated);
        } else {
            const created = await db.createStrategy({
                name: sanitizeStr(name, MAX_HOSTNAME_LEN),
                user_group_guid: sanitizeStr(user_group_guid || '', 64),
                device_group_guid: sanitizeStr(device_group_guid || '', 64),
                enabled,
                permissions: typeof permissions === 'object' ? permissions : {}
            });
            return res.json(created);
        }
    } catch (err) {
        console.error('[API:STRATEGIES] Create/update error:', err.message);
        return res.status(500).json({ error: 'Server error' });
    }
});

// ==================== Security: Peer Key Endpoint ====================

/**
 * GET /api/peer-key/:id
 * Returns the Curve25519 public key for a specific peer (base64).
 * Requires authentication — keys should only be disclosed to logged-in users.
 */
router.get('/api/peer-key/:id', requireAuth, async (req, res) => {
    try {
        const peerId = sanitizeStr(req.params.id, MAX_ID_LEN);
        if (!peerId) {
            return res.status(400).json({ error: 'Invalid peer ID' });
        }

        const device = await db.getDeviceById(peerId);
        if (!device) {
            return res.json({ id: peerId, pk: '' });
        }

        return res.json({
            id: device.id,
            pk: device.pk || ''
        });
    } catch (err) {
        console.error('[API:PEER-KEY] Error:', err.message);
        return res.json({ id: req.params.id, pk: '' });
    }
});

module.exports = router;
