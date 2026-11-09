<!--
  Send a remote command: device ID, command type and the command or script.
  Three fields, so a centred dialog. It waits on the server until the
  device's agent checks in; the warning line says it can't be taken back.
-->
<script lang="ts">
	import { sendCommand } from '#lib/api/automation.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { COMMAND_TYPES, labelFor } from '#lib/rules/automation.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { onclose, onsent }: { onclose: () => void; onsent: () => void } = $props();

	const form = createForm({
		initial: { device_id: '', command_type: 'shell', payload: '' },
		validate: (v) => ({
			device_id: v.device_id.trim() ? undefined : t('automation.id_payload_required'),
			payload: v.payload.trim() ? undefined : t('automation.id_payload_required')
		}),
		submit: async (v) => {
			const body = { device_id: v.device_id.trim(), command_type: v.command_type, payload: v.payload.trim() };
			try {
				await sendCommand(body);
			} catch (err) {
				throw new FormError(
					`${t('automation.command_send_failed')} ${err instanceof Error ? err.message : ''}`.trim()
				);
			}
			toast.success(t('automation.command_sent', { device: body.device_id }));
			onsent();
		}
	});

	const typeOptions = $derived(COMMAND_TYPES.map((c) => ({ value: c, label: labelFor(t, 'cmd_type', c) })));
</script>

<Dialog title={t('automation.send_command')} {onclose}>
	<form id={form.id} class="cmd-form" onsubmit={form.onsubmit} novalidate>
		<Field
			label={t('automation.device_id')}
			hint={t('automation.device_id_hint')}
			error={form.errors.device_id}
			width="medium"
		>
			{#snippet children(f)}
				<Input
					{...f}
					class="mono"
					required
					autocomplete="off"
					spellcheck={false}
					bind:value={form.values.device_id}
				/>
			{/snippet}
		</Field>
		<Field label={t('automation.command_type')} width="medium">
			{#snippet children(f)}<Select
					{...f}
					options={typeOptions}
					bind:value={form.values.command_type}
				/>{/snippet}
		</Field>
		<Field
			label={t('automation.command_payload')}
			hint={t('automation.payload_hint')}
			error={form.errors.payload}
			effect={t('automation.command_effect')}
			effectTone="restart"
		>
			{#snippet children(f)}
				<Textarea
					{...f}
					class="mono"
					rows={4}
					maxlength={10000}
					required
					spellcheck={false}
					bind:value={form.values.payload}
				/>
			{/snippet}
		</Field>
		{#if form.status.state === 'error'}<FormStatus status={form.status} />{/if}
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{t('automation.send_command')}</Button
		>
	{/snippet}
</Dialog>

<style>
	/* Addresses, IDs, lists and JSON in the monospace font */
	.cmd-form :global(.form-input.mono) {
		font-family: var(--mono);
	}
	.cmd-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.cmd-form :global(.form-group) {
		margin: 0;
	}
</style>
