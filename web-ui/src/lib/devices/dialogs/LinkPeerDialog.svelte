<!--
  Link a MeshAgent to the RustDesk or CDAP device on the same computer.
  Empty unlinks.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		save,
		settle
	}: { device: DeviceLike; save: (peerId: string) => Promise<void>; settle: (done: true | null) => void } =
		$props();

	const formId = $props.id();
	let peer = $state(untrack(() => String(device.linked_peer_id ?? '')));
	let busy = $state(false);
	let error = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			await save(peer);
			settle(true);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	title="{t('mesh.link_peer_title')}: {device.id}"
	message={t('mesh.link_peer_hint')}
	onclose={() => settle(null)}
>
	<form id={formId} onsubmit={submit} novalidate>
		<Field label={t('mesh.linked_peer')}>
			{#snippet children(f)}
				<Input {...f} class="mono" width="medium" autocomplete="off" spellcheck="false" bind:value={peer} />
			{/snippet}
		</Field>
		<FormStatus message={error} tone="error" />
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={formId} {busy}>{t('actions.save')}</Button>
	{/snippet}
</Dialog>
