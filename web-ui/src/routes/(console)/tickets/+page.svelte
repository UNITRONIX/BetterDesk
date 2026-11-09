<!--
  Tickets (/tickets): issues tracked until they are solved. The table
  lists every ticket the user may see (viewers: the ones assigned to
  them); search, status and priority narrow it. A click on a row opens the
  ticket in a wide sheet (facts, status actions, attachments, comments);
  New ticket and Edit open the form sheet. Beside the table: tickets by
  status (each part filters), open tickets by priority, and the overdue
  ones (each opens its ticket).

  Data: GET /api/tickets once, filtered here (the old page asked the
  server again for every filter and keystroke, plus once for the side
  column). Again every 60 s while the tab is visible, on Refresh and after
  every change. Reading needs device.view, changing device.edit (P20/A11).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { deleteTicket, listTickets, type Ticket } from '#lib/api/tickets.ts';
	import { formatNumber, formatRelative } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column, SortState } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import ShareFilter, { type ShareFilterPart } from '#lib/support/ShareFilter.svelte';
	import {
		countByStatus,
		createdIsOld,
		filterTickets,
		isFiltered,
		isOverdue,
		openByPriority,
		overdueTickets,
		priorityTone,
		safeKey,
		statusTone,
		type PriorityFilter,
		type StatusFilter
	} from '#lib/support/tickets.ts';
	import TicketFormSheet from './TicketFormSheet.svelte';
	import TicketSheet from './TicketSheet.svelte';

	const canEdit = $derived(can('device.edit'));
	const canOpenDevice = $derived(can('device.view'));

	/* ── Data ── */

	let tickets = $state.raw<Ticket[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let inflight: AbortController | null = null;

	async function load(): Promise<void> {
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		try {
			const list = await listTickets(ctrl.signal);
			if (inflight !== ctrl) return;
			tickets = list;
			loaded = true;
			loadError = null;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			loaded = true;
			if (!tickets.length)
				loadError = `${t('tickets.load_failed')} ${err instanceof Error ? err.message : ''}`.trim();
			throw err;
		}
	}
	const reload = () => void load().catch(() => undefined);

	$effect(() => poll(load, { every: 60_000 }));
	$effect(() => onRefresh(reload));
	$effect(() => () => untrack(() => inflight?.abort()));

	/* ── Filters ── */

	let search = $state('');
	let status = $state<StatusFilter>('');
	let priority = $state<PriorityFilter>('');
	let sort = $state<SortState | null>(null);
	const filters = $derived({ status, priority, search });
	const rows = $derived(filterTickets(tickets, filters));
	const filtered = $derived(isFiltered(filters));

	const statusOptions = $derived([
		{ value: '' as const, label: t('tickets.filter_all') },
		{ value: 'open' as const, label: t('tickets.status_open') },
		{ value: 'in_progress' as const, label: t('tickets.status_in_progress') },
		{ value: 'resolved' as const, label: t('tickets.status_resolved') },
		{ value: 'closed' as const, label: t('tickets.status_closed') }
	]);
	const priorityOptions = $derived([
		{ value: '' as const, label: t('tickets.all_priorities') },
		{ value: 'critical' as const, label: t('tickets.priority_critical') },
		{ value: 'high' as const, label: t('tickets.priority_high') },
		{ value: 'medium' as const, label: t('tickets.priority_medium') },
		{ value: 'low' as const, label: t('tickets.priority_low') }
	]);

	/* ── Sheets ── */

	type SheetState =
		{ kind: 'detail'; id: number } | { kind: 'form'; ticket: Ticket | null; back: number | null } | null;
	let sheet = $state<SheetState>(null);
	let menuFor = $state<number | null>(null);

	const byId = (id: number) => tickets.find((x) => x.id === id);

	function openTicket(id: number) {
		sheet = { kind: 'detail', id };
	}

	async function remove(ticket: Ticket): Promise<boolean> {
		const ok = await confirm({
			title: t('tickets.delete_title', { id: ticket.id }),
			message: t('tickets.delete_confirm', { id: ticket.id, title: ticket.title }),
			confirmLabel: t('tickets.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return false;
		try {
			await deleteTicket(ticket.id);
			toast.success(t('tickets.delete_success', { id: ticket.id }));
			reload();
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('tickets.load_failed'));
			return false;
		}
	}

	/* ── Table ── */

	const columns = $derived<Column<Ticket>[]>([
		{ id: 'id', label: '#', cell: idCell, sortValue: (x) => x.id, align: 'num', class: 'col-id' },
		{
			id: 'title',
			label: t('tickets.ticket_title'),
			cell: titleCell,
			primary: true,
			sortValue: (x) => x.title.toLowerCase(),
			class: 'col-title'
		},
		{
			id: 'status',
			label: t('tickets.status'),
			cell: statusCell,
			sortValue: (x) => x.status,
			class: 'col-status'
		},
		{
			id: 'priority',
			label: t('tickets.priority'),
			cell: priorityCell,
			sortValue: (x) => ['critical', 'high', 'medium', 'low'].indexOf(x.priority),
			class: 'col-priority'
		},
		{
			id: 'category',
			label: t('tickets.category'),
			cell: categoryCell,
			sortValue: (x) => x.category,
			class: 'col-category'
		},
		{
			id: 'assignee',
			label: t('tickets.assigned_to'),
			cell: assigneeCell,
			sortValue: (x) => x.assigned_to.toLowerCase(),
			class: 'col-assignee'
		},
		{
			id: 'device',
			label: t('tickets.device'),
			cell: deviceCell,
			sortValue: (x) => x.device_id,
			class: 'col-device'
		},
		{
			id: 'created',
			label: t('tickets.created_at'),
			cell: createdCell,
			sortValue: (x) => x.created_at,
			class: 'col-created'
		},
		...(canEdit
			? [
					{
						id: 'actions',
						label: t('common.actions'),
						labelHidden: true,
						cell: actionsCell,
						align: 'actions' as const,
						class: 'col-actions'
					}
				]
			: [])
	]);

	function emptyText(): string {
		if (filtered) return t('tickets.empty_filtered');
		// Viewers get only the tickets assigned to them (the server filters by role name)
		if (session.user?.role === 'viewer') return t('tickets.empty_viewer');
		return canEdit ? t('tickets.empty') : t('tickets.no_tickets');
	}

	/* ── Side column ── */

	const byStatus = $derived(countByStatus(tickets));
	const shareParts = $derived<ShareFilterPart<'open' | 'in_progress' | 'resolved' | 'closed'>[]>([
		{ value: 'open', count: byStatus.open, label: t('tickets.share_open'), tone: 'warning' },
		{
			value: 'in_progress',
			count: byStatus.in_progress,
			label: t('tickets.share_in_progress'),
			tone: 'accent'
		},
		{ value: 'resolved', count: byStatus.resolved, label: t('tickets.share_resolved'), tone: 'ok' },
		{ value: 'closed', count: byStatus.closed, label: t('tickets.share_closed'), tone: 'muted' }
	]);
	const active = $derived(openByPriority(tickets));
	const anyActive = $derived(byStatus.open + byStatus.in_progress > 0);
	const overdue = $derived(overdueTickets(tickets));
</script>

{#snippet idCell(x: Ticket)}{x.id}{/snippet}

{#snippet priorityStatus(x: Ticket)}<Status
		tone={priorityTone(x.priority)}
		label={t(`tickets.priority_${safeKey(x.priority)}`)}
	/>{/snippet}

{#snippet titleCell(x: Ticket)}<span class="ticket-title">{x.title}</span>{#if isOverdue(x)}<span
			class="cell-sub sla-overdue">{t('tickets.sla_overdue')}</span
		>{/if}<span class="narrow-meta"
		>{@render priorityStatus(x)}, <User user={x.assigned_to || null} empty={t('tickets.unassigned')} /></span
	>{/snippet}

{#snippet statusCell(x: Ticket)}<Status
		tone={statusTone(x.status)}
		label={t(`tickets.status_${safeKey(x.status)}`)}
	/>{/snippet}

{#snippet priorityCell(x: Ticket)}{@render priorityStatus(x)}{/snippet}

{#snippet categoryCell(x: Ticket)}{#if x.category}<Tag
			label={tf(`tickets.category_${safeKey(x.category)}`, x.category)}
		/>{:else}<Empty />{/if}{/snippet}

{#snippet assigneeCell(x: Ticket)}<User
		user={x.assigned_to || null}
		avatar
		empty={t('tickets.unassigned')}
	/>{/snippet}

{#snippet deviceCell(x: Ticket)}{#if x.device_id}{#if canOpenDevice}<Button
				variant="link"
				class="mono ticket-device"
				onclick={() => openDevice(x.device_id)}>{x.device_id}</Button
			>{:else}<span class="mono">{x.device_id}</span>{/if}{/if}{/snippet}

{#snippet createdCell(x: Ticket)}{#if createdIsOld(x.created_at)}<Time
			value={x.created_at}
			relative={false}
			format={{ hour: undefined, minute: undefined }}
		/>{:else}<Time value={x.created_at} />{/if}{/snippet}

{#snippet actionsCell(x: Ticket)}<MenuButton
		kebab
		label={t('tickets.actions_for', { id: x.id })}
		bind:open={() => menuFor === x.id, (v) => (menuFor = v ? x.id : menuFor === x.id ? null : menuFor)}
	>
		<MenuItem icon={ICONS.edit} onselect={() => (sheet = { kind: 'form', ticket: x, back: null })}
			>{t('actions.edit')}</MenuItem
		>
		<MenuDivider />
		<MenuItem icon={ICONS.delete} danger onselect={() => void remove(x)}>{t('actions.delete')}</MenuItem>
	</MenuButton>{/snippet}

<div class="page page-wide tickets-page">
	<div class="page-head">
		<h1>{t('nav.tickets')}</h1>
		<p class="page-description">{t('tickets.page_description')}</p>
		{#if canEdit}
			<div class="page-actions">
				<Button
					variant="primary"
					icon={ICONS.add}
					onclick={() => (sheet = { kind: 'form', ticket: null, back: null })}>{t('tickets.create')}</Button
				>
			</div>
		{/if}
	</div>

	<div class="page-cols">
		<div class="page-main">
			<section class="section tickets-list" aria-label={t('nav.tickets')}>
				<div class="toolbar">
					<div class="toolbar-search">
						<SearchField label={t('tickets.search_placeholder')} bind:value={search} />
					</div>
					<SegmentedFilter label={t('tickets.status')} options={statusOptions} bind:value={status} />
					<div class="toolbar-end">
						<Select aria-label={t('tickets.priority')} options={priorityOptions} bind:value={priority} />
					</div>
				</div>
				<p class="count-line" aria-live="polite">
					{#if loaded && !loadError}
						{#if filtered}
							<CountLine
								text={t('tickets.count_filtered')}
								values={{ shown: rows.length, total: tickets.length }}
							/>
						{:else}
							<CountLine text={t('tickets.count_total')} values={{ total: tickets.length }} />
						{/if}
					{/if}
				</p>
				<div class="tickets-table">
					<Table
						{rows}
						{columns}
						key={(x) => String(x.id)}
						label={t('nav.tickets')}
						bind:sort
						onrowclick={(x) => openTicket(x.id)}
						loading={!loaded}
						loadingText={t('tickets.loading')}
						error={loadError}
						onretry={reload}
						emptyText={emptyText()}
					/>
				</div>
			</section>
		</div>

		<aside class="page-side" aria-label={t('tickets.side_label')}>
			<!-- Every section here sums up the list: filled once it is in, so the
			     sections don't grow and move as it arrives -->
			{#if loaded}
				<section class="section" aria-labelledby="tickets-share-title">
					<div class="section-head"><h2 id="tickets-share-title">{t('tickets.share_title')}</h2></div>
					{#if loadError && !tickets.length}
						<p class="muted">{t('tickets.summary_failed')}</p>
					{:else}
						<ShareFilter
							parts={shareParts}
							label={t('tickets.share_title')}
							current={status || null}
							onpick={(v) => (status = v)}
						/>
					{/if}
				</section>

				{#if anyActive}
					<section class="section" aria-labelledby="tickets-priority-title">
						<div class="section-head">
							<h2 id="tickets-priority-title">{t('tickets.open_by_priority')}</h2>
						</div>
						<p class="section-note">{t('tickets.open_by_priority_note')}</p>
						<dl class="facts priority-facts">
							{#each ['critical', 'high', 'medium', 'low'] as const as p (p)}
								<dt>{t(`tickets.priority_${p}`)}</dt>
								<dd>{formatNumber(active[p])}</dd>
							{/each}
						</dl>
					</section>
				{/if}

				<section class="section" aria-labelledby="tickets-overdue-title">
					<div class="section-head"><h2 id="tickets-overdue-title">{t('tickets.overdue_title')}</h2></div>
					<p class="section-note">{t('tickets.overdue_note')}</p>
					<RowList>
						{#if loadError && !tickets.length}
							<ListRow empty title={t('tickets.summary_failed')} />
						{:else if !overdue.length}
							<ListRow empty title={t('tickets.overdue_none')} />
						{:else}
							{#each overdue as x (x.id)}
								<ListRow
									title={x.title}
									sub={t('tickets.overdue_row', {
										id: x.id,
										priority: t(`tickets.priority_${safeKey(x.priority)}`),
										time: formatRelative(x.sla_due_at, '')
									})}
									chevron
									onclick={() => openTicket(x.id)}
								/>
							{/each}
						{/if}
					</RowList>
				</section>
			{/if}
		</aside>
	</div>
</div>

{#if sheet?.kind === 'detail'}
	{@const id = sheet.id}
	<TicketSheet
		{id}
		initial={byId(id)}
		onclose={() => (sheet = null)}
		onchanged={reload}
		onedit={(x) => (sheet = { kind: 'form', ticket: x, back: x.id })}
		ondelete={remove}
	/>
{:else if sheet?.kind === 'form'}
	{@const back = sheet.back}
	{@const isNew = sheet.ticket === null}
	<TicketFormSheet
		ticket={sheet.ticket}
		onclose={() => (sheet = back !== null ? { kind: 'detail', id: back } : null)}
		onsaved={(id) => {
			reload();
			// Edited from the ticket: back to it. A new ticket opens, so files can be attached right away
			sheet = back !== null || isNew ? { kind: 'detail', id } : null;
		}}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.toolbar-search {
		flex: 1 1 200px;
		min-width: 0;
		max-width: 320px;
	}
	.toolbar-end {
		margin-inline-start: auto;
	}
	.count-line {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.tickets-list {
		container: tickets / inline-size;
	}
	.ticket-title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.sla-overdue {
		color: var(--warning);
		font-weight: 600;
	}
	.narrow-meta {
		display: none;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.tickets-table :global(:is(th, td).col-id) {
		width: 1%;
		color: var(--text-muted);
	}
	.tickets-table :global(th.col-title) {
		min-width: 220px;
		font-weight: inherit;
	}
	.tickets-table :global(.row-open) {
		text-align: start;
		white-space: normal;
	}
	.tickets-table :global(td.col-created) {
		color: var(--text-muted);
		white-space: nowrap;
	}
	.priority-facts {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	.priority-facts > dd {
		justify-content: flex-end;
		font-variant-numeric: tabular-nums;
	}

	/* The list beside the side column: category and device go (both are in the ticket) */
	@container tickets (max-width: 860px) {
		.tickets-table :global(:is(th, td).col-category),
		.tickets-table :global(:is(th, td).col-device) {
			display: none;
		}
		.tickets-table :global(th.col-title) {
			min-width: 180px;
		}
	}
	/* Narrow: priority and assignee move under the title */
	@container tickets (max-width: 600px) {
		.tickets-table :global(:is(th, td):is(.col-id, .col-priority, .col-assignee, .col-created)) {
			display: none;
		}
		.narrow-meta {
			display: block;
		}
		.tickets-table :global(th.col-title) {
			min-width: 0;
		}
	}
	@media (max-width: 640px) {
		.priority-facts > dt {
			min-height: var(--row-h);
			padding-bottom: var(--row-pad-y);
			border-bottom: 1px solid var(--rule);
			font-size: inherit;
		}
		.priority-facts > dd {
			padding-top: var(--row-pad-y);
		}
	}
	@media (pointer: coarse) {
		.tickets-table :global(.row-open),
		.tickets-table :global(.ticket-device) {
			display: inline-flex;
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
