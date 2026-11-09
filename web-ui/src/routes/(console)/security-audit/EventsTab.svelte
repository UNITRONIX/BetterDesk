<!--
  Server events tab: what the BetterDesk server recorded itself, 25 a page,
  filtered by kind on the server. Above the table, events per day for the
  last 14 days, drawn only when the loaded events reach back that far (the
  server keeps its events since it last started); otherwise one sentence
  says which range they cover.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listServerEvents, type ServerEvent } from '#lib/api/audit.ts';
	import { formatDate, formatNumber, parseDate } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import DetailsText from '#lib/people/DetailsText.svelte';
	import { actionLabel, EVENT_FILTERS, formatDetails } from '#lib/people/audit.ts';
	import { countPerDay, coversDays, lastDays } from '#lib/people/dates.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import Pagination from '#lib/ui/Pagination.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';

	const PAGE_SIZE = 25;
	const CHART_DAYS = 14;

	const uid = $props.id();

	let filter = $state('');
	let pageNo = $state(1);
	type Row = ServerEvent & { key: string };
	let events = $state.raw<Row[]>([]);
	let total = $state<number | null>(null);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);

	interface ChartData {
		labels: string[];
		values: number[];
		summary: string;
	}
	let chart = $state.raw<ChartData | null>(null);
	let range = $state('');

	async function load() {
		loaded = false;
		loadError = null;
		try {
			const out = await listServerEvents({
				limit: PAGE_SIZE,
				offset: (pageNo - 1) * PAGE_SIZE,
				action: filter || undefined
			});
			events = out.events.map((e, i) => ({ ...e, key: `${pageNo}-${i}` }));
			// The server reports the unfiltered total even when filtering: only trusted without a filter
			total = filter ? null : out.total;
		} catch {
			loadError = t('security_audit.events_load_failed');
		} finally {
			loaded = true;
		}
	}

	async function loadChart() {
		let times: Date[];
		let all: number | null;
		try {
			const out = await listServerEvents({ limit: 1000 });
			times = out.events.map((e) => parseDate(e.timestamp || e.created_at)).filter((d): d is Date => !!d);
			all = out.total;
		} catch {
			chart = null; // the table below shows the load error
			range = '';
			return;
		}
		if (!times.length) {
			chart = null;
			range = '';
			return;
		}
		const oldest = new Date(Math.min(...times.map((d) => d.getTime())));
		let text = t('security_audit.events_range', {
			from: formatDate(oldest, { second: '2-digit' }),
			count: formatNumber(times.length)
		});
		if (all !== null && all > times.length)
			text += ` ${t('security_audit.events_range_partial', { total: formatNumber(all) })}`;
		const days = lastDays(CHART_DAYS);
		if (!coversDays(oldest, days)) {
			range = `${text} ${t('security_audit.events_chart_needs', { days: CHART_DAYS })}`;
			chart = null;
			return;
		}
		range = text;
		const perDay = countPerDay(times, days);
		const sum = perDay.reduce((a, b) => a + b, 0);
		const peak = perDay.indexOf(Math.max(...perDay));
		const short = new Intl.DateTimeFormat(i18n.locale, { month: 'short', day: 'numeric' });
		const long = new Intl.DateTimeFormat(i18n.locale, { weekday: 'long', month: 'long', day: 'numeric' });
		chart = {
			labels: days.map((d) => short.format(d)),
			values: perDay,
			summary: t('security_audit.events_chart_summary', {
				total: formatNumber(sum),
				days: CHART_DAYS,
				peakDay: days[peak] ? long.format(days[peak]) : '',
				peak: formatNumber(perDay[peak] ?? 0)
			})
		};
	}

	$effect(() => {
		untrack(() => {
			void load();
			void loadChart();
		});
	});

	const pageCount = $derived(
		total !== null && Number.isFinite(total)
			? Math.max(1, Math.ceil(total / PAGE_SIZE))
			: pageNo + (events.length === PAGE_SIZE ? 1 : 0)
	);

	function goPage(p: number) {
		pageNo = p;
		void load();
	}

	const filterOptions = $derived([
		{ value: '', label: t('security_audit.all_events') },
		...EVENT_FILTERS.map((f) => ({ value: f as string, label: t(`security_audit.event_${f}`) }))
	]);

	const columns = $derived<Column<Row>[]>([
		{ id: 'time', label: t('security_audit.col_time'), cell: timeCell, class: 'col-time' },
		{ id: 'action', label: t('security_audit.col_action'), cell: actionCell },
		{ id: 'actor', label: t('security_audit.col_actor'), cell: actorCell },
		{ id: 'target', label: t('security_audit.col_target'), cell: targetCell },
		{ id: 'details', label: t('security_audit.col_details'), cell: detailsCell, class: 'col-details' }
	]);
</script>

{#snippet timeCell(e: ServerEvent)}<Time
		value={e.timestamp || e.created_at}
		relative={false}
		format={{ second: '2-digit' }}
	/>{/snippet}
{#snippet actionCell(e: ServerEvent)}{#if e.action}<Tag label={actionLabel(e.action, t)} />{/if}{/snippet}
{#snippet actorCell(e: ServerEvent)}<User user={e.actor || e.user} />{/snippet}
{#snippet targetCell(e: ServerEvent)}<ValueCopy value={e.target || e.resource} />{/snippet}
{#snippet detailsCell(e: ServerEvent)}<DetailsText text={formatDetails(e.details)} />{/snippet}

<section class="section" aria-labelledby="{uid}-title">
	<h2 id="{uid}-title" class="sr-only">{t('security_audit.tab_server_events')}</h2>
	<p class="section-note">{t('security_audit.server_events_note')}</p>

	{#if range}
		<section class="section" aria-labelledby="{uid}-chart">
			<h3 id="{uid}-chart">{t('security_audit.events_chart_title')}</h3>
			<p class="section-note" aria-live="polite">{range}</p>
			{#if chart}
				<Chart
					kind="columns"
					label={t('security_audit.events_chart_title')}
					summary={chart.summary}
					labels={chart.labels}
					xHeading={t('security_audit.events_chart_day')}
					series={[{ name: t('security_audit.events_chart_series'), values: chart.values }]}
					format="number"
				/>
			{/if}
		</section>
	{/if}

	<Toolbar>
		<label class="filter">
			<span>{t('security_audit.show')}</span>
			<Select
				options={filterOptions}
				value={filter}
				onchange={(e) => {
					filter = (e.currentTarget as HTMLSelectElement).value;
					goPage(1);
				}}
			/>
		</label>
		{#snippet end()}<Button
				icon={ICONS.refresh}
				onclick={() => {
					void load();
					void loadChart();
				}}>{t('security_audit.refresh')}</Button
			>{/snippet}
	</Toolbar>
	<div class="log-table">
		<Table
			rows={events}
			{columns}
			key={(e) => e.key}
			label={t('security_audit.tab_server_events')}
			loading={!loaded}
			error={loadError}
			onretry={() => void load()}
			emptyText={pageNo > 1 ? t('security_audit.no_more_events') : t('security_audit.no_events')}
		/>
	</div>
	{#if pageCount > 1 && !loadError}
		<Pagination page={pageNo} {pageCount} label={t('security_audit.pages')} onchange={goPage} />
	{/if}
</section>

<style>
	.filter {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-muted);
	}
	.log-table :global(td.col-time) {
		white-space: nowrap;
	}
	.log-table :global(td.col-details) {
		min-width: 16rem;
		max-width: 36rem;
	}
</style>
