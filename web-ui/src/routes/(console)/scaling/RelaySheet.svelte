<!--
  Add or edit a relay server: name, address, location, and the limits used
  for the capacity estimate on the page. A refused save stays in the
  sheet's status line; a saved one closes the sheet with a toast.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { saveRelay, type Relay } from '#lib/api/scaling.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { relay, onclose, onsaved }: { relay: Relay | null; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();

	const form = createForm({
		initial: untrack(() => ({
			name: relay?.name ?? '',
			address: relay?.address ?? '',
			location: relay?.location ?? '',
			maxSessions: String(relay?.max_sessions || 50),
			maxBandwidth: String(relay?.max_bandwidth_mbps || 100)
		})),
		validate: (v) => {
			const missing = t('scaling.relay_name_address_required');
			return { name: v.name.trim() ? undefined : missing, address: v.address.trim() ? undefined : missing };
		},
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				address: v.address.trim(),
				location: v.location.trim(),
				max_sessions: parseInt(v.maxSessions, 10) || 50,
				max_bandwidth_mbps: parseInt(v.maxBandwidth, 10) || 100
			};
			try {
				await saveRelay(relay?.id ?? null, body);
			} catch (err) {
				throw new FormError(
					t('scaling.relay_save_failed_reason', { error: err instanceof Error ? err.message : String(err) })
				);
			}
			toast.success(t('scaling.relay_saved_named', { name: body.name }));
			onsaved();
		}
	});
</script>

<Sheet
	title={relay ? t('scaling.relay_edit') : t('scaling.relay_add')}
	subtitle={tf(
		'scaling.relay_sheet_desc',
		"A relay server carries remote sessions when two devices can't connect directly."
	)}
	status={form.status.state === 'saving' ? tf('scaling.saving', 'Saving…') : form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('scaling.col_name')} hint={t('scaling.relay_name_hint')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} width="host" maxlength={80} required autocomplete="off" bind:value={form.values.name} />
			{/snippet}
		</Field>
		<Field
			label={t('scaling.col_address')}
			hint={t('scaling.relay_address_hint')}
			error={form.errors.address}
		>
			{#snippet children(f)}
				<Input
					{...f}
					class="mono"
					width="host"
					required
					autocomplete="off"
					spellcheck="false"
					bind:value={form.values.address}
				/>
			{/snippet}
		</Field>
		<Field label={t('scaling.col_location')} hint={t('scaling.relay_location_hint')}>
			{#snippet children(f)}
				<Input {...f} width="host" maxlength={80} autocomplete="off" bind:value={form.values.location} />
			{/snippet}
		</Field>
		<FormSection title={t('scaling.col_limits')}>
			<p class="hint" id="{uid}-limits">{t('scaling.relay_limits_hint')}</p>
			<Field label={t('scaling.relay_max_sessions')}>
				{#snippet children(f)}
					<Input
						{...f}
						describedby="{uid}-limits"
						width="short"
						type="number"
						min={1}
						inputmode="numeric"
						bind:value={form.values.maxSessions}
					/>
				{/snippet}
			</Field>
			<Field label={t('scaling.relay_max_bandwidth')}>
				{#snippet children(f)}
					<Input
						{...f}
						describedby="{uid}-limits"
						width="short"
						type="number"
						min={1}
						inputmode="numeric"
						bind:value={form.values.maxBandwidth}
					/>
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('scaling.cancel')}</Button>
		<Button class="relay-save" variant="primary" type="submit" form={form.id} busy={form.busy}
			>{relay ? t('scaling.save') : t('scaling.relay_add')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
