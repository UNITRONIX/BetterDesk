<!--
  Help requests (/help-requests): someone pressed the help button in the
  desktop app. The table lists them (waiting and accepted first by
  default); an operator accepts one, connects and marks it resolved. A
  click on a row opens the device panel. Beside the table: requests by
  status (each part filters the table) and opened/resolved per day.

  Data: GET /api/help/requests (newest 200) every 5 s while the tab is
  visible, on Refresh and on a help_request panel event. The list and its
  actions need chat.access (P17): without it the page says so in one line
  instead of a list that fails.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import {
		acceptHelpRequest,
		HELP_LIST_LIMIT,
		listHelpRequests,
		resolveHelpRequest,
		type HelpRequest
	} from '#lib/api/helpRequests.ts';
	import { ApiError } from '#lib/api/client.ts';
	import * as act from '#lib/devices/actions.svelte.ts';
	import { formatNumber, formatRelative, parseDate } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onPanelEvents } from '#lib/shell/live-events.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import { readPref, writePref } from '#lib/util/storage.ts';
	import ShareFilter, { type ShareFilterPart } from '#lib/support/ShareFilter.svelte';
	import {
		countWaiting,
		mergeFresh,
		oldestWaiting,
		PREF_HELP_SORT,
		statusCounts,
		statusTone,
		trend,
		visibleRequests,
		type HelpFilter,
		type HelpSort,
		type LocalRequest
	} from '#lib/support/help-requests.ts';

	const POLL_MS = 5000;

	const allowed = $derived(can('chat.access'));

	/* ── Data ── */

	let requests = $state.raw<LocalRequest[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let filter = $state<HelpFilter>('open');
	let sort = $state<HelpSort>(readPref(PREF_HELP_SORT) === 'newest' ? 'newest' : 'oldest');
	/** Requests changed here stay in view until the filter changes */
	let touched = $state.raw<ReadonlySet<string>>(new Set());
	let busy = $state.raw<ReadonlySet<string>>(new Set());
	let live = $state('');
	let inflight: AbortController | null = null;

	function failure(err: unknown, key: string): string {
		if (err instanceof ApiError && (err.isPermission || err.isNetwork)) return err.message;
		return t(key);
	}

	async function load(): Promise<void> {
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		try {
			const fresh = await listHelpRequests(ctrl.signal);
			if (inflight !== ctrl) return;
			const before = countWaiting(requests);
			const first = !loaded;
			requests = mergeFresh(requests, fresh);
			loaded = true;
			loadError = null;
			if (!first && countWaiting(fresh) > before) chime();
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			// A failed poll keeps the list it has; only the first load shows the error
			if (!loaded) loadError = failure(err, 'help_request.load_failed');
			throw err;
		}
	}

	$effect(() => {
		if (!allowed) return;
		return poll(load, { every: POLL_MS });
	});
	$effect(() => {
		if (!allowed) return;
		const quiet = () => void load().catch(() => undefined);
		const offRefresh = onRefresh(quiet);
		const offEvents = onPanelEvents((p) => {
			if (p.type === 'help_request') quiet();
		});
		return () => {
			offRefresh();
			offEvents();
			inflight?.abort();
		};
	});

	/** A short tone when someone new is waiting (as the old page did) */
	function chime() {
		try {
			const Ctx =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!Ctx) return;
			const ctx = new Ctx();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.frequency.value = 880;
			osc.type = 'sine';
			gain.gain.setValueAtTime(0.3, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
			osc.start(ctx.currentTime);
			osc.stop(ctx.currentTime + 0.5);
			osc.onended = () => void ctx.close();
		} catch {
			/* no audio */
		}
	}

	/* ── Actions ── */

	function announce(text: string) {
		live = '';
		setTimeout(() => (live = text), 50);
	}

	function me(): string {
		return session.user?.username ?? '';
	}

	async function change(r: HelpRequest, action: 'accept' | 'resolve') {
		if (busy.has(r.id)) return;
		busy = new Set([...busy, r.id]);
		try {
			if (action === 'accept') await acceptHelpRequest(r.id);
			else await resolveHelpRequest(r.id);
		} catch (err) {
			toast.error(
				failure(err, action === 'accept' ? 'help_request.accept_failed' : 'help_request.resolve_failed')
			);
			return;
		} finally {
			busy = new Set([...busy].filter((id) => id !== r.id));
		}
		const now = Date.now();
		requests = requests.map((x) =>
			x.id !== r.id
				? x
				: action === 'accept'
					? { ...x, status: 'accepted', accepted_by: me(), updated_at: now, local: true }
					: { ...x, status: 'resolved', resolved_by: me(), updated_at: now, local: true }
		);
		touched = new Set([...touched, r.id]);
		announce(action === 'accept' ? t('help_request.accepted_live') : t('help_request.resolved_live'));
		// After Accept the next step is Connect; after Resolve, the row's first button
		await tick();
		const row = document.querySelector<HTMLElement>(`.hr-table tr[data-key="${CSS.escape(r.id)}"]`);
		(row?.querySelector<HTMLElement>('.hr-connect .btn') ?? row?.querySelector<HTMLElement>('.btn'))?.focus();
	}

	function connectApp(r: HelpRequest) {
		if (act.connectInApp({ id: r.device_id })) toast.info(t('help_request.app_opening'));
	}

	function pickFilter(next: HelpFilter) {
		filter = next;
		touched = new Set();
	}

	function setSort(next: HelpSort) {
		sort = next;
		writePref(PREF_HELP_SORT, next);
	}

	/* ── View ── */

	const rows = $derived(visibleRequests(requests, filter, sort, touched));
	const counts = $derived(statusCounts(requests));
	const oldest = $derived(oldestWaiting(requests));
	const canConnect = $derived(can('device.connect'));
	const canOpen = $derived(can('device.view'));

	/** Which row's Connect menu is open (kept across polls) */
	let menuFor = $state<string | null>(null);

	const filterOptions = $derived([
		{ value: 'open' as const, label: t('help_request.filter_open') },
		{ value: 'pending' as const, label: t('help_request.filter_waiting') },
		{ value: 'accepted' as const, label: t('help_request.accepted') },
		{ value: 'resolved' as const, label: t('help_request.resolved') },
		{ value: '' as const, label: t('help_request.filter_all') }
	]);
	const sortOptions = $derived([
		{ value: 'oldest' as const, label: t('help_request.sort_oldest') },
		{ value: 'newest' as const, label: t('help_request.sort_newest') }
	]);

	function statusLabel(r: HelpRequest): string {
		if (r.status === 'pending') return t('help_request.status_waiting');
		if (r.status === 'accepted') return t('help_request.accepted');
		if (r.status === 'resolved') return t('help_request.resolved');
		return r.status;
	}

	function statusBy(r: HelpRequest): string {
		if (r.status === 'accepted' && r.accepted_by) return t('help_request.by_name', { name: r.accepted_by });
		if (r.status === 'resolved' && r.resolved_by) return t('help_request.by_name', { name: r.resolved_by });
		return '';
	}

	function emptyText(): string {
		if (filter === 'open') return t('help_request.empty_open');
		if (filter === 'pending') return t('help_request.empty_waiting');
		if (filter === 'accepted') return t('help_request.empty_accepted');
		if (filter === 'resolved') return t('help_request.empty_resolved');
		return t('help_request.empty_all');
	}

	const columns = $derived<Column<HelpRequest>[]>([
		{
			id: 'message',
			label: t('help_request.message'),
			cell: messageCell,
			primary: true,
			class: 'col-message'
		},
		{ id: 'device', label: t('help_request.device'), cell: deviceCell, class: 'col-device' },
		{ id: 'age', label: t('help_request.col_asked'), cell: ageCell, class: 'col-age' },
		{ id: 'status', label: t('help_request.status'), cell: statusCell, class: 'col-status' },
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions',
			class: 'col-actions'
		}
	]);

	const shareParts = $derived<ShareFilterPart<'pending' | 'accepted' | 'resolved'>[]>([
		{ value: 'pending', count: counts.pending, label: t('help_request.share_waiting'), tone: 'accent' },
		{ value: 'accepted', count: counts.accepted, label: t('help_request.share_accepted'), tone: 'ok' },
		{ value: 'resolved', count: counts.resolved, label: t('help_request.share_resolved'), tone: 'muted' }
	]);

	const trendData = $derived(trend(requests, HELP_LIST_LIMIT));
	const chart = $derived.by(() => {
		const d = trendData;
		const dayFmt = new Intl.DateTimeFormat(i18n.locale, { day: 'numeric', month: 'short' });
		const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
		const series = [{ name: t('help_request.trend_opened'), values: d.opened }];
		if (d.hasUpdated) series.push({ name: t('help_request.trend_resolved'), values: d.resolved });
		let summary = d.hasUpdated
			? t('help_request.trend_summary', {
					opened: formatNumber(sum(d.opened)),
					resolved: formatNumber(sum(d.resolved))
				})
			: t('help_request.trend_summary_opened', { opened: formatNumber(sum(d.opened)) });
		if (d.capped) summary += ' ' + t('help_request.trend_capped', { count: formatNumber(HELP_LIST_LIMIT) });
		return { labels: d.days.map((x) => dayFmt.format(x)), series, summary };
	});

	const countText = $derived(
		oldest
			? t('help_request.count_oldest', { age: formatRelative(parseDate(oldest.created_at), '') })
			: t('help_request.count_none')
	);

	// The device of a row opens the panel (with device.view)
	function openRow(r: HelpRequest) {
		if (r.device_id && canOpen) openDevice(r.device_id);
	}

	// Leaving the page: stop asking
	$effect(() => () => untrack(() => inflight?.abort()));
</script>

{#snippet deviceLine(r: HelpRequest)}{#if r.hostname}<span class="hr-host">{r.hostname}</span>{:else}<span
			class="hr-host is-missing">{t('help_request.no_device_name')}</span
		>{/if}{/snippet}

{#snippet messageCell(r: HelpRequest)}{#if r.message}<span class="hr-message" id="hr-msg-{r.id}"
			>{r.message}</span
		>{:else}<span class="hr-message is-missing" id="hr-msg-{r.id}">{t('help_request.no_message')}</span
		>{/if}<span class="hr-sub-narrow"
		>{@render deviceLine(r)}, <ValueCopy value={r.device_id} copy={false} />,
		<Time value={r.created_at} empty={t('common.not_available')} /></span
	>{/snippet}

{#snippet deviceCell(r: HelpRequest)}{@render deviceLine(r)}<span class="cell-sub"
		><ValueCopy value={r.device_id} copy={false} /></span
	>{/snippet}

{#snippet ageCell(r: HelpRequest)}<Time value={r.created_at} empty={t('common.not_available')} />{/snippet}

{#snippet statusCell(r: HelpRequest)}{@const by = statusBy(r)}<Status
		tone={statusTone(r.status)}
		label={statusLabel(r)}
	/>{#if by}<span class="cell-sub">{by}</span>{/if}{/snippet}

{#snippet actionsCell(r: HelpRequest)}
	<span class="hr-actions">
		{#if r.status === 'pending'}
			<Button
				size="sm"
				icon={ICONS.accept}
				busy={busy.has(r.id)}
				aria-describedby="hr-msg-{r.id}"
				onclick={() => void change(r, 'accept')}
				>{busy.has(r.id) ? t('help_request.working') : t('help_request.accept')}</Button
			>
		{/if}
		{#if r.status !== 'resolved' && r.device_id && canConnect}
			<MenuButton
				class="hr-connect"
				size="sm"
				icon={ICONS.connect}
				align="end"
				label={t('help_request.connect')}
				describedby="hr-msg-{r.id}"
				bind:open={() => menuFor === r.id, (v) => (menuFor = v ? r.id : menuFor === r.id ? null : menuFor)}
			>
				<MenuItem icon={ICONS.connect} onselect={() => void act.connectInBrowser({ id: r.device_id })}>
					<span class="hr-connect-text">
						<span class="hr-connect-title">{t('help_request.connect_web')}</span>
						<span class="hr-connect-desc">{t('help_request.connect_web_desc')}</span>
					</span>
				</MenuItem>
				<MenuItem icon={ICONS.connect_app} onselect={() => connectApp(r)}>
					<span class="hr-connect-text">
						<span class="hr-connect-title">{t('help_request.connect_app')}</span>
						<span class="hr-connect-desc">{t('help_request.connect_app_desc')}</span>
					</span>
				</MenuItem>
			</MenuButton>
		{/if}
		{#if r.status !== 'resolved'}
			<Button
				size="sm"
				icon={ICONS.resolve}
				disabled={busy.has(r.id)}
				aria-describedby="hr-msg-{r.id}"
				onclick={() => void change(r, 'resolve')}>{t('help_request.mark_resolved')}</Button
			>
		{/if}
	</span>
{/snippet}

<div class="page page-wide help-requests-page">
	<div class="page-head">
		<h1>{t('nav.help_requests')}</h1>
		<p class="page-description">
			{t('help_request.page_description')}
			{#each t('help_request.page_related').split(/(\{tickets\}|\{chat\})/) as part, i (i)}{#if part === '{tickets}'}<a
						href={link('/tickets')}>{t('nav.tickets')}</a
					>{:else if part === '{chat}'}<a href={link('/chat')}>{t('nav.chat')}</a>{:else}{part}{/if}{/each}
		</p>
	</div>

	{#if !allowed}
		<Notice
			tone="info"
			message={tf(
				'help_request.needs_chat',
				'Help requests are shown to roles with chat access. Ask an administrator if you need them.'
			)}
		/>
	{:else}
		<div class="page-cols">
			<div class="page-main">
				<section class="section hr-list" aria-label={t('nav.help_requests')}>
					<div class="toolbar">
						<SegmentedFilter
							label={t('help_request.status')}
							options={filterOptions}
							value={filter}
							onchange={pickFilter}
						/>
						<div class="toolbar-end">
							<Select
								aria-label={t('help_request.sort_label')}
								options={sortOptions}
								value={sort}
								onchange={(e) =>
									setSort((e.currentTarget as HTMLSelectElement).value === 'newest' ? 'newest' : 'oldest')}
							/>
						</div>
					</div>
					{#if loaded && !loadError}<p class="count-line">{countText}</p>{/if}
					<p class="sr-only" aria-live="polite">{live}</p>
					<div class="hr-table">
						<Table
							rows={loaded ? rows : []}
							{columns}
							key={(r) => r.id}
							label={t('nav.help_requests')}
							onrowclick={canOpen ? openRow : undefined}
							loading={!loaded}
							loadingText={t('help_request.loading')}
							error={loadError}
							onretry={() => {
								loadError = null;
								loaded = false;
								void load().catch(() => undefined);
							}}
							emptyText={emptyText()}
						/>
					</div>
				</section>
			</div>

			<aside class="page-side" aria-label={t('help_request.side_label')}>
				<section class="section" aria-labelledby="hr-share-title">
					<div class="section-head"><h2 id="hr-share-title">{t('help_request.share_title')}</h2></div>
					<ShareFilter
						parts={shareParts}
						label={t('help_request.share_title')}
						current={filter === 'pending' || filter === 'accepted' || filter === 'resolved' ? filter : null}
						onpick={pickFilter}
					/>
				</section>

				<section class="section" aria-labelledby="hr-trend-title">
					<div class="section-head"><h2 id="hr-trend-title">{t('help_request.trend_title')}</h2></div>
					{#if trendData.hasUpdated}<p class="section-note">{t('help_request.trend_note')}</p>{/if}
					{#if loaded}
						<Chart
							kind="columns"
							label={t('help_request.trend_title')}
							summary={chart.summary}
							labels={chart.labels}
							series={chart.series}
							format="number"
							xHeading={t('help_request.trend_day')}
						/>
					{/if}
				</section>
			</aside>
		</div>
	{/if}
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.toolbar-end {
		margin-inline-start: auto;
	}
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.hr-list {
		container: hrlist / inline-size;
	}

	.hr-message {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.hr-message.is-missing,
	.hr-host.is-missing {
		color: var(--text-muted);
		font-weight: 400;
	}
	.hr-host {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.hr-table :global(td.col-age) {
		color: var(--text-muted);
		white-space: nowrap;
	}
	.hr-table :global(th.col-message) {
		min-width: 220px;
		font-weight: inherit;
	}
	.hr-table :global(.row-open) {
		text-align: start;
		white-space: normal;
	}
	.hr-actions {
		display: inline-flex;
		flex-wrap: nowrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}

	/* Connect menu: each way to connect with one line on what it needs */
	.hr-connect-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		max-width: 18rem;
		padding-block: var(--space-1);
		white-space: normal;
	}
	.hr-connect-title {
		font-weight: 600;
	}
	.hr-connect-desc {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	/* Device, ID and age go under the status when the list is narrower */
	.hr-sub-narrow {
		display: none;
	}
	@container hrlist (max-width: 760px) {
		.hr-table :global(:is(th, td).col-device),
		.hr-table :global(:is(th, td).col-age) {
			display: none;
		}
		.hr-sub-narrow {
			display: block;
			color: var(--text-muted);
			font-size: var(--text-sm);
			font-weight: 400;
		}
		.hr-table :global(th.col-message) {
			min-width: 160px;
		}
	}

	/* Phone: the message, then device, ID and age, then the status, and the
	   actions on their own line */
	@container hrlist (max-width: 560px) {
		.hr-table :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.hr-table :global(table),
		.hr-table :global(tbody) {
			display: block;
		}
		.hr-table :global(tbody tr:not(.state-row)) {
			display: flex;
			flex-direction: column;
			gap: var(--space-1);
			padding: var(--space-3) var(--row-pad-x);
			border-bottom: 1px solid var(--rule);
		}
		.hr-table :global(tbody tr:not(.state-row) > :is(td, th)) {
			display: block;
			height: auto;
			min-width: 0;
			padding: 0;
			border: 0;
			background: transparent;
			text-align: start;
			white-space: normal;
		}
		.hr-table :global(tbody tr:not(.state-row) > :is(td, th).col-device),
		.hr-table :global(tbody tr:not(.state-row) > :is(td, th).col-age) {
			display: none;
		}
		.hr-actions {
			flex-wrap: wrap;
			justify-content: flex-start;
			margin-top: var(--space-1);
		}
	}

	/* Touch: the row's button (the message and the line under it) is a full target */
	@media (pointer: coarse) {
		.hr-table :global(.row-open) {
			display: inline-flex;
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
