<!--
  Network monitoring (/network): hosts and ports the server checks. The
  table lists the targets; a click anywhere on a row opens its check
  history. Check now (device.connect) runs one check; adding, editing and
  deleting (server.config) happen in a side sheet and a confirmation.
  Beside it: whether the server checks on its own (start and stop with
  server.config) and the response times of one target as a line chart.

  Data: /api/network/targets and /api/network/monitor/status on load and
  on Refresh (the top bar's or the page's), after every change, and 4 s
  after monitoring starts. The search runs here on that list.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		checkTarget,
		deleteTarget,
		listTargets,
		monitorRunning,
		startMonitor,
		stopMonitor,
		targetHistory,
		type Target
	} from '#lib/api/network.ts';
	import {
		address,
		checkLabel,
		countLine,
		intervalLabel,
		intervalSeconds,
		latency,
		matches,
		rttPoints,
		STATE_KEY,
		STATE_TONE,
		targetState,
		type RttPoints
	} from '#lib/devices-area/network.ts';
	import { joinSentences } from '#lib/devices-area/sentences.ts';
	import { parseDate } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Chart from '#lib/ui/Chart.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import HistorySheet from './HistorySheet.svelte';
	import TargetSheet from './TargetSheet.svelte';

	const canManage = can('server.config');
	const canCheck = can('device.connect');

	const errorText = (err: unknown) =>
		err instanceof Error && err.message ? err.message : t('network.request_failed');

	/* ── Targets ── */

	let targets = $state.raw<Target[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let loadError = $state<string | null>(null);

	async function loadTargets(): Promise<void> {
		loading = true;
		try {
			targets = await listTargets();
			loadError = null;
		} catch (err) {
			targets = [];
			loadError = errorText(err);
		} finally {
			loading = false;
			loaded = true;
		}
	}

	/* ── Monitor ── */

	let running = $state<boolean | null>(null);
	let monitorError = $state<string | null>(null);
	let toggling = $state(false);
	let monitorMessage = $state('');
	let monitorTone = $state<'neutral' | 'ok' | 'error'>('neutral');
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;

	async function loadMonitor(): Promise<void> {
		try {
			running = await monitorRunning();
			monitorError = null;
		} catch (err) {
			monitorError = errorText(err);
		}
	}

	async function toggleMonitor() {
		if (toggling || running === null) return;
		const start = !running;
		toggling = true;
		monitorTone = 'neutral';
		monitorMessage = start ? t('network.monitor_starting') : t('network.monitor_stopping');
		try {
			if (start) await startMonitor();
			else await stopMonitor();
			running = start;
			monitorTone = 'ok';
			monitorMessage = start ? t('network.monitor_started') : t('network.monitor_stopped_msg');
			// The first checks run now; their results are in after a few seconds
			if (start) reloadTimer = setTimeout(() => void loadTargets(), 4000);
		} catch (err) {
			monitorTone = 'error';
			monitorMessage = t('network.monitor_failed', { reason: errorText(err) });
		} finally {
			toggling = false;
		}
	}

	$effect(() => {
		untrack(() => {
			void loadTargets();
			void loadMonitor();
		});
		return () => {
			if (reloadTimer) clearTimeout(reloadTimer);
		};
	});
	const refresh = () => {
		void loadTargets();
		void loadMonitor();
	};
	$effect(() => onRefresh(refresh));

	/* ── Search ── */

	let searchInput = $state('');
	let search = $state('');
	$effect(() => {
		const q = searchInput;
		const timer = setTimeout(() => (search = q.trim()), 150);
		return () => clearTimeout(timer);
	});
	const shown = $derived(search ? targets.filter((x) => matches(x, search)) : targets);
	const counted = $derived(
		loadError === null ? joinSentences(countLine(targets, !!search, shown.length), t) : null
	);
	// Search and Refresh only once there is something to search
	const showToolbar = $derived(!loaded || targets.length > 0 || searchInput.trim() !== '');

	/* ── Row actions ── */

	let checking = $state<string | null>(null);
	let historyFor = $state<Target | null>(null);
	let sheet = $state<{ target: Target | null } | null>(null);
	let rowMenuFor = $state<string | null>(null);

	async function check(x: Target) {
		if (checking) return;
		checking = x.id;
		try {
			const r = await checkTarget(x.id);
			if (r.status === 'up')
				toast.success(t('network.check_up', { name: x.name, ms: Math.round(r.rtt_ms ?? 0) }));
			else toast.error(t('network.check_down', { name: x.name, reason: r.error || t('network.no_answer') }));
		} catch (err) {
			toast.error(t('network.check_failed', { reason: errorText(err) }));
		} finally {
			checking = null;
		}
		await loadTargets();
	}

	async function remove(x: Target) {
		const ok = await confirm({
			title: t('network.delete_title'),
			message: t('network.delete_message', { name: x.name }),
			confirmLabel: t('network.delete_target_item'),
			danger: true
		});
		if (!ok) return;
		try {
			await deleteTarget(x.id);
			toast.success(t('network.deleted_target', { name: x.name }));
		} catch (err) {
			toast.error(t('network.delete_failed', { reason: errorText(err) }));
		}
		await loadTargets();
	}

	/* ── Table ── */

	const said = (s: { key: string; params?: Record<string, number> } | { text: string }) =>
		'text' in s ? s.text : t(s.key, s.params);

	const columns = $derived<Column<Target>[]>([
		{
			id: 'name',
			label: t('network.col_target'),
			cell: nameCell,
			primary: true,
			class: 'col-name',
			sortValue: (x) => x.name
		},
		{
			id: 'address',
			label: t('network.host'),
			cell: addressCell,
			class: 'col-address',
			sortValue: (x) => address(x)
		},
		{
			id: 'check',
			label: t('network.col_check'),
			cell: checkCell,
			class: 'col-check',
			sortValue: (x) => x.check_type
		},
		{
			id: 'status',
			label: t('network.status'),
			cell: statusCell,
			class: 'col-status',
			sortValue: (x) => ['down', 'unchecked', 'paused', 'up'].indexOf(targetState(x))
		},
		{
			id: 'latency',
			label: t('network.col_response'),
			cell: latencyCell,
			align: 'num',
			class: 'col-latency',
			sortValue: (x) => latency(x)
		},
		{
			id: 'last',
			label: t('network.last_check'),
			cell: lastCell,
			class: 'col-last',
			sortValue: (x) => parseDate(x.last_check_at)
		},
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions',
			class: 'col-actions'
		}
	]);

	/* ── Response times ── */

	let rttId = $state<string | null>(null);
	let rtt = $state.raw<RttPoints | null>(null);
	let rttState = $state<'loading' | 'ready' | 'error'>('loading');
	let rttError = $state('');
	let rttRequest = 0;

	// Start with a target that has been checked, so there is something to draw
	$effect(() => {
		const list = targets;
		untrack(() => {
			// One that answers draws a line; then one that was checked at all
			const pick = list.find((x) => x.last_status === 'up') ?? list.find((x) => x.last_check_at) ?? list[0];
			if (!pick) return;
			if (!rttId || !list.some((x) => x.id === rttId)) rttId = pick.id;
			void loadRtt();
		});
	});

	async function loadRtt() {
		const id = rttId;
		if (!id) return;
		const req = ++rttRequest;
		if (!rtt) rttState = 'loading';
		try {
			const history = await targetHistory(id, 100);
			if (req !== rttRequest) return;
			rtt = rttPoints(history, parseDate);
			rttState = 'ready';
		} catch (err) {
			if (req !== rttRequest) return;
			rtt = null;
			rttState = 'error';
			rttError = errorText(err);
		}
	}

	const rttTarget = $derived(targets.find((x) => x.id === rttId) ?? null);
	const timeLabel = (d: Date, withDay: boolean) =>
		new Intl.DateTimeFormat(
			i18n.locale,
			withDay
				? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
				: { hour: '2-digit', minute: '2-digit' }
		).format(d);
	const rttSince = $derived(rtt?.dates[0] ? timeLabel(rtt.dates[0], true) : '');

	const toolsNote = $derived(t('network.tools_note'));
	const [noteBefore = '', noteAfter = ''] = $derived(toolsNote.split('{link}'));
</script>

{#snippet nameCell(x: Target)}<span class="target-name">{x.name}</span><span class="cell-sub addr-sub mono"
		>{address(x)}</span
	>{/snippet}

{#snippet addressCell(x: Target)}<ValueCopy value={address(x)} label={x.name} />{/snippet}

{#snippet checkCell(x: Target)}{said(checkLabel(x))}<span class="cell-sub"
		>{said(intervalLabel(intervalSeconds(x)))}</span
	>{/snippet}

{#snippet statusCell(x: Target)}<Status
		tone={STATE_TONE[targetState(x)]}
		label={t(STATE_KEY[targetState(x)])}
	/>{#if latency(x) !== null}<span class="cell-sub latency-sub"
			>{t('network.ms', { value: latency(x) ?? 0 })}</span
		>{/if}{/snippet}

{#snippet latencyCell(x: Target)}{#if latency(x) !== null}{t('network.ms', {
			value: latency(x) ?? 0
		})}{:else}<Empty />{/if}{/snippet}

{#snippet lastCell(x: Target)}<Time value={x.last_check_at} />{/snippet}

{#snippet actionsCell(x: Target)}{#if canCheck}<Button
			size="sm"
			class="check-btn"
			icon={ICONS.check_now}
			busy={checking === x.id}
			aria-label="{t('network.check_now')}: {x.name}"
			onclick={() => void check(x)}
			>{checking === x.id ? t('network.checking') : t('network.check_now')}</Button
		>{/if}<MenuButton
		kebab
		label={t('network.actions_for', { name: x.name })}
		bind:open={
			() => rowMenuFor === x.id, (v) => (rowMenuFor = v ? x.id : rowMenuFor === x.id ? null : rowMenuFor)
		}
	>
		<MenuItem icon={ICONS.history} onselect={() => (historyFor = x)}>{t('network.check_history')}</MenuItem>
		{#if canManage}
			<MenuItem icon={ICONS.edit} onselect={() => (sheet = { target: x })}
				>{t('network.edit_target_item')}</MenuItem
			>
			<MenuDivider />
			<MenuItem icon={ICONS.delete} danger onselect={() => void remove(x)}
				>{t('network.delete_target_item')}</MenuItem
			>
		{/if}
	</MenuButton>{/snippet}

<div class="page page-wide network-page">
	<div class="page-head">
		<h1>{t('nav.network')}</h1>
		<p class="page-description">{t('network.page_description')}</p>
		{#if canManage}
			<div class="page-actions">
				<Button variant="primary" icon={ICONS.add} onclick={() => (sheet = { target: null })}
					>{t('network.add_target')}</Button
				>
			</div>
		{/if}
	</div>

	<div class="page-cols">
		<section class="section page-main" aria-label={t('network.targets')}>
			{#if showToolbar}
				<Toolbar>
					{#snippet search()}<SearchField
							label={t('network.search_label')}
							bind:value={searchInput}
						/>{/snippet}
					<!-- Next to the search, not alone at the far end of the line -->
					<Button icon={ICONS.refresh} busy={loading && loaded} onclick={refresh}
						>{t('actions.refresh')}</Button
					>
				</Toolbar>
			{/if}
			<div class="count" aria-live="polite">
				{#if counted && counted.text}<CountLine text={counted.text} values={counted.values} />{/if}
			</div>

			<div class="network-table">
				<Table
					rows={shown}
					{columns}
					key={(x) => x.id}
					label={t('network.targets')}
					onrowclick={(x) => (historyFor = x)}
					loading={!loaded}
					loadingText={t('network.loading')}
					error={loadError !== null ? `${t('network.load_failed')} ${loadError}` : null}
					onretry={() => void loadTargets()}
					emptyText={targets.length
						? t('network.no_match')
						: canManage
							? t('network.empty_manage')
							: t('network.empty')}
				/>
			</div>
			{#if canCheck}
				<p class="tools-note">{noteBefore}<a href={link('/toolkit')}>{t('nav.toolkit')}</a>{noteAfter}</p>
			{/if}
		</section>

		<aside class="page-side" aria-label={t('network.side_label')}>
			<!-- Whether the server checks on its own -->
			<section class="section" aria-labelledby="monitor-title">
				<h2 id="monitor-title">{t('network.monitor_title')}</h2>
				<div class="monitor-bar">
					{#if monitorError !== null}
						<Status tone="danger" label={t('network.monitor_unknown', { reason: monitorError })} />
					{:else if running === null}
						<Status tone="waiting" label={t('network.monitor_loading')} />
					{:else}
						<Status
							tone={running ? 'good' : 'neutral'}
							label={running ? t('network.monitor_on') : t('network.monitor_off')}
						/>
						{#if canManage}
							<Button
								size="sm"
								icon={running ? ICONS.stop : ICONS.start}
								busy={toggling}
								onclick={() => void toggleMonitor()}
								>{running ? t('network.monitor_stop') : t('network.monitor_start')}</Button
							>
						{/if}
					{/if}
					<FormStatus message={monitorMessage} tone={monitorTone} />
				</div>
			</section>

			{#if loaded && loadError === null && targets.length}
				<!-- Response times of one target from its check history -->
				<section class="section" aria-labelledby="rtt-title">
					<h2 id="rtt-title">{t('network.rtt_title')}</h2>
					<Field label={t('network.rtt_target')}>
						{#snippet children(f)}
							<Select
								{...f}
								options={targets.map((x) => ({ value: x.id, label: x.name }))}
								bind:value={
									() => rttId ?? '',
									(v) => {
										rttId = v;
										rtt = null;
										void loadRtt();
									}
								}
							/>
						{/snippet}
					</Field>
					{#if rttState === 'error'}
						<States
							kind="error"
							message={`${t('network.history_failed')} ${rttError}`}
							onretry={() => void loadRtt()}
						/>
					{:else if rttState === 'loading' || !rttId}
						<States kind="loading" message={t('network.loading_history')} />
					{:else if !rtt}
						<States message={t('network.no_history_yet')} />
					{:else if rtt.min === null}
						<!-- Nothing to draw: say so instead of an empty plot -->
						<States message={t('network.rtt_summary_none', { count: rtt.values.length, since: rttSince })} />
					{:else}
						<Chart
							kind="line"
							label={t('network.rtt_label', { name: rttTarget?.name ?? '' })}
							summary={t('network.rtt_summary', {
								count: rtt.values.length,
								since: rttSince,
								down: rtt.down,
								min: rtt.min,
								max: rtt.max ?? rtt.min
							})}
							labels={rtt.dates.map((d) => timeLabel(d, rtt?.withDay ?? false))}
							series={[{ name: t('network.col_response'), values: rtt.values }]}
							format={(n: number) => t('network.ms', { value: Math.round(n) })}
							xHeading={t('network.history_time')}
						/>
					{/if}
				</section>
			{/if}
		</aside>
	</div>
</div>

{#if sheet}
	<TargetSheet
		target={sheet.target}
		onclose={() => (sheet = null)}
		onsaved={() => {
			sheet = null;
			void loadTargets();
		}}
	/>
{/if}

{#if historyFor}
	<HistorySheet target={historyFor} onclose={() => (historyFor = null)} />
{/if}

<style>
	.count {
		min-height: 1.5em;
	}
	.target-name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	/* Two classes: wins over .cell-sub whatever order the build puts them in */
	.cell-sub:is(.addr-sub, .latency-sub) {
		display: none;
	}
	.tools-note {
		margin: 0;
		color: var(--text-muted);
	}
	/* The state is a sentence: it wraps, the mark stays on its first line */
	.monitor-bar :global(.status) {
		align-items: flex-start;
		white-space: normal;
	}
	.monitor-bar :global(.status::before) {
		margin-top: 0.45em;
	}
	.monitor-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.network-table {
		container: nettable / inline-size;
	}
	.network-table :global(td.col-last),
	.network-table :global(td.col-check) {
		color: var(--text-muted);
	}
	.network-table :global(td.col-last) {
		white-space: nowrap;
	}
	.network-table :global(td.col-actions) {
		white-space: nowrap;
	}
	/* The address has its own column (with Copy) only where it fits; otherwise it is under the name */
	@container nettable (max-width: 999px) {
		.network-table :global(.col-address) {
			display: none;
		}
		.cell-sub.addr-sub {
			display: block;
		}
	}
	@container nettable (max-width: 640px) {
		.network-table :global(.col-check) {
			display: none;
		}
	}
	@container nettable (max-width: 560px) {
		.network-table :global(.col-latency),
		.network-table :global(.col-last) {
			display: none;
		}
		.cell-sub.latency-sub {
			display: block;
		}
	}
	@media (pointer: coarse) {
		.network-table :global(.row-open) {
			min-height: 44px;
		}
	}
</style>
