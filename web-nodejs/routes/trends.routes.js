/**
 * BetterDesk Console — trends for the Reports page.
 *
 *   GET /api/reports/trends?days=14
 *
 * Returns raw, already-recorded events for the last N days so the browser can
 * bucket them by local day:
 *   - sessions: remote-control sessions observed by the signal server
 *     (peer_connection_sessions via the Go API, one call per device)
 *   - help: help requests with their status and last change
 *
 * Nothing here is estimated. Sessions are fetched per device because the Go
 * server only exposes them per device; the result is cached for five minutes
 * and capped at MAX_PEERS devices.
 */

'use strict';

const express = require('express');
const router = express.Router();
const betterdeskApi = require('../services/betterdeskApi');
const { requireAuth, requirePermission } = require('../middleware/auth');

const MAX_PEERS = 500;
const PER_PEER_LIMIT = 500;
const CONCURRENCY = 6;
const CACHE_MS = 5 * 60 * 1000;
let cache = null;

async function mapLimit(items, limit, fn) {
    const out = [];
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            out[idx] = await fn(items[idx]).catch(() => null);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}

async function collect(days) {
    const since = Date.now() - days * 86400000;
    const toTime = (s) => {
        if (!s) return NaN;
        const str = String(s);
        // SQLite timestamps have no zone and are UTC
        return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(str) ? str : str.replace(' ', 'T') + 'Z');
    };

    const peers = (await betterdeskApi.getAllPeers({ includeDeleted: false })) || [];
    const ids = peers.map((p) => p.id || p.peer_id).filter(Boolean).slice(0, MAX_PEERS);
    const lists = await mapLimit(ids, CONCURRENCY, async (id) => {
        const r = await betterdeskApi.getPeerConnectionSessions(id, { limit: PER_PEER_LIMIT });
        const rows = (r && (r.data || r.sessions)) || [];
        return Array.isArray(rows) ? rows : (rows.sessions || []);
    });
    const seen = new Set();
    const sessions = [];
    for (const list of lists) {
        for (const s of list || []) {
            const start = toTime(s.started_at);
            if (!(start >= since)) continue;
            const key = s.id != null ? 'id:' + s.id : [s.host_id, s.peer_id, s.started_at].join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const end = toTime(s.ended_at);
            sessions.push({ start, end: Number.isFinite(end) ? end : null });
        }
    }

    const help = [];
    const hr = await betterdeskApi.listHelpRequests({ limit: 5000 });
    for (const r of (hr && hr.data) || []) {
        const created = toTime(r.created_at);
        const updated = toTime(r.updated_at);
        if (!(created >= since) && !(updated >= since)) continue;
        help.push({ created, updated: Number.isFinite(updated) ? updated : null, status: String(r.status || '') });
    }

    return { days, since, sessions, help, devicesChecked: ids.length, devicesTotal: peers.length };
}

router.get('/api/reports/trends', requireAuth, requirePermission('audit.view'), async (req, res) => {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 14));
    try {
        if (!cache || cache.days !== days || Date.now() - cache.at > CACHE_MS) {
            cache = { days, at: Date.now(), data: await collect(days) };
        }
        res.json({ success: true, data: cache.data, generatedAt: cache.at });
    } catch (err) {
        console.error('Trends error:', err);
        res.status(502).json({ success: false, error: req.t('errors.server_error') });
    }
});

module.exports = router;
