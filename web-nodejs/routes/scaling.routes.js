'use strict';

/**
 * BetterDesk Console — Scaling & Relay-Node Management Routes
 *
 * NOTE: The Go signal/relay server does not (yet) expose a fleet-management
 * API for relay nodes. The Relay Nodes table in the panel therefore stores
 * relay metadata (name, address, location, capacity hints) inside the
 * Node.js console's own `settings` table. This is **informational** —
 * actual relay routing for clients is driven by the `RELAY_SERVERS` env
 * var / CLI flag passed to the Go server. The list here lets operators
 * keep an inventory of their relay deployments.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth, requirePermission } = require('../middleware/auth');
const db = require('../services/database');

// ---------------------------------------------------------------------------
// Storage helpers — JSON arrays kept in the `settings` table
// ---------------------------------------------------------------------------
const KEY_RELAYS = 'scaling_relay_nodes';
const KEY_RULES = 'scaling_assignment_rules';

async function loadJsonArray(key) {
    try {
        const raw = await db.getSetting(key);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error(`[Scaling] Failed to parse ${key}:`, err.message);
        return [];
    }
}

async function saveJsonArray(key, arr) {
    await db.setSetting(key, JSON.stringify(arr));
}

function newId() {
    return 'r-' + crypto.randomBytes(8).toString('hex');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const ADDRESS_RE = /^[A-Za-z0-9._\-:[\]]+:[0-9]{1,5}$/;
const SAFE_TEXT_RE = /^[\p{L}\p{N}\s._\-#/()]{1,80}$/u;

function validateRelay(body) {
    if (!body || typeof body !== 'object') return 'invalid body';
    const name = String(body.name || '').trim();
    const address = String(body.address || '').trim();
    if (name.length < 1 || name.length > 80) return 'name must be 1-80 characters';
    if (!SAFE_TEXT_RE.test(name)) return 'name contains invalid characters';
    if (!ADDRESS_RE.test(address)) return 'address must be host:port (e.g. relay.example.com:21117)';
    const port = parseInt(address.split(':').pop(), 10);
    if (!port || port < 1 || port > 65535) return 'invalid port';
    const location = String(body.location || '').trim();
    if (location && location.length > 80) return 'location too long';
    const maxSessions = parseInt(body.max_sessions, 10);
    const maxBw = parseInt(body.max_bandwidth_mbps, 10);
    if (Number.isFinite(maxSessions) && (maxSessions < 1 || maxSessions > 100000)) return 'max_sessions out of range';
    if (Number.isFinite(maxBw) && (maxBw < 1 || maxBw > 1000000)) return 'max_bandwidth_mbps out of range';
    return null;
}

function sanitizeRelay(body, existing) {
    const out = existing ? { ...existing } : { id: newId(), created_at: new Date().toISOString() };
    out.name = String(body.name || '').trim();
    out.address = String(body.address || '').trim();
    out.location = String(body.location || '').trim();
    const ms = parseInt(body.max_sessions, 10);
    const mb = parseInt(body.max_bandwidth_mbps, 10);
    out.max_sessions = Number.isFinite(ms) ? ms : 50;
    out.max_bandwidth_mbps = Number.isFinite(mb) ? mb : 100;
    out.updated_at = new Date().toISOString();
    // Live metric fields are not user-editable — kept at 0 until a future
    // Go-server endpoint exposes real telemetry.
    out.connected_devices = 0;
    out.active_sessions = 0;
    out.bandwidth_mbps = 0;
    out.cpu = 0;
    out.memory = 0;
    out.status = 'unknown';
    return out;
}

function validateRule(body) {
    if (!body || typeof body !== 'object') return 'invalid body';
    const name = String(body.name || '').trim();
    const matchType = String(body.match_type || '').trim();
    const matchValue = String(body.match_value || '').trim();
    if (name.length < 1 || name.length > 80) return 'name must be 1-80 characters';
    if (!['subnet', 'group', 'tag', 'country', 'device_id'].includes(matchType)) return 'invalid match_type';
    if (matchValue.length < 1 || matchValue.length > 200) return 'match_value required';
    const priority = parseInt(body.priority, 10);
    if (Number.isFinite(priority) && (priority < 0 || priority > 1000)) return 'priority out of range';
    return null;
}

function sanitizeRule(body, existing) {
    const out = existing ? { ...existing } : { id: newId(), created_at: new Date().toISOString() };
    out.name = String(body.name || '').trim();
    out.match_type = String(body.match_type || '').trim();
    out.match_value = String(body.match_value || '').trim();
    out.target_relay = String(body.target_relay || '').trim();
    out.fallback = String(body.fallback || 'master').trim();
    const priority = parseInt(body.priority, 10);
    out.priority = Number.isFinite(priority) ? priority : 10;
    // An edit without the switch keeps the rule's state; a new rule is on
    out.enabled = body.enabled === undefined
        ? (existing ? existing.enabled !== false : true)
        : body.enabled !== false;
    out.updated_at = new Date().toISOString();
    return out;
}

// ---------------------------------------------------------------------------
// Page route
// ---------------------------------------------------------------------------

router.get('/scaling', requireAuth, requirePermission('server.config'), (req, res) => {
    const tab = req.query.tab || 'overview';
    res.render('scaling', {
        title: req.t('scaling.title'),
        pageStyles: ['scaling'],
        pageScripts: ['scaling'],
        currentPage: 'scaling',
        breadcrumb: [{ label: req.t('scaling.title') }],
        activeTab: tab
    });
});

// ---------------------------------------------------------------------------
// Relay Nodes API — local persistence
// ---------------------------------------------------------------------------

router.get('/api/panel/scaling/relays', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        res.json({ data: relays });
    } catch (err) {
        console.error('[Scaling] list relays:', err.message);
        res.status(500).json({ error: 'failed to load relay nodes' });
    }
});

router.get('/api/panel/scaling/relays/:nodeId', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        const r = relays.find(x => x.id === req.params.nodeId);
        if (!r) return res.status(404).json({ error: 'not found' });
        res.json({ data: r });
    } catch (err) {
        res.status(500).json({ error: 'failed to load relay node' });
    }
});

router.post('/api/panel/scaling/relays', requireAuth, requirePermission('server.config'), async (req, res) => {
    const validationError = validateRelay(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        if (relays.some(r => r.address === String(req.body.address || '').trim())) {
            return res.status(409).json({ error: 'a relay with this address already exists' });
        }
        if (relays.length >= 100) {
            return res.status(400).json({ error: 'too many relay entries (max 100)' });
        }
        const fresh = sanitizeRelay(req.body, null);
        relays.push(fresh);
        await saveJsonArray(KEY_RELAYS, relays);
        res.status(201).json({ data: fresh });
    } catch (err) {
        console.error('[Scaling] create relay:', err.message);
        res.status(500).json({ error: 'failed to save relay node' });
    }
});

router.put('/api/panel/scaling/relays/:nodeId', requireAuth, requirePermission('server.config'), async (req, res) => {
    const validationError = validateRelay(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        const idx = relays.findIndex(x => x.id === req.params.nodeId);
        if (idx < 0) return res.status(404).json({ error: 'not found' });
        const newAddr = String(req.body.address || '').trim();
        if (relays.some((r, i) => i !== idx && r.address === newAddr)) {
            return res.status(409).json({ error: 'another relay already uses this address' });
        }
        relays[idx] = sanitizeRelay(req.body, relays[idx]);
        await saveJsonArray(KEY_RELAYS, relays);
        res.json({ data: relays[idx] });
    } catch (err) {
        console.error('[Scaling] update relay:', err.message);
        res.status(500).json({ error: 'failed to update relay node' });
    }
});

router.delete('/api/panel/scaling/relays/:nodeId', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        const next = relays.filter(x => x.id !== req.params.nodeId);
        if (next.length === relays.length) return res.status(404).json({ error: 'not found' });
        await saveJsonArray(KEY_RELAYS, next);
        res.json({ ok: true });
    } catch (err) {
        console.error('[Scaling] delete relay:', err.message);
        res.status(500).json({ error: 'failed to delete relay node' });
    }
});

// Health and metrics — no live data yet, return sensible empty placeholders
router.get('/api/panel/scaling/relays/:nodeId/health', requireAuth, requirePermission('server.config'), (req, res) => {
    res.json({ data: null, note: 'live relay telemetry not yet available' });
});

router.get('/api/panel/scaling/relays/:nodeId/metrics', requireAuth, requirePermission('server.config'), (req, res) => {
    res.json({ data: [], note: 'live relay telemetry not yet available' });
});

// ---------------------------------------------------------------------------
// Capacity overview — derived from configured relays + reasonable defaults
// ---------------------------------------------------------------------------
router.get('/api/panel/scaling/capacity', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const relays = await loadJsonArray(KEY_RELAYS);
        const totals = relays.reduce((acc, r) => {
            acc.max_sessions += (r.max_sessions || 0);
            acc.max_bandwidth_mbps += (r.max_bandwidth_mbps || 0);
            return acc;
        }, { max_sessions: 0, max_bandwidth_mbps: 0 });
        res.json({
            data: {
                relay_count: relays.length,
                max_devices: 500 + relays.length * 200,
                max_sessions: totals.max_sessions || 50,
                max_bandwidth_mbps: totals.max_bandwidth_mbps || 100
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'failed to compute capacity' });
    }
});

// ---------------------------------------------------------------------------
// Assignment Rules — local persistence
// ---------------------------------------------------------------------------
router.get('/api/panel/scaling/rules', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const rules = await loadJsonArray(KEY_RULES);
        res.json({ data: rules });
    } catch (err) {
        res.status(500).json({ error: 'failed to load rules' });
    }
});

router.post('/api/panel/scaling/rules', requireAuth, requirePermission('server.config'), async (req, res) => {
    const validationError = validateRule(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
        const rules = await loadJsonArray(KEY_RULES);
        if (rules.length >= 200) return res.status(400).json({ error: 'too many rules (max 200)' });
        const fresh = sanitizeRule(req.body, null);
        rules.push(fresh);
        await saveJsonArray(KEY_RULES, rules);
        res.status(201).json({ data: fresh });
    } catch (err) {
        res.status(500).json({ error: 'failed to save rule' });
    }
});

router.put('/api/panel/scaling/rules/:ruleId', requireAuth, requirePermission('server.config'), async (req, res) => {
    const validationError = validateRule(req.body);
    if (validationError) return res.status(400).json({ error: validationError });
    try {
        const rules = await loadJsonArray(KEY_RULES);
        const idx = rules.findIndex(x => x.id === req.params.ruleId);
        if (idx < 0) return res.status(404).json({ error: 'not found' });
        rules[idx] = sanitizeRule(req.body, rules[idx]);
        await saveJsonArray(KEY_RULES, rules);
        res.json({ data: rules[idx] });
    } catch (err) {
        res.status(500).json({ error: 'failed to update rule' });
    }
});

router.delete('/api/panel/scaling/rules/:ruleId', requireAuth, requirePermission('server.config'), async (req, res) => {
    try {
        const rules = await loadJsonArray(KEY_RULES);
        const next = rules.filter(x => x.id !== req.params.ruleId);
        if (next.length === rules.length) return res.status(404).json({ error: 'not found' });
        await saveJsonArray(KEY_RULES, next);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: 'failed to delete rule' });
    }
});

// ---------------------------------------------------------------------------
// Device-facing relay heartbeat — currently a no-op until the Go server
// provides a corresponding endpoint. Returns 202 so legacy callers don't
// retry storms.
// ---------------------------------------------------------------------------
router.post('/api/bd/scaling/relay-heartbeat', (req, res) => {
    res.status(202).json({ ok: true, note: 'relay heartbeat acknowledged but not stored' });
});

module.exports = router;
