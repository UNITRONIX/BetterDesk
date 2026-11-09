<!--
  Billable sessions (?tab=sessions): what waits for a work report and how
  much included time each assignment has used this month, above the full
  list of sessions with its filters (organization, status, device),
  Refresh and Export (billing.export). A click on a session opens its
  details; a session waiting for a report opens the report dialog from the
  list on top (billing.reports), or its details without that permission.

  Older Go servers fail to read a session that is still running, so the
  full list answers 500: then the ended sessions are read by status and a
  notice says running ones are missing (with the "Active" filter: an error
  that names the cause).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		listBillingPackages,
		listContracts,
		listOrgs,
		listReports,
		listSessions,
		reportsExportUrl,
		sessionsExportUrl,
		type BillingSession,
		type Org,
		type SessionFilter,
		type WorkReport
	} from '#lib/api/billing.ts';
	import { ApiError } from '#lib/api/client.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import {
		filterByDevice,
		formatMinutes,
		mergeEnded,
		sameDay,
		STATUS_TONE,
		thisMonth,
		usageRows,
		type UsageRow
	} from '#lib/serverarea/billing.ts';
	import { around } from '#lib/serverarea/text.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';
	import ReportDialog from './ReportDialog.svelte';
	import SessionSheet from './SessionSheet.svelte';

	let { canManage, canWrite, canExport }: { canManage: boolean; canWrite: boolean; canExport: boolean } =
		$props();

	const uid = $props.id();

	/* ── Filters ── */

	let orgId = $state('');
	let status = $state('');
	let deviceInput = $state('');
	let device = $state('');
	let orgs = $state.raw<Org[]>([]);

	// Typing in the device field reloads a moment later
	$effect(() => {
		const v = deviceInput.trim();
		if (v === untrack(() => device)) return;
		const timer = setTimeout(() => (device = v), 300);
		return () => clearTimeout(timer);
	});

	const filter = $derived<SessionFilter>({
		...(orgId ? { org_id: orgId } : {}),
		...(status ? { status } : {}),
		...(device ? { device_id: device } : {})
	});
	const filtered = $derived(!!(orgId || status || device));

	/* ── Sessions ── */

	let sessions = $state.raw<BillingSession[] | null>(null);
	let reports = $state.raw<Record<string, WorkReport>>({});
	let sessionsError = $state<string | null>(null);
	let runningMissing = $state(false);
	let loading = $state(false);

	let inflight = 0;

	async function loadSessions() {
		const mine = ++inflight;
		const f = filter;
		loading = true;
		try {
			const list = listSessions(f).then(
				(d) => ({ list: d, missing: false }),
				async (err: unknown) => {
					if (!(err instanceof ApiError && err.status >= 500) || f.status === 'active') throw err;
					const rest: SessionFilter = { ...f };
					delete rest.status;
					const lists = await Promise.all(
						['pending_report', 'closed'].map((st) => listSessions({ ...rest, status: st }))
					);
					return { list: mergeEnded(lists), missing: !f.status };
				}
			);
			const [s, r] = await Promise.all([list, listReports().catch(() => [] as WorkReport[])]);
			if (mine !== inflight) return;
			reports = Object.fromEntries(r.map((x) => [x.session_id, x]));
			sessions = filterByDevice(s.list, f.device_id ?? '');
			runningMissing = s.missing;
			sessionsError = null;
		} catch (err) {
			if (mine !== inflight) return;
			runningMissing = false;
			sessions = null;
			sessionsError =
				err instanceof ApiError && err.status >= 500
					? t('commercialization.ui.error_sessions_server')
					: t('commercialization.ui.error_sessions');
		} finally {
			if (mine === inflight) loading = false;
		}
	}

	// The list follows the filters
	$effect(() => {
		void filter;
		untrack(() => void loadSessions());
	});

	/* ── Above the list ── */

	let pending = $state.raw<BillingSession[] | null>(null);
	let pendingError = $state(false);
	let usage = $state.raw<UsageRow[] | null>(null);
	let usageError = $state(false);

	async function loadPending() {
		pendingError = false;
		try {
			pending = (await listSessions({ status: 'pending_report' })).filter(
				(s) => s.status === 'pending_report'
			);
		} catch {
			pendingError = true;
		}
	}

	async function loadUsage() {
		usageError = false;
		try {
			const [c, p] = await Promise.all([listContracts(), listBillingPackages()]);
			usage = usageRows(c, p, thisMonth());
		} catch {
			usageError = true;
		}
	}

	$effect(() => {
		untrack(() => {
			void loadPending();
			void loadUsage();
			listOrgs().then(
				(list) => (orgs = list),
				() => {
					/* the filter keeps "All organizations" */
				}
			);
		});
	});

	function refreshAll() {
		void loadSessions();
		void loadUsage();
		void loadPending();
	}

	/* ── Dialogs ── */

	let detailsFor = $state.raw<BillingSession | null>(null);
	let reportFor = $state.raw<BillingSession | null>(null);

	function openPending(s: BillingSession) {
		if (canWrite) reportFor = s;
		else detailsFor = s;
	}

	/* ── Table ── */

	const rows = $derived(sessions ?? []);
	const activeCount = $derived(rows.filter((s) => s.status === 'active').length);

	const columns = $derived<Column<BillingSession>[]>([
		{ id: 'device', label: t('commercialization.sessions.device'), cell: deviceCell, class: 'col-nowrap' },
		{ id: 'operator', label: t('commercialization.sessions.operator'), cell: operatorCell },
		{ id: 'started', label: t('commercialization.sessions.started'), cell: startedCell, class: 'col-nowrap' },
		{ id: 'ended', label: t('commercialization.sessions.ended'), cell: endedCell, class: 'col-nowrap' },
		{
			id: 'billed',
			label: t('commercialization.ui.billed_time'),
			cell: billedCell,
			align: 'num',
			class: 'col-billed'
		},
		{ id: 'status', label: t('commercialization.contracts.status'), cell: statusCell },
		{ id: 'report', label: t('commercialization.sessions.report'), cell: reportCell, class: 'col-report' },
		{
			id: 'actions',
			label: t('commercialization.contracts.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions'
		}
	]);

	const statusOptions = $derived([
		{ value: '', label: t('commercialization.filters.all_statuses') },
		{ value: 'active', label: t('commercialization.status.active') },
		{ value: 'pending_report', label: t('commercialization.status.pending_report') },
		{ value: 'closed', label: t('commercialization.status.closed') }
	]);
	const orgOptions = $derived([
		{ value: '', label: t('commercialization.filters.all_orgs') },
		...orgs.map((o) => ({ value: o.id, label: o.name || o.id }))
	]);
	const orgName = (id: string) => orgs.find((o) => o.id === id)?.name ?? '';
	const timeOnly = { year: undefined, month: undefined, day: undefined } as const;
</script>

{#snippet deviceCell(s: BillingSession)}
	<span class="cell-title">{s.device_name || s.device_id}</span>{#if s.device_id}<span class="cell-sub"
			><ValueCopy value={s.device_id} label="{t('commercialization.sessions.device')} {s.device_id}" /></span
		>{/if}
{/snippet}

{#snippet operatorCell(s: BillingSession)}<User user={s.operator_name || s.operator_id} />{/snippet}

{#snippet startedCell(s: BillingSession)}<Time value={s.started_at} relative={false} />{/snippet}

{#snippet endedCell(s: BillingSession)}
	{#if s.status === 'active'}
		<Empty word={t('commercialization.ui.still_running')} />
	{:else if sameDay(s.started_at, s.ended_at)}
		<Time value={s.ended_at} relative={false} format={timeOnly} />
	{:else}
		<Time value={s.ended_at} relative={false} />
	{/if}
{/snippet}

{#snippet billedCell(s: BillingSession)}
	{#if s.status === 'active'}<Empty word={t('commercialization.ui.billed_at_end')} />{:else}{formatMinutes(
			s.billed_minutes
		)}{/if}
{/snippet}

{#snippet statusCell(s: BillingSession)}
	<Status
		tone={STATUS_TONE[s.status] ?? s.status}
		label={tf(`commercialization.status.${s.status}`, s.status)}
	/>
{/snippet}

{#snippet reportCell(s: BillingSession)}
	{@const r = reports[s.id]}
	{#if r}
		{r.summary}
	{:else if s.status === 'active'}
		<Empty word={t('commercialization.ui.report_after_end')} />
	{:else if s.status === 'pending_report' && canWrite}
		<Button size="sm" class="write-report" icon={ICONS.edit} onclick={() => (reportFor = s)}
			>{t('commercialization.ui.write_report')}</Button
		>
	{:else if s.status === 'pending_report'}
		<Empty word={t('commercialization.ui.report_missing')} />
	{:else}
		<Empty />
	{/if}
{/snippet}

{#snippet actionsCell(s: BillingSession)}
	<Button size="sm" class="session-details" icon={ICONS.details} onclick={() => (detailsFor = s)}
		>{t('commercialization.ui.details')}</Button
	>
{/snippet}

<div class="cols summary">
	<section class="section" aria-labelledby="{uid}-pending">
		<div class="section-head"><h2 id="{uid}-pending">{t('commercialization.ui.pending_title')}</h2></div>
		{#if pending?.length}<p class="section-note">{t('commercialization.ui.pending_note')}</p>{/if}
		{#if pendingError}
			<States
				kind="error"
				message={t('commercialization.ui.error_sessions')}
				onretry={() => void loadPending()}
			/>
		{:else if pending === null}
			<States kind="loading" message={t('commercialization.ui.loading_sessions')} />
		{:else if !pending.length}
			<p class="muted">{t('commercialization.ui.pending_none')}</p>
		{:else}
			<RowList label={t('commercialization.ui.pending_title')}>
				{#each pending as s (s.id)}
					{@const parts = around('commercialization.ui.pending_row_sub', 'date', {
						operator: s.operator_name || s.operator_id
					})}
					<ListRow title={s.device_name || s.device_id} chevron onclick={() => openPending(s)}>
						{#snippet sub()}{parts[0]}<Time value={s.started_at} />{parts[1]}{/snippet}
					</ListRow>
				{/each}
			</RowList>
		{/if}
	</section>

	<section class="section" aria-labelledby="{uid}-usage">
		<div class="section-head"><h2 id="{uid}-usage">{t('commercialization.ui.usage_title')}</h2></div>
		<p class="section-note">{t('commercialization.ui.usage_note')}</p>
		{#if usageError}
			<States
				kind="error"
				message={t('commercialization.ui.error_assignments')}
				onretry={() => void loadUsage()}
			/>
		{:else if usage === null}
			<States kind="loading" message={t('commercialization.ui.loading_assignments')} />
		{:else if !usage.length}
			<p class="muted">
				{t('commercialization.ui.usage_empty')}
				{#if canManage}<a href={link('/commercialization?tab=packages')}
						>{t('commercialization.contracts.new')}</a
					>{/if}
			</p>
		{:else}
			<ul class="usage-list">
				{#each usage as row (row.contract.id)}
					<li class="usage-row">
						<span class="usage-main">
							<span class="cell-title">{row.contract.target_name || row.contract.target_key}</span>
							<span class="cell-sub">{row.packageName}</span>
							{#if row.included}
								<Meter
									value={row.used}
									max={row.included}
									high={80}
									full={100}
									text={t('commercialization.ui.used_of_included', {
										used: formatMinutes(row.used),
										included: formatMinutes(row.included)
									})}
								/>
							{:else}
								<span class="cell-sub">{t('commercialization.ui.no_included_time')}</span>
							{/if}
						</span>
						{#if row.contract.status === 'suspended'}
							<span class="usage-end"
								><Status tone="neutral" label={t('commercialization.status.suspended')} /></span
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<section class="section" id="tab-sessions" aria-labelledby="{uid}-all">
	<div class="section-head"><h2 id="{uid}-all">{t('commercialization.ui.all_sessions_title')}</h2></div>
	<div class="filters">
		<Field label={t('commercialization.filters.organization')}>
			{#snippet children(f)}<Select {...f} options={orgOptions} bind:value={orgId} />{/snippet}
		</Field>
		<Field label={t('commercialization.contracts.status')}>
			{#snippet children(f)}<Select {...f} options={statusOptions} bind:value={status} />{/snippet}
		</Field>
		<Field label={t('commercialization.sessions.device')}>
			{#snippet children(f)}<Input
					{...f}
					type="search"
					width="medium"
					autocomplete="off"
					bind:value={deviceInput}
				/>{/snippet}
		</Field>
		<div class="filters-end">
			<Button class="sessions-refresh" icon={ICONS.refresh} busy={loading} onclick={refreshAll}
				>{t('commercialization.actions.refresh')}</Button
			>
			{#if canExport}
				<MenuButton label={t('commercialization.ui.export')} icon={ICONS.export} align="end">
					<MenuItem class="export-sessions" icon={ICONS.download} href={sessionsExportUrl(filter)} download
						>{t('commercialization.ui.export_sessions_csv')}</MenuItem
					>
					<MenuItem
						class="export-reports-csv"
						icon={ICONS.download}
						href={reportsExportUrl('csv', orgId)}
						download>{t('commercialization.ui.export_reports_csv')}</MenuItem
					>
					<MenuItem
						class="export-reports-pdf"
						icon={ICONS.download}
						href={reportsExportUrl('pdf', orgId)}
						download>{t('commercialization.ui.export_reports_pdf')}</MenuItem
					>
				</MenuButton>
			{/if}
		</div>
	</div>
	{#if runningMissing}
		<Notice tone="warning" message={t('commercialization.ui.running_unreadable')} />
	{/if}
	<div class="count" aria-live="polite">
		{#if sessions?.length}
			<CountLine
				text={t('commercialization.ui.sessions_count') +
					(activeCount
						? ', ' + t('commercialization.ui.sessions_active').replace('{count}', '{active}')
						: '')}
				values={{ count: sessions.length, active: activeCount }}
			/>
		{/if}
	</div>
	<div class="sessions-table">
		<Table
			{rows}
			{columns}
			key={(s) => s.id}
			label={t('commercialization.ui.all_sessions_title')}
			onrowclick={(s) => (detailsFor = s)}
			loading={sessions === null && !sessionsError}
			loadingText={t('commercialization.ui.loading_sessions')}
			error={sessionsError}
			onretry={() => void loadSessions()}
			emptyText={filtered
				? t('commercialization.ui.no_match_sessions')
				: t('commercialization.empty.sessions')}
		/>
	</div>
</section>

{#if detailsFor}
	{@const s = detailsFor}
	<SessionSheet
		session={s}
		report={reports[s.id] ?? null}
		orgName={orgName(s.org_id)}
		{canWrite}
		onwrite={() => {
			detailsFor = null;
			reportFor = s;
		}}
		onclose={() => (detailsFor = null)}
	/>
{/if}

{#if reportFor}
	<ReportDialog
		session={reportFor}
		onclose={() => (reportFor = null)}
		onsaved={() => {
			reportFor = null;
			void loadSessions();
			void loadPending();
		}}
	/>
{/if}

<style>
	.summary {
		align-items: start;
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.muted a {
		margin-inline-start: var(--space-1);
	}
	.cell-title {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.usage-list {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.usage-row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
	}
	.usage-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.usage-main :global(.meter) {
		margin-top: var(--space-1);
	}
	.usage-end {
		flex: none;
	}
	/* Filters with their labels above, in one row */
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-2) var(--space-3);
	}
	.filters > :global(*) {
		margin-bottom: 0;
		min-width: 160px;
	}
	.filters-end {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-inline-start: auto;
	}
	.count {
		min-height: 1.5em;
	}
	.sessions-table :global(td.col-nowrap) {
		white-space: nowrap;
	}
	/* Long work report summaries wrap instead of widening the table */
	.sessions-table :global(td.col-report) {
		min-width: 160px;
		max-width: 420px;
	}
	/* A running session's billed time is a short sentence: it may wrap */
	.sessions-table :global(td.col-billed .value-empty) {
		white-space: normal;
	}
</style>
