/**
 * The fleet workflow builder's model (old public/js/fleet-builder.js),
 * without a DOM: the step types, their settings, the connection rules and
 * the workflow's JSON (saved to the server and exported as a file in the
 * same shape: { name, nodes, connections }).
 */

export type StepCategory = 'trigger' | 'condition' | 'action' | 'result' | 'transform';

export interface StepDef {
	cat: StepCategory;
	/** Translation key of the step's name */
	key: string;
	/** English name when the language file has none */
	label: string;
}

export interface WorkflowNode {
	id: string;
	type: string;
	category: string;
	label: string;
	x: number;
	y: number;
	config: Record<string, string>;
}

export interface WorkflowConnection {
	id: string;
	from: string;
	to: string;
}

export interface Workflow {
	nodes: WorkflowNode[];
	connections: WorkflowConnection[];
}

export const STEP_DEFS: Readonly<Record<string, StepDef>> = {
	trigger_manual: { cat: 'trigger', key: 'fleet.node_manual', label: 'Manual trigger' },
	trigger_schedule: { cat: 'trigger', key: 'fleet.node_schedule', label: 'Schedule' },
	trigger_event: { cat: 'trigger', key: 'fleet.node_event', label: 'Event trigger' },
	cond_os: { cat: 'condition', key: 'fleet.node_os_check', label: 'OS check' },
	cond_threshold: { cat: 'condition', key: 'fleet.node_threshold', label: 'Threshold' },
	cond_time_window: { cat: 'condition', key: 'fleet.node_time_window', label: 'Time window' },
	action_script: { cat: 'action', key: 'fleet.node_run_script', label: 'Run script' },
	action_install: { cat: 'action', key: 'fleet.node_install', label: 'Install software' },
	action_restart: { cat: 'action', key: 'fleet.node_restart', label: 'Restart service' },
	action_file_deploy: { cat: 'action', key: 'fleet.node_file_deploy', label: 'Deploy file' },
	action_message: { cat: 'action', key: 'fleet.node_send_message', label: 'Send message' },
	result_log: { cat: 'result', key: 'fleet.node_log_output', label: 'Log output' },
	result_alert: { cat: 'result', key: 'fleet.node_send_alert', label: 'Send alert' },
	result_chain: { cat: 'result', key: 'fleet.node_chain', label: 'Start another workflow' },
	transform_parse: { cat: 'transform', key: 'fleet.node_parse_json', label: 'Parse JSON' },
	transform_filter: { cat: 'transform', key: 'fleet.node_filter', label: 'Filter' },
	transform_delay: { cat: 'transform', key: 'fleet.node_delay', label: 'Delay' }
};

/** The step list's groups: heading key and the steps, in the old order */
export const STEP_GROUPS: readonly { cat: StepCategory; key: string; types: string[] }[] = [
	{
		cat: 'trigger',
		key: 'fleet.node_triggers',
		types: ['trigger_manual', 'trigger_schedule', 'trigger_event']
	},
	{
		cat: 'condition',
		key: 'fleet.node_conditions',
		types: ['cond_os', 'cond_threshold', 'cond_time_window']
	},
	{
		cat: 'action',
		key: 'fleet.node_actions',
		types: ['action_script', 'action_install', 'action_restart', 'action_file_deploy', 'action_message']
	},
	{ cat: 'result', key: 'fleet.node_results', types: ['result_log', 'result_alert', 'result_chain'] },
	{
		cat: 'transform',
		key: 'fleet.node_transforms',
		types: ['transform_parse', 'transform_filter', 'transform_delay']
	}
];

const CATS: readonly string[] = ['trigger', 'condition', 'action', 'result', 'transform'];

/** A node's category as drawn; anything unknown draws as an action, as before */
export function drawnCategory(node: Pick<WorkflowNode, 'category'>): StepCategory {
	return (CATS.includes(node.category) ? node.category : 'action') as StepCategory;
}

export const STEP_W = 180;
export const STEP_H = 56;

/** The name on a step, cut to fit: 20 characters, or 18 and "…" */
export function stepTitle(label: string): string {
	return label.length > 20 ? label.slice(0, 18) + '…' : label;
}

/** A trigger starts the workflow, so it has no input */
export function hasInput(node: Pick<WorkflowNode, 'category'>): boolean {
	return node.category !== 'trigger';
}

/* ── Settings ── */

export interface StepField {
	key: string;
	/** fleet.prop_<key> and its English fallback */
	label: string;
	kind: 'text' | 'select' | 'script';
	placeholder?: string;
	mono?: boolean;
	options?: readonly string[];
}

const F = (key: string, label: string, placeholder = '', mono = false): StepField => ({
	key,
	label,
	kind: 'text',
	placeholder,
	mono
});
const S = (key: string, label: string, options: readonly string[]): StepField => ({
	key,
	label,
	kind: 'select',
	options
});

/** The settings of each step type, besides its name (old buildPropsForm) */
export const STEP_FIELDS: Readonly<Record<string, readonly StepField[]>> = {
	trigger_schedule: [F('cron', 'Cron expression', '*/5 * * * *', true)],
	trigger_event: [
		S('event', 'Event', ['disk_full', 'cpu_high', 'user_login', 'service_down']),
		F('threshold', 'Threshold in percent', '90')
	],
	cond_os: [S('os', 'Operating system', ['windows', 'linux', 'macos', 'any'])],
	cond_threshold: [
		S('metric', 'Measure', ['cpu', 'ram', 'disk', 'network']),
		S('operator', 'Comparison', ['>', '<', '>=', '<=', '==']),
		F('value', 'Value', '80')
	],
	cond_time_window: [
		F('start_time', 'From', '08:00'),
		F('end_time', 'Until', '18:00'),
		F('days', 'Days (0 is Sunday, 6 is Saturday)', '1,2,3,4,5')
	],
	action_script: [
		{ key: 'script', label: 'Script', kind: 'script', mono: true },
		S('shell', 'Shell', ['bash', 'powershell', 'cmd', 'python'])
	],
	action_install: [
		F('package', 'Package or download address', '', true),
		S('method', 'Installer', ['msi', 'deb', 'rpm', 'apt', 'chocolatey', 'winget'])
	],
	action_restart: [F('service', 'Service name', '', true)],
	action_file_deploy: [
		F('source', 'Source path or address', '', true),
		F('destination', 'Destination path', '', true)
	],
	action_message: [F('message', 'Message')],
	result_alert: [S('channel', 'Send to', ['console', 'email', 'webhook']), F('recipient', 'Recipient')],
	result_chain: [F('workflow_id', 'Workflow ID', '', true)],
	transform_delay: [F('seconds', 'Wait in seconds', '10')],
	transform_filter: [F('expression', 'Filter expression', '', true)]
};

/* ── Editing ── */

/**
 * Ids: nodes are n<number>, connections c<number>, from one counter, as
 * before. `next` is the number the next id gets.
 */
export class Ids {
	next = 1;
	node(): string {
		return 'n' + this.next++;
	}
	connection(): string {
		return 'c' + this.next++;
	}
	/** After loading: past every number in use */
	resetFor(wf: Workflow): void {
		const nums = [
			...wf.nodes.map((n) => parseInt(n.id.replace('n', '') || '0', 10)),
			...wf.connections.map((c) => parseInt(c.id.replace('c', '') || '0', 10))
		].filter((n) => Number.isFinite(n));
		this.next = Math.max(0, ...nums) + 1;
	}
}

export function addStep(
	wf: Workflow,
	ids: Ids,
	type: string,
	x: number,
	y: number,
	label: string
): WorkflowNode | null {
	const def = STEP_DEFS[type];
	if (!def) return null;
	const node: WorkflowNode = { id: ids.node(), type, category: def.cat, label, x, y, config: {} };
	wf.nodes.push(node);
	return node;
}

/**
 * Connect the output of `from` to the input of `to`: never a step to
 * itself, never twice, never into a trigger. Returns the connection or null.
 */
export function connectSteps(wf: Workflow, ids: Ids, from: string, to: string): WorkflowConnection | null {
	if (from === to) return null;
	if (wf.connections.some((c) => c.from === from && c.to === to)) return null;
	const target = wf.nodes.find((n) => n.id === to);
	if (!target || !hasInput(target) || !wf.nodes.some((n) => n.id === from)) return null;
	const c = { id: ids.connection(), from, to };
	wf.connections.push(c);
	return c;
}

export function removeStep(wf: Workflow, id: string): void {
	wf.nodes = wf.nodes.filter((n) => n.id !== id);
	wf.connections = wf.connections.filter((c) => c.from !== id && c.to !== id);
}

export function removeConnection(wf: Workflow, id: string): void {
	wf.connections = wf.connections.filter((c) => c.id !== id);
}

/* ── Loading and files ── */

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** A saved workflow from the server ({ data: wf } or the workflow itself) in the editor's shape */
export function normalizeWorkflow(raw: unknown): Workflow & { id: string; name: string } {
	const outer = isObject(raw) ? raw : {};
	const wf = isObject(outer.data) ? outer.data : outer;
	const nodes: WorkflowNode[] = [];
	for (const n of Array.isArray(wf.nodes) ? wf.nodes : []) {
		if (!isObject(n) || n.id === undefined || typeof n.type !== 'string') continue;
		const config: Record<string, string> = {};
		if (isObject(n.config))
			for (const [k, v] of Object.entries(n.config))
				config[k] = v === null || v === undefined ? '' : String(v);
		nodes.push({
			id: String(n.id),
			type: n.type,
			category: typeof n.category === 'string' ? n.category : (STEP_DEFS[n.type]?.cat ?? 'action'),
			label: typeof n.label === 'string' ? n.label : '',
			x: Number(n.x) || 0,
			y: Number(n.y) || 0,
			config
		});
	}
	const connections: WorkflowConnection[] = [];
	for (const c of Array.isArray(wf.connections) ? wf.connections : []) {
		if (!isObject(c) || c.from === undefined || c.to === undefined) continue;
		connections.push({ id: String(c.id ?? ''), from: String(c.from), to: String(c.to) });
	}
	return {
		id: wf.id === undefined || wf.id === null ? '' : String(wf.id),
		name: typeof wf.name === 'string' ? wf.name : '',
		nodes,
		connections
	};
}

/** The exported file: the same JSON the server gets on save */
export function workflowFile(name: string, wf: Workflow): { fileName: string; text: string } {
	return {
		fileName: (name || 'workflow') + '.json',
		text: JSON.stringify({ name, nodes: wf.nodes, connections: wf.connections }, null, 2)
	};
}
