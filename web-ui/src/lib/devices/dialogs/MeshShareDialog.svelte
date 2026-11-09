<!--
  Guest desktop link for a MeshAgent device: view-only, time-limited, no
  console sign-in. The link shows here after Create.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		create,
		settle
	}: { device: DeviceLike; create: (ttl: number) => Promise<string>; settle: (done: true | null) => void } =
		$props();

	const formId = $props.id();
	let ttl = $state(120);
	let busy = $state(false);
	let error = $state('');
	let url = $state('');

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			url = await create(Math.min(1440, Math.max(15, Math.round(Number(ttl)) || 120)));
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	title="{t('mesh.share_link_title')}: {device.id}"
	message={t('mesh.share_link_hint')}
	onclose={() => settle(url ? true : null)}
>
	<form id={formId} onsubmit={submit} novalidate>
		<Field label={t('mesh.share_ttl')}>
			{#snippet children(f)}
				<Input {...f} type="number" width="short" min={15} max={1440} inputmode="numeric" bind:value={ttl} />
			{/snippet}
		</Field>
		{#if url}
			<div class="block">
				<h3 class="label">{t('mesh.share_url')}</h3>
				<ValueField value={url} label={t('mesh.share_url')} />
			</div>
		{/if}
		<FormStatus message={error} tone="error" />
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(url ? true : null)}>{url ? t('actions.close') : t('actions.cancel')}</Button
		>
		<Button variant="primary" type="submit" form={formId} icon={ICONS.guest_link} {busy}
			>{t('mesh.share_create')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-top: var(--space-4);
	}
	.label {
		margin: 0;
		font-size: inherit;
		font-weight: 600;
	}
</style>
