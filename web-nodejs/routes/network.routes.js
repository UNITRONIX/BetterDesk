/**
 * BetterDesk Console — Network Monitoring API Routes
 *
 * CRUD for monitoring targets, check results, and manual checks.
 *
 * Endpoints:
 *
 * Targets (admin):
 *   GET    /api/network/targets              — List all targets
 *   POST   /api/network/targets              — Create target
 *   GET    /api/network/targets/:id          — Get target detail
 *   PATCH  /api/network/targets/:id          — Update target
 *   DELETE /api/network/targets/:id          — Delete target
 *
 * Checks (admin):
 *   POST   /api/network/targets/:id/check    — Run manual check
 *   GET    /api/network/targets/:id/history  — Get check history
 *   GET    /api/network/stats                — Overview stats
 *
 * Tools:
 *   POST   /api/network/ping                 — Ad-hoc ping test
 *   POST   /api/network/tcp                  — Ad-hoc TCP port test
 *   POST   /api/network/http                 — Ad-hoc HTTP check
 *   POST   /api/network/resolve              — DNS resolve
 *
 * Monitor control:
 *   POST   /api/network/monitor/start        — Start polling loop
 *   POST   /api/network/monitor/stop         — Stop polling loop
 *   GET    /api/network/monitor/status        — Get monitor status
 *
 * Permissions: reading targets, history and monitor status needs device.view;
 * running a check or an ad-hoc tool needs device.connect (the same as the
 * Network tools page); changing targets and starting or stopping the
 * monitor needs server.config.
 *
 * @author UNITRONIX
 * @version 1.0.0
 */

'use strict';

const express = require('express');
const router = express.Router();
const { NetworkMonitor, pingHost, checkTcpPort, checkHttp, resolveHost } = require('../services/networkMonitor');
const { getAdapter } = require('../services/dbAdapter');
const { requirePermission } = require('../middleware/auth');

// Monitor instance (initialized lazily)
let monitor = null;

function getMonitor() {
    if (!monitor) {
        const adapter = getAdapter();
        if (adapter) monitor = new NetworkMonitor(adapter);
    }
    return monitor;
}

// ---------------------------------------------------------------------------
//  Auth middleware
// ---------------------------------------------------------------------------

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// ---------------------------------------------------------------------------
//  Targets CRUD
// ---------------------------------------------------------------------------

const VALID_CHECK_TYPES = ['ping', 'tcp', 'http', 'https'];

/**
 * GET /api/network/targets — List all monitoring targets
 */
router.get('/targets', requireAdmin, requirePermission('device.view'), async (req, res) => {
    try {
        const { enabled, check_type } = req.query;
        const adapter = getAdapter();
        const targets = await adapter.getNetworkTargets({
            enabled: enabled !== undefined ? enabled === 'true' : undefined,
            check_type,
        });
        res.json(targets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/targets — Create a monitoring target
 */
router.post('/targets', requireAdmin, requirePermission('server.config'), async (req, res) => {
    try {
        const { name, host, port, url, check_type, timeout_ms, interval_ms, enabled } = req.body;

        if (!name || !check_type) {
            return res.status(400).json({ error: 'name and check_type are required' });
        }
        if (!VALID_CHECK_TYPES.includes(check_type)) {
            return res.status(400).json({ error: `check_type must be one of: ${VALID_CHECK_TYPES.join(', ')}` });
        }
        if (!host && !url) {
            return res.status(400).json({ error: 'host or url is required' });
        }

        const target = await getAdapter().createNetworkTarget({
            name,
            host: host || '',
            port: parseInt(port, 10) || null,
            url: url || null,
            check_type,
            timeout_ms: parseInt(timeout_ms, 10) || 5000,
            interval_ms: parseInt(interval_ms, 10) || 60000,
            enabled: enabled !== false,
        });

        res.status(201).json(target);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * GET /api/network/targets/:id — Get target detail
 */
router.get('/targets/:id', requireAdmin, requirePermission('device.view'), async (req, res) => {
    try {
        const target = await getAdapter().getNetworkTargetById(req.params.id);
        if (!target) {
            return res.status(404).json({ error: 'Target not found' });
        }
        res.json(target);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * PATCH /api/network/targets/:id — Update target
 */
router.patch('/targets/:id', requireAdmin, requirePermission('server.config'), async (req, res) => {
    try {
        const { name, host, port, url, check_type, timeout_ms, interval_ms, enabled } = req.body;
        if (check_type && !VALID_CHECK_TYPES.includes(check_type)) {
            return res.status(400).json({ error: `check_type must be one of: ${VALID_CHECK_TYPES.join(', ')}` });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (host !== undefined) updates.host = host;
        if (port !== undefined) updates.port = parseInt(port, 10) || null;
        if (url !== undefined) updates.url = url;
        if (check_type !== undefined) updates.check_type = check_type;
        if (timeout_ms !== undefined) updates.timeout_ms = parseInt(timeout_ms, 10);
        if (interval_ms !== undefined) updates.interval_ms = parseInt(interval_ms, 10);
        if (enabled !== undefined) updates.enabled = enabled;

        const target = await getAdapter().updateNetworkTarget(req.params.id, updates);
        if (!target) {
            return res.status(404).json({ error: 'Target not found' });
        }
        res.json(target);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

/**
 * DELETE /api/network/targets/:id — Delete target
 */
router.delete('/targets/:id', requireAdmin, requirePermission('server.config'), async (req, res) => {
    try {
        const ok = await getAdapter().deleteNetworkTarget(req.params.id);
        if (!ok) {
            return res.status(404).json({ error: 'Target not found' });
        }
        res.json({ status: 'deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
//  Manual checks & history
// ---------------------------------------------------------------------------

/**
 * POST /api/network/targets/:id/check — Run check now
 */
router.post('/targets/:id/check', requireAdmin, requirePermission('device.connect'), async (req, res) => {
    try {
        const target = await getAdapter().getNetworkTargetById(req.params.id);
        if (!target) {
            return res.status(404).json({ error: 'Target not found' });
        }

        const m = getMonitor();
        if (!m) {
            return res.status(503).json({ error: 'Monitor not available' });
        }

        const result = await m.checkTarget(target);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/network/targets/:id/history — Check history
 */
router.get('/targets/:id/history', requireAdmin, requirePermission('device.view'), async (req, res) => {
    try {
        const { limit, from, to } = req.query;
        const history = await getAdapter().getNetworkCheckHistory(req.params.id, {
            limit: parseInt(limit, 10) || 100,
            from,
            to,
        });
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/network/stats — Overview stats
 */
router.get('/stats', requireAdmin, requirePermission('device.view'), async (req, res) => {
    try {
        const targets = await getAdapter().getNetworkTargets({});
        const total = targets.length;
        const up = targets.filter(t => t.last_status === 'up').length;
        const down = targets.filter(t => t.last_status === 'down').length;
        const unknown = total - up - down;
        const latencies = targets.filter(t => t.last_latency_ms != null).map(t => t.last_latency_ms);
        const avg_latency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

        res.json({ total, up, down, unknown, avg_latency });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
//  Ad-hoc tools
// ---------------------------------------------------------------------------

/**
 * POST /api/network/ping — Ping a host
 */
router.post('/ping', requireAdmin, requirePermission('device.connect'), async (req, res) => {
    try {
        const { host, timeout } = req.body;
        if (!host) return res.status(400).json({ error: 'host is required' });
        const result = await pingHost(host, parseInt(timeout, 10) || 5000);
        res.json({ host, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/tcp — TCP port check
 */
router.post('/tcp', requireAdmin, requirePermission('device.connect'), async (req, res) => {
    try {
        const { host, port, timeout } = req.body;
        if (!host || !port) return res.status(400).json({ error: 'host and port are required' });
        const result = await checkTcpPort(host, parseInt(port, 10), parseInt(timeout, 10) || 5000);
        res.json({ host, port: parseInt(port, 10), ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/http — HTTP endpoint check
 */
router.post('/http', requireAdmin, requirePermission('device.connect'), async (req, res) => {
    try {
        const { url, timeout } = req.body;
        if (!url) return res.status(400).json({ error: 'url is required' });
        const result = await checkHttp(url, parseInt(timeout, 10) || 5000);
        res.json({ url, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * POST /api/network/resolve — DNS resolution
 */
router.post('/resolve', requireAdmin, requirePermission('device.connect'), async (req, res) => {
    try {
        const { host } = req.body;
        if (!host) return res.status(400).json({ error: 'host is required' });
        const ip = await resolveHost(host);
        res.json({ host, ip });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---------------------------------------------------------------------------
//  Monitor control
// ---------------------------------------------------------------------------

/**
 * POST /api/network/monitor/start
 */
router.post('/monitor/start', requireAdmin, requirePermission('server.config'), (req, res) => {
    const m = getMonitor();
    if (!m) return res.status(503).json({ error: 'Monitor not available' });
    const interval = parseInt(req.body.interval_ms, 10) || undefined;
    m.start(interval);
    res.json({ status: 'started', interval_ms: m.pollInterval });
});

/**
 * POST /api/network/monitor/stop
 */
router.post('/monitor/stop', requireAdmin, requirePermission('server.config'), (req, res) => {
    const m = getMonitor();
    if (!m) return res.status(503).json({ error: 'Monitor not available' });
    m.stop();
    res.json({ status: 'stopped' });
});

/**
 * GET /api/network/monitor/status
 */
router.get('/monitor/status', requireAdmin, requirePermission('device.view'), (req, res) => {
    const m = getMonitor();
    res.json({
        running: m ? m.running : false,
        interval_ms: m ? m.pollInterval : null,
    });
});

module.exports = router;
