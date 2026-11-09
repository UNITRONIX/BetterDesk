/**
 * The fleet workflow being edited, kept by the Fleet page so it survives
 * switching tabs (the old page only hid the builder's panel). The builder
 * component draws and changes it.
 */

import type { View } from './geometry.ts';
import { addStep, Ids, normalizeWorkflow, removeConnection, removeStep, type Workflow } from './workflow.ts';

export type StatusTone = 'neutral' | 'ok' | 'error';

export class WorkflowEditor {
	doc = $state<Workflow>({ nodes: [], connections: [] });
	/** The saved workflow's id; null for one never saved */
	id = $state<string | null>(null);
	name = $state('');
	view = $state<View>({ x: 0, y: 0, zoom: 1 });
	selectedNode = $state<string | null>(null);
	selectedWire = $state<string | null>(null);
	/** The line under the toolbar: what the last action did */
	status = $state<{ text: string; tone: StatusTone }>({ text: '', tone: 'neutral' });
	ids = new Ids();

	say(text: string, tone: StatusTone = 'neutral'): void {
		this.status = { text, tone };
	}

	/** A new workflow with a manual trigger, as before */
	reset(triggerLabel: string): void {
		this.doc = { nodes: [], connections: [] };
		this.ids = new Ids();
		this.id = null;
		this.name = '';
		this.selectedNode = null;
		this.selectedWire = null;
		addStep(this.doc, this.ids, 'trigger_manual', 40, 200, triggerLabel);
	}

	/** A saved workflow from the server */
	load(raw: unknown, fallbackId: string): void {
		const wf = normalizeWorkflow(raw);
		this.doc = { nodes: wf.nodes, connections: wf.connections };
		this.id = wf.id || fallbackId;
		this.name = wf.name;
		this.ids.resetFor(this.doc);
		this.selectedNode = null;
		this.selectedWire = null;
	}

	removeSelected(): boolean {
		if (this.selectedNode) {
			removeStep(this.doc, this.selectedNode);
			this.selectedNode = null;
			return true;
		}
		if (this.selectedWire) {
			removeConnection(this.doc, this.selectedWire);
			this.selectedWire = null;
			return true;
		}
		return false;
	}

	zoomBy(delta: number): void {
		this.view = { ...this.view, zoom: Math.max(0.3, Math.min(3, this.view.zoom + delta)) };
	}

	resetView(): void {
		this.view = { x: 0, y: 0, zoom: 1 };
	}
}
