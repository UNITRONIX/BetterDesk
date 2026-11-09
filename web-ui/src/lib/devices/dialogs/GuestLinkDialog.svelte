<!--
  Guest access link: a time-limited link to the web viewer for the chosen
  devices, for someone without a console account. After Create the link
  shows here, ready to copy.
-->
<script lang="ts">
	import type { GuestLinkInput } from '#lib/api/guest.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { ICONS } from '#lib/util/display.ts';

	let {
		ids,
		create,
		settle
	}: {
		ids: string[];
		create: (input: GuestLinkInput) => Promise<{ url: string; expiresAt: string }>;
		settle: (done: true | null) => void;
	} = $props();

	const formId = $props.id();
	let ttl = $state(120);
	let label = $state('');
	let viewOnly = $state(true);
	let busy = $state(false);
	let error = $state('');
	let link = $state<{ url: string; expiresAt: string } | null>(null);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy) return;
		busy = true;
		error = '';
		try {
			const minutes = Math.min(1440, Math.max(15, Math.round(Number(ttl)) || 120));
			link = await create({ peer_ids: ids, ttl_minutes: minutes, view_only: viewOnly, label: label.trim() });
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

<Dialog
	title={t('guest_access.create_title')}
	message={t('guest_access.create_hint')}
	onclose={() => settle(link ? true : null)}
>
	<form id={formId} onsubmit={submit} novalidate>
		<div class="block">
			<h3 class="label">{t('guest_access.devices')}</h3>
			<p class="ids mono">{ids.join(', ')}</p>
		</div>
		<Field label={t('guest_access.ttl')}>
			{#snippet children(f)}
				<Input {...f} type="number" width="short" min={15} max={1440} inputmode="numeric" bind:value={ttl} />
			{/snippet}
		</Field>
		<Field label={t('guest_access.label')}>
			{#snippet children(f)}
				<Input {...f} maxlength={120} bind:value={label} />
			{/snippet}
		</Field>
		<Checkbox label={t('guest_access.view_only')} bind:checked={viewOnly} />
		{#if link}
			<div class="block result">
				<h3 class="label">{t('guest_access.url')}</h3>
				<ValueField value={link.url} label={t('guest_access.url')} />
				{#if link.expiresAt}
					<p class="hint">{t('guest_access.expires')}: <Time value={link.expiresAt} relative={false} /></p>
				{/if}
			</div>
		{/if}
		<FormStatus message={error} tone="error" />
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(link ? true : null)}
			>{link ? t('actions.close') : t('actions.cancel')}</Button
		>
		<Button variant="primary" type="submit" form={formId} icon={ICONS.guest_link} {busy}
			>{t('guest_access.create')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label {
		margin: 0;
		font-size: inherit;
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.ids {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.result {
		margin-top: var(--space-4);
	}
</style>
