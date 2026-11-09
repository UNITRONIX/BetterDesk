<!--
  Connection mode (Overview): only on clients that can switch between the
  full client and incoming-only, or the support agent (one line that it
  stays incoming-only). The form needs device.connection_mode; the reason
  goes into the audit log and is required.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { ConnectionMode } from '#lib/api/devices.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { setConnectionMode } from '../actions.svelte.ts';
	import type { ConnectionModeView, PanelDevice } from '../panel-logic.ts';
	import PanelSection from './PanelSection.svelte';

	let { device, view }: { device: PanelDevice; view: ConnectionModeView } = $props();

	const modeLabel = (m: string) =>
		m === 'normal'
			? t('device_detail.connection_mode_normal')
			: m === 'incoming-only'
				? t('device_detail.connection_mode_incoming_only')
				: m;
	const statusLabel = (s: string) => {
		if (!s) return t('device_detail.connection_mode_status_none');
		const key = `device_detail.connection_mode_status_${s}`;
		const word = t(key);
		return word === key ? s : word;
	};

	// Starts at the requested (or effective) mode; the person picks from there
	let mode = $state<ConnectionMode>(
		untrack(() => ((view.desired || view.effective) === 'incoming-only' ? 'incoming-only' : 'normal'))
	);
	let reason = $state('');
	let reasonError = $state('');
	let busy = $state(false);

	async function apply(event: SubmitEvent) {
		event.preventDefault();
		if (busy) return;
		if (!reason.trim()) {
			reasonError = t('device_detail.connection_mode_reason');
			return;
		}
		busy = true;
		try {
			if (await setConnectionMode(device, mode, reason)) reason = '';
		} finally {
			busy = false;
		}
	}
</script>

<PanelSection title={t('device_detail.connection_mode_title')}>
	{#if view.locked}
		<p class="dp-hint">{t('device_detail.connection_mode_support_locked')}</p>
	{:else}
		<Facts
			items={[
				{ label: t('device_detail.connection_mode_effective'), value: modeLabel(view.effective) },
				{ label: t('device_detail.connection_mode_desired'), value: modeLabel(view.desired) },
				{ label: t('device_detail.connection_mode_status'), value: statusLabel(view.status) },
				...(view.rejection
					? [{ label: t('device_detail.connection_mode_status_rejected'), value: view.rejection }]
					: [])
			]}
		/>
		{#if view.canChange}
			<form class="dp-conn-form" novalidate onsubmit={apply}>
				<Field label={t('device_detail.connection_mode_title')} width="medium">
					{#snippet children(f)}
						<Select
							{...f}
							options={[
								{ value: 'normal', label: t('device_detail.connection_mode_normal') },
								{ value: 'incoming-only', label: t('device_detail.connection_mode_incoming_only') }
							]}
							bind:value={mode}
						/>
					{/snippet}
				</Field>
				<Field
					label={t('device_detail.connection_mode_reason')}
					hint={t('device_detail.connection_mode_reason_placeholder')}
					error={reasonError || undefined}
				>
					{#snippet children(f)}
						<Input {...f} maxlength={500} bind:value={reason} oninput={() => (reasonError = '')} />
					{/snippet}
				</Field>
				<div><Button type="submit" {busy}>{t('device_detail.connection_mode_apply')}</Button></div>
			</form>
		{/if}
	{/if}
</PanelSection>

<style>
	.dp-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-conn-form {
		display: block;
		margin-top: var(--space-2);
	}
</style>
