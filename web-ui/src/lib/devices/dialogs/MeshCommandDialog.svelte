<!--
  Run a command on a MeshAgent device (optionally in a shell).
-->
<script lang="ts">
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		run,
		settle
	}: {
		device: DeviceLike;
		run: (command: string, shell: boolean) => Promise<void>;
		settle: (done: true | null) => void;
	} = $props();

	const formId = $props.id();
	let command = $state('');
	let shell = $state(true);
	let busy = $state(false);
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy || !command.trim()) return;
		busy = true;
		error = '';
		try {
			await run(command, shell);
			settle(true);
		} catch (err) {
			error = err instanceof Error ? err.message : t('mesh.command_failed');
		} finally {
			busy = false;
		}
	}
</script>

<Dialog title="{t('mesh.run_command_title')}: {device.id}" onclose={() => settle(null)}>
	<form id={formId} onsubmit={submit} novalidate>
		<Field label={t('mesh.command_placeholder')}>
			{#snippet children(f)}
				<Textarea {...f} rows={4} class="mono" spellcheck="false" bind:value={command} />
			{/snippet}
		</Field>
		<Checkbox label={t('mesh.run_as_shell')} bind:checked={shell} />
		<FormStatus message={error} tone="error" />
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={formId} icon={ICONS.run} {busy}
			>{tf('actions.run', 'Run')}</Button
		>
	{/snippet}
</Dialog>
