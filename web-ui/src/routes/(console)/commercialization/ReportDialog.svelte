<!--
  The work report for an ended session (billing.reports): what was done,
  a category and an optional ticket reference. A short dialog; a refused
  save says why inside it.
-->
<script lang="ts">
	import { writeReport, type BillingSession } from '#lib/api/billing.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { around } from '#lib/serverarea/text.ts';
	import { REPORT_CATEGORIES } from '#lib/serverarea/billing.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { session, onclose, onsaved }: { session: BillingSession; onclose: () => void; onsaved: () => void } =
		$props();

	const form = createForm({
		initial: { summary: '', category: '', ticket: '' },
		validate: (v) => ({
			summary: v.summary.trim() ? undefined : t('commercialization.report.summary_required')
		}),
		submit: async (v) => {
			try {
				await writeReport(session.id, {
					summary: v.summary.trim(),
					category: v.category,
					ticket_ref: v.ticket.trim()
				});
			} catch (err) {
				throw new FormError(err instanceof Error ? err.message : String(err));
			}
			toast.success(t('commercialization.report.saved'));
			onsaved();
		}
	});

	const categories = $derived([
		{ value: '', label: t('commercialization.ui.category_none') },
		...REPORT_CATEGORIES.map((c) => ({ value: c as string, label: t(`commercialization.ui.category_${c}`) }))
	]);
	const intro = $derived(
		around('commercialization.ui.report_for', 'date', { device: session.device_name || session.device_id })
	);
</script>

<Dialog title={t('commercialization.report.title')} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<p class="intro">{intro[0]}<Time value={session.started_at} relative={false} />{intro[1]}</p>
		<Field label={t('commercialization.report.summary')} error={form.errors.summary}>
			{#snippet children(f)}
				<Textarea {...f} rows={4} maxlength={2000} required bind:value={form.values.summary} />
			{/snippet}
		</Field>
		<Field label={t('commercialization.report.category')}>
			{#snippet children(f)}
				<Select {...f} width="host" options={categories} bind:value={form.values.category} />
			{/snippet}
		</Field>
		<Field label={t('commercialization.report.ticket_ref')} hint={t('commercialization.ui.optional_hint')}>
			{#snippet children(f)}
				<Input {...f} width="medium" maxlength={64} autocomplete="off" bind:value={form.values.ticket} />
			{/snippet}
		</Field>
		{#if form.status.state === 'error'}<FormStatus status={form.status} />{/if}
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('commercialization.form.cancel')}</Button>
		<Button class="report-save" variant="primary" type="submit" form={form.id} busy={form.busy}
			>{t('commercialization.report.submit')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.intro {
		margin: 0 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
