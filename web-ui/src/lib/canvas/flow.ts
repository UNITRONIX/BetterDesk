/**
 * The flow builder's model (old public/js/cdap-studio.js), without a DOM:
 * the node types and their default settings, ports and where wires attach,
 * the connection rules, the settings fields, and the .bdflow file format.
 * The page keeps a Flow in $state and changes it with these functions.
 *
 * A flow is { nodes, wires } and is stored as JSON (flow_json on the
 * server, `flow` in a .bdflow file); the shapes stay as they were.
 */

export type NodeCategory = 'sources' | 'processing' | 'outputs';

export const CATEGORIES: readonly NodeCategory[] = ['sources', 'processing', 'outputs'];

export type ConfigDefault = string | number | boolean | Record<string, unknown>[];

export interface NodeDef {
	cat: NodeCategory;
	icon: string;
	/** English name, used when the language file has none */
	label: string;
	/** English tooltip in the node list */
	desc: string;
	ports: { in: number; out: number; pass?: number };
	config: Record<string, ConfigDefault>;
}

export interface FlowNode {
	id: string;
	type: string;
	x: number;
	y: number;
	label: string;
	config: Record<string, unknown>;
}

export interface FlowWire {
	from: string;
	fromPort: string;
	to: string;
	toPort: string;
}

export interface Flow {
	nodes: FlowNode[];
	wires: FlowWire[];
}

// prettier-ignore
export const NODE_DEFS: Readonly<Record<string, NodeDef>> = {
	// Sources
	'modbus-tcp': { cat: 'sources', icon: 'electrical_services', label: 'Modbus TCP', desc: 'Read Modbus registers via TCP', ports: { in: 0, out: 1 }, config: { host: '192.168.1.100', port: 502, unitId: 1, register: 100, dataType: 'float32', interval: 5000 } },
	'modbus-rtu': { cat: 'sources', icon: 'usb', label: 'Modbus RTU', desc: 'Read serial Modbus', ports: { in: 0, out: 1 }, config: { serialPort: '/dev/ttyUSB0', baud: 9600, parity: 'none', slaveId: 1, register: 0, dataType: 'int16', interval: 5000 } },
	'snmp-poll': { cat: 'sources', icon: 'router', label: 'SNMP Poll', desc: 'Poll SNMP OIDs', ports: { in: 0, out: 1 }, config: { host: '192.168.1.1', community: 'public', version: '2c', oids: '1.3.6.1.2.1.1.3.0', interval: 10000 } },
	'rest-poll': { cat: 'sources', icon: 'api', label: 'REST Poll', desc: 'Poll HTTP/REST endpoint', ports: { in: 0, out: 1 }, config: { url: 'https://api.example.com/data', method: 'GET', headers: '', interval: 30000, jmesPath: '' } },
	'mqtt-subscribe': { cat: 'sources', icon: 'cell_tower', label: 'MQTT Subscribe', desc: 'Listen to MQTT topic', ports: { in: 0, out: 1 }, config: { broker: 'mqtt://broker:1883', topic: 'sensors/#', qos: 0, tls: false } },
	'webhook-listen': { cat: 'sources', icon: 'webhook', label: 'Webhook', desc: 'Receive HTTP webhooks', ports: { in: 0, out: 1 }, config: { path: '/webhook/data', method: 'POST', authToken: '' } },
	'device-telemetry': { cat: 'sources', icon: 'developer_board', label: 'Device Telemetry', desc: 'BetterDesk agent metrics', ports: { in: 0, out: 1 }, config: { deviceId: '', metrics: 'cpu,memory,disk' } },
	'database-query': { cat: 'sources', icon: 'storage', label: 'Database Query', desc: 'Poll SQL database', ports: { in: 0, out: 1 }, config: { dsn: '', query: 'SELECT 1', interval: 60000 } },
	'file-watch': { cat: 'sources', icon: 'folder_open', label: 'File Watch', desc: 'Watch file changes', ports: { in: 0, out: 1 }, config: { path: '/var/log/', pattern: '*.log', events: 'modify' } },

	// Processing
	filter: { cat: 'processing', icon: 'filter_alt', label: 'Filter', desc: 'Pass/block based on condition', ports: { in: 1, out: 1, pass: 1 }, config: { field: 'value', operator: '>', threshold: 0 } },
	transform: { cat: 'processing', icon: 'swap_horiz', label: 'Transform', desc: 'Map/rename/calculate fields', ports: { in: 1, out: 1 }, config: { expression: 'value * 1' } },
	aggregate: { cat: 'processing', icon: 'functions', label: 'Aggregate', desc: 'Combine inputs (avg/min/max)', ports: { in: 1, out: 1 }, config: { mode: 'avg', window: 10 } },
	delay: { cat: 'processing', icon: 'timer', label: 'Delay', desc: 'Hold data for N seconds', ports: { in: 1, out: 1 }, config: { duration: 5000, bufferSize: 100 } },
	debounce: { cat: 'processing', icon: 'slow_motion_video', label: 'Debounce', desc: 'Suppress rapid changes', ports: { in: 1, out: 1 }, config: { cooldown: 5000 } },
	switch: { cat: 'processing', icon: 'call_split', label: 'Switch', desc: 'Route to different paths', ports: { in: 1, out: 1, pass: 1 }, config: { conditions: [{ field: 'value', operator: '>', value: 0 }] } },
	merge: { cat: 'processing', icon: 'merge', label: 'Merge', desc: 'Combine multiple streams', ports: { in: 2, out: 1 }, config: { strategy: 'latest' } },
	script: { cat: 'processing', icon: 'code', label: 'Script', desc: 'Custom JavaScript code', ports: { in: 1, out: 1 }, config: { code: '// msg.payload\nreturn msg;' } },

	// Outputs
	'widget-update': { cat: 'outputs', icon: 'dashboard', label: 'Widget Update', desc: 'Update a dashboard widget', ports: { in: 1, out: 0 }, config: { widgetId: '', valueField: 'value' } },
	alert: { cat: 'outputs', icon: 'notifications', label: 'Alert', desc: 'Trigger alert/notification', ports: { in: 1, out: 0 }, config: { severity: 'warning', message: 'Alert: ${value}' } },
	command: { cat: 'outputs', icon: 'send', label: 'Command', desc: 'Send command to device', ports: { in: 1, out: 0 }, config: { deviceId: '', commandType: '', payload: '{}' } },
	log: { cat: 'outputs', icon: 'list_alt', label: 'Log', desc: 'Write to audit log', ports: { in: 1, out: 0 }, config: { level: 'info', message: '${JSON.stringify(data)}' } },
	'rest-call': { cat: 'outputs', icon: 'http', label: 'REST Call', desc: 'Call external API', ports: { in: 1, out: 0 }, config: { url: '', method: 'POST', headers: '', bodyTemplate: '${JSON.stringify(data)}' } },
	'mqtt-publish': { cat: 'outputs', icon: 'publish', label: 'MQTT Publish', desc: 'Publish to MQTT', ports: { in: 1, out: 0 }, config: { broker: '', topic: '', payloadTemplate: '${JSON.stringify(data)}' } },
	'database-write': { cat: 'outputs', icon: 'save', label: 'Database Write', desc: 'Insert/update SQL', ports: { in: 1, out: 0 }, config: { dsn: '', table: '', fieldMapping: '' } },
	email: { cat: 'outputs', icon: 'email', label: 'Email', desc: 'Send email notification', ports: { in: 1, out: 0 }, config: { to: '', subject: '', body: '' } },
	'modbus-write': { cat: 'outputs', icon: 'edit_note', label: 'Modbus Write', desc: 'Write Modbus register', ports: { in: 1, out: 0 }, config: { host: '', port: 502, register: 0, value: '0' } }
};

/** Node types of a category, in the node list's order */
export function typesOf(cat: NodeCategory): string[] {
	return Object.keys(NODE_DEFS).filter((type) => NODE_DEFS[type]?.cat === cat);
}

/** A node type's category; unknown types draw as sources, as before */
export function categoryOf(type: string): NodeCategory {
	return NODE_DEFS[type]?.cat ?? 'sources';
}

/* ── Names ── */

type Translate = (key: string, fallback: string) => string;

/** sdk_studio.node_<type> (the webhook's key is node_webhook) */
export function nodeLabelKey(type: string): string {
	return 'sdk_studio.' + (type === 'webhook-listen' ? 'node_webhook' : 'node_' + type.replace(/-/g, '_'));
}

/** A node type's name in the console language, English when the language file has none */
export function nodeLabel(type: string, tr: Translate): string {
	return tr(nodeLabelKey(type), NODE_DEFS[type]?.label ?? type);
}

/** What kind of step a node is: Source, Processing step, Output */
export function nodeKindKey(type: string): string {
	const cat = NODE_DEFS[type]?.cat;
	return cat === 'processing'
		? 'sdk_studio.kind_processing'
		: cat === 'outputs'
			? 'sdk_studio.kind_output'
			: 'sdk_studio.kind_source';
}

/** The line under a node's name: its kind, or the type's name when the node was renamed */
export function nodeSubtitle(node: Pick<FlowNode, 'type' | 'label'>, tr: Translate): string {
	const typeName = nodeLabel(node.type, tr);
	if (node.label && node.label !== typeName) return typeName;
	const key = nodeKindKey(node.type);
	return tr(
		key,
		key === 'sdk_studio.kind_processing'
			? 'Processing step'
			: key === 'sdk_studio.kind_output'
				? 'Output'
				: 'Source'
	);
}

const LABEL_WORDS: Record<string, string> = {
	id: 'ID',
	url: 'URL',
	oids: 'OIDs',
	dsn: 'DSN',
	qos: 'QoS',
	tls: 'TLS',
	jmes: 'JMES'
};
const MS_KEYS = ['interval', 'duration', 'cooldown'];

/** A settings key as a label: "unitId" → "Unit ID", "jmesPath" → "JMES path", times in milliseconds */
export function configLabel(key: string): string {
	const words = key
		.replace(/([A-Z])/g, ' $1')
		.replace(/_/g, ' ')
		.trim()
		.toLowerCase()
		.split(/\s+/);
	const text = words
		.map((w, i) => LABEL_WORDS[w] ?? (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
		.join(' ');
	return MS_KEYS.includes(key) ? text + ' (ms)' : text;
}

/* ── Settings fields ── */

export type FieldKind = 'boolean' | 'number' | 'json' | 'code' | 'select' | 'text';

export interface ConfigField {
	key: string;
	kind: FieldKind;
	/** The value to show: the node's, else the type's default */
	value: unknown;
	/** Choices of a select */
	options?: readonly string[];
}

const SELECTS: Record<string, readonly string[]> = {
	operator: ['>', '<', '==', '!=', '>=', '<=', 'contains'],
	severity: ['info', 'warning', 'critical'],
	level: ['info', 'warn', 'error', 'debug'],
	method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
	mode: ['avg', 'min', 'max', 'sum', 'count'],
	strategy: ['latest', 'all', 'zip'],
	dataType: ['int16', 'uint16', 'int32', 'uint32', 'float32', 'float64']
};

/** The settings form of a node, in the order of its type's defaults */
export function configFields(node: Pick<FlowNode, 'type' | 'config'>): ConfigField[] {
	const def = NODE_DEFS[node.type];
	if (!def) return [];
	return Object.entries(def.config).map(([key, dflt]) => {
		const value = node.config[key] !== undefined ? node.config[key] : dflt;
		if (typeof dflt === 'boolean') return { key, kind: 'boolean', value };
		if (typeof dflt === 'number') return { key, kind: 'number', value };
		if (dflt && typeof dflt === 'object') return { key, kind: 'json', value };
		if (key === 'code' || key === 'expression') return { key, kind: 'code', value };
		const options = SELECTS[key];
		if (options) {
			// A value from a file or an older version stays choosable
			const current = String(value);
			return {
				key,
				kind: 'select',
				value,
				options: options.includes(current) ? options : [...options, current]
			};
		}
		return { key, kind: 'text', value };
	});
}

/** The text a field shows for a value */
export function fieldText(field: ConfigField): string {
	if (field.kind === 'json') return JSON.stringify(field.value, null, 2);
	if (field.kind === 'boolean') return field.value ? 'true' : 'false';
	return field.value === null || field.value === undefined ? '' : String(field.value);
}

/** What a field's text means as a setting; JSON that doesn't parse is refused */
export function parseField(kind: FieldKind, text: string): { ok: true; value: unknown } | { ok: false } {
	if (kind === 'json') {
		try {
			return { ok: true, value: JSON.parse(text) as unknown };
		} catch {
			return { ok: false };
		}
	}
	if (kind === 'number') return { ok: true, value: Number(text) };
	if (kind === 'boolean') return { ok: true, value: text === 'true' };
	return { ok: true, value: text };
}

/* ── Ports and wires ── */

export const NODE_W = 180;
export const NODE_H = 52;
export const PORT_R = 6;
export const GRID = 20;
const PORT_GAP = 18;

export interface Port {
	name: string;
	dir: 'in' | 'out';
	x: number;
	y: number;
}

/**
 * A node's ports, relative to the node: inputs on the left edge, outputs
 * (out, then pass for Filter and Switch) on the right edge, spread 18 px
 * apart around the middle. Unknown types get one input and one output.
 */
export function nodePorts(type: string): Port[] {
	const ports = NODE_DEFS[type]?.ports ?? { in: 1, out: 1 };
	const list: Port[] = [];
	for (let i = 0; i < ports.in; i++) {
		list.push({ name: 'in', dir: 'in', x: 0, y: NODE_H / 2 + (i - (ports.in - 1) / 2) * PORT_GAP });
	}
	const outs = [...(ports.out ? ['out'] : []), ...(ports.pass ? ['pass'] : [])];
	outs.forEach((name, i) => {
		list.push({ name, dir: 'out', x: NODE_W, y: NODE_H / 2 + (i - (outs.length - 1) / 2) * PORT_GAP });
	});
	return list;
}

/**
 * Where a wire meets a node (canvas coordinates). Inputs meet in the middle
 * of the left edge (a Merge's two inputs share the name "in"); outputs at
 * their port, so a wire from Pass starts at the Pass dot.
 */
export function wireEnd(node: Pick<FlowNode, 'type' | 'x' | 'y'>, port: string): { x: number; y: number } {
	if (port === 'in') return { x: node.x, y: node.y + NODE_H / 2 };
	const p = nodePorts(node.type).find((q) => q.dir === 'out' && q.name === port);
	return p ? { x: node.x + p.x, y: node.y + p.y } : { x: node.x + NODE_W, y: node.y + NODE_H / 2 };
}

export interface PortRef {
	node: string;
	port: string;
	dir: 'in' | 'out';
}

/**
 * Connect two ports dragged from `a` to `b`. An output connects to an
 * input, in either drag direction; a node never connects to itself and the
 * same connection is never added twice. Returns the new wire or null.
 */
export function connect(flow: Flow, a: PortRef, b: PortRef): FlowWire | null {
	if (a.node === b.node || a.dir === b.dir) return null;
	const [out, inp] = a.dir === 'out' ? [a, b] : [b, a];
	if (!flow.nodes.some((n) => n.id === out.node) || !flow.nodes.some((n) => n.id === inp.node)) return null;
	const wire: FlowWire = {
		from: out.node,
		fromPort: out.port || 'out',
		to: inp.node,
		toPort: inp.port || 'in'
	};
	const exists = flow.wires.some(
		(w) =>
			w.from === wire.from && w.fromPort === wire.fromPort && w.to === wire.to && w.toPort === wire.toPort
	);
	if (exists) return null;
	flow.wires.push(wire);
	return wire;
}

/** Remove a node and every wire to or from it */
export function removeNode(flow: Flow, id: string): void {
	flow.nodes = flow.nodes.filter((n) => n.id !== id);
	flow.wires = flow.wires.filter((w) => w.from !== id && w.to !== id);
}

/* ── Nodes ── */

/** The highest number in the flow's node ids ("n7" → 7), so new nodes get fresh ids */
export function lastNodeNumber(flow: Flow): number {
	let max = 0;
	for (const n of flow.nodes) {
		const num = parseInt(n.id.replace('n', ''), 10);
		if (num > max) max = num;
	}
	return max;
}

/** Add a node of a known type at (x, y) with the type's default settings */
export function addNode(
	flow: Flow,
	type: string,
	x: number,
	y: number,
	id: string,
	label: string
): FlowNode | null {
	const def = NODE_DEFS[type];
	if (!def) return null;
	const node: FlowNode = {
		id,
		type,
		x: Math.round(x),
		y: Math.round(y),
		label,
		config: structuredClone(def.config)
	};
	flow.nodes.push(node);
	return node;
}

/* ── Reading flows from files and the server ── */

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/**
 * A flow from outside (a file, flow_json, a template) in the shape the
 * editor draws: nodes and wires as lists, ids and texts as strings,
 * positions as numbers. Entries that can't be a node or wire are dropped.
 */
export function normalizeFlow(raw: unknown): Flow {
	const src = isObject(raw) ? raw : {};
	const nodes: FlowNode[] = [];
	for (const n of Array.isArray(src.nodes) ? src.nodes : []) {
		if (!isObject(n) || (typeof n.id !== 'string' && typeof n.id !== 'number') || typeof n.type !== 'string')
			continue;
		nodes.push({
			id: String(n.id),
			type: n.type,
			x: num(n.x),
			y: num(n.y),
			label: typeof n.label === 'string' ? n.label : '',
			config: isObject(n.config) ? { ...n.config } : {}
		});
	}
	const wires: FlowWire[] = [];
	for (const w of Array.isArray(src.wires) ? src.wires : []) {
		if (!isObject(w) || w.from === undefined || w.to === undefined) continue;
		wires.push({
			from: String(w.from),
			fromPort: typeof w.fromPort === 'string' && w.fromPort ? w.fromPort : 'out',
			to: String(w.to),
			toPort: typeof w.toPort === 'string' && w.toPort ? w.toPort : 'in'
		});
	}
	return { nodes, wires };
}

/** flow_json from the server: a JSON string; anything unreadable is an empty flow, as before */
export function parseFlowJson(text: string): Flow {
	try {
		return normalizeFlow(JSON.parse(text));
	} catch {
		return { nodes: [], wires: [] };
	}
}

/* ── .bdflow files ── */

export interface Bdflow {
	version: '1.0';
	format: 'bdflow';
	name: string;
	description: string;
	flow: Flow;
	exportedAt: string;
	exportedBy: string;
}

/** The file for the flow on the canvas: the same format as the server's export */
export function toBdflow(
	meta: { name: string; description: string },
	flow: Flow,
	user: string,
	now = new Date()
): Bdflow {
	return {
		version: '1.0',
		format: 'bdflow',
		name: meta.name,
		description: meta.description || '',
		flow,
		exportedAt: now.toISOString(),
		exportedBy: user
	};
}

/** "Temp monitor 2" → "Temp_monitor_2.bdflow" (the server's rule) */
export function bdflowFileName(name: string): string {
	return String(name || 'flow').replace(/[^a-zA-Z0-9_-]/g, '_') + '.bdflow';
}

/**
 * A .bdflow file's content. Not JSON, or not { format: "bdflow", flow }:
 * 'invalid' (the file is something else) or 'unreadable' (not JSON at all,
 * with the parser's message).
 */
export function parseBdflow(
	text: string
):
	| { ok: true; name: string; description: string; flow: Flow }
	| { ok: false; reason: 'invalid' }
	| { ok: false; reason: 'unreadable'; message: string } {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (err) {
		return { ok: false, reason: 'unreadable', message: err instanceof Error ? err.message : String(err) };
	}
	if (!isObject(data) || data.format !== 'bdflow' || !data.flow) return { ok: false, reason: 'invalid' };
	return {
		ok: true,
		name: typeof data.name === 'string' ? data.name : '',
		description: typeof data.description === 'string' ? data.description : '',
		flow: normalizeFlow(data.flow)
	};
}

/** "Show flow as JSON": the first 20 lines and how many more there are */
export function jsonPreview(flow: Flow, max = 20): { lines: string[]; more: number } {
	const lines = JSON.stringify(flow, null, 2).split('\n');
	return { lines: lines.slice(0, max), more: Math.max(0, lines.length - max) };
}
