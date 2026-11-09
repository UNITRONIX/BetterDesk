<!--
  Fleet > Workflows (old fleet-builder.js): a workflow chains steps (what
  starts it, conditions, actions, what happens with the result). Steps
  come from the list on the start side (click, Enter or drag), are
  connected from the dot on the right of one step to the dot on the left of
  the next, and set up in the panel on the end side, which shows while a
  step is selected. Toolbar: a saved workflow, New workflow, Export (a
  .json file), Dry run, Run… (asks first) and Save (asks for the name).

  Keys on this tab (not while typing or with a dialog open): Delete or
  Backspace removes the selected step or connection; a double click on a
  connection removes it too.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		executeWorkflow,
		getWorkflow,
		isUnavailable,
		listWorkflows,
		saveWorkflow,
		type WorkflowSummary
	} from '#lib/api/fleet.ts';
	import NodeCanvas, { type PortRef } from '#lib/canvas/NodeCanvas.svelte';
	import type { WorkflowEditor } from '#lib/canvas/workflow-editor.svelte.ts';
	import {
		addStep,
		connectSteps,
		drawnCategory,
		hasInput,
		removeConnection,
		removeStep,
		STEP_DEFS,
		STEP_FIELDS,
		STEP_GROUPS,
		STEP_H,
		STEP_W,
		stepTitle,
		workflowFile,
		type WorkflowNode
	} from '#lib/canvas/workflow.ts';
	import { formatPercent } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import { openLayers } from '#lib/ui/layers.ts';
	import { ICONS } from '#lib/util/display.ts';
	import Filter from './Filter.svelte';
	import OutputSheet from './OutputSheet.svelte';

	interface Props {
		ready: boolean;
		unavailable: boolean;
		noticeId: string;
		editor: WorkflowEditor;
	}

	let { ready, unavailable = $bindable(), noticeId, editor }: Props = $props();

	const uid = $props.id();
	const message = (err: unknown) => (err instanceof Error ? err.message : '');
	const stepName = (type: string) => {
		const def = STEP_DEFS[type];
		return def ? tf(def.key, def.label) : type;
	};
	const untitled = () => t('fleet.untitled');
	const describedby = $derived(unavailable ? noticeId : undefined);

	/* ── Saved workflows ── */

	let saved = $state.raw<WorkflowSummary[]>([]);
	let choice = $state(untrack(() => editor.id ?? ''));

	async function loadList(): Promise<void> {
		if (!ready || unavailable) return;
		try {
			saved = await listWorkflows();
		} catch (err) {
			if (isUnavailable(err)) unavailable = true;
			else editor.say(t('fleet.workflows_failed', { error: message(err) }), 'error');
		}
	}

	$effect(() => {
		void [ready, unavailable];
		untrack(() => void loadList());
	});

	const options = $derived([
		{ value: '', label: t('fleet.select_workflow') },
		...saved.map((w) => ({ value: w.id, label: w.name || w.id }))
	]);

	async function open() {
		const id = choice;
		if (!id) return;
		editor.say(t('fleet.loading_workflow'));
		try {
			editor.load(await getWorkflow(id), id);
			editor.say('');
		} catch (err) {
			editor.say(t('fleet.workflow_load_failed', { error: message(err) }), 'error');
		}
	}

	/* ── Toolbar ── */

	function newWorkflow() {
		editor.reset(stepName('trigger_manual'));
		choice = '';
		editor.say(t('fleet.workflow_new_status'));
	}

	async function save() {
		const name = await prompt({
			title: t('fleet.save_workflow_title'),
			label: t('fleet.workflow_name'),
			value: editor.name || untitled(),
			confirmLabel: t('fleet.save')
		});
		if (name === null) return;
		if (!name.trim()) {
			editor.say(t('fleet.name_required'), 'error');
			return;
		}
		editor.name = name.trim();
		editor.say(t('fleet.saving'));
		try {
			const doc = $state.snapshot(editor.doc);
			const id = await saveWorkflow(editor.id, {
				name: editor.name,
				nodes: doc.nodes,
				connections: doc.connections
			});
			if (id) editor.id = id;
			editor.say(t('fleet.workflow_saved', { name: editor.name }), 'ok');
			await loadList();
			if (editor.id) choice = editor.id;
		} catch (err) {
			editor.say(t('fleet.save_failed', { error: message(err) }), 'error');
		}
	}

	function exportFile() {
		const file = workflowFile(editor.name || untitled(), $state.snapshot(editor.doc));
		const url = URL.createObjectURL(new Blob([file.text], { type: 'application/json' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = file.fileName;
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	let result = $state<{ dryRun: boolean; text: string } | null>(null);

	async function run(dryRun: boolean) {
		if (!editor.id && !editor.doc.nodes.length) {
			editor.say(t('fleet.workflow_empty'), 'error');
			return;
		}
		const name = editor.name || untitled();
		if (!dryRun) {
			const ok = await confirm({
				title: t('fleet.run_title'),
				message: t('fleet.run_message', { name }),
				confirmLabel: t('fleet.execute'),
				confirmIcon: ICONS.run
			});
			if (!ok) return;
		}
		editor.say(dryRun ? t('fleet.dry_running') : t('fleet.running'));
		try {
			const doc = $state.snapshot(editor.doc);
			const output = await executeWorkflow(editor.id || 'draft', {
				dry_run: dryRun,
				nodes: doc.nodes,
				connections: doc.connections
			});
			editor.say(dryRun ? t('fleet.dry_run_done') : t('fleet.run_started'), 'ok');
			if (output) result = { dryRun, text: output };
		} catch (err) {
			editor.say(t('fleet.run_failed', { error: message(err) }), 'error');
		}
	}

	/* ── Canvas ── */

	let canvas = $state<ReturnType<typeof NodeCanvas<WorkflowNode>> | null>(null);
	const wires = $derived(
		editor.doc.connections.map((c) => ({ key: c.id, from: c.from, fromPort: 'out', to: c.to, toPort: 'in' }))
	);
	const selected = $derived(editor.doc.nodes.find((n) => n.id === editor.selectedNode) ?? null);

	function add(type: string, x: number, y: number) {
		const node = addStep(editor.doc, editor.ids, type, x, y, stepName(type));
		if (node) {
			editor.selectedNode = node.id;
			editor.selectedWire = null;
		}
	}

	/** Click or Enter in the step list: in the middle of the visible canvas, a little apart from the last one */
	function addAtCentre(type: string) {
		const c = canvas?.centre() ?? { x: 0, y: 0 };
		const offset = (editor.doc.nodes.length % 5) * 24;
		add(type, c.x - STEP_W / 2 + offset, c.y - STEP_H / 2 + offset);
	}

	function onconnect(a: PortRef, b: PortRef) {
		if (a.dir === 'out' && b.dir === 'in') connectSteps(editor.doc, editor.ids, a.node, b.node);
	}

	function onmove(id: string, x: number, y: number) {
		const n = editor.doc.nodes.find((q) => q.id === id);
		if (n) {
			n.x = x;
			n.y = y;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (openLayers() > 0 || e.ctrlKey || e.metaKey) return;
		const el = e.target instanceof HTMLElement ? e.target : null;
		if (el && (el.matches('input, textarea, select') || el.isContentEditable)) return;
		if (editor.removeSelected()) e.preventDefault();
	}

	/* ── Step settings ── */

	function setLabel(node: WorkflowNode, value: string) {
		node.label = value;
	}

	function setConfig(node: WorkflowNode, key: string, value: string) {
		node.config[key] = value;
	}

	const targets = $derived(
		selected ? editor.doc.nodes.filter((n) => n.id !== selected.id && hasInput(n)) : []
	);
	let target = $state('');
	$effect(() => {
		void editor.selectedNode;
		target = '';
	});
	const incoming = $derived(selected ? editor.doc.connections.filter((c) => c.to === selected.id) : []);
	const outgoing = $derived(selected ? editor.doc.connections.filter((c) => c.from === selected.id) : []);
	const labelOf = (id: string) => editor.doc.nodes.find((n) => n.id === id)?.label ?? id;
</script>

<svelte:document {onkeydown} />

{#snippet stepBody(n: WorkflowNode)}
	{@const cat = drawnCategory(n)}
	<rect
		class={['step-body', editor.selectedNode === n.id && 'is-selected']}
		width={STEP_W}
		height={STEP_H}
		rx="3"
	/>
	<rect class={['step-header', `is-${n.category}`]} width={STEP_W} height="22" rx="3" />
	<circle class={['step-dot', `is-${cat}`]} cx="12" cy="11" r="4" />
	<text class="step-title" x="22" y="11">{stepTitle(n.label)}</text>
{/snippet}

<p class="note">{t('fleet.builder_note')}</p>
<Toolbar>
	<Filter
		label={t('fleet.workflow_label')}
		{options}
		bind:value={choice}
		disabled={unavailable}
		{describedby}
		onchange={() => void open()}
	/>
	<Button icon={ICONS.add} onclick={newWorkflow}>{t('fleet.new_workflow')}</Button>
	{#snippet end()}
		<Button icon={ICONS.download} onclick={exportFile}>{t('fleet.export')}</Button>
		<Button
			icon={ICONS.run}
			disabled={unavailable}
			aria-describedby={describedby}
			onclick={() => void run(true)}>{t('fleet.dry_run')}</Button
		>
		<Button
			icon={ICONS.run}
			disabled={unavailable}
			aria-describedby={describedby}
			onclick={() => void run(false)}>{t('fleet.execute')}</Button
		>
		<Button
			variant="primary"
			disabled={unavailable}
			aria-describedby={describedby}
			onclick={() => void save()}>{t('fleet.save')}</Button
		>
	{/snippet}
</Toolbar>
<FormStatus message={editor.status.text} tone={editor.status.tone} />

<div class={['builder', selected && 'has-props']}>
	<nav class="palette" aria-label={t('fleet.palette_label')}>
		<p class="palette-hint">{t('fleet.palette_hint')}</p>
		{#each STEP_GROUPS as group (group.cat)}
			<div class="palette-group">
				<h3><span class={['dot', `is-${group.cat}`]} aria-hidden="true"></span>{t(group.key)}</h3>
				{#each group.types as type (type)}
					<button
						type="button"
						class="palette-step"
						draggable="true"
						ondragstart={(e) => e.dataTransfer?.setData('text/plain', type)}
						onclick={() => addAtCentre(type)}>{stepName(type)}</button
					>
				{/each}
			</div>
		{/each}
	</nav>

	<NodeCanvas
		bind:this={canvas}
		class="builder-canvas"
		nodes={editor.doc.nodes}
		{wires}
		nodeW={STEP_W}
		nodeH={STEP_H}
		ports={(n) => [
			...(hasInput(n) ? [{ name: 'in', dir: 'in' as const, x: 0, y: STEP_H / 2 }] : []),
			{ name: 'out', dir: 'out' as const, x: STEP_W, y: STEP_H / 2 }
		]}
		wireEnd={(n, port) =>
			port === 'out' ? { x: n.x + STEP_W, y: n.y + STEP_H / 2 } : { x: n.x, y: n.y + STEP_H / 2 }}
		bind:view={editor.view}
		minZoom={0.3}
		maxZoom={3}
		wheelZoom={(z, dy) => z + (dy > 0 ? -0.08 : 0.08)}
		bend={0.4}
		arrow
		bind:selectedNode={editor.selectedNode}
		bind:selectedWire={editor.selectedWire}
		label={t('fleet.canvas_label')}
		nodeName={(n) => `${n.label}, ${tf(STEP_GROUPS.find((g) => g.cat === drawnCategory(n))?.key ?? '', '')}`}
		node={stepBody}
		accepts={(type) => !!STEP_DEFS[type]}
		ondrop={(type, at) => add(type, at.x - STEP_W / 2, at.y - STEP_H / 2)}
		{onconnect}
		{onmove}
		onwiredblclick={(key) => {
			removeConnection(editor.doc, key);
			if (editor.selectedWire === key) editor.selectedWire = null;
		}}
	>
		<div class="zoom" role="group" aria-label={t('fleet.zoom_label')}>
			<Button size="sm" onclick={() => editor.zoomBy(-0.15)}>{t('fleet.zoom_out')}</Button>
			<span class="zoom-level">{formatPercent(editor.view.zoom, { fraction: true })}</span>
			<Button size="sm" onclick={() => editor.zoomBy(0.15)}>{t('fleet.zoom_in')}</Button>
			<Button size="sm" onclick={() => editor.resetView()}>{t('fleet.zoom_reset')}</Button>
		</div>
	</NodeCanvas>

	{#if selected}
		<aside class="props" aria-labelledby={`${uid}-props-title`}>
			<div class="props-head">
				<h3 id={`${uid}-props-title`}>{selected.label || stepName(selected.type)}</h3>
				<IconButton icon="close" label={t('fleet.close')} onclick={() => (editor.selectedNode = null)} />
			</div>
			{#key selected.id}
				<div class="props-body">
					<Field label={tf('fleet.prop_label', 'Name')}>
						{#snippet children(f)}<Input
								{...f}
								value={selected.label}
								onchange={(e) => setLabel(selected, e.currentTarget.value)}
							/>{/snippet}
					</Field>
					{#each STEP_FIELDS[selected.type] ?? [] as field (field.key)}
						<Field label={tf(`fleet.prop_${field.key}`, field.label)}>
							{#snippet children(f)}
								{#if field.kind === 'select'}
									<Select
										{...f}
										options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
										value={selected.config[field.key] || field.options?.[0] || ''}
										onchange={(e) => setConfig(selected, field.key, e.currentTarget.value)}
									/>
								{:else if field.kind === 'script'}
									<Textarea
										{...f}
										class="mono"
										rows={5}
										spellcheck="false"
										value={selected.config[field.key] ?? ''}
										onchange={(e) => setConfig(selected, field.key, e.currentTarget.value)}
									/>
								{:else}
									<Input
										{...f}
										class={field.mono ? 'mono' : ''}
										placeholder={field.placeholder}
										value={selected.config[field.key] ?? ''}
										onchange={(e) => setConfig(selected, field.key, e.currentTarget.value)}
									/>
								{/if}
							{/snippet}
						</Field>
					{/each}

					<div class="props-wires">
						<h4>{tf('fleet.prop_connections', 'Connections')}</h4>
						{#if incoming.length || outgoing.length}
							<ul>
								{#each [...incoming.map( (c) => ({ c, text: tf( 'fleet.prop_from', 'From {name}', { name: labelOf(c.from) } ) }) ), ...outgoing.map( (c) => ({ c, text: tf( 'fleet.prop_to', 'To {name}', { name: labelOf(c.to) } ) }) )] as w (w.c.id)}
									<li>
										<span id={`${uid}-wire-${w.c.id}`}>{w.text}</span>
										<Button
											size="sm"
											variant="ghost"
											aria-describedby={`${uid}-wire-${w.c.id}`}
											onclick={() => removeConnection(editor.doc, w.c.id)}
											>{tf('fleet.prop_remove_connection', 'Remove')}</Button
										>
									</li>
								{/each}
							</ul>
						{:else}
							<p class="muted">{tf('fleet.prop_no_connections', 'Not connected yet.')}</p>
						{/if}
						{#if targets.length}
							<Field label={tf('fleet.prop_connect_to', 'Connect to')}>
								{#snippet children(f)}<Select
										{...f}
										options={[
											{ value: '', label: tf('fleet.prop_choose_step', 'Choose a step') },
											...targets.map((n) => ({ value: n.id, label: n.label || stepName(n.type) }))
										]}
										bind:value={target}
									/>{/snippet}
							</Field>
							<Button
								size="sm"
								disabled={!target}
								onclick={() => {
									connectSteps(editor.doc, editor.ids, selected.id, target);
									target = '';
								}}>{tf('fleet.prop_connect', 'Connect')}</Button
							>
						{/if}
					</div>

					<div class="props-delete">
						<Button
							size="sm"
							variant="danger-quiet"
							onclick={() => {
								removeStep(editor.doc, selected.id);
								editor.selectedNode = null;
							}}>{tf('fleet.prop_delete', 'Remove step')}</Button
						>
					</div>
				</div>
			{/key}
		</aside>
	{/if}
</div>

{#if result}
	{@const r = result}
	<OutputSheet
		title={r.dryRun ? t('fleet.dry_run_result') : t('fleet.run_result')}
		subtitle={r.dryRun
			? t('fleet.dry_run_done')
			: t('fleet.run_output_desc', { name: editor.name || untitled() })}
		text={r.text}
		onclose={() => (result = null)}
	/>
{/if}

<style>
	.note {
		margin: 0;
		color: var(--text-muted);
	}

	/* Step list, canvas, step settings; without a selected step the canvas takes the third column too */
	.builder {
		--cat-trigger: var(--accent);
		--cat-condition: var(--warning);
		--cat-action: var(--success);
		--cat-result: var(--danger);
		--cat-transform: var(--info);
		display: grid;
		grid-template-columns: minmax(170px, 210px) minmax(0, 1fr);
		gap: var(--space-4);
		min-height: 500px;
	}
	.builder.has-props {
		grid-template-columns: minmax(170px, 210px) minmax(0, 1fr) minmax(220px, 280px);
	}
	.palette {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.palette-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.palette-group h3 {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin: 0 0 var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.palette-step {
		display: flex;
		align-items: center;
		width: calc(100% + var(--space-2));
		min-height: var(--control-h-sm);
		margin-inline-start: calc(-1 * var(--space-2));
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: grab;
	}
	.palette-step:hover {
		background: var(--hover);
	}
	.palette-step:active {
		cursor: grabbing;
	}
	.palette-step:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.dot {
		display: inline-block;
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	.dot.is-trigger {
		background: var(--cat-trigger);
	}
	.dot.is-condition {
		background: var(--cat-condition);
	}
	.dot.is-action {
		background: var(--cat-action);
	}
	.dot.is-result {
		background: var(--cat-result);
	}
	.dot.is-transform {
		background: var(--cat-transform);
	}

	/* The canvas: the editor needs its own area */
	.builder :global(.builder-canvas) {
		height: 500px;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}
	.zoom {
		position: absolute;
		inset-block-end: var(--space-2);
		inset-inline-end: var(--space-2);
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.zoom-level {
		min-width: 5ch;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		text-align: center;
	}
	.step-body {
		fill: var(--bg-float);
		stroke: var(--border);
		stroke-width: 1;
	}
	.builder :global(.node:hover > .step-body),
	.step-body.is-selected {
		stroke: var(--accent);
		stroke-width: 2;
	}
	.step-header.is-trigger {
		fill: color-mix(in srgb, var(--cat-trigger) 16%, transparent);
	}
	.step-header.is-condition {
		fill: color-mix(in srgb, var(--cat-condition) 16%, transparent);
	}
	.step-header.is-action {
		fill: color-mix(in srgb, var(--cat-action) 16%, transparent);
	}
	.step-header.is-result {
		fill: color-mix(in srgb, var(--cat-result) 16%, transparent);
	}
	.step-header.is-transform {
		fill: color-mix(in srgb, var(--cat-transform) 16%, transparent);
	}
	.step-header {
		fill: transparent;
	}
	.step-dot.is-trigger {
		fill: var(--cat-trigger);
	}
	.step-dot.is-condition {
		fill: var(--cat-condition);
	}
	.step-dot.is-action {
		fill: var(--cat-action);
	}
	.step-dot.is-result {
		fill: var(--cat-result);
	}
	.step-dot.is-transform {
		fill: var(--cat-transform);
	}
	.step-title {
		fill: var(--text);
		font-family: var(--font);
		font-size: 12px;
		font-weight: 600;
		dominant-baseline: central;
		pointer-events: none;
	}

	/* Settings of the selected step */
	.props {
		min-width: 0;
		padding-inline-start: var(--space-4);
		border-inline-start: 1px solid var(--rule);
	}
	.props-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}
	.props-head h3 {
		margin: 0;
		margin-inline-end: auto;
		font-size: var(--text-md);
		overflow-wrap: anywhere;
	}
	.props-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.props-body :global(textarea.mono),
	.props-body :global(input.mono) {
		font-family: var(--mono);
	}
	.props-wires {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
	}
	.props-wires > :global(*) {
		align-self: stretch;
	}
	.props-wires > :global(.btn) {
		align-self: flex-start;
	}
	.props-wires h4 {
		margin: 0;
		font-size: var(--text-base);
	}
	.props-wires ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.props-wires li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--control-h-sm);
		border-bottom: 1px solid var(--rule);
		overflow-wrap: anywhere;
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.props-delete {
		padding-top: var(--space-2);
	}

	@media (max-width: 1100px) {
		.builder,
		.builder.has-props {
			grid-template-columns: minmax(160px, 200px) minmax(0, 1fr);
		}
		.props {
			grid-column: 1 / -1;
			padding-inline-start: 0;
			padding-top: var(--space-3);
			border-inline-start: 0;
			border-top: 1px solid var(--rule);
		}
	}
	@media (max-width: 767px) {
		.builder,
		.builder.has-props {
			grid-template-columns: minmax(0, 1fr);
			min-height: 0;
		}
		.palette {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			gap: var(--space-3);
		}
		.palette-hint {
			grid-column: 1 / -1;
		}
		.builder :global(.builder-canvas) {
			height: 360px;
		}
	}
	@media (pointer: coarse) {
		.palette-step {
			min-height: var(--control-h);
		}
	}
</style>
