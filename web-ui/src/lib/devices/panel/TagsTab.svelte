<!--
  Tags and notes: tags change right away (add with the button or Enter,
  remove per tag); the note saves with its own button. Read-only without
  device.edit. Removing a tag here takes it off this device only.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { addTag, removeTag, saveNote } from '../actions.svelte.ts';
	import type { PanelData } from '../panel-data.svelte.ts';
	import { hasTag, TAG_MAX, type PanelDevice } from '../panel-logic.ts';
	import PanelSection from './PanelSection.svelte';

	let { device, data }: { device: PanelDevice; data: PanelData } = $props();

	const uid = $props.id();
	const editable = $derived(!device.soft_deleted && can('device.edit'));
	const tags = $derived(device.tags ?? []);
	const suggestions = $derived(data.tags.filter((x) => x && !hasTag(tags, x)));

	let input = $state('');
	let inputError = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let busy = $state<string | null>(null);
	// The note as typed; follows the device until someone types
	let note = $state<string | null>(null);
	const noteValue = $derived(note ?? device.note ?? '');

	$effect(() => {
		if (editable) void data.loadTags();
	});

	async function add() {
		const tag = input.trim();
		if (!tag || busy) return;
		if (hasTag(tags, tag)) {
			inputError = t('device_detail.tag_exists');
			return;
		}
		busy = 'add';
		try {
			if (await addTag(device, tag)) {
				data.rememberTags([tag]);
				input = '';
			}
		} finally {
			busy = null;
			inputEl?.focus();
		}
	}

	async function remove(tag: string) {
		if (busy) return;
		busy = `rm:${tag}`;
		try {
			await removeTag(device, tag);
		} finally {
			busy = null;
			inputEl?.focus();
		}
	}

	async function save() {
		if (busy) return;
		busy = 'note';
		try {
			if (await saveNote(device, noteValue)) note = null;
		} finally {
			busy = null;
		}
	}
</script>

<PanelSection
	title={t('device_detail.tags')}
	note={editable ? t('device_detail.tags_unassign_hint') : undefined}
>
	{#if editable}
		<RowList label={t('device_detail.tags')}>
			{#each tags as tag (tag)}
				<ListRow title={tag}>
					{#snippet actions()}
						<Button
							size="sm"
							aria-label="{t('devices.unassign_tag')}: {tag}"
							busy={busy === `rm:${tag}`}
							onclick={() => remove(tag)}>{t('actions.remove')}</Button
						>
					{/snippet}
				</ListRow>
			{:else}
				<ListRow title={t('device_detail.no_tags')} empty />
			{/each}
		</RowList>
		<Field
			label={t('devices.add_tag_label')}
			hint={t('devices.add_tag_hint')}
			error={inputError || undefined}
		>
			{#snippet children(f)}
				<div class="dp-tag-row">
					<Input
						{...f}
						bind:element={inputEl}
						bind:value={input}
						list="{uid}-suggestions"
						maxlength={TAG_MAX}
						autocomplete="off"
						oninput={() => (inputError = '')}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								void add();
							}
						}}
					/>
					<Button icon="add" busy={busy === 'add'} onclick={add}>{t('device_detail.add_tag')}</Button>
				</div>
				<datalist id="{uid}-suggestions">
					{#each suggestions as s (s)}<option value={s}></option>{/each}
				</datalist>
			{/snippet}
		</Field>
	{:else}
		<TagSet {tags} empty={t('device_detail.no_tags')} />
	{/if}
</PanelSection>

<PanelSection title={t('device_detail.notes')}>
	{#if editable}
		<Textarea
			aria-label={t('device_detail.notes')}
			rows={4}
			maxlength={512}
			value={noteValue}
			oninput={(e: Event) => (note = (e.currentTarget as HTMLTextAreaElement).value)}
		/>
		<div><Button size="sm" busy={busy === 'note'} onclick={save}>{t('actions.save')}</Button></div>
	{:else if device.note}
		<p class="dp-note">{device.note}</p>
	{:else}
		<p class="dp-muted">{t('device_detail.no_notes')}</p>
	{/if}
</PanelSection>

<style>
	.dp-tag-row {
		display: flex;
		gap: var(--space-2);
	}
	.dp-tag-row > :global(.form-input) {
		flex: 1;
		min-width: 0;
	}
	.dp-note {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
	}
</style>
