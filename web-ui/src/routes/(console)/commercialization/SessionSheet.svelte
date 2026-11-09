<!--
  One billable session: its facts, the work report, and the IDs under a
  closed "Technical details". A running session leaves the amounts out and
  says when its time is counted. Footer: Write report (when it waits for
  one and billing.reports allows it), then Close.
-->
<script lang="ts">
	import type { BillingSession, WorkReport } from '#lib/api/billing.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatMinutes, formatMoney, STATUS_TONE } from '#lib/serverarea/billing.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { ICONS } from '#lib/util/display.ts';

	let {
		session: s,
		report,
		orgName,
		canWrite,
		onwrite,
		onclose
	}: {
		session: BillingSession;
		report: WorkReport | null;
		orgName: string;
		canWrite: boolean;
		onwrite: () => void;
		onclose: () => void;
	} = $props();

	const running = $derived(s.status === 'active');
	const money = (amount: unknown) => formatMoney(amount, s.currency, i18n.locale);
	const operator = $derived(s.operator_name || s.operator_id);

	const facts = $derived.by(() => {
		const out: Fact[] = [
			{ label: t('commercialization.sessions.device'), value: device },
			{ label: t('commercialization.sessions.operator'), value: operator ? operatorValue : '' },
			{ label: t('commercialization.sessions.org'), value: orgName || s.org_id },
			{ label: t('commercialization.contracts.status'), value: status },
			{ label: t('commercialization.sessions.started'), value: s.started_at ? started : '' },
			{ label: t('commercialization.sessions.ended'), value: ended },
			{
				label: t('commercialization.ui.measured_time'),
				value: running
					? notYet
					: s.raw_seconds !== null
						? formatMinutes(Math.round((s.raw_seconds || 0) / 60))
						: ''
			},
			{
				label: t('commercialization.ui.billed_time'),
				value: running ? notYet : formatMinutes(s.billed_minutes)
			}
		];
		if (s.billing_phase)
			out.push({
				label: t('commercialization.sessions.phase'),
				value: tf(`commercialization.ui.phase_${s.billing_phase}`, s.billing_phase)
			});
		if (!running)
			out.push(
				{ label: t('commercialization.ui.included_used'), value: formatMinutes(s.included_minutes_used) },
				{ label: t('commercialization.ui.overage_time'), value: formatMinutes(s.overage_minutes) },
				{ label: t('commercialization.ui.amount_included'), value: money(s.amount_included) },
				{ label: t('commercialization.ui.amount_overage'), value: money(s.amount_overage) }
			);
		return out;
	});

	const reportFacts = $derived.by(() => {
		if (!report) return [];
		const out: Fact[] = [{ label: t('commercialization.report.summary'), value: report.summary }];
		if (report.category) out.push({ label: t('commercialization.report.category'), value: category });
		if (report.ticket_ref)
			out.push({ label: t('commercialization.report.ticket_ref'), value: report.ticket_ref });
		if (report.operator_id) out.push({ label: t('commercialization.ui.report_author'), value: author });
		if (report.created_at) out.push({ label: t('commercialization.ui.report_date'), value: written });
		return out;
	});

	const techFacts = $derived.by(() => {
		const out: Fact[] = [];
		if (s.transport) out.push({ label: t('commercialization.ui.transport'), value: s.transport });
		out.push({ label: t('commercialization.ui.clock_synced'), value: clock });
		if (s.contract_id) out.push({ label: t('commercialization.ui.contract_id'), value: contractId });
		out.push({ label: t('commercialization.ui.session_id'), value: sessionId });
		if (s.relay_uuid) out.push({ label: t('commercialization.ui.relay_id'), value: relayId });
		return out;
	});
</script>

{#snippet device()}
	<span>{s.device_name || s.device_id}</span>
	{#if s.device_id}<ValueCopy
			value={s.device_id}
			label="{t('commercialization.sessions.device')} {s.device_id}"
		/>{/if}
{/snippet}
{#snippet operatorValue()}<User user={operator} />{/snippet}
{#snippet status()}
	<Status
		tone={STATUS_TONE[s.status] ?? s.status}
		label={tf(`commercialization.status.${s.status}`, s.status)}
	/>
{/snippet}
{#snippet started()}<Time value={s.started_at} relative={false} />{/snippet}
{#snippet ended()}
	{#if running}<Empty word={t('commercialization.ui.still_running')} />{:else}<Time
			value={s.ended_at}
			relative={false}
		/>{/if}
{/snippet}
{#snippet notYet()}<Empty word={t('commercialization.ui.billed_at_end')} />{/snippet}
{#snippet category()}<Tag
		label={tf(`commercialization.ui.category_${report?.category}`, report?.category ?? '')}
	/>{/snippet}
{#snippet author()}<User user={report?.operator_id} />{/snippet}
{#snippet written()}<Time value={report?.created_at} relative={false} />{/snippet}
{#snippet clock()}
	<BooleanStatus value={s.clock_synced_at_start} on={t('common.yes')} off={t('common.no')} />
	{#if s.clock_offset_ms_at_start}<span class="muted"
			>{formatNumber(s.clock_offset_ms_at_start, {
				style: 'unit',
				unit: 'millisecond',
				unitDisplay: 'short'
			})}</span
		>{/if}
{/snippet}
{#snippet contractId()}<ValueCopy
		value={s.contract_id}
		label="{t('commercialization.ui.contract_id')} {s.contract_id}"
	/>{/snippet}
{#snippet sessionId()}<ValueCopy
		value={s.id}
		label="{t('commercialization.ui.session_id')} {s.id}"
	/>{/snippet}
{#snippet relayId()}<ValueCopy
		value={s.relay_uuid}
		label="{t('commercialization.ui.relay_id')} {s.relay_uuid}"
	/>{/snippet}

<Sheet title={t('commercialization.ui.session_details')} subtitle={s.device_name || s.device_id} {onclose}>
	<div class="stack">
		<Facts items={facts} />
		<section class="report" aria-labelledby="report-{s.id}">
			<h3 id="report-{s.id}">{t('commercialization.report.title')}</h3>
			{#if report}
				<Facts items={reportFacts} />
			{:else}
				<p class="muted">
					{running ? t('commercialization.ui.report_after_end_long') : t('commercialization.ui.no_report')}
				</p>
			{/if}
		</section>
		<Disclosure level={3} title={t('commercialization.ui.technical_details')}>
			<Facts items={techFacts} />
		</Disclosure>
	</div>
	{#snippet footer()}
		{#if !report && s.status === 'pending_report' && canWrite}
			<Button class="session-write" icon={ICONS.edit} onclick={onwrite}
				>{t('commercialization.ui.write_report')}</Button
			>
		{/if}
		<Button onclick={onclose}>{t('common.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.report {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.report h3 {
		margin: 0;
		font-size: var(--text-md);
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
</style>
