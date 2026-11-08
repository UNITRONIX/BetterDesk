/* fleet-builder.js — Visual workflow builder (SVG node editor) */
'use strict';
(function () {
    const _ = (key, params) => (typeof window._ === 'function' ? window._(key, params || {}) : key);
    // A translation, or the fallback while the key is missing
    const tr = (key, fallback, params) => { const v = _(key, params); return v === key ? fallback : v; };

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const NODE_W = 180;
    const NODE_H = 56;
    const PORT_R = 6;

    let _svg = null;
    let _group = null; // top-level <g> for zoom/pan
    let _zoom = 1;
    let _panX = 0, _panY = 0;

    let _nodes = [];       // { id, type, category, label, x, y, config: {} }
    let _connections = [];  // { id, from, to }
    let _nextId = 1;
    let _selected = null;
    let _dragging = null;
    let _connecting = null; // { fromId, startX, startY, line }
    let _panning = false;
    let _panStart = null;

    let _workflowId = null;
    let _workflowName = tr('fleet.untitled', 'Untitled');

    // Categories; their colours come from the page CSS (.node-header.<cat>, .node-dot-svg.<cat>)
    const CATS = { trigger: {}, condition: {}, action: {}, result: {}, transform: {} };

    // Node type → category + default label (the palette uses the same keys)
    const NODE_DEFS = {
        trigger_manual:    { cat: 'trigger',   key: 'fleet.node_manual',       label: 'Manual trigger' },
        trigger_schedule:  { cat: 'trigger',   key: 'fleet.node_schedule',     label: 'Schedule' },
        trigger_event:     { cat: 'trigger',   key: 'fleet.node_event',        label: 'Event trigger' },
        cond_os:           { cat: 'condition', key: 'fleet.node_os_check',     label: 'OS check' },
        cond_threshold:    { cat: 'condition', key: 'fleet.node_threshold',    label: 'Threshold' },
        cond_time_window:  { cat: 'condition', key: 'fleet.node_time_window',  label: 'Time window' },
        action_script:     { cat: 'action',    key: 'fleet.node_run_script',   label: 'Run script' },
        action_install:    { cat: 'action',    key: 'fleet.node_install',      label: 'Install software' },
        action_restart:    { cat: 'action',    key: 'fleet.node_restart',      label: 'Restart service' },
        action_file_deploy:{ cat: 'action',    key: 'fleet.node_file_deploy',  label: 'Deploy file' },
        action_message:    { cat: 'action',    key: 'fleet.node_send_message', label: 'Send message' },
        result_log:        { cat: 'result',    key: 'fleet.node_log_output',   label: 'Log output' },
        result_alert:      { cat: 'result',    key: 'fleet.node_send_alert',   label: 'Send alert' },
        result_chain:      { cat: 'result',    key: 'fleet.node_chain',        label: 'Start another workflow' },
        transform_parse:   { cat: 'transform', key: 'fleet.node_parse_json',   label: 'Parse JSON' },
        transform_filter:  { cat: 'transform', key: 'fleet.node_filter',       label: 'Filter' },
        transform_delay:   { cat: 'transform', key: 'fleet.node_delay',        label: 'Delay' }
    };

    // -----------------------------------------------------------------------
    // Init
    // -----------------------------------------------------------------------
    function init() {
        _svg = document.getElementById('builder-canvas');
        if (!_svg) return;

        // Marker for arrowheads
        const defs = svgEl('defs');
        const marker = svgEl('marker', { id: 'arrowhead', markerWidth: '8', markerHeight: '6', refX: '8', refY: '3', orient: 'auto' });
        const poly = svgEl('polygon', { points: '0 0, 8 3, 0 6', class: 'connection-arrow' });
        marker.appendChild(poly);
        defs.appendChild(marker);
        _svg.appendChild(defs);

        _group = svgEl('g');
        _svg.appendChild(_group);

        // Events
        _svg.addEventListener('mousedown', onCanvasMouseDown);
        _svg.addEventListener('mousemove', onCanvasMouseMove);
        _svg.addEventListener('mouseup', onCanvasMouseUp);
        _svg.addEventListener('wheel', onWheel, { passive: false });

        // Palette drag & drop
        document.querySelectorAll('.palette-node[draggable]').forEach(el => {
            el.addEventListener('dragstart', onPaletteDragStart);
        });
        _svg.parentElement.addEventListener('dragover', e => e.preventDefault());
        _svg.parentElement.addEventListener('drop', onPaletteDrop);

        // Keyboard
        document.addEventListener('keydown', onKeyDown);

        // Load workflow list
        if (window.Fleet) Fleet.loadWorkflowList();
    }

    // -----------------------------------------------------------------------
    // SVG helpers
    // -----------------------------------------------------------------------
    function svgEl(tag, attrs) {
        const el = document.createElementNS(SVG_NS, tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
        return el;
    }

    function updateTransform() {
        _group.setAttribute('transform', `translate(${_panX},${_panY}) scale(${_zoom})`);
        const zoomEl = document.getElementById('builder-zoom-level');
        if (zoomEl) zoomEl.textContent = Math.round(_zoom * 100) + '%';
    }

    function svgPoint(e) {
        const rect = _svg.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - _panX) / _zoom,
            y: (e.clientY - rect.top - _panY) / _zoom
        };
    }

    // -----------------------------------------------------------------------
    // Node creation
    // -----------------------------------------------------------------------
    function addNode(type, x, y) {
        const def = NODE_DEFS[type];
        if (!def) return null;
        const id = 'n' + (_nextId++);
        const node = { id, type, category: def.cat, label: tr(def.key, def.label), x, y, config: {} };
        _nodes.push(node);
        renderNode(node);
        return node;
    }

    // Palette click or Enter: put the step in the middle of the visible canvas
    function addFromPalette(type) {
        if (!_svg || !NODE_DEFS[type]) return;
        const rect = _svg.getBoundingClientRect();
        const cx = (rect.width / 2 - _panX) / _zoom;
        const cy = (rect.height / 2 - _panY) / _zoom;
        const offset = (_nodes.length % 5) * 24;
        const node = addNode(type, cx - NODE_W / 2 + offset, cy - NODE_H / 2 + offset);
        if (node) selectNode(node.id);
    }

    function renderNode(node) {
        const cat = CATS[node.category] ? node.category : 'action';
        const g = svgEl('g', { class: 'node-group', 'data-id': node.id, transform: `translate(${node.x},${node.y})` });

        // Body
        const body = svgEl('rect', { class: 'node-body', x: '0', y: '0', width: NODE_W, height: NODE_H });
        g.appendChild(body);

        // Header band
        const header = svgEl('rect', { class: 'node-header ' + node.category, x: '0', y: '0', width: NODE_W, height: '22' });
        g.appendChild(header);

        // Category dot
        const dot = svgEl('circle', { cx: '12', cy: '11', r: '4', class: 'node-dot-svg ' + cat });
        g.appendChild(dot);

        // Title
        const title = svgEl('text', { class: 'node-title', x: '22', y: '11' });
        title.textContent = node.label.length > 20 ? node.label.slice(0, 18) + '…' : node.label;
        g.appendChild(title);

        // Input port (left center)
        if (node.category !== 'trigger') {
            const inPort = svgEl('circle', {
                class: 'node-port port-in', cx: '0', cy: String(NODE_H / 2), r: PORT_R,
                'data-node': node.id, 'data-dir': 'in'
            });
            g.appendChild(inPort);
        }

        // Output port (right center)
        const outPort = svgEl('circle', {
            class: 'node-port port-out', cx: String(NODE_W), cy: String(NODE_H / 2), r: PORT_R,
            'data-node': node.id, 'data-dir': 'out'
        });
        g.appendChild(outPort);

        // Drag events on the group
        g.addEventListener('mousedown', onNodeMouseDown);

        _group.appendChild(g);
    }

    function removeNode(id) {
        _nodes = _nodes.filter(n => n.id !== id);
        _connections = _connections.filter(c => c.from !== id && c.to !== id);
        const el = _group.querySelector(`[data-id="${id}"]`);
        if (el) el.remove();
        redrawConnections();
        if (_selected === id) { _selected = null; hideProps(); }
    }

    // -----------------------------------------------------------------------
    // Connections
    // -----------------------------------------------------------------------
    function addConnection(fromId, toId) {
        if (fromId === toId) return;
        if (_connections.find(c => c.from === fromId && c.to === toId)) return;
        const id = 'c' + (_nextId++);
        _connections.push({ id, from: fromId, to: toId });
        redrawConnections();
    }

    function redrawConnections() {
        _group.querySelectorAll('.connection-line').forEach(el => el.remove());
        _connections.forEach(c => {
            const fromNode = _nodes.find(n => n.id === c.from);
            const toNode = _nodes.find(n => n.id === c.to);
            if (!fromNode || !toNode) return;
            const x1 = fromNode.x + NODE_W;
            const y1 = fromNode.y + NODE_H / 2;
            const x2 = toNode.x;
            const y2 = toNode.y + NODE_H / 2;
            const cpx = Math.abs(x2 - x1) * 0.4;
            const d = `M${x1},${y1} C${x1 + cpx},${y1} ${x2 - cpx},${y2} ${x2},${y2}`;
            const path = svgEl('path', { class: 'connection-line', d, 'data-conn': c.id });
            path.addEventListener('dblclick', () => {
                _connections = _connections.filter(cc => cc.id !== c.id);
                path.remove();
            });
            // Insert connections below nodes
            _group.insertBefore(path, _group.firstChild);
        });
    }

    // -----------------------------------------------------------------------
    // Palette drag & drop
    // -----------------------------------------------------------------------
    function onPaletteDragStart(e) {
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.type);
    }

    function onPaletteDrop(e) {
        e.preventDefault();
        const type = e.dataTransfer.getData('text/plain');
        if (!type || !NODE_DEFS[type]) return;
        const pt = svgPoint(e);
        addNode(type, pt.x - NODE_W / 2, pt.y - NODE_H / 2);
    }

    // -----------------------------------------------------------------------
    // Mouse events
    // -----------------------------------------------------------------------
    function onNodeMouseDown(e) {
        const g = e.currentTarget;
        const nodeId = g.dataset.id;
        const target = e.target;

        // Port click → start connection
        if (target.classList.contains('node-port')) {
            e.stopPropagation();
            if (target.dataset.dir === 'out') {
                const node = _nodes.find(n => n.id === nodeId);
                if (!node) return;
                const sx = node.x + NODE_W;
                const sy = node.y + NODE_H / 2;
                const line = svgEl('path', { class: 'connection-line', d: `M${sx},${sy} L${sx},${sy}` });
                _group.appendChild(line);
                _connecting = { fromId: nodeId, sx, sy, line };
            }
            return;
        }

        e.stopPropagation();
        selectNode(nodeId);

        // Start drag
        const pt = svgPoint(e);
        const node = _nodes.find(n => n.id === nodeId);
        if (!node) return;
        _dragging = { id: nodeId, offX: pt.x - node.x, offY: pt.y - node.y };
    }

    function onCanvasMouseDown(e) {
        if (e.target === _svg || e.target === _group) {
            selectNode(null);
            // Start pan
            _panning = true;
            _panStart = { x: e.clientX - _panX, y: e.clientY - _panY };
        }
    }

    function onCanvasMouseMove(e) {
        if (_dragging) {
            const pt = svgPoint(e);
            const node = _nodes.find(n => n.id === _dragging.id);
            if (!node) return;
            node.x = pt.x - _dragging.offX;
            node.y = pt.y - _dragging.offY;
            const g = _group.querySelector(`[data-id="${_dragging.id}"]`);
            if (g) g.setAttribute('transform', `translate(${node.x},${node.y})`);
            redrawConnections();
        }
        if (_connecting) {
            const pt = svgPoint(e);
            const cpx = Math.abs(pt.x - _connecting.sx) * 0.4;
            _connecting.line.setAttribute('d',
                `M${_connecting.sx},${_connecting.sy} C${_connecting.sx + cpx},${_connecting.sy} ${pt.x - cpx},${pt.y} ${pt.x},${pt.y}`
            );
        }
        if (_panning && _panStart) {
            _panX = e.clientX - _panStart.x;
            _panY = e.clientY - _panStart.y;
            updateTransform();
        }
    }

    function onCanvasMouseUp(e) {
        if (_connecting) {
            _connecting.line.remove();
            // Check if dropped on an input port
            const target = e.target;
            if (target.classList.contains('node-port') && target.dataset.dir === 'in') {
                addConnection(_connecting.fromId, target.dataset.node);
            }
            _connecting = null;
        }
        _dragging = null;
        _panning = false;
        _panStart = null;
    }

    function onWheel(e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        _zoom = Math.max(0.3, Math.min(3, _zoom + delta));
        updateTransform();
    }

    function onKeyDown(e) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (_selected && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
                removeNode(_selected);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Selection & properties
    // -----------------------------------------------------------------------
    function selectNode(id) {
        _group.querySelectorAll('.node-selected').forEach(g => g.classList.remove('node-selected'));
        _selected = id;
        if (id) {
            const g = _group.querySelector(`[data-id="${id}"]`);
            if (g) g.classList.add('node-selected');
            showProps(id);
        } else {
            hideProps();
        }
    }

    function showProps(id) {
        const node = _nodes.find(n => n.id === id);
        if (!node) return;
        const panel = document.getElementById('builder-props');
        const body = document.getElementById('props-body');
        const title = document.getElementById('props-title');
        if (!panel || !body) return;
        panel.style.display = 'block';
        title.textContent = node.label;
        body.innerHTML = buildPropsForm(node);
    }

    function hideProps() {
        const panel = document.getElementById('builder-props');
        if (panel) panel.style.display = 'none';
    }

    function closeProps() { hideProps(); selectNode(null); }

    // Property labels: translation key and the English fallback
    const PROP = (key, fallback) => tr('fleet.prop_' + key, fallback);

    function buildPropsForm(node) {
        const fid = (key) => `prop-${esc(node.id)}-${esc(key)}`;
        let html = `
            <div class="form-group">
                <label class="form-label" for="${fid('label')}">${esc(PROP('label', 'Label'))}</label>
                <input id="${fid('label')}" class="form-input" value="${esc(node.label)}" data-bd-call="FleetBuilder.updateNodeProp" data-bd-args='["${node.id}","label"]' data-bd-on="change" data-bd-value="1">
            </div>`;

        // Type-specific fields
        if (node.type === 'trigger_schedule') {
            html += field(node, 'cron', PROP('cron', 'Cron expression'), '*/5 * * * *', true);
        }
        if (node.type === 'trigger_event') {
            html += selectField(node, 'event', PROP('event', 'Event'), ['disk_full', 'cpu_high', 'user_login', 'service_down']);
            html += field(node, 'threshold', PROP('threshold', 'Threshold in percent'), '90');
        }
        if (node.type === 'cond_os') {
            html += selectField(node, 'os', PROP('os', 'Operating system'), ['windows', 'linux', 'macos', 'any']);
        }
        if (node.type === 'cond_threshold') {
            html += selectField(node, 'metric', PROP('metric', 'Measure'), ['cpu', 'ram', 'disk', 'network']);
            html += selectField(node, 'operator', PROP('operator', 'Comparison'), ['>', '<', '>=', '<=', '==']);
            html += field(node, 'value', PROP('value', 'Value'), '80');
        }
        if (node.type === 'cond_time_window') {
            html += field(node, 'start_time', PROP('start_time', 'From'), '08:00');
            html += field(node, 'end_time', PROP('end_time', 'Until'), '18:00');
            html += field(node, 'days', PROP('days', 'Days (0 is Sunday, 6 is Saturday)'), '1,2,3,4,5');
        }
        if (node.type === 'action_script') {
            html += `<div class="form-group"><label class="form-label" for="${fid('script')}">${esc(PROP('script', 'Script'))}</label>
                <textarea id="${fid('script')}" class="form-input mono" rows="5" spellcheck="false" data-bd-call="FleetBuilder.updateNodeProp" data-bd-args='["${node.id}","script"]' data-bd-on="change" data-bd-value="1">${esc(node.config.script || '')}</textarea></div>`;
            html += selectField(node, 'shell', PROP('shell', 'Shell'), ['bash', 'powershell', 'cmd', 'python']);
        }
        if (node.type === 'action_install') {
            html += field(node, 'package', PROP('package', 'Package or download address'), '', true);
            html += selectField(node, 'method', PROP('method', 'Installer'), ['msi', 'deb', 'rpm', 'apt', 'chocolatey', 'winget']);
        }
        if (node.type === 'action_restart') {
            html += field(node, 'service', PROP('service', 'Service name'), '', true);
        }
        if (node.type === 'action_file_deploy') {
            html += field(node, 'source', PROP('source', 'Source path or address'), '', true);
            html += field(node, 'destination', PROP('destination', 'Destination path'), '', true);
        }
        if (node.type === 'action_message') {
            html += field(node, 'message', PROP('message', 'Message'), '');
        }
        if (node.type === 'result_alert') {
            html += selectField(node, 'channel', PROP('channel', 'Send to'), ['console', 'email', 'webhook']);
            html += field(node, 'recipient', PROP('recipient', 'Recipient'), '');
        }
        if (node.type === 'result_chain') {
            html += field(node, 'workflow_id', PROP('workflow_id', 'Workflow ID'), '', true);
        }
        if (node.type === 'transform_delay') {
            html += field(node, 'seconds', PROP('seconds', 'Wait in seconds'), '10');
        }
        if (node.type === 'transform_filter') {
            html += field(node, 'expression', PROP('expression', 'Filter expression'), '', true);
        }

        html += `<div class="form-group props-delete">
            <button type="button" class="btn btn-sm btn-danger-quiet" data-bd-call="FleetBuilder.removeSelected">${esc(PROP('delete', 'Remove step'))}</button>
            </div>`;
        return html;
    }

    function field(node, key, label, placeholder, mono) {
        const id = `prop-${esc(node.id)}-${esc(key)}`;
        return `<div class="form-group"><label class="form-label" for="${id}">${esc(label)}</label>
            <input id="${id}" class="form-input${mono ? ' mono' : ''}" placeholder="${esc(placeholder)}" value="${esc(node.config[key] || '')}"
                data-bd-call="FleetBuilder.updateNodeProp" data-bd-args='["${node.id}","${key}"]' data-bd-on="change" data-bd-value="1">
        </div>`;
    }

    function selectField(node, key, label, opts) {
        const val = node.config[key] || '';
        const id = `prop-${esc(node.id)}-${esc(key)}`;
        return `<div class="form-group"><label class="form-label" for="${id}">${esc(label)}</label>
            <select id="${id}" class="form-select" data-bd-call="FleetBuilder.updateNodeProp" data-bd-args='["${node.id}","${key}"]' data-bd-on="change" data-bd-value="1">
                ${opts.map(o => `<option value="${esc(o)}" ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}
            </select></div>`;
    }

    function updateNodeProp(nodeId, key, value) {
        const node = _nodes.find(n => n.id === nodeId);
        if (!node) return;
        if (key === 'label') {
            node.label = value;
            const g = _group.querySelector(`[data-id="${nodeId}"]`);
            const txt = g?.querySelector('.node-title');
            if (txt) txt.textContent = value.length > 20 ? value.slice(0, 18) + '…' : value;
        } else {
            node.config[key] = value;
        }
    }

    // -----------------------------------------------------------------------
    // Workflow operations
    // -----------------------------------------------------------------------
    function status(text, cls) {
        if (window.Fleet && Fleet.workflowStatus) Fleet.workflowStatus(text, cls);
    }

    async function request(url, method, body) {
        const headers = { 'x-csrf-token': window.BetterDesk?.csrfToken || '' };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const resp = await fetch(url, { method, credentials: 'same-origin', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        let data = null;
        try { data = await resp.json(); } catch { data = null; }
        if (!resp.ok || (data && data.success === false)) {
            throw new Error((data && (data.error || data.message)) || resp.statusText || String(resp.status));
        }
        return data || {};
    }

    function newWorkflow() {
        _nodes = []; _connections = []; _nextId = 1; _selected = null; _workflowId = null;
        _workflowName = tr('fleet.untitled', 'Untitled');
        _group.innerHTML = '';
        hideProps();
        const sel = document.getElementById('workflow-select');
        if (sel) sel.value = '';
        // Add default trigger
        addNode('trigger_manual', 40, 200);
        status(tr('fleet.workflow_new_status', 'New workflow with a manual trigger. Add steps from the list.'));
    }

    async function saveWorkflow() {
        const name = await Modal.prompt({
            title: tr('fleet.save_workflow_title', 'Save workflow'),
            label: tr('fleet.workflow_name', 'Workflow name'),
            value: _workflowName,
            confirmLabel: tr('fleet.save', 'Save')
        });
        if (name === null) return;
        if (!name.trim()) { status(tr('fleet.name_required', 'Enter a name.'), 'is-error'); return; }
        _workflowName = name.trim();
        const payload = {
            name: _workflowName, nodes: _nodes, connections: _connections
        };
        status(tr('fleet.saving', 'Saving…'));
        try {
            const url = _workflowId
                ? `/api/panel/fleet/workflows/${encodeURIComponent(_workflowId)}`
                : '/api/panel/fleet/workflows';
            const data = await request(url, _workflowId ? 'PUT' : 'POST', payload);
            if (data.id) _workflowId = data.id;
            status(tr('fleet.workflow_saved', 'Workflow saved.', { name: _workflowName }), 'is-ok');
            if (window.Fleet) await Fleet.loadWorkflowList();
            const sel = document.getElementById('workflow-select');
            if (sel && _workflowId) sel.value = _workflowId;
        } catch (e) {
            status(tr('fleet.save_failed', 'Could not save.', { error: e.message }), 'is-error');
        }
    }

    function exportWorkflow() {
        const payload = JSON.stringify({ name: _workflowName, nodes: _nodes, connections: _connections }, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (_workflowName || 'workflow') + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    async function loadWorkflow(id) {
        const sel = document.getElementById('workflow-select');
        const wid = id || sel?.value;
        if (!wid) return;
        status(tr('fleet.loading_workflow', 'Loading workflow…'));
        try {
            const data = await request(`/api/panel/fleet/workflows/${encodeURIComponent(wid)}`, 'GET');
            const wf = data.data || data;
            _workflowId = wf.id || wid;
            _workflowName = wf.name || tr('fleet.untitled', 'Untitled');
            _nodes = wf.nodes || [];
            _connections = wf.connections || [];
            _nextId = Math.max(0, ..._nodes.map(n => parseInt(n.id?.replace('n', '') || '0')), ..._connections.map(c => parseInt(c.id?.replace('c', '') || '0'))) + 1;
            _group.innerHTML = '';
            _selected = null;
            hideProps();
            _nodes.forEach(n => renderNode(n));
            redrawConnections();
            status('');
        } catch (e) {
            status(tr('fleet.workflow_load_failed', 'Could not load the workflow.', { error: e.message }), 'is-error');
        }
    }

    async function execute(dryRun) {
        if (!_workflowId && !_nodes.length) {
            status(tr('fleet.workflow_empty', 'Add steps or open a saved workflow first.'), 'is-error');
            return;
        }
        if (!dryRun) {
            const ok = await Modal.confirm({
                title: tr('fleet.run_title', 'Run workflow'),
                message: tr('fleet.run_message', 'The actions in this workflow run on the devices it targets now.', { name: _workflowName }),
                confirmLabel: tr('fleet.execute', 'Run')
            });
            if (!ok) return;
        }
        status(dryRun ? tr('fleet.dry_running', 'Trying the workflow…') : tr('fleet.running', 'Starting the workflow…'));
        try {
            const id = _workflowId || 'draft';
            const data = await request(`/api/panel/fleet/workflows/${encodeURIComponent(id)}/execute`, 'POST', {
                dry_run: !!dryRun,
                nodes: _nodes,
                connections: _connections
            });
            status(dryRun ? tr('fleet.dry_run_done', 'Dry run finished. Nothing was changed on the devices.') : tr('fleet.run_started', 'Workflow started.'), 'is-ok');
            if (data.output || data.log) {
                const pre = document.createElement('pre');
                pre.className = 'code-block';
                pre.textContent = data.output || data.log;
                Modal.show({
                    title: dryRun ? tr('fleet.dry_run_result', 'Dry run result') : tr('fleet.run_result', 'Workflow output'),
                    content: pre.outerHTML,
                    size: 'large',
                    buttons: [{ label: tr('fleet.close', 'Close'), class: 'btn-primary', onClick: () => Modal.close() }]
                });
            }
        } catch (e) {
            status(tr('fleet.run_failed', 'Could not run the workflow.', { error: e.message }), 'is-error');
        }
    }

    // -----------------------------------------------------------------------
    // Zoom
    // -----------------------------------------------------------------------
    function zoomIn() { _zoom = Math.min(3, _zoom + 0.15); updateTransform(); }
    function zoomOut() { _zoom = Math.max(0.3, _zoom - 0.15); updateTransform(); }
    function zoomReset() { _zoom = 1; _panX = 0; _panY = 0; updateTransform(); }

    // Helpers
    function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = String(s); return d.innerHTML; }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    window.FleetBuilder = {
        init, newWorkflow, saveWorkflow, exportWorkflow, loadWorkflow, execute, addFromPalette,
        zoomIn, zoomOut, zoomReset, closeProps,
        updateNodeProp, removeSelected() { if (_selected) removeNode(_selected); }
    };

    document.addEventListener('DOMContentLoaded', init);
})();
