<!--
  Delete one device. Delete unlocks after a 3 second countdown and focus
  starts on Cancel, so Enter right away does not delete. Two options:
  release the ID (permanent delete) and revoke the device.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import type { DeviceLike } from '../model.ts';

	let {
		device,
		settle
	}: { device: DeviceLike; settle: (choice: { hard: boolean; revoke: boolean } | null) => void } = $props();

	let hard = $state(false);
	let revoke = $state(false);
	let left = $state(3);

	$effect(() => {
		const timer = setInterval(() => {
			left = Math.max(0, left - 1);
			if (left === 0) clearInterval(timer);
		}, 1000);
		return () => clearInterval(timer);
	});
</script>

<Dialog title={t('devices.delete_title')} onclose={() => settle(null)}>
	<div class="delete-form">
		<p class="delete-warning">{t('devices.delete_confirm', { id: device.id })}</p>
		<p class="delete-info">{t('devices.delete_reserved_hint')}</p>
		<Checkbox
			label={t('devices.delete_hard_option')}
			hint={t('devices.delete_hard_hint')}
			bind:checked={hard}
		/>
		<Checkbox label={t('devices.revoke_option')} hint={t('devices.revoke_hint')} bind:checked={revoke} />
	</div>
	{#snippet footer()}
		<Button data-autofocus onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button
			variant="danger"
			icon={ICONS.delete}
			disabled={left > 0}
			onclick={() => left === 0 && settle({ hard, revoke })}
			>{left > 0 ? `${t('actions.delete')} (${left})` : t('actions.delete')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.delete-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.delete-warning {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border-inline-start: 3px solid var(--danger);
		background: var(--bg-subtle);
	}
	.delete-info {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
