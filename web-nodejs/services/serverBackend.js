/**
 * BetterDesk Console - Server Backend Abstraction Layer
 *
 * Provides a unified interface for device/peer operations regardless of
 * which backend is active ('rustdesk' or 'betterdesk').
 *
 * In 'rustdesk' mode  → delegates to database.js (SQLite) + hbbsApi.js
 * In 'betterdesk' mode → delegates to betterdeskApi.js (Go server REST API)
 *
 * The active backend is determined by:
 *   1. auth.db settings table ('server_backend' key) — set via Settings UI
 *   2. config.serverBackend (env var SERVER_BACKEND) — fallback
 */

const config = require('../config/config');
const db = require('./database');
const hbbsApi = require('./hbbsApi');
const betterdeskApi = require('./betterdeskApi');

// Cache the resolved backend name to avoid hitting the DB on every call.
// Invalidated explicitly when the user changes it from the UI.
let _cachedBackend = null;

/**
 * Return the active backend name: 'rustdesk' | 'betterdesk'
 */
async function getActiveBackend() {
    if (_cachedBackend) return _cachedBackend;
    try {
        const stored = await db.getSetting('server_backend');
        _cachedBackend = stored || config.serverBackend || 'rustdesk';
    } catch {
        _cachedBackend = config.serverBackend || 'rustdesk';
    }
    return _cachedBackend;
}

/**
 * Change the active backend. Persists to auth.db and invalidates cache.
 * @param {'rustdesk'|'betterdesk'} name
 */
async function setActiveBackend(name) {
    const allowed = ['rustdesk', 'betterdesk'];
    if (!allowed.includes(name)) {
        throw new Error(`Invalid backend: ${name}. Allowed: ${allowed.join(', ')}`);
    }
    await db.setSetting('server_backend', name);
    _cachedBackend = name;
}

/**
 * Returns true when the active backend is BetterDesk (Go server).
 */
async function isBetterDesk() {
    return (await getActiveBackend()) === 'betterdesk';
}

// ========================== Health / Stats ===================================

async function getHealth() {
    if (await isBetterDesk()) {
        return betterdeskApi.getHealth();
    }
    return hbbsApi.getHealth();
}

async function getStats() {
    if (await isBetterDesk()) {
        const result = await betterdeskApi.getServerStats();
        if (result.success && result.data) {
            // Normalise Go shape → panel shape
            const d = result.data;
            const total = d.peers_total ?? d.total_peers ?? d.total ?? 0;
            const online = d.peers_online ?? d.peers_online_live ?? d.online_peers ?? d.online ?? 0;
            return {
                total,
                online,
                offline: total - online,
                banned: d.peers_banned ?? d.banned_peers ?? d.banned ?? 0,
                withNotes: d.with_notes ?? 0
            };
        }
        // Fallthrough: fetch from local DB as fallback
    }
    return await db.getStats();
}

async function getServerInfo() {
    if (await isBetterDesk()) {
        return betterdeskApi.getServerInfo();
    }
    return hbbsApi.getServerInfo();
}

// ========================== Devices / Peers ==================================

async function getAllDevices(filters = {}) {
    if (await isBetterDesk()) {
        let peers = await betterdeskApi.getAllPeers();

        // Overlay folder_id from auth.db assignments (Go server doesn't track folders)
        try {
            const assignments = await db.getAllFolderAssignments();
            for (const peer of peers) {
                if (assignments[peer.id] !== undefined) {
                    peer.folder_id = assignments[peer.id];
                }
            }
        } catch (err) {
            // Non-critical: folders simply won't be assigned
            console.error('Failed to overlay folder assignments:', err.message);
        }

        // Apply client-side filtering (the Go API may not support all filter params)
        if (filters.search) {
            const s = filters.search.toLowerCase();
            peers = peers.filter(p =>
                (p.id && p.id.toLowerCase().includes(s)) ||
                (p.username && p.username.toLowerCase().includes(s)) ||
                (p.hostname && p.hostname.toLowerCase().includes(s)) ||
                (p.note && p.note.toLowerCase().includes(s))
            );
        }
        if (filters.status === 'online') {
            peers = peers.filter(p => p.online);
        } else if (filters.status === 'offline') {
            peers = peers.filter(p => !p.online && !p.banned);
        } else if (filters.status === 'banned') {
            peers = peers.filter(p => p.banned);
        }
        if (filters.hasNotes) {
            peers = peers.filter(p => p.note && p.note.trim() !== '');
        }
        // Sort
        const col = filters.sortBy || 'last_online';
        const asc = filters.sortOrder === 'asc';
        peers.sort((a, b) => {
            const va = a[col] || '';
            const vb = b[col] || '';
            return asc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
        });
        return peers;
    }
    return await db.getAllDevices(filters);
}

async function getDeviceById(id) {
    if (await isBetterDesk()) {
        const peer = await betterdeskApi.getPeer(id);
        // Overlay folder_id from auth.db
        if (peer) {
            try {
                const assignments = await db.getAllFolderAssignments();
                if (assignments[peer.id] !== undefined) {
                    peer.folder_id = assignments[peer.id];
                }
            } catch { /* non-critical */ }
        }
        return peer;
    }
    return await db.getDeviceById(id);
}

async function deleteDevice(id) {
    if (await isBetterDesk()) {
        return betterdeskApi.deletePeer(id);
    }
    return await db.deleteDevice(id);
}

async function setBanStatus(id, banned, reason = '') {
    if (await isBetterDesk()) {
        return banned
            ? betterdeskApi.banPeer(id, reason)
            : betterdeskApi.unbanPeer(id);
    }
    return await db.setBanStatus(id, banned, reason);
}

async function updateDevice(id, data) {
    // BetterDesk Go server does not expose a peer-update endpoint for user/note,
    // so we keep writing to the local SQLite in both modes for now.
    return await db.updateDevice(id, data);
}

async function changePeerId(oldId, newId) {
    if (await isBetterDesk()) {
        return betterdeskApi.changePeerId(oldId, newId);
    }
    return hbbsApi.changePeerId(oldId, newId);
}

// ========================== Online Status Sync ===============================

async function syncOnlineStatus() {
    if (await isBetterDesk()) {
        // BetterDesk Go server owns the peer map — no sync needed.
        return betterdeskApi.syncOnlineStatus();
    }
    // hbbs legacy backend uses raw SQLite — only available in SQLite mode
    if (db.DB_TYPE === 'postgres' || db.DB_TYPE === 'postgresql') {
        return { synced: 0, skipped: true, reason: 'hbbs_requires_sqlite' };
    }
    return hbbsApi.syncOnlineStatus(db.getDb());
}

// ========================== BetterDesk-only features =========================
// These are only available when backend === 'betterdesk'.
// Routes should check isBetterDesk() before calling them.

async function getStatusSummary() {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.getStatusSummary();
}

async function getBlocklist() {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.getBlocklist();
}

async function addBlocklistEntry(entry) {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.addBlocklistEntry(entry);
}

async function removeBlocklistEntry(entry) {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.removeBlocklistEntry(entry);
}

async function setPeerTags(id, tags) {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.setPeerTags(id, tags);
}

async function getPeersByTag(tag) {
    if (!await isBetterDesk()) return [];
    return betterdeskApi.getPeersByTag(tag);
}

async function getAuditEvents(limit) {
    if (!await isBetterDesk()) return { success: false, error: 'Requires BetterDesk backend' };
    return betterdeskApi.getAuditEvents(limit);
}

module.exports = {
    // Backend management
    getActiveBackend,
    setActiveBackend,
    isBetterDesk,
    // Health / Stats
    getHealth,
    getStats,
    getServerInfo,
    // Devices
    getAllDevices,
    getDeviceById,
    deleteDevice,
    setBanStatus,
    updateDevice,
    changePeerId,
    // Status sync
    syncOnlineStatus,
    // BetterDesk-only
    getStatusSummary,
    getBlocklist,
    addBlocklistEntry,
    removeBlocklistEntry,
    setPeerTags,
    getPeersByTag,
    getAuditEvents
};
