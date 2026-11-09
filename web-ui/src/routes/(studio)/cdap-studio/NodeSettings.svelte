<!--
  The settings of the selected node (old renderInspector): its name, its
  type's settings (Yes/No, numbers, choices, code, lists and objects as
  JSON), its connections and Delete node. A change applies when the field
  is left (change event), one undo step each. JSON that doesn't parse is
  refused: the field is marked and the log says why.

  Connections can also be made and removed here, so a flow can be built
  without dragging between ports (keyboard, touch).
-->
<script lang="ts">
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import {
		configFields,
		configLabel,
		fieldText,
		nodeLabel,
		nodePorts,
		nodeSubtitle,
		parseField,
		type Flow,
		type FlowNode,
		type FieldKind
	} from '#lib/canvas/flow.ts';

	interface Props {
		node: FlowNode;
		flow: Flow;
		onlabel: (label: string) => void;
		onconfig: (key: string, value: unknown) => void;
		/** A JSON field didn't parse: the page logs it */
		oninvalid: (key: string) => void;
		onconnect: (fromPort: string, to: string) => void;
		onremovewire: (index: number) => void;
		ondelete: () => void;
	}

	let { node, flow, onlabel, onconfig, oninvalid, onconnect, onremovewire, ondelete }: Props = $props();

	const uid = $props.id();
	const tr = (key: string, fallback: string) => tf(key, fallback);
	const name = (n: FlowNode) => n.label || nodeLabel(n.type, tr);

	const fields = $derived(configFields(node));
	let invalid = $state<Record<string, boolean>>({});
	$effect(() => {
		void node.id;
		invalid = {};
	});

	function change(key: string, kind: FieldKind, text: string) {
		const parsed = parseField(kind, text);
		if (!parsed.ok) {
			invalid = { ...invalid, [key]: true };
			oninvalid(key);
			return;
		}
		invalid = { ...invalid, [key]: false };
		onconfig(key, parsed.value);
	}

	/* ── Connections ── */

	const byId = $derived(new Map(flow.nodes.map((n) => [n.id, n])));
	const incoming = $derived(
		flow.wires.flatMap((w, i) => (w.to === node.id ? [{ i, other: byId.get(w.from), port: w.fromPort }] : []))
	);
	const outgoing = $derived(
		flow.wires.flatMap((w, i) => (w.from === node.id ? [{ i, other: byId.get(w.to), port: w.fromPort }] : []))
	);
	const outPorts = $derived(nodePorts(node.type).filter((p) => p.dir === 'out'));
	const targets = $derived(
		flow.nodes.filter((n) => n.id !== node.id && nodePorts(n.type).some((p) => p.dir === 'in'))
	);
	const portLabel = (port: string) =>
		port === 'pass' ? tf('sdk_studio.port_pass', 'Passed') : tf('sdk_studio.port_out', 'Output');

	let fromPort = $state('out');
	let target = $state('');
	$effect(() => {
		void node.id;
		fromPort = outPorts[0]?.name ?? 'out';
		target = '';
	});
	const targetOptions = $derived([
		{ value: '', label: tf('sdk_studio.connect_choose', 'Choose a node') },
		...targets.map((n) => ({ value: n.id, label: name(n) }))
	]);

	function wireText(w: { other: FlowNode | undefined; port: string }, dir: 'in' | 'out'): string {
		const other = w.other ? name(w.other) : '';
		if (dir === 'in') return tf('sdk_studio.wire_from', 'From {name}', { name: other });
		return outPorts.length > 1
			? tf('sdk_studio.wire_to_port', '{port} to {name}', { port: portLabel(w.port), name: other })
			: tf('sdk_studio.wire_to', 'To {name}', { name: other });
	}
</script>

{#key node.id}
	<div class="node-settings">
		<h3 class="title">
			<span class="title-name">{name(node)}</span>
			<span class="title-kind"><Tag label={nodeSubtitle(node, tr)} /></span>
		</h3>

		<Field label={t('sdk_studio.label')} class="settings-field">
			{#snippet children(f)}<Input
					{...f}
					small
					maxlength={40}
					value={node.label}
					onchange={(e) => onlabel(e.currentTarget.value)}
				/>{/snippet}
		</Field>

		{#if fields.length}
			<h3 class="section">{t('sdk_studio.configuration')}</h3>
			{#each fields as field (field.key)}
				{@const text = fieldText(field)}
				{#if field.kind === 'json'}
					<Field
						label={configLabel(field.key)}
						hint={t('sdk_studio.json_hint')}
						error={invalid[field.key]
							? t('sdk_studio.log_json_invalid', { field: configLabel(field.key) })
							: undefined}
						class="settings-field"
					>
						{#snippet children(f)}<Textarea
								{...f}
								class="mono"
								rows={4}
								spellcheck="false"
								value={text}
								onchange={(e) => change(field.key, field.kind, e.currentTarget.value)}
							/>{/snippet}
					</Field>
				{:else if field.kind === 'code'}
					<Field label={configLabel(field.key)} class="settings-field">
						{#snippet children(f)}<Textarea
								{...f}
								class="mono"
								rows={4}
								spellcheck="false"
								value={text}
								onchange={(e) => change(field.key, field.kind, e.currentTarget.value)}
							/>{/snippet}
					</Field>
				{:else if field.kind === 'boolean'}
					<Field label={configLabel(field.key)} class="settings-field">
						{#snippet children(f)}<Select
								{...f}
								small
								options={[
									{ value: 'true', label: t('common.yes') },
									{ value: 'false', label: t('common.no') }
								]}
								value={text}
								onchange={(e) => change(field.key, field.kind, e.currentTarget.value)}
							/>{/snippet}
					</Field>
				{:else if field.kind === 'select'}
					<Field label={configLabel(field.key)} class="settings-field">
						{#snippet children(f)}<Select
								{...f}
								small
								options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
								value={text}
								onchange={(e) => change(field.key, field.kind, e.currentTarget.value)}
							/>{/snippet}
					</Field>
				{:else}
					<Field label={configLabel(field.key)} class="settings-field">
						{#snippet children(f)}<Input
								{...f}
								small
								type={field.kind === 'number' ? 'number' : 'text'}
								value={text}
								onchange={(e) => change(field.key, field.kind, e.currentTarget.value)}
							/>{/snippet}
					</Field>
				{/if}
			{/each}
		{/if}

		<h3 class="section">{t('sdk_studio.connections')}</h3>
		<p class="muted">
			{t('sdk_studio.connections_line', {
				in: formatNumber(incoming.length),
				out: formatNumber(outgoing.length)
			})}
		</p>
		{#if incoming.length || outgoing.length}
			<ul class="wires">
				{#each [...incoming.map( (w) => ({ ...w, dir: 'in' as const }) ), ...outgoing.map( (w) => ({ ...w, dir: 'out' as const }) )] as w (w.i)}
					<li>
						<span id={`${uid}-wire-${w.i}`}>{wireText(w, w.dir)}</span>
						<Button
							size="sm"
							variant="ghost"
							aria-describedby={`${uid}-wire-${w.i}`}
							onclick={() => onremovewire(w.i)}>{tf('sdk_studio.remove_wire', 'Remove')}</Button
						>
					</li>
				{/each}
			</ul>
		{/if}
		{#if outPorts.length && targets.length}
			<div class="connect">
				{#if outPorts.length > 1}
					<Field label={tf('sdk_studio.connect_from', 'From')} class="settings-field">
						{#snippet children(f)}<Select
								{...f}
								small
								options={outPorts.map((p) => ({ value: p.name, label: portLabel(p.name) }))}
								bind:value={fromPort}
							/>{/snippet}
					</Field>
				{/if}
				<Field label={tf('sdk_studio.connect_to', 'Connect to')} class="settings-field">
					{#snippet children(f)}<Select {...f} small options={targetOptions} bind:value={target} />{/snippet}
				</Field>
				<Button
					size="sm"
					disabled={!target}
					onclick={() => {
						onconnect(fromPort, target);
						target = '';
					}}>{tf('sdk_studio.connect', 'Connect')}</Button
				>
			</div>
		{/if}

		<div class="delete">
			<Button size="sm" variant="danger-quiet" onclick={ondelete}>{t('sdk_studio.delete_node')}</Button>
		</div>
	</div>
{/key}

<style>
	.node-settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.title {
		margin: 0;
		font-size: var(--text-base);
		overflow-wrap: anywhere;
	}
	.title-name {
		display: block;
	}
	.title-kind {
		display: block;
		margin-top: var(--space-1);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.section {
		margin: var(--space-2) 0 0;
		padding-top: var(--space-3);
		border-top: 1px solid var(--rule);
		font-size: var(--text-base);
	}
	.node-settings :global(.settings-field label) {
		font-size: var(--text-sm);
	}
	.node-settings :global(textarea.mono) {
		font-family: var(--mono);
		font-size: var(--text-sm);
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.wires {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.wires li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--control-h-sm);
		border-bottom: 1px solid var(--rule);
		overflow-wrap: anywhere;
	}
	.connect {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.connect :global(.settings-field) {
		align-self: stretch;
	}
	.delete {
		padding-top: var(--space-2);
	}
</style>
