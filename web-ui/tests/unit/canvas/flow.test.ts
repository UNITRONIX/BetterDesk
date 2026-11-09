import { describe, expect, test } from 'vitest';
import {
	addNode,
	bdflowFileName,
	categoryOf,
	configFields,
	configLabel,
	connect,
	fieldText,
	jsonPreview,
	lastNodeNumber,
	NODE_DEFS,
	NODE_H,
	NODE_W,
	nodeLabel,
	nodeLabelKey,
	nodePorts,
	nodeSubtitle,
	normalizeFlow,
	parseBdflow,
	parseField,
	parseFlowJson,
	removeNode,
	toBdflow,
	typesOf,
	wireEnd,
	type Flow
} from '../../../src/lib/canvas/flow.ts';

const en = (_key: string, fallback: string) => fallback;

function flowOf(...types: string[]): Flow {
	const flow: Flow = { nodes: [], wires: [] };
	types.forEach((type, i) =>
		addNode(flow, type, i * 300, 100, 'n' + (i + 1), NODE_DEFS[type]?.label ?? type)
	);
	return flow;
}

describe('node types', () => {
	test('every node type of the old studio is there, in its category and order', () => {
		expect(typesOf('sources')).toEqual([
			'modbus-tcp',
			'modbus-rtu',
			'snmp-poll',
			'rest-poll',
			'mqtt-subscribe',
			'webhook-listen',
			'device-telemetry',
			'database-query',
			'file-watch'
		]);
		expect(typesOf('processing')).toEqual([
			'filter',
			'transform',
			'aggregate',
			'delay',
			'debounce',
			'switch',
			'merge',
			'script'
		]);
		expect(typesOf('outputs')).toEqual([
			'widget-update',
			'alert',
			'command',
			'log',
			'rest-call',
			'mqtt-publish',
			'database-write',
			'email',
			'modbus-write'
		]);
	});

	test('names come from sdk_studio.node_<type>, the webhook from node_webhook', () => {
		expect(nodeLabelKey('modbus-tcp')).toBe('sdk_studio.node_modbus_tcp');
		expect(nodeLabelKey('webhook-listen')).toBe('sdk_studio.node_webhook');
		expect(nodeLabel('rest-call', (k, f) => (k === 'sdk_studio.node_rest_call' ? 'REST-Aufruf' : f))).toBe(
			'REST-Aufruf'
		);
		expect(nodeLabel('rest-call', en)).toBe('REST Call');
		expect(nodeLabel('mystery', en)).toBe('mystery');
	});

	test('the line under a node: its kind, or the type name once the node is renamed', () => {
		expect(nodeSubtitle({ type: 'filter', label: 'Filter' }, en)).toBe('Processing step');
		expect(nodeSubtitle({ type: 'modbus-tcp', label: '' }, en)).toBe('Source');
		const tr = (k: string, f: string) =>
			({ 'sdk_studio.kind_processing': 'Processing step', 'sdk_studio.kind_output': 'Output' })[k] ?? f;
		expect(nodeSubtitle({ type: 'filter', label: 'Filter' }, tr)).toBe('Processing step');
		expect(nodeSubtitle({ type: 'alert', label: 'Alert' }, tr)).toBe('Output');
		expect(nodeSubtitle({ type: 'filter', label: 'High Temp' }, tr)).toBe('Filter');
	});

	test('unknown types draw as sources', () => {
		expect(categoryOf('mystery')).toBe('sources');
	});
});

describe('settings', () => {
	test('keys become labels, times say milliseconds', () => {
		expect(configLabel('unitId')).toBe('Unit ID');
		expect(configLabel('jmesPath')).toBe('JMES path');
		expect(configLabel('interval')).toBe('Interval (ms)');
		expect(configLabel('oids')).toBe('OIDs');
		expect(configLabel('bufferSize')).toBe('Buffer size');
	});

	test('field kinds follow the type defaults, in their order', () => {
		const fields = configFields({ type: 'modbus-tcp', config: {} });
		expect(fields.map((f) => [f.key, f.kind])).toEqual([
			['host', 'text'],
			['port', 'number'],
			['unitId', 'number'],
			['register', 'number'],
			['dataType', 'select'],
			['interval', 'number']
		]);
		expect(configFields({ type: 'mqtt-subscribe', config: {} }).find((f) => f.key === 'tls')?.kind).toBe(
			'boolean'
		);
		expect(configFields({ type: 'script', config: {} })[0]?.kind).toBe('code');
		expect(configFields({ type: 'switch', config: {} })[0]?.kind).toBe('json');
		expect(configFields({ type: 'mystery', config: {} })).toEqual([]);
	});

	test('a value from a file outside the choices stays choosable', () => {
		const level = configFields({ type: 'log', config: { level: 'trace' } }).find((f) => f.key === 'level');
		expect(level?.options).toEqual(['info', 'warn', 'error', 'debug', 'trace']);
		const known = configFields({ type: 'log', config: { level: 'warn' } }).find((f) => f.key === 'level');
		expect(known?.options).toEqual(['info', 'warn', 'error', 'debug']);
	});

	test('the node value wins over the default', () => {
		const port = configFields({ type: 'modbus-tcp', config: { port: 1502 } }).find((f) => f.key === 'port');
		expect(port?.value).toBe(1502);
	});

	test('the Switch conditions are JSON, not [object Object]', () => {
		const cond = configFields({ type: 'switch', config: {} })[0];
		expect(cond && fieldText(cond)).toContain('"operator": ">"');
		expect(parseField('json', '[{"field":"v"}]')).toEqual({ ok: true, value: [{ field: 'v' }] });
		expect(parseField('json', '[{"field":')).toEqual({ ok: false });
	});

	test('numbers and Yes/No are stored as numbers and booleans', () => {
		expect(parseField('number', '42')).toEqual({ ok: true, value: 42 });
		expect(parseField('number', '')).toEqual({ ok: true, value: 0 });
		expect(parseField('boolean', 'true')).toEqual({ ok: true, value: true });
		expect(parseField('boolean', 'false')).toEqual({ ok: true, value: false });
		expect(parseField('text', '7')).toEqual({ ok: true, value: '7' });
	});
});

describe('ports and wires', () => {
	test('sources have only an output, outputs only an input', () => {
		expect(nodePorts('modbus-tcp').map((p) => [p.name, p.dir])).toEqual([['out', 'out']]);
		expect(nodePorts('alert').map((p) => [p.name, p.dir])).toEqual([['in', 'in']]);
	});

	test('Filter and Switch have out and pass; Merge two inputs', () => {
		expect(nodePorts('filter').map((p) => p.name)).toEqual(['in', 'out', 'pass']);
		expect(nodePorts('switch').map((p) => p.name)).toEqual(['in', 'out', 'pass']);
		expect(nodePorts('merge').filter((p) => p.dir === 'in')).toHaveLength(2);
	});

	test('a wire starts at the dot it was drawn from (pass below out)', () => {
		const filter = { type: 'filter', x: 100, y: 50 };
		const ports = nodePorts('filter');
		const out = ports.find((p) => p.name === 'out');
		const pass = ports.find((p) => p.name === 'pass');
		expect(wireEnd(filter, 'out')).toEqual({ x: 100 + NODE_W, y: 50 + (out?.y ?? 0) });
		expect(wireEnd(filter, 'pass')).toEqual({ x: 100 + NODE_W, y: 50 + (pass?.y ?? 0) });
		expect(wireEnd(filter, 'pass').y).toBeGreaterThan(wireEnd(filter, 'out').y);
		expect(wireEnd(filter, 'in')).toEqual({ x: 100, y: 50 + NODE_H / 2 });
	});

	test('an output connects to an input, dragged either way', () => {
		const flow = flowOf('modbus-tcp', 'alert');
		expect(
			connect(flow, { node: 'n1', port: 'out', dir: 'out' }, { node: 'n2', port: 'in', dir: 'in' })
		).toEqual({
			from: 'n1',
			fromPort: 'out',
			to: 'n2',
			toPort: 'in'
		});
		const back = flowOf('modbus-tcp', 'alert');
		connect(back, { node: 'n2', port: 'in', dir: 'in' }, { node: 'n1', port: 'out', dir: 'out' });
		expect(back.wires).toEqual([{ from: 'n1', fromPort: 'out', to: 'n2', toPort: 'in' }]);
	});

	test('never to itself, never twice, never output to output or input to input', () => {
		const flow = flowOf('filter', 'transform', 'alert');
		const out = (node: string, port = 'out') => ({ node, port, dir: 'out' as const });
		const inp = (node: string) => ({ node, port: 'in', dir: 'in' as const });
		expect(connect(flow, out('n1'), inp('n1'))).toBeNull();
		expect(connect(flow, out('n1'), out('n2'))).toBeNull();
		expect(connect(flow, inp('n2'), inp('n3'))).toBeNull();
		expect(connect(flow, out('n1'), inp('n2'))).not.toBeNull();
		expect(connect(flow, out('n1'), inp('n2'))).toBeNull();
		// The pass output is another connection to the same node
		expect(connect(flow, out('n1', 'pass'), inp('n2'))).not.toBeNull();
		expect(flow.wires).toHaveLength(2);
	});

	test('removing a node removes its wires', () => {
		const flow = flowOf('modbus-tcp', 'filter', 'alert');
		connect(flow, { node: 'n1', port: 'out', dir: 'out' }, { node: 'n2', port: 'in', dir: 'in' });
		connect(flow, { node: 'n2', port: 'pass', dir: 'out' }, { node: 'n3', port: 'in', dir: 'in' });
		removeNode(flow, 'n2');
		expect(flow.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
		expect(flow.wires).toEqual([]);
	});
});

describe('nodes', () => {
	test('a new node gets its own copy of the defaults, at whole pixels', () => {
		const flow: Flow = { nodes: [], wires: [] };
		const a = addNode(flow, 'switch', 10.6, 20.2, 'n1', 'Switch');
		const b = addNode(flow, 'switch', 0, 0, 'n2', 'Switch');
		expect(a).toMatchObject({ x: 11, y: 20 });
		(a?.config.conditions as unknown[]).push('x');
		expect(b?.config.conditions).toHaveLength(1);
		expect(NODE_DEFS.switch?.config.conditions).toHaveLength(1);
		expect(addNode(flow, 'mystery', 0, 0, 'n3', 'x')).toBeNull();
	});

	test('new ids continue after the highest one in a loaded flow', () => {
		expect(
			lastNodeNumber({ nodes: [{ id: 'n4' }, { id: 'n12' }, { id: 'x' }] as Flow['nodes'], wires: [] })
		).toBe(12);
		expect(lastNodeNumber({ nodes: [], wires: [] })).toBe(0);
	});
});

describe('.bdflow files and stored flows', () => {
	test('the file has the server export format and a safe name', () => {
		const flow = flowOf('modbus-tcp');
		const file = toBdflow(
			{ name: 'Temp monitor', description: '' },
			flow,
			'anna',
			new Date('2026-11-09T10:00:00Z')
		);
		expect(file).toEqual({
			version: '1.0',
			format: 'bdflow',
			name: 'Temp monitor',
			description: '',
			flow,
			exportedAt: '2026-11-09T10:00:00.000Z',
			exportedBy: 'anna'
		});
		expect(bdflowFileName('Temp monitor 2/ä')).toBe('Temp_monitor_2__.bdflow');
		expect(bdflowFileName('')).toBe('flow.bdflow');
	});

	test('a file round-trips', () => {
		const flow = flowOf('rest-poll', 'log');
		connect(flow, { node: 'n1', port: 'out', dir: 'out' }, { node: 'n2', port: 'in', dir: 'in' });
		const text = JSON.stringify(toBdflow({ name: 'A', description: 'd' }, flow, 'u'));
		expect(parseBdflow(text)).toEqual({ ok: true, name: 'A', description: 'd', flow });
	});

	test('other files are refused with a reason', () => {
		expect(parseBdflow('{"name":"x"}')).toEqual({ ok: false, reason: 'invalid' });
		expect(parseBdflow('{"format":"bdflow"}')).toEqual({ ok: false, reason: 'invalid' });
		expect(parseBdflow('[]')).toEqual({ ok: false, reason: 'invalid' });
		expect(parseBdflow('{"format":"node-red","flow":{"nodes":[]}}')).toEqual({
			ok: false,
			reason: 'invalid'
		});
		const broken = parseBdflow('{oops');
		expect(broken.ok).toBe(false);
		expect(!broken.ok && broken.reason).toBe('unreadable');
	});

	test('junk in a file never reaches the canvas as something else', () => {
		const flow = normalizeFlow({
			nodes: [
				{ id: 3, type: 'alert', x: '40', y: null, label: 7, config: 'x' },
				{ type: 'alert' },
				'nope',
				{ id: 'n9', type: 5 }
			],
			wires: [{ from: 3, to: 'n1' }, { to: 'n1' }, null]
		});
		expect(flow.nodes).toEqual([{ id: '3', type: 'alert', x: 40, y: 0, label: '', config: {} }]);
		expect(flow.wires).toEqual([{ from: '3', fromPort: 'out', to: 'n1', toPort: 'in' }]);
		expect(normalizeFlow(null)).toEqual({ nodes: [], wires: [] });
	});

	test('unreadable flow_json opens as an empty flow', () => {
		expect(parseFlowJson('{"nodes":')).toEqual({ nodes: [], wires: [] });
		expect(parseFlowJson('{"nodes":[{"id":"n1","type":"log","x":1,"y":2}]}').nodes).toHaveLength(1);
	});

	test('the JSON view shows 20 lines and how many more', () => {
		const preview = jsonPreview(flowOf('modbus-tcp', 'alert'));
		expect(preview.lines).toHaveLength(20);
		expect(preview.more).toBeGreaterThan(0);
		expect(jsonPreview({ nodes: [], wires: [] })).toEqual({
			lines: ['{', '  "nodes": [],', '  "wires": []', '}'],
			more: 0
		});
	});
});
