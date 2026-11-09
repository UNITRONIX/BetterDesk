<!--
  Tags of one or more devices. Each tag is a checkbox: ticked means every
  chosen device gets it, cleared means it comes off all of them. A tag only
  some of the devices have starts half-ticked (left as it is) and comes
  back to that state on the third click. New tags are added with the field.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import type { DeviceLike } from '../model.ts';

	type State = 'all' | 'some' | 'none';
	interface Row {
		tag: string;
		/** How many of the devices have it now */
		have: number;
		state: State;
	}

	let {
		devices,
		known,
		settle
	}: {
		devices: DeviceLike[];
		known: string[];
		settle: (answer: { add: string[]; remove: string[] } | null) => void;
	} = $props();

	const formId = $props.id();
	const listId = `${formId}-known`;
	const total = $derived(devices.length);

	function initialRows(list: DeviceLike[]): Row[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local count, not state
		const count = new Map<string, number>();
		for (const d of list) for (const tag of d.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
		return [...count.entries()]
			.sort((a, b) => a[0].localeCompare(b[0]))
			.map(([tag, have]) => ({ tag, have, state: have === list.length ? 'all' : 'some' }));
	}

	let rows = $state<Row[]>(untrack(() => initialRows(devices)));
	let input = $state('');
	let inputError = $state('');

	const suggestions = $derived(
		known.filter((k) => !rows.some((r) => r.tag.toLowerCase() === k.toLowerCase()))
	);

	/** Adds what is typed (commas split it); false when a tag is too long */
	function addTyped(): boolean {
		const parts = input
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (!parts.length) return true;
		for (const tag of parts) {
			if (tag.length > 50) {
				inputError = tf('devices.tag_too_long', 'A tag can have at most 50 characters.');
				return false;
			}
			const row = rows.find((r) => r.tag.toLowerCase() === tag.toLowerCase());
			if (row) row.state = 'all';
			else rows.push({ tag, have: 0, state: 'all' });
		}
		input = '';
		inputError = '';
		return true;
	}

	function cycle(row: Row) {
		const mixed = row.have > 0 && row.have < total;
		if (row.state === 'some') row.state = 'all';
		else if (row.state === 'all') row.state = 'none';
		else row.state = mixed ? 'some' : 'all';
	}

	function onInputKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addTyped();
		}
	}

	function submit(e: SubmitEvent) {
		e.preventDefault();
		// A tag typed but not added yet is meant to be saved too
		if (!addTyped()) return;
		settle({
			add: rows.filter((r) => r.state === 'all' && r.have < total).map((r) => r.tag),
			remove: rows.filter((r) => r.state === 'none' && r.have > 0).map((r) => r.tag)
		});
	}

	function sub(row: Row): string | undefined {
		if (total === 1) return undefined;
		return tf('devices.tag_on_count', 'On {count} of {total}', { count: row.have, total });
	}
</script>

<Dialog
	title={total === 1
		? t('devices.manage_device_tags')
		: tf('devices.bulk_tags_title', 'Tags of {count} devices', { count: total })}
	onclose={() => settle(null)}
>
	<form id={formId} onsubmit={submit} novalidate>
		{#if total === 1}
			<p class="for mono">{devices[0]?.id}</p>
		{/if}
		<fieldset>
			<legend>{t('devices.tags')}</legend>
			<p class="hint">
				{total === 1
					? t('devices.tags_device_hint')
					: tf(
							'devices.bulk_tags_hint',
							'Ticked tags go on every chosen device, cleared ones come off. Half-ticked tags stay as they are.'
						)}
			</p>
			<ul class="pick">
				{#each rows as row (row.tag)}
					<li>
						<Checkbox
							label={row.tag}
							hint={sub(row)}
							checked={row.state === 'all'}
							indeterminate={row.state === 'some'}
							onclick={(e: MouseEvent) => {
								e.preventDefault();
								cycle(row);
							}}
						/>
					</li>
				{:else}
					<li class="empty">{t('device_detail.no_tags')}</li>
				{/each}
			</ul>
		</fieldset>
		<Field label={t('devices.add_tag_label')} hint={t('devices.add_tag_hint')} error={inputError}>
			{#snippet children(f)}
				<div class="add-row">
					<Input
						{...f}
						bind:value={input}
						list={listId}
						maxlength={200}
						autocomplete="off"
						onkeydown={onInputKey}
						oninput={() => (inputError = '')}
					/>
					<datalist id={listId}>
						{#each suggestions as s (s)}<option value={s}></option>{/each}
					</datalist>
					<Button icon={ICONS.add} onclick={addTyped}>{t('device_detail.add_tag')}</Button>
				</div>
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={formId}>{t('actions.save')}</Button>
	{/snippet}
</Dialog>

<style>
	.for {
		margin: 0 0 var(--space-3);
		color: var(--text-muted);
	}
	fieldset {
		min-width: 0;
		margin: 0 0 var(--space-4);
		padding: 0;
		border: 0;
	}
	legend {
		padding: 0;
		font-weight: 600;
	}
	.hint {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.pick {
		max-height: 18rem;
		margin: var(--space-2) 0 0;
		overflow-y: auto;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.pick > li {
		border-bottom: 1px solid var(--rule);
	}
	.pick > li > :global(.check-field) {
		padding-block: var(--row-pad-y);
	}
	.pick .empty {
		padding: var(--row-pad-y) 0;
		color: var(--text-muted);
	}
	.add-row {
		display: flex;
		gap: var(--space-2);
	}
	.add-row > :global(input) {
		flex: 1;
		min-width: 0;
	}
</style>
