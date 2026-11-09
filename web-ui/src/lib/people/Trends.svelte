<!--
  Trends on the reports page: remote sessions per day and help requests
  opened and resolved per day, the last 14 days, as two column charts side
  by side. Data: GET /api/reports/trends (raw times, counted per local day
  here).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getTrends, type Trends } from '#lib/api/reports.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import { lastDays } from '#lib/people/dates.ts';
	import { helpTrend, sessionTrend } from '#lib/people/reports.ts';
	import Chart from '#lib/ui/Chart.svelte';
	import States from '#lib/ui/States.svelte';

	const DAYS = 14;
	const uid = $props.id();

	let data = $state.raw<Trends | null>(null);
	let failed = $state(false);

	async function load() {
		failed = false;
		try {
			data = await getTrends(DAYS);
		} catch {
			failed = true;
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	const days = lastDays(DAYS);
	const labels = $derived.by(() => {
		const f = new Intl.DateTimeFormat(i18n.locale, { month: 'short', day: 'numeric' });
		return days.map((d) => f.format(d));
	});
	const longDay = (d: Date | undefined) =>
		d
			? new Intl.DateTimeFormat(i18n.locale, { weekday: 'long', month: 'long', day: 'numeric' }).format(d)
			: '';

	const sessions = $derived(data ? sessionTrend(data.sessions, days) : null);
	const help = $derived(data ? helpTrend(data.help, days) : null);
	const helpTotals = $derived(
		help
			? { opened: help.opened.reduce((a, b) => a + b, 0), resolved: help.resolved.reduce((a, b) => a + b, 0) }
			: null
	);

	const sessionSummary = $derived.by(() => {
		if (!sessions || !data) return '';
		let s = t('reports.trends_sessions_summary', {
			total: formatNumber(sessions.total),
			days: DAYS,
			peakDay: longDay(days[sessions.peak]),
			peak: formatNumber(sessions.perDay[sessions.peak] ?? 0)
		});
		if (sessions.avgMinutes !== null)
			s += ` ${t('reports.trends_sessions_length', { minutes: formatNumber(sessions.avgMinutes) })}`;
		if (data.devicesChecked < data.devicesTotal)
			s += ` ${t('reports.trends_sessions_capped', {
				checked: formatNumber(data.devicesChecked),
				total: formatNumber(data.devicesTotal)
			})}`;
		return s;
	});
</script>

<section class="section" aria-labelledby="{uid}-title">
	<div class="section-head"><h2 id="{uid}-title">{t('reports.trends_title')}</h2></div>
	<p class="section-note">{t('reports.trends_note', { days: DAYS })}</p>
	{#if failed}
		<States kind="error" message={t('reports.trends_failed')} onretry={() => void load()} />
	{:else if !data || !sessions || !help || !helpTotals}
		<States kind="loading" message={t('reports.trends_loading')} />
	{:else}
		<div class="cols">
			<section class="section" aria-labelledby="{uid}-sessions">
				<h3 id="{uid}-sessions">{t('reports.trends_sessions_title')}</h3>
				{#if !sessions.total}
					<States message={t('reports.trends_sessions_empty', { days: DAYS })} />
				{:else}
					<Chart
						kind="columns"
						label={t('reports.trends_sessions_title')}
						summary={sessionSummary}
						{labels}
						xHeading={t('reports.trends_day')}
						series={[{ name: t('reports.trends_sessions_series'), values: sessions.perDay }]}
						format="number"
					/>
				{/if}
			</section>
			<section class="section" aria-labelledby="{uid}-help">
				<h3 id="{uid}-help">{t('reports.trends_help_title')}</h3>
				{#if !helpTotals.opened && !helpTotals.resolved}
					<States message={t('reports.trends_help_empty', { days: DAYS })} />
				{:else}
					<Chart
						kind="columns"
						label={t('reports.trends_help_title')}
						summary={t('reports.trends_help_summary', {
							opened: formatNumber(helpTotals.opened),
							resolved: formatNumber(helpTotals.resolved),
							days: DAYS,
							open: formatNumber(help.stillOpen)
						})}
						{labels}
						xHeading={t('reports.trends_day')}
						series={[
							{ name: t('reports.trends_help_opened'), values: help.opened },
							{ name: t('reports.trends_help_resolved'), values: help.resolved }
						]}
						format="number"
					/>
				{/if}
			</section>
		</div>
	{/if}
</section>
