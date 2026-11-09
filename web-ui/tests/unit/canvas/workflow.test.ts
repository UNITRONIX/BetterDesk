import { describe, expect, test } from 'vitest';
import { WorkflowEditor } from '../../../src/lib/canvas/workflow-editor.svelte.ts';
import {
	addStep,
	connectSteps,
	drawnCategory,
	hasInput,
	Ids,
	normalizeWorkflow,
	removeConnection,
	removeStep,
	STEP_DEFS,
	STEP_FIELDS,
	STEP_GROUPS,
	stepTitle,
	workflowFile,
	type Workflow
} from '../../../src/lib/canvas/workflow.ts';

function wf(...types: string[]): { doc: Workflow; ids: Ids } {
	const doc: Workflow = { nodes: [], connections: [] };
	const ids = new Ids();
	types.forEach((type, i) => addStep(doc, ids, type, i * 220, 100, type));
	return { doc, ids };
}

describe('step types', () => {
	test('all 17 steps of the old builder, in five groups', () => {
		expect(Object.keys(STEP_DEFS)).toHaveLength(17);
		expect(STEP_GROUPS.map((g) => [g.cat, g.types.length])).toEqual([
			['trigger', 3],
			['condition', 3],
			['action', 5],
			['result', 3],
			['transform', 3]
		]);
		for (const g of STEP_GROUPS) for (const type of g.types) expect(STEP_DEFS[type]?.cat).toBe(g.cat);
	});

	test('the settings of each type, as before', () => {
		expect(STEP_FIELDS.trigger_schedule?.map((f) => f.key)).toEqual(['cron']);
		expect(STEP_FIELDS.cond_threshold?.map((f) => [f.key, f.kind])).toEqual([
			['metric', 'select'],
			['operator', 'select'],
			['value', 'text']
		]);
		expect(STEP_FIELDS.action_script?.map((f) => f.kind)).toEqual(['script', 'select']);
		expect(STEP_FIELDS.action_install?.find((f) => f.key === 'method')?.options).toContain('winget');
		expect(STEP_FIELDS.result_log).toBeUndefined();
		expect(STEP_FIELDS.transform_parse).toBeUndefined();
	});

	test('titles are cut to 20 characters', () => {
		expect(stepTitle('Start another workflow')).toBe('Start another work…');
		expect(stepTitle('Exactly twenty chars')).toBe('Exactly twenty chars');
	});

	test('unknown categories draw as actions; triggers have no input', () => {
		expect(drawnCategory({ category: 'mystery' })).toBe('action');
		expect(hasInput({ category: 'trigger' })).toBe(false);
		expect(hasInput({ category: 'action' })).toBe(true);
	});
});

describe('editing', () => {
	test('nodes and connections share one id counter', () => {
		const { doc, ids } = wf('trigger_manual', 'action_script');
		expect(doc.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
		expect(connectSteps(doc, ids, 'n1', 'n2')?.id).toBe('c3');
		expect(addStep(doc, ids, 'result_log', 0, 0, 'Log')?.id).toBe('n4');
		expect(addStep(doc, ids, 'nope', 0, 0, 'x')).toBeNull();
	});

	test('no connection to itself, twice, or into a trigger', () => {
		const { doc, ids } = wf('trigger_manual', 'action_script', 'trigger_event');
		expect(connectSteps(doc, ids, 'n2', 'n2')).toBeNull();
		expect(connectSteps(doc, ids, 'n2', 'n3')).toBeNull();
		expect(connectSteps(doc, ids, 'n1', 'n2')).not.toBeNull();
		expect(connectSteps(doc, ids, 'n1', 'n2')).toBeNull();
		expect(connectSteps(doc, ids, 'n1', 'n9')).toBeNull();
		expect(doc.connections).toHaveLength(1);
	});

	test('removing a step removes its connections; a connection can go alone', () => {
		const { doc, ids } = wf('trigger_manual', 'action_script', 'result_log');
		connectSteps(doc, ids, 'n1', 'n2');
		const c = connectSteps(doc, ids, 'n2', 'n3');
		removeConnection(doc, c?.id ?? '');
		expect(doc.connections.map((x) => [x.from, x.to])).toEqual([['n1', 'n2']]);
		removeStep(doc, 'n2');
		expect(doc.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
		expect(doc.connections).toEqual([]);
	});

	test('after loading, new ids come after every number in use', () => {
		const ids = new Ids();
		ids.resetFor({
			nodes: [{ id: 'n7' }, { id: 'n2' }] as Workflow['nodes'],
			connections: [{ id: 'c11', from: 'n7', to: 'n2' }]
		});
		expect(ids.node()).toBe('n12');
	});
});

describe('loading and export', () => {
	test('a saved workflow as { data } or bare, in the editor shape', () => {
		const raw = {
			data: {
				id: 9,
				name: 'Patch',
				nodes: [
					{ id: 'n1', type: 'trigger_manual', category: 'trigger', label: 'Go', x: 10, y: 20, config: {} },
					{ id: 'n2', type: 'action_script', x: '5', config: { script: 'ls', retries: 2, none: null } },
					{ type: 'x' }
				],
				connections: [{ id: 'c3', from: 'n1', to: 'n2' }, { from: 'n1' }]
			}
		};
		const out = normalizeWorkflow(raw);
		expect(out.id).toBe('9');
		expect(out.name).toBe('Patch');
		expect(out.nodes[1]).toEqual({
			id: 'n2',
			type: 'action_script',
			category: 'action',
			label: '',
			x: 5,
			y: 0,
			config: { script: 'ls', retries: '2', none: '' }
		});
		expect(out.nodes).toHaveLength(2);
		expect(out.connections).toEqual([{ id: 'c3', from: 'n1', to: 'n2' }]);
		expect(normalizeWorkflow({ name: 'bare', nodes: [], connections: [] }).name).toBe('bare');
	});

	test('the exported file is the same JSON the server gets', () => {
		const { doc, ids } = wf('trigger_manual', 'result_log');
		connectSteps(doc, ids, 'n1', 'n2');
		const file = workflowFile('Night patch', doc);
		expect(file.fileName).toBe('Night patch.json');
		expect(JSON.parse(file.text)).toEqual({
			name: 'Night patch',
			nodes: doc.nodes,
			connections: doc.connections
		});
		expect(workflowFile('', doc).fileName).toBe('workflow.json');
	});
});

describe('the editor the page keeps', () => {
	test('a new workflow starts with a manual trigger and no id', () => {
		const ed = new WorkflowEditor();
		ed.id = 'w1';
		ed.reset('Manual trigger');
		expect(ed.id).toBeNull();
		expect(ed.doc.nodes).toEqual([
			{
				id: 'n1',
				type: 'trigger_manual',
				category: 'trigger',
				label: 'Manual trigger',
				x: 40,
				y: 200,
				config: {}
			}
		]);
	});

	test('Delete removes the selected step, else the selected connection', () => {
		const ed = new WorkflowEditor();
		ed.reset('Start');
		addStep(ed.doc, ed.ids, 'action_script', 300, 200, 'Run');
		const c = connectSteps(ed.doc, ed.ids, 'n1', 'n2');
		ed.selectedWire = c?.id ?? null;
		expect(ed.removeSelected()).toBe(true);
		expect(ed.doc.connections).toEqual([]);
		ed.selectedNode = 'n2';
		expect(ed.removeSelected()).toBe(true);
		expect(ed.doc.nodes.map((n) => n.id)).toEqual(['n1']);
		expect(ed.removeSelected()).toBe(false);
	});

	test('zoom stays between 30 % and 300 %', () => {
		const ed = new WorkflowEditor();
		for (let i = 0; i < 30; i++) ed.zoomBy(0.15);
		expect(ed.view.zoom).toBe(3);
		for (let i = 0; i < 30; i++) ed.zoomBy(-0.15);
		expect(ed.view.zoom).toBe(0.3);
		ed.view = { x: 40, y: 9, zoom: 2 };
		ed.resetView();
		expect(ed.view).toEqual({ x: 0, y: 0, zoom: 1 });
	});

	test('a loaded workflow keeps its id, or the one it was asked for', () => {
		const ed = new WorkflowEditor();
		ed.load({ name: 'No id', nodes: [{ id: 'n4', type: 'result_log' }], connections: [] }, 'w7');
		expect(ed.id).toBe('w7');
		expect(ed.ids.node()).toBe('n5');
	});
});
