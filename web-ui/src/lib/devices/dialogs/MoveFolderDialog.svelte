<!--
  Move one or more devices to a folder (or out of any folder).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { Folder } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { ICONS } from '#lib/util/display.ts';

	let {
		count,
		folders,
		current,
		settle
	}: { count: number; folders: Folder[]; current: number | null; settle: (folderId: number | null) => void } =
		$props();

	const formId = $props.id();
	let value = $state<number>(untrack(() => current ?? 0));
	const options = $derived([
		{ value: 0, label: t('folders.unassigned') },
		...folders.map((f) => ({ value: f.id, label: f.name }))
	]);

	function submit(e: SubmitEvent) {
		e.preventDefault();
		settle(Number(value) || 0);
	}
</script>

<Dialog
	title={count === 1
		? tf('devices.move_to_folder', 'Move to folder')
		: tf('devices.move_many_to_folder', 'Move {count} devices to a folder', { count })}
	onclose={() => settle(null)}
>
	<form id={formId} onsubmit={submit} novalidate>
		<Field label={t('folders.title')} hint={t('devices.folder_hint')}>
			{#snippet children(f)}
				<Select {...f} width="medium" {options} bind:value />
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={formId} icon={ICONS.folder}
			>{tf('devices.move', 'Move')}</Button
		>
	{/snippet}
</Dialog>
