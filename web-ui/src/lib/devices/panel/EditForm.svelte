<!--
  The device panel in edit mode: display name, user, note, folder and tags
  as fields at the top of Overview. The footer's Save submits this form
  (form={form.id}), so Enter in the name or user field saves; Enter in the
  tag field adds the tag. A tag typed but not added is saved with the rest;
  one the device has already is refused next to the field.
-->
<script lang="ts">
	import type { Folder } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import type { Form } from '#lib/ui/form.svelte.ts';
	import { hasTag, TAG_MAX, type EditValues } from '../panel-logic.ts';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		form: Form<EditValues>;
		/** null while loading; the folder field shows once there are folders */
		folders: Folder[] | null;
		knownTags: readonly string[];
		onsubmit: () => void;
	}

	let { form, folders, knownTags, onsubmit }: Props = $props();

	const uid = $props.id();
	const listId = `${uid}-tags`;
	let tagField = $state<HTMLInputElement | null>(null);

	const suggestions = $derived(knownTags.filter((x) => x && !hasTag(form.values.tags, x)));
	const folderOptions = $derived([
		{ value: '', label: t('folders.unassigned') },
		...(folders ?? []).map((f) => ({ value: String(f.id), label: f.name }))
	]);

	function addTag() {
		const tag = form.values.tagInput.trim();
		if (!tag) return;
		if (hasTag(form.values.tags, tag)) {
			form.setError('tagInput', t('device_detail.tag_exists'));
			return;
		}
		form.values.tags = [...form.values.tags, tag];
		form.values.tagInput = '';
		tagField?.focus();
	}

	function removeTag(tag: string) {
		form.values.tags = form.values.tags.filter((x) => x !== tag);
		tagField?.focus();
	}

	function submit(event: SubmitEvent) {
		event.preventDefault();
		onsubmit();
	}
</script>

<form id={form.id} class="dp-edit" novalidate onsubmit={submit}>
	<PanelSection title={t('device_detail.edit_heading')}>
		<div class="dp-edit-fields">
			<Field
				label={t('devices.display_name')}
				hint={t('devices.display_name_hint')}
				error={form.errors.display_name}
			>
				{#snippet children(f)}
					<Input
						{...f}
						maxlength={128}
						autocomplete="off"
						data-autofocus
						bind:value={form.values.display_name}
					/>
				{/snippet}
			</Field>
			<Field
				label={t('devices.username')}
				hint={tf(
					'device_detail.user_hint',
					'Shown in the list. The device replaces it when it reports who is signed in.'
				)}
				error={form.errors.user}
				width="medium"
			>
				{#snippet children(f)}
					<Input {...f} maxlength={128} autocomplete="off" spellcheck={false} bind:value={form.values.user} />
				{/snippet}
			</Field>
			<Field label={t('devices.note')} error={form.errors.note}>
				{#snippet children(f)}
					<Textarea {...f} rows={3} maxlength={512} bind:value={form.values.note} />
				{/snippet}
			</Field>
			{#if folders?.length}
				<Field label={t('device_detail.folder')} width="medium">
					{#snippet children(f)}
						<Select {...f} options={folderOptions} bind:value={form.values.folder} />
					{/snippet}
				</Field>
			{/if}
			<div class="dp-field">
				<span class="dp-label" id="{uid}-tags-label">{t('device_detail.tags')}</span>
				<p class="dp-hint">{t('devices.tags_device_hint')}</p>
				<div class="dp-edit-tags" role="group" aria-labelledby="{uid}-tags-label">
					<RowList>
						{#each form.values.tags as tag (tag)}
							<ListRow title={tag}>
								{#snippet actions()}
									<Button size="sm" aria-label="{t('actions.remove')}: {tag}" onclick={() => removeTag(tag)}
										>{t('actions.remove')}</Button
									>
								{/snippet}
							</ListRow>
						{:else}
							<ListRow title={t('device_detail.no_tags')} empty />
						{/each}
					</RowList>
				</div>
			</div>
			<Field label={t('devices.add_tag_label')} hint={t('devices.add_tag_hint')} error={form.errors.tagInput}>
				{#snippet children(f)}
					<div class="dp-tag-row">
						<Input
							{...f}
							bind:element={tagField}
							bind:value={form.values.tagInput}
							list={listId}
							maxlength={TAG_MAX}
							autocomplete="off"
							onkeydown={(e: KeyboardEvent) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addTag();
								}
							}}
						/>
						<Button icon="add" onclick={addTag}>{t('device_detail.add_tag')}</Button>
					</div>
					<datalist id={listId}>
						{#each suggestions as s (s)}<option value={s}></option>{/each}
					</datalist>
				{/snippet}
			</Field>
		</div>
	</PanelSection>
	<!-- Enter in the name or user field saves (the footer's Save is outside the form) -->
	<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
</form>

<style>
	/* Fields as a block: Field's own bottom margin spaces them */
	.dp-edit-fields {
		display: block;
	}
	.dp-field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.dp-label {
		font-weight: 600;
	}
	.dp-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-edit-tags {
		margin-top: var(--space-1);
	}
	.dp-tag-row {
		display: flex;
		gap: var(--space-2);
	}
	.dp-tag-row > :global(.form-input) {
		flex: 1;
		min-width: 0;
	}
</style>
