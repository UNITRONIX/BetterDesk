<!--
  Reject a request. A RustDesk client can be banned at the same time; a
  local-network request can take a reason, which the device receives.
  Opened from the row or from the request's sheet (it sits on top of it).
-->
<script lang="ts">
	import { rejectEnrollment, rejectLan } from '#lib/api/registrations.ts';
	import { SOURCE_ENROLLMENT, type RequestRow } from '#lib/clients/registrations.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import { plainly } from './labels.ts';

	let {
		row,
		onclose,
		onrejected
	}: { row: RequestRow; onclose: () => void; onrejected: (banned: boolean) => void } = $props();

	const isGo = $derived(row.source === SOURCE_ENROLLMENT);
	const name = $derived(row.hostname || row.device_id);

	const form = createForm({
		initial: { ban: false, reason: '' },
		submit: async (v) => {
			await plainly(
				() => (isGo ? rejectEnrollment(row.rowId, v.ban) : rejectLan(row.rowId, v.reason)),
				'registrations.reject_failed'
			);
			onrejected(isGo && v.ban);
		}
	});
</script>

<Dialog title={t('registrations.reject_title_named', { name })} class="reject-dialog" {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<p class="lead">
			{isGo
				? t('registrations.reject_text_rustdesk', { name })
				: t('registrations.reject_text_lan', { name })}
		</p>
		{#if isGo}
			<Checkbox
				label={t('registrations.reject_ban_option')}
				hint={t('registrations.reject_ban_hint_plain')}
				bind:checked={form.values.ban}
			/>
		{:else}
			<Field label={t('registrations.reject_reason')} hint={t('registrations.reject_reason_hint')}>
				{#snippet children(f)}
					<Textarea {...f} rows={3} maxlength={500} bind:value={form.values.reason} />
				{/snippet}
			</Field>
		{/if}
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="danger" icon={ICONS.reject} type="submit" form={form.id} busy={form.busy}
			>{t('registrations.reject_btn')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.lead {
		margin: 0 0 var(--space-4);
		max-width: var(--measure);
	}
</style>
