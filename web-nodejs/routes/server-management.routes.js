/**
 * BetterDesk Console — Server Management Routes (BETA)
 *
 * The page (/server-management) is in the new console (web-ui); the old
 * address redirects there (lib/portedPages.js).
 *
 * REST API (all require server.config permission):
 *   GET    /api/server-management/info
 *   GET    /api/server-management/resources
 *   GET    /api/server-management/files?path=<abs>
 *   GET    /api/server-management/files/read?path=<abs>
 *   POST   /api/server-management/files/write     {path, content}
 *   POST   /api/server-management/files/mkdir     {path}
 *   POST   /api/server-management/files/rename    {from, to}
 *   POST   /api/server-management/files/delete    {path}
 *   GET    /api/server-management/services
 *   POST   /api/server-management/services/:name/:action
 *
 * The terminal endpoint is WebSocket-based and lives on the HTTP upgrade
 * path /ws/server-management/terminal — see services/serverTerminalProxy.js.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { requireAuth, requirePermission } = require('../middleware/auth');
const sm = require('../services/serverManagement');
const { isPtyAvailable, activeSessionCount } = require('../services/serverTerminalProxy');
const db = require('../services/database');
const serverBackend = require('../services/serverBackend');

const REQUIRED_PERMISSION = 'server.config';

// All endpoints below require auth + server.config permission.
const auth = [requireAuth, requirePermission(REQUIRED_PERMISSION)];

function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
    return req.ip || (req.socket && req.socket.remoteAddress) || '';
}

async function audit(req, action, details) {
    try {
        if (db && typeof db.logAction === 'function') {
            await db.logAction(req.session && req.session.userId, action, details, getClientIp(req));
        }
    } catch (_) { /* never fail requests due to audit */ }
}

function sendError(res, status, message) {
    res.status(status).json({ success: false, error: message });
}

// ─── Info / capabilities ──────────────────────────────────────────────────────

// Go durations look like "26h3m4.5s"; turn them into seconds
function goDurationSeconds(text) {
    if (typeof text !== 'string' || !text) return null;
    const units = { h: 3600, m: 60, s: 1, ms: 0.001, 'µs': 0.000001, us: 0.000001, ns: 1e-9 };
    let total = 0;
    let matched = false;
    for (const m of text.matchAll(/([\d.]+)(ms|µs|us|ns|h|m|s)/g)) {
        total += parseFloat(m[1]) * units[m[2]];
        matched = true;
    }
    return matched ? Math.floor(total) : null;
}

router.get('/api/server-management/info', auth, async (req, res) => {
    // Uptime of the BetterDesk server (Go), which is not the console's or the host's
    let server = null;
    try {
        const health = await serverBackend.getHealth();
        server = {
            running: !!health && health.status === 'running',
            uptimeSeconds: goDurationSeconds(health && health.uptime),
            version: (health && health.version) || null
        };
    } catch (_) { /* leave null */ }
    res.json({
        success: true,
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        pid: process.pid,
        ptyAvailable: isPtyAvailable(),
        terminalSessions: activeSessionCount(),
        fileRoots: sm.getAllowedFileRoots(),
        mutableFileRoots: sm.getMutableFileRoots(),
        server,
        beta: true
    });
});

// ─── Resources ────────────────────────────────────────────────────────────────

router.get('/api/server-management/resources', auth, (req, res) => {
    try {
        res.json({ success: true, snapshot: sm.getResourceSnapshot() });
    } catch (err) {
        sendError(res, 500, err.message || 'snapshot_failed');
    }
});

// ─── Files ────────────────────────────────────────────────────────────────────

router.get('/api/server-management/files', auth, async (req, res) => {
    const p = String(req.query.path || '/');
    try {
        const data = await sm.listDirectory(p);
        res.json({ success: true, ...data, cwd: data.path, entries: data.items || [] });
    } catch (err) {
        sendError(res, 400, err.message || 'list_failed');
    }
});

router.get('/api/server-management/files/read', auth, async (req, res) => {
    const p = String(req.query.path || '');
    try {
        const data = await sm.readFilePreview(p);
        res.json({ success: true, ...data });
    } catch (err) {
        sendError(res, 400, err.message || 'read_failed');
    }
});

router.post('/api/server-management/files/write', auth, async (req, res) => {
    const { path: p, content } = req.body || {};
    if (typeof p !== 'string' || typeof content !== 'string') {
        return sendError(res, 400, 'path_and_content_required');
    }
    try {
        const result = await sm.writeFile(p, content);
        await audit(req, 'server_file_write', `path=${result.path} bytes=${result.size}`);
        res.json({ success: true, ...result });
    } catch (err) {
        sendError(res, 400, err.message || 'write_failed');
    }
});

router.post('/api/server-management/files/mkdir', auth, async (req, res) => {
    const p = (req.body && req.body.path) || '';
    if (typeof p !== 'string' || !p.length) return sendError(res, 400, 'path_required');
    try {
        const result = await sm.makeDirectory(p);
        await audit(req, 'server_file_mkdir', `path=${result.path}`);
        res.json({ success: true, ...result });
    } catch (err) {
        sendError(res, 400, err.message || 'mkdir_failed');
    }
});

router.post('/api/server-management/files/rename', auth, async (req, res) => {
    const { from, to } = req.body || {};
    if (typeof from !== 'string' || typeof to !== 'string') {
        return sendError(res, 400, 'from_and_to_required');
    }
    try {
        const result = await sm.renamePath(from, to);
        await audit(req, 'server_file_rename', `from=${result.from} to=${result.to}`);
        res.json({ success: true, ...result });
    } catch (err) {
        sendError(res, 400, err.message || 'rename_failed');
    }
});

router.post('/api/server-management/files/delete', auth, async (req, res) => {
    const p = (req.body && req.body.path) || '';
    if (typeof p !== 'string' || !p.length) return sendError(res, 400, 'path_required');
    try {
        const result = await sm.deletePath(p);
        await audit(req, 'server_file_delete', `path=${result.path}`);
        res.json({ success: true, ...result });
    } catch (err) {
        sendError(res, 400, err.message || 'delete_failed');
    }
});

// ─── Services ─────────────────────────────────────────────────────────────────

router.get('/api/server-management/services', auth, (req, res) => {
    try {
        const services = sm.listServices().map((svc) => ({
            ...svc,
            state: svc.state || svc.active || svc.status || 'unknown',
            status: svc.status || svc.sub || svc.active || 'unknown'
        }));
        res.json({ success: true, platform: process.platform, services });
    } catch (err) {
        sendError(res, 500, err.message || 'list_failed');
    }
});

router.post('/api/server-management/services/:name/:action', auth, async (req, res) => {
    const { name, action } = req.params;
    if (!sm.SERVICE_NAME_RE.test(name)) {
        return sendError(res, 400, 'invalid_service_name');
    }
    try {
        const result = await sm.controlService(name, action);
        await audit(req, 'server_service_control', `name=${name} action=${action} exit=${result.exitCode}`);
        res.json({ success: true, ...result });
    } catch (err) {
        sendError(res, 400, err.message || 'control_failed');
    }
});

module.exports = router;
