<!--
  A file from the file browser in a wide sheet: its path, size and kind,
  the content in a monospace text area, Save file. Binary files and files
  cut off at 256 KB open read-only, without Save. After a save the sheet
  stays open with "File saved" in its status line (people save, check and
  edit again); closing with unsaved changes asks first.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { writeFile, type FileContent } from '#lib/api/serverManagement.ts';
	import { formatBytes } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm } from '#lib/ui/form.svelte.ts';

	let {
		file,
		requested,
		onclose,
		onsaved
	}: { file: FileContent; requested: string; onclose: () => void; onsaved: () => void } = $props();

	const uid = $props.id();
	const path = $derived(file.path || requested);
	const binary = $derived(file.isBinary || file.binary);
	const readOnly = $derived(binary || file.truncated);
	const meta = $derived(
		t(binary ? 'server_mgmt.file_meta_binary' : 'server_mgmt.file_meta_text', {
			size: formatBytes(file.size ?? 0) || '0 B'
		}) + (!binary && file.truncated ? ' ' + t('server_mgmt.file_meta_truncated') : '')
	);

	const form = createForm({
		initial: untrack(() => ({ content: file.content })),
		submit: async (v) => {
			if (readOnly) return;
			try {
				await writeFile(path, v.content);
			} catch (err) {
				throw new Error(
					t('server_mgmt.save_failed_reason', { error: err instanceof Error ? err.message : String(err) }),
					{ cause: err }
				);
			}
			onsaved();
		},
		savedMessage: t('server_mgmt.file_saved')
	});

	async function beforeclose(): Promise<boolean> {
		if (!form.dirty || readOnly) return true;
		return confirm({
			title: t('device_detail.discard_title'),
			confirmLabel: t('device_detail.discard_confirm'),
			danger: true
		});
	}
</script>

<Sheet
	wide
	title={path}
	subtitle={meta}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : form.status.state === 'saved' ? 'ok' : 'neutral'}
	{beforeclose}
	{onclose}
>
	<form id={form.id} class="editor-form" onsubmit={form.onsubmit} novalidate>
		<label class="sr-only" for="{uid}-content">{t('server_mgmt.file_content')}</label>
		<Textarea
			id="{uid}-content"
			class="editor"
			spellcheck="false"
			autocomplete="off"
			readonly={readOnly}
			bind:value={form.values.content}
		/>
	</form>
	{#snippet footer()}
		<Button
			class="sheet-footer-start"
			onclick={async () => {
				if (await beforeclose()) onclose();
			}}>{t('actions.close')}</Button
		>
		{#if !readOnly}
			<Button variant="primary" type="submit" form={form.id} busy={form.busy}
				>{t('server_mgmt.file_save')}</Button
			>
		{/if}
	{/snippet}
</Sheet>

<style>
	.editor-form {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 360px;
	}
	.editor-form :global(.editor) {
		flex: 1;
		width: 100%;
		min-height: 360px;
		resize: vertical;
		font-family: var(--mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		white-space: pre;
		overflow: auto;
	}
	.editor-form :global(.editor[readonly]) {
		background: var(--bg-subtle);
	}
</style>
