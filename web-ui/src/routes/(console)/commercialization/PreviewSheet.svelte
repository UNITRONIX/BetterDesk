<!--
  A package's month: which companies use it, how many devices, how much of
  the included time was used, what was billed beyond it. Older and newer
  months with the buttons or the month list (newest first).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { packagePreview, type BillingPackage, type Preview } from '#lib/api/billing.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatMinutes, formatMoney, formatMonth } from '#lib/serverarea/billing.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';

	let { pkg, cached, onclose }: { pkg: BillingPackage; cached: Preview | null; onclose: () => void } =
		$props();

	const uid = $props.id();
	// svelte-ignore state_referenced_locally
	let data = $state.raw<Preview | null>(cached);
	let error = $state('');
	let period = $state(untrack(() => cached?.period_ym ?? ''));

	async function load(p?: string) {
		error = '';
		try {
			data = await packagePreview(pkg.id, p);
			period = data.period_ym;
		} catch (err) {
			error = `${t('commercialization.ui.error_preview')} ${err instanceof Error ? err.message : ''}`.trim();
		}
	}

	$effect(() => {
		if (!untrack(() => data)) void load();
	});

	// Months are listed newest first
	const periods = $derived(
		data?.available_periods.length ? data.available_periods : data ? [data.period_ym] : []
	);
	const index = $derived(periods.indexOf(period));
	const options = $derived(periods.map((p) => ({ value: p, label: formatMonth(p, i18n.locale) })));

	function shift(delta: number) {
		const next = periods[Math.max(0, Math.min(periods.length - 1, index + delta))];
		if (next && next !== period) void load(next);
	}

	const facts = $derived(
		data
			? [
					{ label: t('commercialization.preview.company'), value: data.companies.join(', ') },
					{ label: t('commercialization.preview.devices'), value: formatNumber(data.device_count || 0) },
					{ label: t('commercialization.preview.used'), value: formatMinutes(data.included_minutes_used) },
					{ label: t('commercialization.preview.remaining'), value: formatMinutes(data.remaining_minutes) },
					{
						label: t('commercialization.preview.overage'),
						value: `${formatMinutes(data.overage_minutes)}, ${formatMoney(data.amount_overage, data.currency || pkg.currency, i18n.locale)}`
					},
					{
						label: t('commercialization.preview.month_total'),
						value: formatMinutes((data.included_minutes_used || 0) + (data.overage_minutes || 0))
					},
					{ label: t('commercialization.preview.timezone'), value: data.timezone || 'UTC' }
				]
			: []
	);
</script>

<Sheet
	title={pkg.name || tf('commercialization.preview.title', 'Package preview')}
	subtitle={tf(
		'commercialization.ui.preview_sheet_desc',
		'How much of the included time the package used in a month, and the time billed beyond it.'
	)}
	{onclose}
>
	<div class="period">
		<label class="label" for="{uid}-period">{t('commercialization.ui.preview_month')}</label>
		<div class="period-row">
			<Button
				size="sm"
				class="preview-prev"
				disabled={!data || index >= periods.length - 1}
				onclick={() => shift(1)}>{t('commercialization.preview.prev_month')}</Button
			>
			<Select
				id="{uid}-period"
				small
				{options}
				value={period}
				disabled={!data}
				onchange={(e) => void load((e.currentTarget as HTMLSelectElement).value)}
			/>
			<Button size="sm" class="preview-next" disabled={!data || index <= 0} onclick={() => shift(-1)}
				>{t('commercialization.preview.next_month')}</Button
			>
		</div>
	</div>
	{#if error}
		<States kind="error" message={error} onretry={() => void load(period || undefined)} />
	{:else if data}
		<Facts items={facts} />
	{:else}
		<States kind="loading" />
	{/if}
	<p class="hint">{t('commercialization.preview.hint')}</p>
	{#snippet footer()}
		<Button onclick={onclose}>{t('common.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.period {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label {
		font-weight: 600;
	}
	.period-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.hint {
		margin: var(--space-4) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
