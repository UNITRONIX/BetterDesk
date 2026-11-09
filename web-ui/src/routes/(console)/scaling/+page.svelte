<!--
  Relay servers (/scaling): the list of extra relay servers, the rules
  that send devices to them, how a connection works with the addresses
  clients get now, a sizing guide, and capacity beside them.

  ?tab=relays|rules|capacity scrolls to that section once the lists are
  loaded (old links used tabs); overview or nothing stays at the top.
  Needs server.config for the page and every call.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import {
		deleteRelay,
		deleteRule,
		getCapacity,
		getClientAddresses,
		getConnectionMode,
		listRelays,
		listRules,
		type Capacity,
		type Relay,
		type Rule
	} from '#lib/api/scaling.ts';
	import { formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import {
		availability,
		capacityTiers,
		diagramProps,
		filterRelays,
		recommendations,
		relayName,
		relayStatus,
		reportingCount,
		sectionFor,
		SIZING,
		sortRules,
		totals
	} from '#lib/serverarea/scaling.ts';
	import { around } from '#lib/serverarea/text.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import ConnectionDiagram from '#lib/ui/ConnectionDiagram.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import RelaySheet from './RelaySheet.svelte';
	import RuleSheet from './RuleSheet.svelte';

	const allowed = $derived(can('server.config'));

	/* ── Data ── */

	let relays = $state.raw<Relay[] | null>(null);
	let relaysError = $state<string | null>(null);
	let rules = $state.raw<Rule[] | null>(null);
	let rulesError = $state<string | null>(null);
	let capacity = $state.raw<Capacity | null>(null);
	let diagram = $state.raw<ReturnType<typeof diagramProps> | null>(null);
	let diagramError = $state(false);

	async function loadRelays() {
		try {
			relays = await listRelays();
			relaysError = null;
		} catch {
			relays = relays ?? null;
			relaysError = t('scaling.relays_error');
		}
	}

	async function loadRules() {
		try {
			rules = await listRules();
			rulesError = null;
		} catch {
			rulesError = t('scaling.rules_error');
		}
	}

	async function loadCapacity() {
		try {
			capacity = await getCapacity();
		} catch {
			capacity = null;
		}
	}

	async function loadDiagram() {
		diagramError = false;
		diagram = null;
		try {
			const [cfg, mode] = await Promise.all([getClientAddresses(), getConnectionMode().catch(() => null)]);
			diagram = diagramProps(cfg, mode);
		} catch {
			diagramError = true;
		}
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			void loadDiagram();
			void Promise.all([loadRelays(), loadRules(), loadCapacity()]).then(async () => {
				const id = sectionFor(page.url.searchParams.get('tab'));
				if (!id) return;
				await tick();
				document.getElementById(id)?.scrollIntoView({ block: 'start' });
			});
		});
	});

	/* ── What shows ── */

	const shows = $derived(availability(relays, rules));
	let query = $state('');
	const shownRelays = $derived(filterRelays(relays ?? [], query));
	const sortedRules = $derived(sortRules(rules ?? []));
	const tiers = $derived(capacityTiers(relays ?? [], capacity));
	const advice = $derived(
		relays === null ? [] : recommendations(relays, capacity).map((r) => t(r.key, r.params))
	);
	const used = $derived(totals(relays ?? []));
	const description = $derived(around('scaling.page_description', 'link'));
	const endpointsLabel = $derived(
		`${t('nav.settings')} › ${t('settings.tab_general')} › ${t('settings.public_endpoints_title')}`
	);

	/* ── Sheets and deletes ── */

	let relaySheet = $state<{ relay: Relay | null } | null>(null);
	let ruleSheet = $state<{ rule: Rule | null } | null>(null);

	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	async function removeRelay(r: Relay) {
		const name = r.name || r.id;
		const ok = await confirm({
			title: t('scaling.delete_relay_title', { name }),
			message: t('scaling.confirm_delete_relay'),
			confirmLabel: t('scaling.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteRelay(r.id);
			toast.success(t('scaling.relay_deleted_named', { name }));
		} catch (err) {
			toast.error(t('scaling.relay_delete_failed_reason', { error: message(err) }));
		}
		await loadRelays();
		void loadCapacity();
	}

	async function removeRule(r: Rule) {
		const name = r.name || r.id;
		const ok = await confirm({
			title: t('scaling.delete_rule_title', { name }),
			message: t('scaling.confirm_delete_rule'),
			confirmLabel: t('scaling.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteRule(r.id);
			toast.success(t('scaling.rule_deleted_named', { name }));
		} catch (err) {
			toast.error(t('scaling.rule_delete_failed_reason', { error: message(err) }));
		}
		void loadRules();
	}

	/* ── Tables ── */

	const relayColumns = $derived<Column<Relay>[]>([
		{ id: 'name', label: t('scaling.col_name'), cell: relayNameCell, primary: true },
		{ id: 'address', label: t('scaling.col_address'), cell: addressCell },
		{ id: 'limits', label: t('scaling.col_limits'), cell: limitsCell },
		{ id: 'status', label: t('scaling.col_status'), cell: relayStatusCell },
		{
			id: 'actions',
			label: t('scaling.col_actions'),
			labelHidden: true,
			cell: relayActions,
			align: 'actions'
		}
	]);

	const ruleColumns = $derived<Column<Rule>[]>([
		{ id: 'priority', label: t('scaling.col_priority'), cell: priorityCell, align: 'num' },
		{ id: 'name', label: t('scaling.col_rule_name'), cell: ruleNameCell, primary: true },
		{ id: 'match', label: t('scaling.col_match'), cell: matchCell },
		{ id: 'relay', label: t('scaling.col_target_relay'), cell: targetCell },
		{ id: 'fallback', label: t('scaling.col_fallback'), cell: fallbackCell },
		{ id: 'status', label: t('scaling.col_status'), cell: enabledCell },
		{ id: 'actions', label: t('scaling.col_actions'), labelHidden: true, cell: ruleActions, align: 'actions' }
	]);

	type SizingRow = (typeof SIZING)[number];
	const sizingColumns = $derived<Column<SizingRow>[]>([
		{ id: 'config', label: t('scaling.cap_config'), cell: sizingName },
		{ id: 'devices', label: t('scaling.cap_max_devices'), cell: sizingDevices, align: 'num' },
		{ id: 'sessions', label: t('scaling.cap_max_sessions'), cell: sizingSessions, align: 'num' },
		{ id: 'usage', label: t('scaling.cap_utilization'), cell: sizingUsage }
	]);

	const matchLabel = (type: string) => {
		const key = 'scaling.match_' + type;
		const v = t(key);
		return v === key ? type : v;
	};
</script>

{#snippet relayNameCell(r: Relay)}
	<span class="strong">{r.name || r.id}</span>{#if r.location}<span class="cell-sub">{r.location}</span>{/if}
{/snippet}

{#snippet addressCell(r: Relay)}<ValueCopy value={r.address} label={r.name || r.address} />{/snippet}

{#snippet limitsCell(r: Relay)}
	{t('scaling.relay_limits', { sessions: r.max_sessions || 0, bandwidth: r.max_bandwidth_mbps || 0 })}
{/snippet}

{#snippet relayStatusCell(r: Relay)}
	{@const st = relayStatus(r)}
	<Status tone={st.tone} label={t(st.label)} />{#if st.reports}<span class="cell-sub"
			>{t('scaling.relay_usage', {
				devices: r.connected_devices || 0,
				sessions: r.active_sessions || 0,
				bandwidth: (r.bandwidth_mbps || 0).toFixed(1),
				cpu: r.cpu || 0,
				memory: r.memory || 0
			})}</span
		>{/if}
{/snippet}

{#snippet relayActions(r: Relay)}
	<Button
		size="sm"
		class="relay-edit"
		aria-label={t('scaling.edit_named', { name: r.name || r.id })}
		onclick={() => (relaySheet = { relay: r })}>{t('scaling.edit')}</Button
	>
	<Button
		size="sm"
		variant="danger-quiet"
		class="relay-delete"
		aria-label={t('scaling.delete_named', { name: r.name || r.id })}
		onclick={() => void removeRelay(r)}>{t('scaling.delete')}…</Button
	>
{/snippet}

{#snippet priorityCell(r: Rule)}{formatNumber(r.priority || 0)}{/snippet}

{#snippet ruleNameCell(r: Rule)}<span class="strong">{r.name || r.id}</span>{/snippet}

{#snippet matchCell(r: Rule)}
	<span class="match"
		><Tag label={matchLabel(r.match_type)} /> <ValueCopy value={r.match_value} copy={false} /></span
	>
{/snippet}

{#snippet targetCell(r: Rule)}{r.target_relay_name ||
		relayName(relays ?? [], r.target_relay) ||
		'–'}{/snippet}

{#snippet fallbackCell(r: Rule)}{t('scaling.fallback_' + (r.fallback || 'master'))}{/snippet}

{#snippet enabledCell(r: Rule)}
	<BooleanStatus
		value={r.enabled !== false}
		on={t('scaling.status_enabled')}
		off={t('scaling.status_disabled')}
	/>
{/snippet}

{#snippet ruleActions(r: Rule)}
	{#if relays?.length}
		<Button
			size="sm"
			class="rule-edit"
			aria-label={t('scaling.edit_named', { name: r.name || r.id })}
			onclick={() => (ruleSheet = { rule: r })}>{t('scaling.edit')}</Button
		>
	{/if}
	<Button
		size="sm"
		variant="danger-quiet"
		class="rule-delete"
		aria-label={t('scaling.delete_named', { name: r.name || r.id })}
		onclick={() => void removeRule(r)}>{t('scaling.delete')}…</Button
	>
{/snippet}

{#snippet sizingName(r: SizingRow)}{t(r.key)}{/snippet}
{#snippet sizingDevices(r: SizingRow)}{formatNumber(r.devices)}{/snippet}
{#snippet sizingSessions(r: SizingRow)}{formatNumber(r.sessions)}{/snippet}
{#snippet sizingUsage(r: SizingRow)}
	<span class="meter-box"><Meter value={(used.devices / r.devices) * 100} high={80} /></span>
{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide scaling-page">
		<div class="page-head">
			<h1>{t('nav.scaling')}</h1>
			<p class="page-description">
				{description[0]}<a href={link('/settings?tab=general#public-endpoints')}>{endpointsLabel}</a
				>{description[1]}
			</p>
			<div class="page-actions">
				<Button
					class="relay-add"
					variant="primary"
					icon={ICONS.add}
					onclick={() => (relaySheet = { relay: null })}>{t('scaling.relay_add')}</Button
				>
			</div>
		</div>

		<div class="page-cols">
			<div class="page-main">
				<section class="section" id="panel-relays" aria-labelledby="relays-title">
					<div class="section-head"><h2 id="relays-title">{t('scaling.relays_title')}</h2></div>
					<p class="section-note">{t('scaling.relays_info_banner')}</p>
					{#if shows.search}
						<div class="toolbar">
							<div class="search"><SearchField label={t('scaling.relay_search')} bind:value={query} /></div>
						</div>
						<CountLine
							text={t('scaling.count_line')}
							values={{
								relays: relays?.length ?? 0,
								rules: rules?.length ?? 0,
								reporting: reportingCount(relays ?? [])
							}}
						/>
					{/if}
					<Table
						rows={shownRelays}
						columns={relayColumns}
						key={(r) => r.id}
						label={t('scaling.relays_title')}
						onrowclick={(r) => (relaySheet = { relay: r })}
						loading={relays === null && !relaysError}
						loadingText={t('scaling.relays_loading')}
						error={relaysError}
						onretry={() => void loadRelays()}
						emptyText={relays?.length ? t('scaling.relays_no_match') : t('scaling.no_relays')}
					/>
				</section>

				<section class="section" id="panel-rules" aria-labelledby="rules-title">
					<div class="section-head">
						<h2 id="rules-title">{t('scaling.tab_rules')}</h2>
						{#if shows.addRule && relays !== null}
							<Button size="sm" class="rule-add" icon={ICONS.add} onclick={() => (ruleSheet = { rule: null })}
								>{t('scaling.rule_add')}</Button
							>
						{/if}
					</div>
					<p class="section-note">{t('scaling.rules_hint')}</p>
					{#if shows.foldRules}
						<p class="muted">{t('scaling.rules_need_relay_note')}</p>
					{:else}
						<Table
							rows={sortedRules}
							columns={ruleColumns}
							key={(r) => r.id}
							label={t('scaling.tab_rules')}
							onrowclick={relays?.length ? (r) => (ruleSheet = { rule: r }) : undefined}
							loading={rules === null && !rulesError}
							loadingText={t('scaling.rules_loading')}
							error={rulesError}
							onretry={() => void loadRules()}
							emptyText={t('scaling.no_rules')}
						/>
					{/if}
				</section>

				<section class="section" id="panel-diagram" aria-labelledby="diagram-title">
					<div class="section-head"><h2 id="diagram-title">{t('diagram.how_title')}</h2></div>
					<p class="section-note">{t('scaling.diagram_note')}</p>
					{#if diagram}
						<div class="diagram"><ConnectionDiagram {...diagram} /></div>
					{:else if diagramError}
						<States kind="error" message={t('scaling.diagram_error')} onretry={() => void loadDiagram()} />
					{:else}
						<States kind="loading" message={t('scaling.diagram_loading')} />
					{/if}
				</section>

				<Disclosure class="section" title={t('scaling.cap_planning')}>
					<div id="panel-sizing" class="sizing">
						<p class="muted">{t('scaling.cap_planning_note')}</p>
						<Table
							rows={[...SIZING]}
							columns={sizingColumns}
							key={(r) => r.key}
							label={t('scaling.cap_planning')}
						/>
					</div>
				</Disclosure>
			</div>

			<aside class="page-side" aria-labelledby="capacity-title">
				<section class="section" id="panel-capacity" aria-labelledby="capacity-title">
					<div class="section-head"><h2 id="capacity-title">{t('scaling.tab_capacity')}</h2></div>
					{#if shows.capacity && relays !== null}
						<p class="section-note">{t('scaling.capacity_note')}</p>
						<dl class="facts tiers">
							{#each tiers as tier (tier.key)}
								<dt>{t(tier.key)}</dt>
								<dd>
									<span class="meter-box"
										><Meter
											value={tier.max > 0 ? (tier.current / tier.max) * 100 : 0}
											high={80}
											text={formatPercent(Math.round(tier.max > 0 ? (tier.current / tier.max) * 100 : 0))}
										/></span
									>
									<span class="cell-sub"
										>{t('scaling.cap_of', {
											current: formatNumber(tier.current) + tier.unit,
											max: formatNumber(tier.max) + tier.unit
										})}</span
									>
								</dd>
							{/each}
						</dl>
					{/if}
					{#if advice.length}
						<p class="advice">{advice.join(' ')}</p>
					{/if}
				</section>
			</aside>
		</div>
	</div>
{/if}

{#if relaySheet}
	<RelaySheet
		relay={relaySheet.relay}
		onclose={() => (relaySheet = null)}
		onsaved={() => {
			relaySheet = null;
			void loadRelays();
			void loadCapacity();
		}}
	/>
{/if}

{#if ruleSheet && relays?.length}
	<RuleSheet
		rule={ruleSheet.rule}
		{relays}
		onclose={() => (ruleSheet = null)}
		onsaved={() => {
			ruleSheet = null;
			void loadRules();
		}}
	/>
{/if}

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.search {
		flex: 1 1 200px;
		max-width: 360px;
	}
	.strong {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.match {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.muted {
		margin: 0;
		max-width: var(--measure);
		color: var(--text-muted);
	}
	.advice {
		margin: 0;
		max-width: var(--measure);
	}
	.meter-box {
		display: block;
		width: min(100%, 280px);
	}
	.meter-box :global(.meter-value) {
		min-width: 4.5ch;
		text-align: end;
	}
	.sizing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	/* Capacity facts: meter with the numbers under it, label above value */
	.tiers {
		grid-template-columns: minmax(0, 1fr);
	}
	.tiers > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		font-size: var(--text-sm);
	}
	.tiers > dd {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 2px;
		min-height: 0;
		padding-top: var(--space-1);
	}
</style>
