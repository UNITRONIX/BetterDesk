/**
 * BetterDesk Console — CDAP SDK Studio Routes
 * Flow storage for the visual node editor that builds CDAP bridge flows.
 * Phase 14 of the BetterDesk 3.0 Roadmap. The editor (/cdap-studio) is in the
 * new console (web-ui); the old address redirects there (lib/portedPages.js).
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, isSuperAdminRole } = require('../middleware/auth');
const { getAdapter } = require('../services/dbAdapter');
const crypto = require('crypto');

// ── Flow storage (studio_flows table, see services/dbAdapter) ───────────

const MAX_FLOW_BYTES = 5 * 1024 * 1024;

function store() {
    return getAdapter();
}

/** Super admins see and change every flow; everyone else only their own. */
function canAccessFlow(user, flow) {
    return !!user && (isSuperAdminRole(user.role) || flow.created_by === user.username);
}

/** Read a flow the current user may see. Sends 404 and returns null otherwise. */
async function findFlowForUser(req, res) {
    const flow = await store().getStudioFlow(req.params.id);
    if (!flow || !canAccessFlow(req.session.user, flow)) {
        res.status(404).json({ success: false, error: 'Flow not found' });
        return null;
    }
    return flow;
}

/** Read a flow the current user may change. Sends 404 or 403 and returns null otherwise. */
async function findFlowToChange(req, res) {
    const flow = await store().getStudioFlow(req.params.id);
    if (!flow) {
        res.status(404).json({ success: false, error: 'Flow not found' });
        return null;
    }
    if (!canAccessFlow(req.session.user, flow)) {
        res.status(403).json({ success: false, error: 'Not authorized' });
        return null;
    }
    return flow;
}

/** flow_json as a JSON string, or an error message. */
function normalizeFlowJson(value) {
    const jsonStr = typeof value === 'string' ? value : JSON.stringify(value || {});
    if (jsonStr.length > MAX_FLOW_BYTES) return { error: 'Flow data too large (max 5MB)' };
    try {
        JSON.parse(jsonStr);
    } catch (_) {
        return { error: 'Invalid flow JSON' };
    }
    return { json: jsonStr };
}

function cleanDescription(value) {
    return typeof value === 'string' ? value.trim().slice(0, 500) : '';
}

// ── API Routes ───────────────────────────────────────────────────────────

/**
 * GET /api/cdap-studio/flows
 * List saved flows without their flow_json: all for super admins, own for others.
 */
router.get('/api/cdap-studio/flows', requireAuth, async (req, res) => {
    try {
        const user = req.session.user || {};
        const flows = await store().listStudioFlows(
            isSuperAdminRole(user.role) ? {} : { createdBy: user.username }
        );
        res.json({ success: true, flows: flows || [] });
    } catch (err) {
        console.error('[cdap-studio] list flows:', err.message);
        res.status(500).json({ success: false, error: 'Failed to list flows' });
    }
});

/**
 * GET /api/cdap-studio/flows/:id
 * Get a single flow with full JSON.
 */
router.get('/api/cdap-studio/flows/:id', requireAuth, async (req, res) => {
    try {
        const flow = await findFlowForUser(req, res);
        if (!flow) return;
        res.json({ success: true, flow });
    } catch (err) {
        console.error('[cdap-studio] get flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to get flow' });
    }
});

/**
 * POST /api/cdap-studio/flows
 * Create a new flow.
 */
router.post('/api/cdap-studio/flows', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const { name, description, flow_json } = req.body || {};
        const cleanName = typeof name === 'string' ? name.trim() : '';
        if (!cleanName || cleanName.length > 100) {
            return res.status(400).json({ success: false, error: 'Invalid flow name' });
        }
        const flowJson = normalizeFlowJson(flow_json);
        if (flowJson.error) return res.status(400).json({ success: false, error: flowJson.error });

        const id = crypto.randomBytes(8).toString('hex');
        await store().createStudioFlow({
            id,
            name: cleanName,
            description: cleanDescription(description),
            flow_json: flowJson.json,
            created_by: req.session.user.username
        });
        res.json({ success: true, id });
    } catch (err) {
        console.error('[cdap-studio] create flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to create flow' });
    }
});

/**
 * PUT /api/cdap-studio/flows/:id
 * Update an existing flow (name, description, flow_json). Fields left out keep their value.
 */
router.put('/api/cdap-studio/flows/:id', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const { name, description, flow_json } = req.body || {};
        const existing = await findFlowToChange(req, res);
        if (!existing) return;

        let flowJson = { json: existing.flow_json };
        if (flow_json !== undefined) {
            flowJson = normalizeFlowJson(flow_json);
            if (flowJson.error) return res.status(400).json({ success: false, error: flowJson.error });
        }
        const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : existing.name;

        await store().updateStudioFlow(req.params.id, {
            name: cleanName,
            description: description === undefined ? existing.description : cleanDescription(description),
            flow_json: flowJson.json
        });
        res.json({ success: true });
    } catch (err) {
        console.error('[cdap-studio] update flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to update flow' });
    }
});

/**
 * DELETE /api/cdap-studio/flows/:id
 * Delete a flow.
 */
router.delete('/api/cdap-studio/flows/:id', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const existing = await findFlowToChange(req, res);
        if (!existing) return;
        await store().deleteStudioFlow(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[cdap-studio] delete flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to delete flow' });
    }
});

/**
 * POST /api/cdap-studio/flows/:id/deploy
 * Mark a flow as deployed.
 */
router.post('/api/cdap-studio/flows/:id/deploy', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const existing = await findFlowToChange(req, res);
        if (!existing) return;
        await store().setStudioFlowStatus(req.params.id, 'deployed');
        res.json({ success: true, status: 'deployed' });
    } catch (err) {
        console.error('[cdap-studio] deploy flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to deploy flow' });
    }
});

/**
 * POST /api/cdap-studio/flows/:id/test
 * Run a flow in sandbox/dry-run mode.
 */
router.post('/api/cdap-studio/flows/:id/test', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const row = await findFlowForUser(req, res);
        if (!row) return;

        let flowData;
        try {
            flowData = JSON.parse(row.flow_json);
        } catch (_) {
            return res.status(400).json({ success: false, error: 'Invalid flow JSON' });
        }

        // Simulate execution — walk nodes in topological order
        const nodes = (flowData && flowData.nodes) || [];
        const wires = (flowData && flowData.wires) || [];
        const results = [];

        for (const node of nodes) {
            results.push({
                nodeId: node.id,
                nodeType: node.type,
                label: node.label || node.type,
                status: 'ok',
                output: { _simulated: true, value: `Mock data from ${node.type}` }
            });
        }

        res.json({ success: true, results, nodeCount: nodes.length, wireCount: wires.length });
    } catch (err) {
        console.error('[cdap-studio] test flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to test flow' });
    }
});

/**
 * GET /api/cdap-studio/flows/:id/export
 * Export flow as downloadable .bdflow JSON.
 */
router.get('/api/cdap-studio/flows/:id/export', requireAuth, async (req, res) => {
    try {
        const row = await findFlowForUser(req, res);
        if (!row) return;

        let flow;
        try {
            flow = JSON.parse(row.flow_json);
        } catch (_) {
            return res.status(400).json({ success: false, error: 'Invalid flow JSON' });
        }
        const exportData = {
            version: '1.0',
            format: 'bdflow',
            name: row.name,
            description: row.description,
            flow,
            exportedAt: new Date().toISOString(),
            exportedBy: req.session.user.username
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${String(row.name).replace(/[^a-zA-Z0-9_-]/g, '_')}.bdflow"`);
        res.send(JSON.stringify(exportData, null, 2));
    } catch (err) {
        console.error('[cdap-studio] export flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to export flow' });
    }
});

/**
 * POST /api/cdap-studio/flows/import
 * Import a .bdflow file.
 */
router.post('/api/cdap-studio/flows/import', requireAuth, requireRole('operator'), async (req, res) => {
    try {
        const { name, description, flow } = req.body || {};
        if (!flow || typeof flow !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid .bdflow format' });
        }
        const flowJson = normalizeFlowJson(flow);
        if (flowJson.error) return res.status(400).json({ success: false, error: flowJson.error });

        const id = crypto.randomBytes(8).toString('hex');
        const flowName = (typeof name === 'string' && name.trim() ? name.trim() : 'Imported Flow').slice(0, 100);

        await store().createStudioFlow({
            id,
            name: flowName,
            description: cleanDescription(description),
            flow_json: flowJson.json,
            created_by: req.session.user.username
        });
        res.json({ success: true, id });
    } catch (err) {
        console.error('[cdap-studio] import flow:', err.message);
        res.status(500).json({ success: false, error: 'Failed to import flow' });
    }
});

/**
 * GET /api/cdap-studio/templates
 * Returns pre-built flow templates.
 */
router.get('/api/cdap-studio/templates', requireAuth, (req, res) => {
    const templates = [
        {
            id: 'temp-monitor',
            name: 'Temperature Monitor',
            description: 'Modbus TCP temperature reading with high-temp alert',
            icon: 'thermostat',
            flow: {
                nodes: [
                    { id: 'n1', type: 'modbus-tcp', x: 100, y: 150, label: 'Modbus TCP', config: { host: '192.168.1.100', port: 502, unitId: 1, register: 100, dataType: 'float32', interval: 5000 } },
                    { id: 'n2', type: 'filter', x: 400, y: 150, label: 'High Temp', config: { field: 'value', operator: '>', threshold: 80 } },
                    { id: 'n3', type: 'widget-update', x: 700, y: 80, label: 'Dashboard', config: { widgetId: '', valueField: 'value' } },
                    { id: 'n4', type: 'alert', x: 700, y: 220, label: 'Alert', config: { severity: 'warning', message: 'Temperature ${value}°C exceeds threshold!' } }
                ],
                wires: [
                    { from: 'n1', to: 'n2', fromPort: 'out', toPort: 'in' },
                    { from: 'n2', to: 'n3', fromPort: 'pass', toPort: 'in' },
                    { from: 'n2', to: 'n4', fromPort: 'pass', toPort: 'in' }
                ]
            }
        },
        {
            id: 'snmp-health',
            name: 'SNMP Health Dashboard',
            description: 'Poll SNMP devices and display uptime/status',
            icon: 'router',
            flow: {
                nodes: [
                    { id: 'n1', type: 'snmp-poll', x: 100, y: 150, label: 'SNMP Poll', config: { host: '192.168.1.1', community: 'public', version: '2c', oids: ['1.3.6.1.2.1.1.3.0'], interval: 10000 } },
                    { id: 'n2', type: 'transform', x: 400, y: 150, label: 'Format', config: { expression: 'Math.floor(value / 100)' } },
                    { id: 'n3', type: 'widget-update', x: 700, y: 150, label: 'Uptime Widget', config: { widgetId: '', valueField: 'value' } }
                ],
                wires: [
                    { from: 'n1', to: 'n2', fromPort: 'out', toPort: 'in' },
                    { from: 'n2', to: 'n3', fromPort: 'out', toPort: 'in' }
                ]
            }
        },
        {
            id: 'rest-aggregator',
            name: 'REST API Aggregator',
            description: 'Poll multiple REST endpoints and merge data',
            icon: 'api',
            flow: {
                nodes: [
                    { id: 'n1', type: 'rest-poll', x: 100, y: 100, label: 'API 1', config: { url: 'https://api.example.com/data', method: 'GET', interval: 30000 } },
                    { id: 'n2', type: 'rest-poll', x: 100, y: 250, label: 'API 2', config: { url: 'https://api.example.com/status', method: 'GET', interval: 30000 } },
                    { id: 'n3', type: 'merge', x: 400, y: 175, label: 'Merge', config: { strategy: 'latest' } },
                    { id: 'n4', type: 'log', x: 700, y: 175, label: 'Log', config: { level: 'info', message: 'Aggregated: ${JSON.stringify(data)}' } }
                ],
                wires: [
                    { from: 'n1', to: 'n3', fromPort: 'out', toPort: 'in' },
                    { from: 'n2', to: 'n3', fromPort: 'out', toPort: 'in' },
                    { from: 'n3', to: 'n4', fromPort: 'out', toPort: 'in' }
                ]
            }
        },
        {
            id: 'modbus-control',
            name: 'Modbus PLC Control',
            description: 'Read PLC registers, apply logic, write back',
            icon: 'precision_manufacturing',
            flow: {
                nodes: [
                    { id: 'n1', type: 'modbus-tcp', x: 100, y: 150, label: 'Read PLC', config: { host: '192.168.1.50', port: 502, unitId: 1, register: 0, dataType: 'int16', interval: 2000 } },
                    { id: 'n2', type: 'switch', x: 400, y: 150, label: 'Check Range', config: { conditions: [{ field: 'value', operator: '>', value: 100 }] } },
                    { id: 'n3', type: 'modbus-write', x: 700, y: 80, label: 'Write PLC', config: { host: '192.168.1.50', port: 502, register: 10, value: '1' } },
                    { id: 'n4', type: 'alert', x: 700, y: 220, label: 'Over Range', config: { severity: 'critical', message: 'PLC value ${value} exceeded limit!' } }
                ],
                wires: [
                    { from: 'n1', to: 'n2', fromPort: 'out', toPort: 'in' },
                    { from: 'n2', to: 'n3', fromPort: 'pass', toPort: 'in' },
                    { from: 'n2', to: 'n4', fromPort: 'pass', toPort: 'in' }
                ]
            }
        },
        {
            id: 'file-watcher',
            name: 'File Change Detector',
            description: 'Watch directory for changes and notify',
            icon: 'folder_open',
            flow: {
                nodes: [
                    { id: 'n1', type: 'file-watch', x: 100, y: 150, label: 'Watch Files', config: { path: '/var/log/', pattern: '*.log', events: ['modify'] } },
                    { id: 'n2', type: 'debounce', x: 400, y: 150, label: 'Debounce 5s', config: { cooldown: 5000 } },
                    { id: 'n3', type: 'alert', x: 700, y: 150, label: 'Notify', config: { severity: 'info', message: 'File changed: ${filename}' } }
                ],
                wires: [
                    { from: 'n1', to: 'n2', fromPort: 'out', toPort: 'in' },
                    { from: 'n2', to: 'n3', fromPort: 'out', toPort: 'in' }
                ]
            }
        }
    ];

    res.json({ success: true, templates });
});

module.exports = router;
