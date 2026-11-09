<!--
  Ban a device: what banning does, then an optional reason. Enter bans.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import { deviceLabel, type DeviceLike } from '../model.ts';

	let { device, settle }: { device: DeviceLike; settle: (reason: string | null) => void } = $props();

	const formId = $props.id();
	let reason = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		settle(reason.trim());
	}
</script>

<Dialog title={t('devices.ban_title')} onclose={() => settle(null)}>
	<form id={formId} onsubmit={submit} novalidate>
		<p class="effect">{t('devices.ban_effect', { device: deviceLabel(device) })}</p>
		<Field label={t('devices.ban_reason_label')} hint={t('devices.ban_reason_hint')}>
			{#snippet children(f)}
				<Input {...f} bind:value={reason} maxlength={500} autocomplete="off" />
			{/snippet}
		</Field>
	</form>
	{#snippet footer()}
		<Button onclick={() => settle(null)}>{t('actions.cancel')}</Button>
		<Button variant="danger" type="submit" form={formId} icon={ICONS.ban}>{t('actions.ban')}</Button>
	{/snippet}
</Dialog>

<style>
	.effect {
		margin: 0 0 var(--space-4);
	}
</style>
