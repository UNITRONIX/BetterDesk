<!--
  Data loss prevention (/dataguard, ?tab=events). Two tabs: the policies
  (search, create, edit and delete in a sheet; a click on a row opens it)
  and the events devices reported (search, filter by action, the share of
  blocked, logged and allowed).

  Who: server.config (the page route). Events need audit.view; without it
  the Events tab and the Events column stay out instead of failing.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { listDlpEvents, listDlpPolicies, type DlpEvent, type DlpPolicy } from '#lib/api/dataguard.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import {
		actionLabel,
		countByAction,
		detailText,
		dgTabFrom,
		eventsPerPolicy,
		filterEvents,
		filterPolicies,
		typeLabel,
		typeOf,
		type DataguardTab
	} from '#lib/rules/dataguard.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';
	import PolicySheet from './PolicySheet.svelte';

	$effect(() => setPageTitle(t('nav.dataguard')));

	const allowed = $derived(can('server.config'));
	const canEvents = $derived(can('audit.view'));
	const message = (err: unknown) => (err instanceof Error ? err.message : '');

	/* ── Tabs (?tab=events) ── */

	let tab = $state<DataguardTab>(untrack(() => dgTabFrom(page.url.searchParams.get('tab'))));
	const shownTab = $derived(tab === 'events' && !canEvents ? 'policies' : tab);

	function selectTab(id: string) {
		tab = dgTabFrom(id);
		const url = new URL(location.href);
		if (tab === 'events') url.searchParams.set('tab', 'events');
		else url.searchParams.delete('tab');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL with ?tab=
		replaceState(url, page.state);
	}

	$effect(() => {
		if (!allowed) return;
		const current = shownTab;
		untrack(() => (current === 'policies' ? void loadPolicies() : void loadEvents()));
	});
	$effect(() => onRefresh(() => (shownTab === 'policies' ? void loadPolicies() : void loadEvents())));

	/* ── Policies ── */

	let policies = $state.raw<DlpPolicy[]>([]);
	let policiesLoaded = $state(false);
	let policiesError = $state<string | null>(null);
	let policyQuery = $state('');
	/** Events per policy for the Events column; null while unknown */
	let perPolicy = $state.raw<Map<string, number> | null>(null);

	async function loadPolicies() {
		try {
			policies = await listDlpPolicies();
			policiesError = null;
		} catch (err) {
			policiesError = `${t('dataguard.load_policies_failed')} ${message(err)}`.trim();
		} finally {
			policiesLoaded = true;
		}
		if (canEvents) {
			try {
				events = await listDlpEvents();
				eventsLoaded = true;
				perPolicy = eventsPerPolicy(events);
			} catch {
				perPolicy = null;
			}
		}
	}

	const label = (type: string) => typeLabel(t, type);
	const shownPolicies = $derived(filterPolicies(policies, policyQuery, label));
	const enabledCount = $derived(policies.filter((p) => p.enabled).length);

	let sheet = $state<{ policy: DlpPolicy | null } | null>(null);
	let createBtn = $state<HTMLElement | null>(null);

	const policyColumns = $derived<Column<DlpPolicy>[]>([
		{
			id: 'name',
			label: t('dataguard.policy_name'),
			cell: nameCell,
			primary: true,
			sortValue: (p) => p.name.toLowerCase(),
			class: 'col-name'
		},
		{ id: 'type', label: t('dataguard.transfer_type'), cell: typeCell, sortValue: (p) => label(typeOf(p)) },
		{ id: 'action', label: t('dataguard.action'), cell: actionCell, sortValue: (p) => p.action },
		{ id: 'scope', label: t('dataguard.scope'), cell: scopeCell, class: 'col-scope' },
		{ id: 'enabled', label: t('dataguard.status'), cell: enabledCell, sortValue: (p) => (p.enabled ? 1 : 0) },
		...(canEvents
			? [
					{
						id: 'events',
						label: t('dataguard.events_count'),
						cell: eventsCell,
						align: 'num' as const,
						sortValue: (p: DlpPolicy) => perPolicy?.get(p.id) ?? 0
					}
				]
			: []),
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: editCell, align: 'actions' }
	]);

	/* ── Events ── */

	let events = $state.raw<DlpEvent[]>([]);
	let eventsLoaded = $state(false);
	let eventsError = $state<string | null>(null);
	let eventQuery = $state('');
	let eventAction = $state('');

	async function loadEvents() {
		try {
			events = await listDlpEvents();
			perPolicy = eventsPerPolicy(events);
			eventsError = null;
		} catch (err) {
			eventsError = `${t('dataguard.load_events_failed')} ${message(err)}`.trim();
		} finally {
			eventsLoaded = true;
		}
	}

	const shownEvents = $derived(filterEvents(events, eventQuery, eventAction));
	const byAction = $derived(countByAction(events));
	const eventShare = $derived([
		{ value: byAction.block, label: t('dataguard.legend_blocked'), tone: 'danger' as const },
		{ value: byAction.log, label: t('dataguard.legend_logged'), tone: 'warning' as const },
		{ value: byAction.allow, label: t('dataguard.legend_allowed'), tone: 'muted' as const }
	]);
	const actionOptions = $derived([
		{ value: '', label: t('common.all') },
		{ value: 'block', label: t('dataguard.action_block') },
		{ value: 'log', label: t('dataguard.action_log') },
		{ value: 'allow', label: t('dataguard.action_allow') }
	]);

	const eventColumns = $derived<Column<DlpEvent>[]>([
		{
			id: 'time',
			label: t('dataguard.event_time'),
			cell: eventTimeCell,
			sortValue: (e) => e.created_at,
			class: 'col-time'
		},
		{ id: 'device', label: t('dataguard.device'), cell: eventDeviceCell, sortValue: (e) => e.device_id },
		{ id: 'policy', label: t('dataguard.policy'), cell: eventPolicyCell, sortValue: (e) => e.policy_name },
		{ id: 'action', label: t('dataguard.action'), cell: eventActionCell, sortValue: (e) => e.action },
		{ id: 'detail', label: t('dataguard.detail'), cell: eventDetailCell, class: 'col-detail' }
	]);

	const tabs = $derived([
		{ id: 'policies', label: t('dataguard.tab_policies') },
		...(canEvents ? [{ id: 'events', label: t('dataguard.tab_events') }] : [])
	]);
	const eventKey = (e: DlpEvent, i?: number) => e.id ?? `${e.created_at}-${e.device_id}-${i ?? 0}`;
	const keyedEvents = $derived(shownEvents.map((e, i) => ({ ...e, id: eventKey(e, i) })));
</script>

{#snippet nameCell(p: DlpPolicy)}<span class="strong">{p.name}</span>{#if p.description}<span class="cell-sub"
			>{p.description}</span
		>{/if}{/snippet}
{#snippet typeCell(p: DlpPolicy)}{#if typeOf(p)}<Tag label={label(typeOf(p))} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet actionCell(p: DlpPolicy)}{#if p.action}<Tag label={actionLabel(t, p.action)} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet scopeCell(p: DlpPolicy)}{#if p.scope}<ValueCopy value={p.scope} />{:else}{t(
			'dataguard.scope_all'
		)}{/if}{/snippet}
{#snippet enabledCell(p: DlpPolicy)}<BooleanStatus
		value={p.enabled}
		on={t('dataguard.enabled')}
		off={t('dataguard.disabled')}
	/>{/snippet}
{#snippet eventsCell(p: DlpPolicy)}{#if perPolicy}{formatNumber(perPolicy.get(p.id) ?? 0)}{:else}<Empty
		/>{/if}{/snippet}
{#snippet editCell(p: DlpPolicy)}<Button
		size="sm"
		aria-label="{t('common.edit')}: {p.name}"
		onclick={() => (sheet = { policy: p })}>{t('common.edit')}</Button
	>{/snippet}

{#snippet eventTimeCell(e: DlpEvent)}<Time value={e.created_at} />{/snippet}
{#snippet eventDeviceCell(e: DlpEvent)}{#if e.device_id}<ValueCopy value={e.device_id} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet eventPolicyCell(e: DlpEvent)}{#if e.policy_name}{e.policy_name}{:else}<Empty />{/if}{/snippet}
{#snippet eventActionCell(e: DlpEvent)}{#if e.action}<Tag label={actionLabel(t, e.action)} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet eventDetailCell(e: DlpEvent)}{@const d = detailText(e)}{#if d}{d}{:else}<Empty />{/if}{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide dg-page">
		<div class="page-head">
			<h1>{t('nav.dataguard')}</h1>
			<p class="page-description">{t('dataguard.page_description')}</p>
		</div>

		<Tabs {tabs} value={shownTab} label={t('dataguard.views_label')} onchange={selectTab}>
			{#snippet children(id)}
				{#if id === 'policies'}
					<div class="panel">
						<Toolbar>
							{#snippet search()}<SearchField
									label={t('dataguard.search_policies')}
									bind:value={policyQuery}
								/>{/snippet}
							<!-- Right after the search, not alone at the far end of a wide page -->
							<Button
								variant="primary"
								icon={ICONS.add}
								bind:element={createBtn}
								onclick={() => (sheet = { policy: null })}>{t('dataguard.create_policy')}</Button
							>
						</Toolbar>
						{#if policiesLoaded && policies.length}
							<CountLine
								text={t(policies.length === 1 ? 'dataguard.policy_count_one' : 'dataguard.policy_count_many')}
								values={{ count: policies.length, enabled: enabledCount }}
							/>
						{/if}
						<Table
							rows={shownPolicies}
							columns={policyColumns}
							key={(p) => p.id}
							label={t('dataguard.tab_policies')}
							onrowclick={(p) => (sheet = { policy: p })}
							loading={!policiesLoaded}
							loadingText={t('dataguard.loading_policies')}
							error={policiesError && !policies.length ? policiesError : null}
							onretry={() => void loadPolicies()}
							emptyText={policyQuery.trim()
								? t('dataguard.empty_policies_filtered')
								: t('dataguard.empty_policies')}
						/>
					</div>
				{:else}
					<div class="panel">
						<Toolbar>
							{#snippet search()}<SearchField
									label={t('dataguard.search_events')}
									bind:value={eventQuery}
								/>{/snippet}
							<SegmentedFilter
								label={t('dataguard.action')}
								options={actionOptions}
								bind:value={eventAction}
							/>
						</Toolbar>
						{#if eventsLoaded && events.length}
							<CountLine
								text={t(events.length === 1 ? 'dataguard.event_total_one' : 'dataguard.event_total_many')}
								values={{ count: events.length }}
							/>
							<ShareBar parts={eventShare} label={t('dataguard.tab_events')} />
						{/if}
						<Table
							rows={keyedEvents}
							columns={eventColumns}
							key={(e) => e.id ?? ''}
							label={t('dataguard.tab_events')}
							loading={!eventsLoaded}
							loadingText={t('dataguard.loading_events')}
							error={eventsError && !events.length ? eventsError : null}
							onretry={() => void loadEvents()}
							emptyText={eventQuery.trim() || eventAction
								? t('dataguard.empty_events_filtered')
								: t('dataguard.empty_events')}
						/>
					</div>
				{/if}
			{/snippet}
		</Tabs>
	</div>
{/if}

{#if sheet}
	<PolicySheet
		policy={sheet.policy}
		onclose={() => (sheet = null)}
		onsaved={() => {
			sheet = null;
			void loadPolicies();
		}}
		ondeleted={() => {
			sheet = null;
			// The row and its sheet are gone; focus stays on the page
			createBtn?.focus();
			void loadPolicies();
		}}
	/>
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: 0;
	}
	.strong {
		font-weight: 600;
	}
	.dg-page :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.dg-page :global(td.col-time) {
		white-space: nowrap;
	}
	.dg-page :global(td.col-scope) {
		max-width: 24ch;
		overflow-wrap: anywhere;
	}
	/* Event details are JSON from the device: wrap anywhere, keep rows short */
	.dg-page :global(td.col-detail) {
		max-width: 40ch;
		overflow-wrap: anywhere;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
