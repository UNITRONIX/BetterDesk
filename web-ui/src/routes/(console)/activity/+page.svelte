<!--
  App usage (/activity, audit.view): daily reports from devices running the
  BetterDesk agent with activity tracking, newest first. Search by device,
  a date range (or 7 days, 30 days, all), a click on a report opens that
  device's apps and sessions. The side column adds up the reports: active
  against idle time, and the most used apps over all devices (there is no
  endpoint for all devices, so each device in the reports is asked, four
  at a time).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listActivity, topApps, type ActivitySummary, type TopApp } from '#lib/api/activity.ts';
	import { formatDuration, formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		activeIdle,
		filterReports,
		mergeTopApps,
		presetOf,
		presetRange,
		rangeOf,
		sortReports,
		type AppTotal
	} from '#lib/people/activity.ts';
	import { eachLimited } from '#lib/people/users.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';
	import ActivitySheet from './ActivitySheet.svelte';

	const allowed = can('audit.view');
	const uid = $props.id();

	let from = $state('');
	let to = $state('');
	const preset = $derived(presetOf(from, to));
	const range = $derived(rangeOf(from, to));

	type Row = ActivitySummary & { key: string };
	let reports = $state.raw<Row[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let apps = $state.raw<AppTotal[] | null>(null);
	let appsFailed = $state(false);
	let appsDevices = $state(0);
	let appsMissing = $state(0);
	let generation = 0;
	/** The per-device app requests of the last load; stopped by a new load or by leaving the page */
	let appRequests: AbortController | null = null;

	async function load() {
		const gen = ++generation;
		appRequests?.abort();
		loaded = false;
		loadError = null;
		apps = null;
		try {
			const list = sortReports(await listActivity(range));
			if (gen !== generation) return;
			reports = list.map((r, i) => ({ ...r, key: `${r.device_id}|${r.reported_at}|${i}` }));
			loaded = true;
			void loadApps(gen, list);
		} catch {
			if (gen !== generation) return;
			loaded = true;
			loadError = t('activity.load_failed');
		}
	}

	async function loadApps(gen: number, list: ActivitySummary[]) {
		appsFailed = false;
		const ids = [...new Set(list.map((r) => r.device_id).filter(Boolean))];
		if (!ids.length) {
			apps = [];
			return;
		}
		const ctrl = new AbortController();
		appRequests = ctrl;
		const per: TopApp[][] = [];
		let missing = 0;
		await eachLimited(ids, 4, async (id) => {
			if (ctrl.signal.aborted) return;
			try {
				per.push(await topApps(id, { ...range, limit: 500 }, ctrl.signal));
			} catch {
				missing++;
			}
		});
		if (gen !== generation || ctrl.signal.aborted) return;
		if (missing === ids.length) {
			appsFailed = true;
			apps = [];
			return;
		}
		appsDevices = ids.length - missing;
		appsMissing = missing;
		apps = mergeTopApps(per);
	}

	$effect(() => {
		if (!allowed) return;
		void range;
		untrack(() => void load());
	});
	$effect(() => {
		if (!allowed) return;
		const stop = onRefresh(() => void load());
		return () => {
			stop();
			appRequests?.abort();
		};
	});

	function choosePreset(p: '' | '7' | '30') {
		const r = presetRange(p);
		from = r.from;
		to = r.to;
	}

	let searchInput = $state('');
	let query = $state('');
	$effect(() => {
		const v = searchInput;
		const timer = setTimeout(() => (query = v), 150);
		return () => clearTimeout(timer);
	});
	const shown = $derived(filterReports(reports, query) as Row[]);
	const deviceCount = $derived(new Set(shown.map((r) => r.device_id)).size);
	const time = $derived(activeIdle(reports));

	let openFor = $state.raw<{ id: string; name: string } | null>(null);
	const nameOf = (r: ActivitySummary) => (r.hostname && r.hostname !== r.device_id ? r.hostname : '');

	function categoryLabel(cat: string): string {
		const key = `activity.category_${cat.toLowerCase()}`;
		return t(key) === key ? cat : t(key);
	}

	const duration = (s: number) => formatDuration(s, { largest: 'hour' });

	const presets = $derived([
		{ value: '7' as const, label: t('activity.preset_7') },
		{ value: '30' as const, label: t('activity.preset_30') },
		{ value: '' as const, label: t('activity.preset_all') }
	]);

	const columns = $derived<Column<Row>[]>([
		{
			id: 'device',
			label: t('activity.device'),
			cell: deviceCell,
			primary: true,
			sortValue: (r) => nameOf(r) || r.device_id
		},
		{
			id: 'reported',
			label: t('activity.reported_at'),
			cell: reportedCell,
			sortValue: (r) => r.reported_at,
			class: 'col-nowrap'
		},
		{
			id: 'active',
			label: t('activity.active_time'),
			cell: activeCell,
			align: 'num',
			sortValue: (r) => r.total_active_secs
		},
		{
			id: 'idle',
			label: t('activity.idle_time'),
			cell: idleCell,
			align: 'num',
			sortValue: (r) => r.idle_seconds
		},
		{
			id: 'sessions',
			label: t('activity.session_count'),
			cell: sessionsCell,
			align: 'num',
			sortValue: (r) => r.session_count
		},
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet deviceCell(r: Row)}{#if nameOf(r)}<span class="device-name">{nameOf(r)}</span><span
			class="cell-sub mono">{r.device_id}</span
		>{:else}<span class="mono">{r.device_id}</span>{/if}{/snippet}
{#snippet reportedCell(r: Row)}<Time value={r.reported_at} relative={false} />{/snippet}
{#snippet activeCell(r: Row)}{#if r.total_active_secs > 0}{duration(r.total_active_secs)}{:else}<Empty
		/>{/if}{/snippet}
{#snippet idleCell(r: Row)}{#if r.idle_seconds > 0}{duration(r.idle_seconds)}{:else}<Empty />{/if}{/snippet}
{#snippet sessionsCell(r: Row)}{formatNumber(r.session_count)}{/snippet}
{#snippet actionsCell(r: Row)}<Button
		size="sm"
		aria-label={t('activity.details_for', { name: nameOf(r) || r.device_id })}
		onclick={() => (openFor = { id: r.device_id, name: nameOf(r) || r.device_id })}
		>{t('activity.details')}</Button
	>{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide activity-page">
		<div class="page-head">
			<h1>{t('activity.title')}</h1>
			<p class="page-description">{t('activity.page_description')}</p>
		</div>

		<div class="page-cols">
			<section class="section page-main" aria-labelledby="{uid}-list">
				<h2 id="{uid}-list" class="sr-only">{t('activity.title')}</h2>
				<Toolbar>
					{#snippet search()}<SearchField label={t('activity.search')} bind:value={searchInput} />{/snippet}
					<fieldset class="range">
						<legend class="sr-only">{t('activity.date_range')}</legend>
						<label class="date">
							<span>{t('activity.filter_from')}</span>
							<Input type="date" small bind:value={from} max={to || undefined} />
						</label>
						<label class="date">
							<span>{t('activity.filter_to')}</span>
							<Input type="date" small bind:value={to} min={from || undefined} />
						</label>
					</fieldset>
					<SegmentedFilter
						label={t('activity.date_range')}
						options={presets}
						value={preset ?? undefined}
						onchange={choosePreset}
					/>
					{#snippet end()}<Button icon={ICONS.refresh} onclick={() => void load()}
							>{t('activity.refresh')}</Button
						>{/snippet}
				</Toolbar>
				<div class="count" aria-live="polite">
					{#if loaded && !loadError && reports.length}
						<CountLine
							text={t('activity.count_line')}
							values={{ reports: shown.length, devices: deviceCount }}
						/>
					{/if}
				</div>
				<div class="reports">
					<Table
						rows={shown}
						{columns}
						key={(r) => r.key}
						label={t('activity.title')}
						onrowclick={(r) => (openFor = { id: r.device_id, name: nameOf(r) || r.device_id })}
						loading={!loaded}
						loadingText={t('activity.loading')}
						error={loadError}
						onretry={() => void load()}
						emptyText={reports.length
							? t('activity.no_match')
							: from || to
								? t('activity.empty_range')
								: t('activity.empty')}
					/>
				</div>
			</section>

			<aside class="page-side" aria-label={t('activity.summary_label')}>
				<section class="section" aria-labelledby="{uid}-time">
					<h2 id="{uid}-time">{t('activity.active_idle_title')}</h2>
					<p class="line" aria-live="polite">
						{#if !loaded}{t('activity.loading')}{:else if loadError}{:else if time}{t(
								'activity.active_idle_line',
								{
									active: duration(time.active),
									idle: duration(time.idle),
									pct: time.pct
								}
							)}{:else}{t('activity.active_idle_none')}{/if}
					</p>
				</section>
				<section class="section" aria-labelledby="{uid}-apps">
					<h2 id="{uid}-apps">{t('activity.top_apps_all_title')}</h2>
					{#if loadError}
						<!-- the table says what failed -->
					{:else if apps === null}
						<States kind="loading" message={t('activity.loading')} />
					{:else if appsFailed}
						<States
							kind="error"
							message={t('activity.top_apps_all_failed')}
							retryLabel={t('activity.try_again')}
							onretry={() => void load()}
						/>
					{:else if !apps.length}
						<States message={t('activity.top_apps_all_empty')} />
					{:else}
						<p class="section-note">
							{t('activity.top_apps_all_note', { devices: appsDevices })}
							{#if appsMissing}{t('activity.top_apps_all_partial', { failed: appsMissing })}{/if}
						</p>
						<ol class="apps">
							{#each apps as a (a.name)}
								<li>
									<span class="app-name">{a.name}</span>
									<span class="app-sub"
										>{a.devices === 1
											? t('activity.top_apps_all_one_device')
											: t('activity.top_apps_all_devices', { count: a.devices })}</span
									>
									<Meter
										value={a.secs}
										max={apps[0]?.secs ?? a.secs}
										text={duration(a.secs)}
										high={101}
										full={101}
									/>
								</li>
							{/each}
						</ol>
					{/if}
				</section>
			</aside>
		</div>
	</div>

	{#if openFor}
		<ActivitySheet
			deviceId={openFor.id}
			name={openFor.name}
			{range}
			{categoryLabel}
			onclose={() => (openFor = null)}
		/>
	{/if}
{/if}

<style>
	.range {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-width: 0;
		margin: 0;
		padding: 0;
		border: 0;
	}
	.date {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.date > span {
		color: var(--text-muted);
	}
	.date :global(.form-input) {
		width: auto;
	}
	.count {
		min-height: 1.5em;
	}
	.device-name {
		font-weight: 600;
	}
	.reports :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.reports :global(td.col-nowrap),
	.reports :global(td.is-num) {
		white-space: nowrap;
	}
	.line {
		margin: 0;
	}
	.apps {
		display: flex;
		flex-direction: column;
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.apps > li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.app-name {
		font-weight: 600;
	}
	.app-sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.apps :global(.meter) {
		margin-top: var(--space-1);
	}
	/* Touch: the name that opens the row gets a 44 px hit area (as on the device list) */
	@media (pointer: coarse) {
		.reports :global(.row-open) {
			display: inline-flex;
			flex-direction: column;
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
