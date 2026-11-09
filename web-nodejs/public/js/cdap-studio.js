/**
 * BetterDesk Console — CDAP SDK Studio
 * Visual node-based flow editor for building CDAP bridge configurations.
 * Phase 14 of the BetterDesk 3.0 Roadmap.
 *
 * Architecture:
 *   - Flow state  = { nodes: [], wires: [] } stored as JSON
 *   - Canvas      = SVG with pan/zoom via transform on a <g> wrapper
 *   - Nodes       = SVG <g> groups with rect + text + port circles
 *   - Wires       = SVG <path> cubic bezier curves
 *   - Drag & drop = mousedown/mousemove/mouseup on palette items & nodes
 *   - Inspector   = DOM panel dynamically rebuilt per selected node
 *   - Persistence = REST API to /api/cdap-studio/flows/*
 */
(function () {
    'use strict';

    const _ = window._ || (k => k);

    // Translated text with {name} placeholders filled in
    function fmt(key, vars) {
        let text = _(key);
        for (const [k, v] of Object.entries(vars || {})) {
            text = text.split('{' + k + '}').join(String(v));
        }
        return text;
    }

    function toast(type, message) {
        if (window.Notifications && typeof window.Notifications[type] === 'function') {
            window.Notifications[type](message);
        }
    }

    // ─── Node Registry ──────────────────────────────────────────────

    const NODE_DEFS = {
        // Sources
        'modbus-tcp':       { cat: 'sources', icon: 'electrical_services', label: 'Modbus TCP', desc: 'Read Modbus registers via TCP', ports: { in: 0, out: 1 }, config: { host: '192.168.1.100', port: 502, unitId: 1, register: 100, dataType: 'float32', interval: 5000 } },
        'modbus-rtu':       { cat: 'sources', icon: 'usb',               label: 'Modbus RTU', desc: 'Read serial Modbus', ports: { in: 0, out: 1 }, config: { serialPort: '/dev/ttyUSB0', baud: 9600, parity: 'none', slaveId: 1, register: 0, dataType: 'int16', interval: 5000 } },
        'snmp-poll':        { cat: 'sources', icon: 'router',            label: 'SNMP Poll', desc: 'Poll SNMP OIDs', ports: { in: 0, out: 1 }, config: { host: '192.168.1.1', community: 'public', version: '2c', oids: '1.3.6.1.2.1.1.3.0', interval: 10000 } },
        'rest-poll':        { cat: 'sources', icon: 'api',               label: 'REST Poll', desc: 'Poll HTTP/REST endpoint', ports: { in: 0, out: 1 }, config: { url: 'https://api.example.com/data', method: 'GET', headers: '', interval: 30000, jmesPath: '' } },
        'mqtt-subscribe':   { cat: 'sources', icon: 'cell_tower',        label: 'MQTT Subscribe', desc: 'Listen to MQTT topic', ports: { in: 0, out: 1 }, config: { broker: 'mqtt://broker:1883', topic: 'sensors/#', qos: 0, tls: false } },
        'webhook-listen':   { cat: 'sources', icon: 'webhook',           label: 'Webhook', desc: 'Receive HTTP webhooks', ports: { in: 0, out: 1 }, config: { path: '/webhook/data', method: 'POST', authToken: '' } },
        'device-telemetry': { cat: 'sources', icon: 'developer_board',   label: 'Device Telemetry', desc: 'BetterDesk agent metrics', ports: { in: 0, out: 1 }, config: { deviceId: '', metrics: 'cpu,memory,disk' } },
        'database-query':   { cat: 'sources', icon: 'storage',           label: 'Database Query', desc: 'Poll SQL database', ports: { in: 0, out: 1 }, config: { dsn: '', query: 'SELECT 1', interval: 60000 } },
        'file-watch':       { cat: 'sources', icon: 'folder_open',       label: 'File Watch', desc: 'Watch file changes', ports: { in: 0, out: 1 }, config: { path: '/var/log/', pattern: '*.log', events: 'modify' } },

        // Processing
        'filter':    { cat: 'processing', icon: 'filter_alt', label: 'Filter', desc: 'Pass/block based on condition', ports: { in: 1, out: 1, pass: 1 }, config: { field: 'value', operator: '>', threshold: 0 } },
        'transform': { cat: 'processing', icon: 'swap_horiz', label: 'Transform', desc: 'Map/rename/calculate fields', ports: { in: 1, out: 1 }, config: { expression: 'value * 1' } },
        'aggregate': { cat: 'processing', icon: 'functions',  label: 'Aggregate', desc: 'Combine inputs (avg/min/max)', ports: { in: 1, out: 1 }, config: { mode: 'avg', window: 10 } },
        'delay':     { cat: 'processing', icon: 'timer',      label: 'Delay', desc: 'Hold data for N seconds', ports: { in: 1, out: 1 }, config: { duration: 5000, bufferSize: 100 } },
        'debounce':  { cat: 'processing', icon: 'slow_motion_video', label: 'Debounce', desc: 'Suppress rapid changes', ports: { in: 1, out: 1 }, config: { cooldown: 5000 } },
        'switch':    { cat: 'processing', icon: 'call_split', label: 'Switch', desc: 'Route to different paths', ports: { in: 1, out: 1, pass: 1 }, config: { conditions: [{ field: 'value', operator: '>', value: 0 }] } },
        'merge':     { cat: 'processing', icon: 'merge',      label: 'Merge', desc: 'Combine multiple streams', ports: { in: 2, out: 1 }, config: { strategy: 'latest' } },
        'script':    { cat: 'processing', icon: 'code',       label: 'Script', desc: 'Custom JavaScript code', ports: { in: 1, out: 1 }, config: { code: '// msg.payload\nreturn msg;' } },

        // Outputs
        'widget-update': { cat: 'outputs', icon: 'dashboard',     label: 'Widget Update', desc: 'Update a dashboard widget', ports: { in: 1, out: 0 }, config: { widgetId: '', valueField: 'value' } },
        'alert':         { cat: 'outputs', icon: 'notifications', label: 'Alert', desc: 'Trigger alert/notification', ports: { in: 1, out: 0 }, config: { severity: 'warning', message: 'Alert: ${value}' } },
        'command':       { cat: 'outputs', icon: 'send',          label: 'Command', desc: 'Send command to device', ports: { in: 1, out: 0 }, config: { deviceId: '', commandType: '', payload: '{}' } },
        'log':           { cat: 'outputs', icon: 'list_alt',      label: 'Log', desc: 'Write to audit log', ports: { in: 1, out: 0 }, config: { level: 'info', message: '${JSON.stringify(data)}' } },
        'rest-call':     { cat: 'outputs', icon: 'http',          label: 'REST Call', desc: 'Call external API', ports: { in: 1, out: 0 }, config: { url: '', method: 'POST', headers: '', bodyTemplate: '${JSON.stringify(data)}' } },
        'mqtt-publish':  { cat: 'outputs', icon: 'publish',      label: 'MQTT Publish', desc: 'Publish to MQTT', ports: { in: 1, out: 0 }, config: { broker: '', topic: '', payloadTemplate: '${JSON.stringify(data)}' } },
        'database-write':{ cat: 'outputs', icon: 'save',         label: 'Database Write', desc: 'Insert/update SQL', ports: { in: 1, out: 0 }, config: { dsn: '', table: '', fieldMapping: '' } },
        'email':         { cat: 'outputs', icon: 'email',         label: 'Email', desc: 'Send email notification', ports: { in: 1, out: 0 }, config: { to: '', subject: '', body: '' } },
        'modbus-write':  { cat: 'outputs', icon: 'edit_note',     label: 'Modbus Write', desc: 'Write Modbus register', ports: { in: 1, out: 0 }, config: { host: '', port: 502, register: 0, value: '0' } }
    };

    // Node names come from the language files (sdk_studio.node_*), English as fallback
    const NODE_LABEL_KEYS = { 'webhook-listen': 'node_webhook' };
    function nodeLabel(type) {
        const def = NODE_DEFS[type] || {};
        const key = 'sdk_studio.' + (NODE_LABEL_KEYS[type] || 'node_' + type.replace(/-/g, '_'));
        const v = _(key);
        return v && v !== key ? v : (def.label || type);
    }

    // What kind of step a node is, in words ("Source", "Processing step", "Output")
    function nodeKind(type) {
        const cat = (NODE_DEFS[type] || {}).cat;
        return _(cat === 'processing' ? 'sdk_studio.kind_processing' : cat === 'outputs' ? 'sdk_studio.kind_output' : 'sdk_studio.kind_source');
    }

    // The line under a node's name: what it is, when the name doesn't say it already
    function nodeSubtitle(node) {
        const kindName = nodeLabel(node.type);
        return node.label && node.label !== kindName ? kindName : nodeKind(node.type);
    }

    // Settings keys ("unitId", "jmesPath") as labels: "Unit ID", "JMES path"; times are in milliseconds
    const LABEL_WORDS = { id: 'ID', url: 'URL', oids: 'OIDs', dsn: 'DSN', qos: 'QoS', tls: 'TLS', jmes: 'JMES' };
    const MS_KEYS = ['interval', 'duration', 'cooldown'];
    function configLabel(key) {
        const words = key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim().toLowerCase().split(/\s+/);
        const text = words.map((w, i) => LABEL_WORDS[w] || (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
        return MS_KEYS.includes(key) ? text + ' (ms)' : text;
    }

    // ─── State ──────────────────────────────────────────────────────

    let flow = { nodes: [], wires: [] };
    let flowMeta = { id: null, name: _('sdk_studio.untitled'), description: '' };
    let selectedNodeId = null;
    let selectedWireIdx = null;
    let zoomLevel = 1;
    let panX = 0, panY = 0;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };
    let isDraggingNode = false;
    let dragNodeId = null;
    let dragOffset = { x: 0, y: 0 };
    let isDrawingWire = false;
    let wireStart = { nodeId: null, portName: null };
    let undoStack = [];
    let redoStack = [];
    let nodeIdCounter = 0;
    let showGrid = true;

    // ─── DOM References ─────────────────────────────────────────────

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const svgEl = $('#studio-canvas-svg');
    const wiresLayer = $('#studio-wires-layer');
    const nodesLayer = $('#studio-nodes-layer');
    const tempWire = $('#studio-temp-wire');
    const canvasWrap = $('#studio-canvas-wrap');
    const emptyState = $('#studio-empty-state');
    const inspectorBody = $('#studio-inspector-body');
    const consoleBody = $('#studio-console-body');

    // ─── Helpers ────────────────────────────────────────────────────

    const esc = (str) => Utils.escapeHtml(str);

    // A translated sentence with values that are already HTML (statuses, times)
    function fmtHtml(key, vars) {
        let text = esc(_(key));
        for (const [k, v] of Object.entries(vars || {})) {
            text = text.split('{' + k + '}').join(v);
        }
        return text;
    }

    // Deploy state in the status bar: Not deployed (neutral), Deployed (good), failed (danger)
    function setDeployState(tone, label) {
        const el = document.getElementById('status-state-text');
        if (!el) return;
        el.className = 'status is-' + Utils.statusTone(tone) + ' studio-status-dot';
        el.textContent = label;
    }

    function genId() {
        return 'n' + (++nodeIdCounter);
    }

    function timeStr() {
        const d = new Date();
        return String(d.getHours()).padStart(2, '0') + ':' +
               String(d.getMinutes()).padStart(2, '0') + ':' +
               String(d.getSeconds()).padStart(2, '0');
    }

    function logConsole(msg, level) {
        level = level || 'info';
        const line = document.createElement('div');
        line.className = 'studio-console-line studio-console-' + level;
        line.innerHTML = `<span class="studio-console-time">${timeStr()}</span><span class="studio-console-msg">${esc(msg)}</span>`;
        consoleBody.appendChild(line);
        consoleBody.scrollTop = consoleBody.scrollHeight;
        const last = document.getElementById('studio-console-last');
        if (last) {
            last.textContent = msg;
            last.className = 'studio-console-last studio-console-last-' + level;
        }
    }

    // The log is folded to one line (its latest message) unless opened
    function setConsoleOpen(open, remember) {
        const btn = document.getElementById('btn-toggle-console');
        if (!btn) return;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        consoleBody.hidden = !open;
        const box = document.getElementById('studio-console');
        if (box) box.classList.toggle('is-open', open);
        if (open) consoleBody.scrollTop = consoleBody.scrollHeight;
        if (remember) store('bd.studio.log', open ? '1' : '0');
    }

    // Side panels fold to a narrow strip so the canvas gets the room
    function setPanelOpen(btn, open, remember) {
        const panel = btn.closest('.studio-panel');
        const body = document.getElementById(btn.getAttribute('aria-controls'));
        const label = open ? btn.dataset.labelHide : btn.dataset.labelShow;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', label);
        btn.title = label;
        if (body) body.hidden = !open;
        if (panel) panel.classList.toggle('is-collapsed', !open);
        if (remember) store('bd.studio.' + btn.id, open ? '1' : '0');
    }

    // Per-viewer layout memory; the page works the same without storage
    function store(key, value) {
        try {
            if (value === undefined) return window.localStorage.getItem(key);
            window.localStorage.setItem(key, value);
        } catch (_) { /* private window or blocked storage */ }
        return null;
    }

    function pushUndo() {
        undoStack.push(JSON.stringify(flow));
        if (undoStack.length > 50) undoStack.shift();
        redoStack = [];
        updateUndoButtons();
    }

    function updateUndoButtons() {
        const u = document.getElementById('btn-undo');
        const r = document.getElementById('btn-redo');
        if (u) u.disabled = !undoStack.length;
        if (r) r.disabled = !redoStack.length;
    }

    function doUndo() {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify(flow));
        flow = JSON.parse(undoStack.pop());
        selectedNodeId = null;
        selectedWireIdx = null;
        renderAll();
        clearInspector();
        logConsole(_('sdk_studio.log_undo'), 'info');
    }

    function doRedo() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(flow));
        flow = JSON.parse(redoStack.pop());
        selectedNodeId = null;
        selectedWireIdx = null;
        renderAll();
        clearInspector();
        logConsole(_('sdk_studio.log_redo'), 'info');
    }

    function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

    function svgPoint(clientX, clientY) {
        // Convert client coords to canvas coords accounting for pan/zoom
        const rect = canvasWrap.getBoundingClientRect();
        return {
            x: (clientX - rect.left - panX) / zoomLevel,
            y: (clientY - rect.top - panY) / zoomLevel
        };
    }

    // ─── Palette ────────────────────────────────────────────────────

    function buildPalette() {
        const cats = { sources: [], processing: [], outputs: [] };
        for (const [type, def] of Object.entries(NODE_DEFS)) {
            cats[def.cat].push({ type, ...def });
        }

        for (const cat of ['sources', 'processing', 'outputs']) {
            const container = $(`#palette-${cat}`);
            if (!container) continue;
            container.innerHTML = '';
            for (const n of cats[cat]) {
                const el = document.createElement('button');
                el.type = 'button';
                el.className = 'studio-palette-node';
                el.dataset.type = n.type;
                el.dataset.cat = cat;
                el.draggable = true;
                el.title = n.desc;
                el.innerHTML = `<span class="studio-palette-node-label">${esc(nodeLabel(n.type))}</span>`;
                // Click or Enter adds the node in the middle of the visible canvas
                el.addEventListener('click', () => addNodeAtCentre(n.type));
                container.appendChild(el);
            }
        }

        // Category toggle
        for (const btn of $$('.studio-palette-cat-btn')) {
            btn.addEventListener('click', () => {
                const collapsed = btn.closest('.studio-palette-category').classList.toggle('collapsed');
                btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            });
        }

        // Search filter
        const searchInput = $('#palette-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.toLowerCase();
                for (const item of $$('.studio-palette-node')) {
                    const visible = !q || item.textContent.toLowerCase().includes(q);
                    item.style.display = visible ? '' : 'none';
                }
            });
        }

        // Drag from palette
        for (const item of $$('.studio-palette-node')) {
            item.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', item.dataset.type);
                e.dataTransfer.effectAllowed = 'copy';
            });
        }
    }

    // ─── Canvas Drop ────────────────────────────────────────────────

    function initCanvasDrop() {
        canvasWrap.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
        });

        canvasWrap.addEventListener('drop', (e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData('text/plain');
            if (!NODE_DEFS[type]) return;

            const pos = svgPoint(e.clientX, e.clientY);
            pushUndo();
            addNode(type, pos.x, pos.y);
            renderAll();
            logConsole(fmt('sdk_studio.log_node_added', { name: nodeLabel(type) }), 'success');
        });
    }

    function addNodeAtCentre(type) {
        if (!NODE_DEFS[type]) return;
        const rect = canvasWrap.getBoundingClientRect();
        // Offset each new node a little so several clicks don't stack exactly
        const shift = (flow.nodes.length % 5) * 24;
        const pos = svgPoint(rect.left + rect.width / 2 - (NODE_W / 2) * zoomLevel + shift, rect.top + rect.height / 2 - (NODE_H / 2) * zoomLevel + shift);
        pushUndo();
        const node = addNode(type, pos.x, pos.y);
        if (node) selectedNodeId = node.id;
        renderAll();
        logConsole(fmt('sdk_studio.log_node_added', { name: nodeLabel(type) }), 'success');
    }

    // ─── Node Operations ────────────────────────────────────────────

    function addNode(type, x, y, label, config, id) {
        const def = NODE_DEFS[type];
        if (!def) return null;

        const node = {
            id: id || genId(),
            type,
            x: Math.round(x),
            y: Math.round(y),
            label: label || nodeLabel(type),
            config: config ? { ...config } : { ...def.config }
        };
        flow.nodes.push(node);
        updateStatus();
        return node;
    }

    function deleteNode(nodeId) {
        pushUndo();
        flow.nodes = flow.nodes.filter(n => n.id !== nodeId);
        flow.wires = flow.wires.filter(w => w.from !== nodeId && w.to !== nodeId);
        if (selectedNodeId === nodeId) selectedNodeId = null;
        renderAll();
        clearInspector();
        logConsole(_('sdk_studio.log_node_deleted'), 'warn');
    }

    function getNode(id) {
        return flow.nodes.find(n => n.id === id);
    }

    // ─── Wire Operations ────────────────────────────────────────────

    function addWire(fromNodeId, fromPort, toNodeId, toPort) {
        // Prevent duplicate
        const exists = flow.wires.some(w =>
            w.from === fromNodeId && w.fromPort === fromPort &&
            w.to === toNodeId && w.toPort === toPort
        );
        if (exists) return;
        // Prevent self-connect
        if (fromNodeId === toNodeId) return;

        flow.wires.push({
            from: fromNodeId, fromPort: fromPort || 'out',
            to: toNodeId, toPort: toPort || 'in'
        });
        updateStatus();
    }

    function deleteWire(idx) {
        if (idx < 0 || idx >= flow.wires.length) return;
        pushUndo();
        flow.wires.splice(idx, 1);
        if (selectedWireIdx === idx) selectedWireIdx = null;
        renderAll();
        logConsole(_('sdk_studio.log_wire_removed'), 'warn');
    }

    // ─── Port Positions ─────────────────────────────────────────────

    const NODE_W = 180;
    const NODE_H = 52;
    const PORT_R = 6;

    function getPortPos(node, portName) {
        const def = NODE_DEFS[node.type] || {};
        const ports = def.ports || { in: 1, out: 1 };

        if (portName === 'in') {
            return { x: node.x, y: node.y + NODE_H / 2 };
        }
        if (portName === 'out') {
            return { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
        }
        if (portName === 'pass') {
            return { x: node.x + NODE_W, y: node.y + NODE_H / 2 - 14 };
        }
        // Default: out
        return { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
    }

    // ─── Rendering ──────────────────────────────────────────────────

    function renderAll() {
        renderNodes();
        renderWires();
        renderMinimap();
        updateEmptyState();
        updateStatus();
        updateUndoButtons();
        if (selectedNodeId) renderInspector(selectedNodeId);
    }

    function renderNodes() {
        nodesLayer.innerHTML = '';

        for (const node of flow.nodes) {
            const def = NODE_DEFS[node.type] || {};
            const cat = def.cat || 'sources';
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.setAttribute('class', 'studio-node' + (node.id === selectedNodeId ? ' selected' : ''));
            g.setAttribute('data-id', node.id);
            g.setAttribute('data-category', cat);
            g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

            // Body rect
            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('class', 'studio-node-body');
            rect.setAttribute('width', NODE_W);
            rect.setAttribute('height', NODE_H);
            g.appendChild(rect);

            // Accent bar (left edge color by category)
            const accent = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            accent.setAttribute('class', 'studio-node-accent');
            accent.setAttribute('x', 0);
            accent.setAttribute('y', 0);
            accent.setAttribute('width', 4);
            accent.setAttribute('height', NODE_H);
            g.appendChild(accent);

            // Label
            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('class', 'studio-node-label');
            label.setAttribute('x', 16);
            label.setAttribute('y', 22);
            label.textContent = (node.label || def.label || node.type).slice(0, 20);
            g.appendChild(label);

            // Type subtitle
            const typeTxt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            typeTxt.setAttribute('class', 'studio-node-type');
            typeTxt.setAttribute('x', 16);
            typeTxt.setAttribute('y', 38);
            typeTxt.textContent = nodeSubtitle(node).slice(0, 26);
            g.appendChild(typeTxt);

            // Input ports
            const ports = def.ports || { in: 1, out: 1 };
            if (ports.in) {
                for (let i = 0; i < ports.in; i++) {
                    const cy = NODE_H / 2 + (i - (ports.in - 1) / 2) * 18;
                    const port = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    port.setAttribute('class', 'studio-port studio-port-in');
                    port.setAttribute('cx', 0);
                    port.setAttribute('cy', cy);
                    port.setAttribute('r', PORT_R);
                    port.dataset.nodeId = node.id;
                    port.dataset.port = 'in';
                    g.appendChild(port);
                }
            }

            // Output ports
            const outPorts = [];
            if (ports.out) outPorts.push('out');
            if (ports.pass) outPorts.push('pass');

            for (let i = 0; i < outPorts.length; i++) {
                const pName = outPorts[i];
                const cy = NODE_H / 2 + (i - (outPorts.length - 1) / 2) * 18;
                const port = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                port.setAttribute('class', 'studio-port studio-port-out');
                port.setAttribute('cx', NODE_W);
                port.setAttribute('cy', cy);
                port.setAttribute('r', PORT_R);
                port.dataset.nodeId = node.id;
                port.dataset.port = pName;
                g.appendChild(port);
            }

            nodesLayer.appendChild(g);
        }
    }

    function renderWires() {
        wiresLayer.innerHTML = '';

        for (let i = 0; i < flow.wires.length; i++) {
            const w = flow.wires[i];
            const fromNode = getNode(w.from);
            const toNode = getNode(w.to);
            if (!fromNode || !toNode) continue;

            const p1 = getPortPos(fromNode, w.fromPort || 'out');
            const p2 = getPortPos(toNode, w.toPort || 'in');

            const dx = Math.abs(p2.x - p1.x) * 0.5;
            const d = `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('class', 'studio-wire' + (i === selectedWireIdx ? ' selected' : ''));
            path.setAttribute('d', d);
            path.dataset.wireIdx = i;
            wiresLayer.appendChild(path);
        }
    }

    function renderMinimap() {
        const canvas = $('#studio-minimap-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const W = 160, H = 100;
        ctx.clearRect(0, 0, W, H);

        if (!flow.nodes.length) return;

        // Find bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of flow.nodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
            if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
        }

        const pad = 40;
        minX -= pad; minY -= pad; maxX += pad; maxY += pad;
        const sw = maxX - minX || 1;
        const sh = maxY - minY || 1;
        const scale = Math.min(W / sw, H / sh);

        // Colours follow the theme tokens
        const css = getComputedStyle(document.documentElement);
        const tok = (name, fallback) => (css.getPropertyValue(name) || '').trim() || fallback;

        // Draw wires
        ctx.strokeStyle = tok('--text-muted', '#566064');
        ctx.lineWidth = 1;
        for (const w of flow.wires) {
            const from = getNode(w.from);
            const to = getNode(w.to);
            if (!from || !to) continue;
            ctx.beginPath();
            ctx.moveTo((from.x + NODE_W - minX) * scale, (from.y + NODE_H / 2 - minY) * scale);
            ctx.lineTo((to.x - minX) * scale, (to.y + NODE_H / 2 - minY) * scale);
            ctx.stroke();
        }

        // Draw nodes
        for (const n of flow.nodes) {
            const def = NODE_DEFS[n.type] || {};
            ctx.fillStyle = def.cat === 'sources' ? tok('--accent', '#1b62cf') : def.cat === 'processing' ? tok('--warning', '#875b00') : tok('--success', '#1c7a3b');
            ctx.fillRect((n.x - minX) * scale, (n.y - minY) * scale, NODE_W * scale, NODE_H * scale);
        }
    }

    function updateEmptyState() {
        if (emptyState) {
            emptyState.style.display = flow.nodes.length ? 'none' : '';
        }
        const minimap = $('#studio-minimap');
        if (minimap) minimap.hidden = !flow.nodes.length;
    }

    function updateStatus() {
        const sn = $('#status-nodes');
        const sw = $('#status-wires');
        const sf = $('#status-flow-label');
        const fn = $('#studio-flow-name');
        if (sn) sn.textContent = Utils.formatNumber(flow.nodes.length);
        if (sw) sw.textContent = Utils.formatNumber(flow.wires.length);
        if (sf) sf.textContent = flowMeta.name;
        if (fn) fn.textContent = flowMeta.name;
    }

    // ─── Inspector ──────────────────────────────────────────────────

    function renderInspector(nodeId) {
        const node = getNode(nodeId);
        if (!node) {
            clearInspector();
            return;
        }

        const def = NODE_DEFS[node.type] || {};
        let html = '';
        let fieldNo = 0;
        const fid = () => 'studio-field-' + (++fieldNo);

        // Node header
        html += `<h3 class="studio-inspector-title">${esc(node.label || nodeLabel(node.type))} <span class="studio-inspector-type">${Utils.tagHtml(nodeSubtitle(node))}</span></h3>`;

        // Label field
        const labelId = fid();
        html += `<div class="studio-field">
            <label for="${labelId}">${_('sdk_studio.label')}</label>
            <input type="text" id="${labelId}" class="form-input" data-field="label" value="${esc(node.label || '')}" maxlength="40">
        </div>`;

        // Config fields
        html += `<h3 class="studio-inspector-section">${_('sdk_studio.configuration')}</h3>`;

        const cfg = node.config || {};
        for (const [key, defaultVal] of Object.entries(def.config || {})) {
            const val = cfg[key] !== undefined ? cfg[key] : defaultVal;
            const fieldLabel = configLabel(key);
            const id = fid();

            if (typeof defaultVal === 'boolean') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        <option value="true" ${val ? 'selected' : ''}>${_('common.yes')}</option>
                        <option value="false" ${!val ? 'selected' : ''}>${_('common.no')}</option>
                    </select>
                </div>`;
            } else if (typeof defaultVal === 'number') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <input type="number" id="${id}" class="form-input" data-config="${esc(key)}" value="${val}">
                </div>`;
            } else if (defaultVal && typeof defaultVal === 'object') {
                // Lists and objects (switch conditions) are edited as JSON
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <textarea id="${id}" class="form-input" data-config="${esc(key)}" data-json="1" rows="4" aria-describedby="${id}-hint">${esc(JSON.stringify(val, null, 2))}</textarea>
                    <p class="form-hint" id="${id}-hint">${_('sdk_studio.json_hint')}</p>
                </div>`;
            } else if (key === 'code' || key === 'expression') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <textarea id="${id}" class="form-input" data-config="${esc(key)}" rows="4">${esc(String(val))}</textarea>
                </div>`;
            } else if (key === 'operator') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${['>', '<', '==', '!=', '>=', '<=', 'contains'].map(op =>
                            `<option value="${op}" ${val === op ? 'selected' : ''}>${op}</option>`
                        ).join('')}
                    </select>
                </div>`;
            } else if (key === 'severity') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${['info', 'warning', 'critical'].map(s =>
                            `<option value="${s}" ${val === s ? 'selected' : ''}>${s}</option>`
                        ).join('')}
                    </select>
                </div>`;
            } else if (key === 'level') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${['info', 'warn', 'error', 'debug'].map(l =>
                            `<option value="${l}" ${val === l ? 'selected' : ''}>${l}</option>`
                        ).join('')}
                    </select>
                </div>`;
            } else if (key === 'method') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m =>
                            `<option value="${m}" ${val === m ? 'selected' : ''}>${m}</option>`
                        ).join('')}
                    </select>
                </div>`;
            } else if (key === 'mode' || key === 'strategy') {
                const opts = key === 'mode'
                    ? ['avg', 'min', 'max', 'sum', 'count']
                    : ['latest', 'all', 'zip'];
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${opts.map(o => `<option value="${o}" ${val === o ? 'selected' : ''}>${o}</option>`).join('')}
                    </select>
                </div>`;
            } else if (key === 'dataType') {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <select id="${id}" class="form-select" data-config="${esc(key)}">
                        ${['int16', 'uint16', 'int32', 'uint32', 'float32', 'float64'].map(t =>
                            `<option value="${t}" ${val === t ? 'selected' : ''}>${t}</option>`
                        ).join('')}
                    </select>
                </div>`;
            } else {
                html += `<div class="studio-field">
                    <label for="${id}">${esc(fieldLabel)}</label>
                    <input type="text" id="${id}" class="form-input" data-config="${esc(key)}" value="${esc(String(val))}">
                </div>`;
            }
        }

        // Connections info
        const inWires = flow.wires.filter(w => w.to === nodeId);
        const outWires = flow.wires.filter(w => w.from === nodeId);
        html += `<h3 class="studio-inspector-section">${_('sdk_studio.connections')}</h3>`;
        html += `<p class="studio-inspector-connections">${esc(fmt('sdk_studio.connections_line', { in: Utils.formatNumber(inWires.length), out: Utils.formatNumber(outWires.length) }))}</p>`;

        // Delete button
        html += `<button type="button" class="btn btn-sm btn-danger-quiet studio-delete-node-btn" id="btn-delete-selected-node">${_('sdk_studio.delete_node')}</button>`;

        inspectorBody.innerHTML = html;

        // Bind field change handlers
        for (const input of inspectorBody.querySelectorAll('[data-field]')) {
            input.addEventListener('change', () => {
                const node = getNode(selectedNodeId);
                if (!node) return;
                pushUndo();
                node[input.dataset.field] = input.value;
                renderAll();
            });
        }

        for (const input of inspectorBody.querySelectorAll('[data-config]')) {
            input.addEventListener('change', () => {
                const node = getNode(selectedNodeId);
                if (!node) return;
                let val = input.value;
                if (input.dataset.json) {
                    try {
                        val = JSON.parse(val);
                        input.removeAttribute('aria-invalid');
                    } catch (_) {
                        input.setAttribute('aria-invalid', 'true');
                        logConsole(fmt('sdk_studio.log_json_invalid', { field: configLabel(input.dataset.config) }), 'error');
                        return;
                    }
                }
                if (input.type === 'number') val = Number(val);
                if (input.tagName === 'SELECT' && (val === 'true' || val === 'false')) val = val === 'true';
                pushUndo();
                node.config[input.dataset.config] = val;
            });
        }

        // Delete button
        const delBtn = $('#btn-delete-selected-node');
        if (delBtn) {
            delBtn.addEventListener('click', () => deleteNode(selectedNodeId));
        }
    }

    function clearInspector() {
        inspectorBody.innerHTML = `<div class="studio-inspector-empty">
            <p>${_('sdk_studio.select_node')}</p>
            <h3 class="studio-inspector-section">${_('sdk_studio.howto_title')}</h3>
            <ol class="steps studio-howto">
                <li>${_('sdk_studio.howto_add')}</li>
                <li>${_('sdk_studio.howto_connect')}</li>
                <li>${_('sdk_studio.howto_save')}</li>
            </ol>
            <p class="form-hint">${_('sdk_studio.howto_keys')}</p>
        </div>`;
    }

    // ─── Pan & Zoom ─────────────────────────────────────────────────

    function applyTransform() {
        const g = nodesLayer;
        const gw = wiresLayer;
        const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
        g.style.transform = transform;
        gw.style.transform = transform;
        g.style.transformOrigin = '0 0';
        gw.style.transformOrigin = '0 0';

        // The dots move with the canvas; the rect itself always fills the view
        const gridPattern = $('#studio-grid');
        if (gridPattern) {
            gridPattern.setAttribute('patternTransform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
        }

        $('#studio-zoom-label').textContent = Utils.formatPercent(zoomLevel, { fraction: true });
    }

    function zoomTo(newZoom, cx, cy) {
        newZoom = clamp(newZoom, 0.25, 4);
        if (cx !== undefined && cy !== undefined) {
            const rect = canvasWrap.getBoundingClientRect();
            const wx = cx - rect.left;
            const wy = cy - rect.top;
            panX = wx - (wx - panX) * (newZoom / zoomLevel);
            panY = wy - (wy - panY) * (newZoom / zoomLevel);
        }
        zoomLevel = newZoom;
        applyTransform();
        renderMinimap();
    }

    function zoomFit() {
        if (!flow.nodes.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of flow.nodes) {
            if (n.x < minX) minX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.x + NODE_W > maxX) maxX = n.x + NODE_W;
            if (n.y + NODE_H > maxY) maxY = n.y + NODE_H;
        }
        const pad = 60;
        const cw = canvasWrap.clientWidth;
        const ch = canvasWrap.clientHeight;
        const sw = maxX - minX + pad * 2;
        const sh = maxY - minY + pad * 2;
        zoomLevel = clamp(Math.min(cw / sw, ch / sh), 0.25, 2);
        panX = (cw - sw * zoomLevel) / 2 - (minX - pad) * zoomLevel;
        panY = (ch - sh * zoomLevel) / 2 - (minY - pad) * zoomLevel;
        applyTransform();
        renderMinimap();
    }

    // ─── Canvas Interaction ─────────────────────────────────────────

    function initCanvasInteraction() {
        // Wheel zoom
        canvasWrap.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            zoomTo(zoomLevel * delta, e.clientX, e.clientY);
        }, { passive: false });

        // Pan (middle-click or space+drag)
        canvasWrap.addEventListener('mousedown', (e) => {
            // Click on port → start wire
            if (e.target.classList.contains('studio-port')) {
                e.preventDefault();
                isDrawingWire = true;
                wireStart.nodeId = e.target.dataset.nodeId;
                wireStart.portName = e.target.dataset.port;
                const node = getNode(wireStart.nodeId);
                if (node) {
                    const pos = getPortPos(node, wireStart.portName);
                    tempWire.setAttribute('x1', pos.x);
                    tempWire.setAttribute('y1', pos.y);
                    tempWire.setAttribute('x2', pos.x);
                    tempWire.setAttribute('y2', pos.y);
                    tempWire.style.display = '';
                    tempWire.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
                    tempWire.style.transformOrigin = '0 0';
                }
                return;
            }

            // Click on node → select / start drag
            const nodeG = e.target.closest('.studio-node');
            if (nodeG && e.button === 0) {
                e.preventDefault();
                const nId = nodeG.dataset.id;
                selectedNodeId = nId;
                selectedWireIdx = null;
                isDraggingNode = true;
                dragNodeId = nId;
                const node = getNode(nId);
                if (node) {
                    const pos = svgPoint(e.clientX, e.clientY);
                    dragOffset.x = pos.x - node.x;
                    dragOffset.y = pos.y - node.y;
                }
                renderNodes();
                renderInspector(nId);
                return;
            }

            // Click on wire → select
            if (e.target.classList.contains('studio-wire')) {
                e.preventDefault();
                selectedWireIdx = parseInt(e.target.dataset.wireIdx, 10);
                selectedNodeId = null;
                renderWires();
                clearInspector();
                return;
            }

            // Middle-click or left-click on empty canvas → pan
            if (e.button === 1 || (e.button === 0 && !nodeG)) {
                isPanning = true;
                panStart.x = e.clientX - panX;
                panStart.y = e.clientY - panY;
                canvasWrap.style.cursor = 'grabbing';

                // Deselect when clicking empty canvas
                if (e.button === 0 && !nodeG) {
                    selectedNodeId = null;
                    selectedWireIdx = null;
                    renderNodes();
                    renderWires();
                    clearInspector();
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (isPanning) {
                panX = e.clientX - panStart.x;
                panY = e.clientY - panStart.y;
                applyTransform();
                return;
            }

            if (isDraggingNode && dragNodeId) {
                const pos = svgPoint(e.clientX, e.clientY);
                const node = getNode(dragNodeId);
                if (node) {
                    node.x = Math.round(pos.x - dragOffset.x);
                    node.y = Math.round(pos.y - dragOffset.y);
                    // Snap to grid (20px)
                    if (showGrid) {
                        node.x = Math.round(node.x / 20) * 20;
                        node.y = Math.round(node.y / 20) * 20;
                    }
                    renderNodes();
                    renderWires();
                }
                return;
            }

            if (isDrawingWire) {
                const pos = svgPoint(e.clientX, e.clientY);
                tempWire.setAttribute('x2', pos.x);
                tempWire.setAttribute('y2', pos.y);
            }
        });

        window.addEventListener('mouseup', (e) => {
            if (isPanning) {
                isPanning = false;
                canvasWrap.style.cursor = '';
                renderMinimap();
            }

            if (isDraggingNode) {
                if (dragNodeId) pushUndo();
                isDraggingNode = false;
                dragNodeId = null;
                renderMinimap();
            }

            if (isDrawingWire) {
                isDrawingWire = false;
                tempWire.style.display = 'none';

                // Check if dropped on a port
                const target = document.elementFromPoint(e.clientX, e.clientY);
                if (target && target.classList.contains('studio-port')) {
                    const toNodeId = target.dataset.nodeId;
                    const toPort = target.dataset.port;

                    if (wireStart.nodeId !== toNodeId) {
                        pushUndo();
                        // Determine direction: if start was input, swap
                        if (wireStart.portName === 'in') {
                            addWire(toNodeId, toPort, wireStart.nodeId, wireStart.portName);
                        } else {
                            addWire(wireStart.nodeId, wireStart.portName, toNodeId, toPort);
                        }
                        renderWires();
                        renderMinimap();
                        if (selectedNodeId) renderInspector(selectedNodeId);
                        logConsole(_('sdk_studio.log_wire_connected'), 'success');
                    }
                }
            }
        });

        // Delete key
        document.addEventListener('keydown', (e) => {
            // Skip if typing in input
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
            if (document.querySelector('.modal-overlay.open')) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeId) {
                    deleteNode(selectedNodeId);
                } else if (selectedWireIdx !== null) {
                    deleteWire(selectedWireIdx);
                }
            }

            if (e.ctrlKey && e.key === 'z') { e.preventDefault(); doUndo(); }
            if (e.ctrlKey && e.key === 'y') { e.preventDefault(); doRedo(); }
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFlow(); }
        });
    }

    // ─── Flow Persistence (API) ─────────────────────────────────────

    function getCsrf() {
        return window.BetterDesk && window.BetterDesk.csrfToken
            ? { 'x-csrf-token': window.BetterDesk.csrfToken }
            : {};
    }

    async function listFlows() {
        try {
            const resp = await fetch('/api/cdap-studio/flows', {
                headers: { ...getCsrf() }
            });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || resp.statusText);
            return data.flows || [];
        } catch (err) {
            logConsole(fmt('sdk_studio.log_list_failed', { error: err.message }), 'error');
            return null;
        }
    }

    async function loadFlow(id) {
        try {
            const resp = await fetch(`/api/cdap-studio/flows/${encodeURIComponent(id)}`, {
                headers: { ...getCsrf() }
            });
            const data = await resp.json();
            if (!data.success || !data.flow) throw new Error(data.error || _('sdk_studio.flow_not_found'));

            flowMeta.id = data.flow.id;
            flowMeta.name = data.flow.name;
            flowMeta.description = data.flow.description;

            try {
                flow = JSON.parse(data.flow.flow_json);
            } catch (_) {
                flow = { nodes: [], wires: [] };
            }
            if (!flow.nodes) flow.nodes = [];
            if (!flow.wires) flow.wires = [];

            // Recalculate node ID counter
            let maxId = 0;
            for (const n of flow.nodes) {
                const num = parseInt((n.id || '').replace('n', ''), 10);
                if (num > maxId) maxId = num;
            }
            nodeIdCounter = maxId;

            selectedNodeId = null;
            selectedWireIdx = null;
            undoStack = [];
            redoStack = [];

            setDeployState(data.flow.status === 'deployed' ? 'good' : 'neutral',
                _(data.flow.status === 'deployed' ? 'sdk_studio.status_deployed' : 'sdk_studio.status_ready'));
            renderAll();
            clearInspector();
            zoomFit();
            logConsole(fmt('sdk_studio.log_flow_opened', { name: flowMeta.name }), 'success');
        } catch (err) {
            logConsole(fmt('sdk_studio.log_open_failed', { error: err.message }), 'error');
            toast('error', fmt('sdk_studio.log_open_failed', { error: err.message }));
        }
    }

    // What to do after the next successful save (a test run or deploy that needed it)
    let afterSave = null;

    // Save: a flow that was saved before saves right away; a new one asks for a name first
    function saveFlow() {
        if (flowMeta.id) {
            doSaveFlow();
            return;
        }
        openSaveDialog(null);
    }

    // The name and description dialog; note says why it opened (e.g. before a test run)
    function openSaveDialog(note) {
        if (!note) afterSave = null;
        showModal('save-flow');
        const nameInput = $('#save-flow-name');
        const descInput = $('#save-flow-desc');
        if (nameInput) nameInput.value = flowMeta.name || '';
        if (descInput) descInput.value = flowMeta.description || '';
        const st = $('#save-flow-status');
        if (st) { st.textContent = ''; st.className = 'form-status'; }
        const noteEl = $('#save-flow-note');
        if (noteEl) {
            noteEl.textContent = note || '';
            noteEl.hidden = !note;
        }
        if (nameInput) nameInput.focus();
    }

    async function doSaveFlow() {
        const dialogOpen = isModalOpen('save-flow');
        if (dialogOpen) {
            const name = ($('#save-flow-name') || {}).value || _('sdk_studio.untitled');
            const desc = ($('#save-flow-desc') || {}).value || '';
            flowMeta.name = name.trim() || _('sdk_studio.untitled');
            flowMeta.description = desc.trim();
        }

        try {
            const body = {
                name: flowMeta.name,
                description: flowMeta.description,
                flow_json: JSON.stringify(flow)
            };

            let resp;
            if (flowMeta.id) {
                // Update existing
                resp = await fetch(`/api/cdap-studio/flows/${encodeURIComponent(flowMeta.id)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', ...getCsrf() },
                    body: JSON.stringify(body)
                });
            } else {
                // Create new
                resp = await fetch('/api/cdap-studio/flows', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...getCsrf() },
                    body: JSON.stringify(body)
                });
            }

            const data = await resp.json();
            if (!data.success) throw new Error(data.error || resp.statusText);
            if (data.id) flowMeta.id = data.id;

            closeAllModals();
            updateStatus();
            logConsole(fmt('sdk_studio.log_saved', { name: flowMeta.name }), 'success');
            toast('success', fmt('sdk_studio.log_saved', { name: flowMeta.name }));
            const next = afterSave;
            afterSave = null;
            if (next) next();
        } catch (err) {
            const msg = fmt('sdk_studio.log_save_failed', { error: err.message });
            logConsole(msg, 'error');
            const st = $('#save-flow-status');
            if (st && isModalOpen('save-flow')) {
                st.textContent = msg;
                st.className = 'form-status is-error';
            } else {
                toast('error', msg);
            }
        }
    }

    async function deployFlow() {
        if (!flowMeta.id) {
            afterSave = deployFlow;
            openSaveDialog(_('sdk_studio.save_first_deploy_note'));
            return;
        }

        try {
            const resp = await fetch(`/api/cdap-studio/flows/${encodeURIComponent(flowMeta.id)}/deploy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrf() }
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || resp.statusText);

            logConsole(fmt('sdk_studio.log_deployed', { name: flowMeta.name }), 'success');
            toast('success', fmt('sdk_studio.log_deployed', { name: flowMeta.name }));

            setDeployState('good', _('sdk_studio.status_deployed'));
        } catch (err) {
            setDeployState('danger', _('sdk_studio.status_deploy_failed'));
            logConsole(fmt('sdk_studio.log_deploy_failed', { error: err.message }), 'error');
            toast('error', fmt('sdk_studio.log_deploy_failed', { error: err.message }));
        }
    }

    async function testFlow() {
        if (!flowMeta.id) {
            afterSave = testFlow;
            openSaveDialog(_('sdk_studio.save_first_test_note'));
            return;
        }

        setConsoleOpen(true, false);
        logConsole(_('sdk_studio.log_test_started'), 'info');

        try {
            const resp = await fetch(`/api/cdap-studio/flows/${encodeURIComponent(flowMeta.id)}/test`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getCsrf() }
            });
            const data = await resp.json();
            if (!data.success) throw new Error(data.error || resp.statusText);

            logConsole(fmt('sdk_studio.log_test_done', { nodes: data.nodeCount, wires: data.wireCount }), 'success');

            for (const r of (data.results || [])) {
                logConsole(`  [${r.label}] → ${JSON.stringify(r.output)}`, 'data');
            }
        } catch (err) {
            logConsole(fmt('sdk_studio.log_test_failed', { error: err.message }), 'error');
            toast('error', fmt('sdk_studio.log_test_failed', { error: err.message }));
        }
    }

    // Download the flow on the canvas as a .bdflow file (same format as the
    // server's export), whether or not it has been saved
    function exportFlow() {
        const user = (window.BetterDesk && window.BetterDesk.user) || {};
        const data = {
            version: '1.0',
            format: 'bdflow',
            name: flowMeta.name,
            description: flowMeta.description || '',
            flow,
            exportedAt: new Date().toISOString(),
            exportedBy: user.username || ''
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = String(flowMeta.name || 'flow').replace(/[^a-zA-Z0-9_-]/g, '_') + '.bdflow';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        logConsole(_('sdk_studio.log_exported'), 'success');
    }

    function importFlow() {
        var fileInput = document.getElementById('import-flow-input');
        if (!fileInput) return;
        fileInput.value = '';
        fileInput.click();
    }

    function handleImportFile(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;

        var reader = new FileReader();
        reader.onload = function (ev) {
            try {
                var data = JSON.parse(ev.target.result);
                if (data.format !== 'bdflow' || !data.flow) {
                    logConsole(_('sdk_studio.log_import_invalid'), 'error');
                    toast('error', _('sdk_studio.log_import_invalid'));
                    return;
                }
                flow = data.flow;
                flowMeta = {
                    id: null,
                    name: data.name || _('sdk_studio.untitled'),
                    description: data.description || '',
                    status: 'draft'
                };
                selectedNodeId = null;
                selectedWireIdx = null;
                undoStack = [];
                redoStack = [];
                renderAll();
                clearInspector();
                zoomFit();
                logConsole(fmt('sdk_studio.log_imported', { name: flowMeta.name }), 'success');
                toast('success', fmt('sdk_studio.log_imported', { name: flowMeta.name }));
            } catch (err) {
                logConsole(fmt('sdk_studio.log_import_failed', { error: err.message }), 'error');
                toast('error', fmt('sdk_studio.log_import_failed', { error: err.message }));
            }
        };
        reader.readAsText(file);
    }

    // ─── Modals ─────────────────────────────────────────────────────
    // Open flow, Browse templates and Save flow are centred dialogs from
    // modal.js (Escape, focus trap and focus return come from there). Their
    // bodies are the <template id="tpl-…"> blocks in cdap-studio.ejs.

    const MODALS = {
        'open-flow': () => ({ title: _('sdk_studio.open_flow'), size: 'large' }),
        'templates': () => ({ title: _('sdk_studio.browse_templates'), size: 'large' }),
        'save-flow': () => ({
            title: _('sdk_studio.save_flow'),
            buttons: [
                { label: _('common.cancel'), class: 'btn-secondary', onClick: () => hideModal('save-flow') },
                { label: _('sdk_studio.save_flow'), class: 'btn-primary', id: 'btn-save-confirm', onClick: () => doSaveFlow() }
            ]
        })
    };
    // Which of them is open: name -> Modal id
    const openModals = {};

    function showModal(name) {
        const tpl = document.getElementById('tpl-' + name);
        if (!tpl || !MODALS[name]) return;
        // Opening one replaces another (modal.js does the same)
        Object.keys(openModals).forEach((k) => { delete openModals[k]; });
        const id = Modal.show(Object.assign({ content: tpl.innerHTML }, MODALS[name](), {
            onClose: () => { if (openModals[name] === id) delete openModals[name]; }
        }));
        openModals[name] = id;
        if (name === 'save-flow') {
            const form = document.getElementById('save-flow-form');
            if (form) {
                form.addEventListener('submit', (e) => {
                    e.preventDefault();
                    doSaveFlow();
                });
            }
        }
    }

    function isModalOpen(name) {
        const el = openModals[name] && document.getElementById(openModals[name]);
        return !!el && el.getAttribute('aria-hidden') !== 'true';
    }

    function hideModal(name) {
        const id = openModals[name];
        if (!id) return;
        delete openModals[name];
        Modal.close(id);
    }

    function closeAllModals() {
        Object.keys(openModals).forEach(hideModal);
    }

    // ─── Open Flow Modal ────────────────────────────────────────────

    // One saved flow's facts: deploy state, version, who changed it when, its ID
    function flowMetaHtml(f) {
        const deployed = f.status === 'deployed';
        const parts = [
            Utils.statusHtml(deployed ? 'good' : 'neutral', _(deployed ? 'sdk_studio.status_deployed' : 'sdk_studio.status_ready')),
            esc(fmt('sdk_studio.flow_version', { version: Utils.formatNumber(f.version || 1) })),
            Utils.valueHtml(f.id, { copy: true })
        ];
        // "Changed 3h ago by anna"; without a time or a name, only what is known
        const when = f.updated_at || f.created_at;
        if (when && f.created_by) {
            parts.splice(2, 0, fmtHtml('sdk_studio.flow_changed', { time: Utils.timeHtml(when), user: Utils.userHtml(f.created_by) }));
        } else if (when) {
            parts.splice(2, 0, fmtHtml('sdk_studio.flow_changed_at', { time: Utils.timeHtml(when) }));
        } else if (f.created_by) {
            parts.splice(2, 0, Utils.userHtml(f.created_by));
        }
        return parts.join('<span class="studio-meta-sep" aria-hidden="true"> · </span>');
    }

    async function showOpenFlowModal() {
        showModal('open-flow');
        const container = $('#flow-list-container');
        if (!container) return;

        const flows = await listFlows();
        if (flows === null) {
            container.innerHTML = `<p class="state is-error">${_('sdk_studio.list_failed')} <button type="button" class="btn btn-sm" id="btn-retry-flows">${_('sdk_studio.try_again')}</button></p>`;
            const retry = $('#btn-retry-flows');
            if (retry) retry.addEventListener('click', showOpenFlowModal);
            return;
        }
        if (!flows.length) {
            container.innerHTML = `<p class="state">${_('sdk_studio.no_flows')}</p>`;
            return;
        }

        container.innerHTML = `<ul class="list">${flows.map(f => `
            <li class="list-row studio-flow-item" data-id="${esc(f.id)}">
                <span class="row-main studio-flow-item-info">
                    <button type="button" class="btn-link studio-flow-item-name flow-action-open" data-id="${esc(f.id)}">${esc(f.name)}</button>
                    ${f.description ? `<span class="row-sub studio-flow-item-desc">${esc(f.description)}</span>` : ''}
                    <span class="row-sub studio-flow-item-meta">${flowMetaHtml(f)}</span>
                </span>
                <span class="row-end studio-flow-item-actions">
                    <button type="button" class="btn btn-sm flow-action-export" data-id="${esc(f.id)}">${Utils.icon('export')}${_('sdk_studio.export_flow')}</button>
                    <button type="button" class="btn btn-sm btn-danger-quiet flow-action-delete" data-id="${esc(f.id)}" data-name="${esc(f.name)}">${_('sdk_studio.delete_flow')}</button>
                </span>
            </li>
        `).join('')}</ul>`;

        // Open
        for (const btn of container.querySelectorAll('.flow-action-open')) {
            btn.addEventListener('click', () => {
                closeAllModals();
                loadFlow(btn.dataset.id);
            });
        }

        // Delete
        for (const btn of container.querySelectorAll('.flow-action-delete')) {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const name = btn.dataset.name || '';
                let ok;
                if (window.Modal && typeof window.Modal.confirm === 'function') {
                    // Modal.confirm replaces the open dialog; reopen the list afterwards
                    hideModal('open-flow');
                    ok = await window.Modal.confirm({
                        title: _('sdk_studio.delete_title'),
                        message: fmt('sdk_studio.confirm_delete', { name }),
                        confirmLabel: _('sdk_studio.delete_flow'),
                        danger: true
                    });
                } else {
                    ok = window.confirm(fmt('sdk_studio.confirm_delete', { name }));
                }
                if (!ok) {
                    showOpenFlowModal();
                    return;
                }
                try {
                    const resp = await fetch(`/api/cdap-studio/flows/${encodeURIComponent(btn.dataset.id)}`, {
                        method: 'DELETE',
                        headers: { ...getCsrf() }
                    });
                    const data = await resp.json().catch(() => ({}));
                    if (!resp.ok || data.success === false) throw new Error(data.error || resp.statusText);
                    if (flowMeta.id && String(flowMeta.id) === String(btn.dataset.id)) {
                        flowMeta.id = null;
                    }
                    toast('success', fmt('sdk_studio.log_flow_deleted', { name }));
                    logConsole(fmt('sdk_studio.log_flow_deleted', { name }), 'warn');
                } catch (err) {
                    toast('error', fmt('sdk_studio.log_delete_failed', { error: err.message }));
                    logConsole(fmt('sdk_studio.log_delete_failed', { error: err.message }), 'error');
                }
                showOpenFlowModal(); // Refresh
            });
        }

        // Export
        for (const btn of container.querySelectorAll('.flow-action-export')) {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.open(`/api/cdap-studio/flows/${encodeURIComponent(btn.dataset.id)}/export`);
            });
        }
    }

    // ─── Templates Modal ────────────────────────────────────────────

    async function showTemplatesModal() {
        showModal('templates');
        const container = $('#template-grid-container');
        if (!container) return;

        try {
            const resp = await fetch('/api/cdap-studio/templates', { headers: { ...getCsrf() } });
            const data = await resp.json();
            if (!resp.ok) throw new Error(data.error || resp.statusText);
            const templates = data.templates || [];

            if (!templates.length) {
                container.innerHTML = `<p class="state">${_('sdk_studio.no_templates')}</p>`;
                return;
            }

            container.innerHTML = `<ul class="list">${templates.map(t => `
                <li><button type="button" class="list-row is-link studio-template-card" data-id="${esc(t.id)}">
                    <span class="row-main">
                        <span class="row-title">${esc(t.name)}</span>
                        <span class="row-sub">${esc(t.description || '')}</span>
                    </span>
                    <span class="material-icons row-chevron" aria-hidden="true">chevron_right</span>
                </button></li>
            `).join('')}</ul>`;

            for (const card of container.querySelectorAll('.studio-template-card')) {
                card.addEventListener('click', () => {
                    const tpl = templates.find(t => t.id === card.dataset.id);
                    if (!tpl || !tpl.flow) return;

                    closeAllModals();
                    pushUndo();

                    flow = JSON.parse(JSON.stringify(tpl.flow));
                    if (!flow.nodes) flow.nodes = [];
                    if (!flow.wires) flow.wires = [];

                    flowMeta.id = null;
                    flowMeta.name = tpl.name;
                    flowMeta.description = tpl.description;

                    // Recalculate node ID counter
                    let maxId = 0;
                    for (const n of flow.nodes) {
                        const num = parseInt((n.id || '').replace('n', ''), 10);
                        if (num > maxId) maxId = num;
                    }
                    nodeIdCounter = maxId;

                    renderAll();
                    clearInspector();
                    zoomFit();
                    logConsole(fmt('sdk_studio.log_template_opened', { name: tpl.name }), 'success');
                });
            }
        } catch (err) {
            container.innerHTML = `<p class="state is-error">${_('sdk_studio.templates_failed')} <button type="button" class="btn btn-sm" id="btn-retry-templates">${_('sdk_studio.try_again')}</button></p>`;
            const retry = $('#btn-retry-templates');
            if (retry) retry.addEventListener('click', showTemplatesModal);
        }
    }

    // ─── New Flow ───────────────────────────────────────────────────

    function newFlow() {
        pushUndo();
        flow = { nodes: [], wires: [] };
        flowMeta = { id: null, name: _('sdk_studio.untitled'), description: '' };
        selectedNodeId = null;
        selectedWireIdx = null;
        nodeIdCounter = 0;
        undoStack = [];
        redoStack = [];
        panX = 0;
        panY = 0;
        zoomLevel = 1;
        applyTransform();
        setDeployState('neutral', _('sdk_studio.status_ready'));
        renderAll();
        clearInspector();
        logConsole(_('sdk_studio.log_new_flow'), 'info');
    }

    // ─── Toolbar Buttons ────────────────────────────────────────────

    function initToolbar() {
        const bind = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };

        bind('btn-new-flow', newFlow);
        bind('btn-open-flow', showOpenFlowModal);
        bind('btn-save-flow', saveFlow);
        bind('btn-import-flow', importFlow);
        bind('btn-export-flow', exportFlow);
        bind('btn-run-flow', testFlow);
        bind('btn-debug-flow', testFlow); // Debug = test for now
        bind('btn-deploy-flow', deployFlow);
        bind('btn-undo', doUndo);
        bind('btn-redo', doRedo);
        bind('btn-zoom-in', () => zoomTo(zoomLevel * 1.2));
        bind('btn-zoom-out', () => zoomTo(zoomLevel * 0.8));
        bind('btn-zoom-fit', zoomFit);
        bind('btn-clear-console', () => {
            consoleBody.innerHTML = '';
            const last = document.getElementById('studio-console-last');
            if (last) last.textContent = '';
        });
        bind('btn-rename-flow', () => openSaveDialog(null));
        bind('btn-toggle-console', () => {
            const btn = document.getElementById('btn-toggle-console');
            setConsoleOpen(btn.getAttribute('aria-expanded') !== 'true', true);
        });
        for (const id of ['btn-toggle-palette', 'btn-toggle-inspector']) {
            const btn = document.getElementById(id);
            if (!btn) continue;
            btn.addEventListener('click', () => setPanelOpen(btn, btn.getAttribute('aria-expanded') !== 'true', true));
            if (store('bd.studio.' + id) === '0') setPanelOpen(btn, false, false);
        }
        setConsoleOpen(store('bd.studio.log') === '1', false);
        bind('btn-empty-template', showTemplatesModal);
        bind('btn-empty-template-menu', showTemplatesModal);

        // Grid: shows the dots and snaps dragged nodes to them
        const gridToggle = document.getElementById('btn-toggle-grid');
        if (gridToggle) {
            gridToggle.addEventListener('change', () => {
                showGrid = !!gridToggle.checked;
                svgEl.classList.toggle('no-grid', !showGrid);
            });
        }

        // Show the flow as JSON in the console
        bind('btn-toggle-code', () => {
            setConsoleOpen(true, false);
            const json = JSON.stringify(flow, null, 2);
            logConsole(_('sdk_studio.log_json_heading'), 'info');
            // Output lines (max 20)
            const lines = json.split('\n');
            for (let i = 0; i < Math.min(lines.length, 20); i++) {
                logConsole(lines[i], 'data');
            }
            if (lines.length > 20) logConsole(fmt('sdk_studio.log_json_more', { count: lines.length - 20 }), 'info');
        });
    }

    // ─── Initialize ─────────────────────────────────────────────────

    function init() {
        buildPalette();
        initCanvasDrop();
        initCanvasInteraction();
        initToolbar();
        renderAll();
        applyTransform();

        // Import file input handler
        var importInput = document.getElementById('import-flow-input');
        if (importInput) importInput.addEventListener('change', handleImportFile);

        updateUndoButtons();
        clearInspector();
        logConsole(_('sdk_studio.console_ready'), 'info');
        checkStore();
    }

    async function checkStore() {
        const notice = document.getElementById('studio-store-notice');
        if (!notice) return;
        try {
            const resp = await fetch('/api/cdap-studio/flows', { headers: { ...getCsrf() } });
            await resp.text();
            notice.hidden = resp.ok;
        } catch (_) {
            notice.hidden = false;
        }
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Export for external access
    window.CdapStudio = {
        init,
        newFlow,
        saveFlow,
        loadFlow,
        testFlow,
        deployFlow,
        exportFlow,
        importFlow,
        getFlow: () => flow,
        getFlowMeta: () => flowMeta
    };

})();
