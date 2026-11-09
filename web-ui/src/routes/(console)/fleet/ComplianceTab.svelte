<!--
  Fleet > Compliance: how well each device meets the software rules, for
  all organizations or one. A summary line, then a table: a click on a row
  opens the device panel (device.view); Scan per row, Fix automatically in
  the row menu (asks first), Scan all devices above the table.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		isUnavailable,
		listCompliance,
		remediateDevice,
		scanDevice,
		type ComplianceRow
	} from '#lib/api/fleet.ts';
	import type { Organization } from '#lib/api/orgs.ts';
	import { complianceSummary, deviceOf, score, scoreLevel } from '#lib/canvas/fleet.ts';
	import { formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { openDevice } from '#lib/state/devicePanel.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import Filter from './Filter.svelte';

	interface Props {
		ready: boolean;
		unavailable: boolean;
		noticeId: string;
		orgs: Organization[];
		org: string;
	}

	let { ready, unavailable = $bindable(), noticeId, orgs, org = $bindable() }: Props = $props();

	const message = (err: unknown) => (err instanceof Error ? err.message : '');
	const canOpen = $derived(can('device.view'));

	/* ── Data ── */

	let list = $state.raw<ComplianceRow[]>([]);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let inflight: AbortController | null = null;

	async function load(): Promise<void> {
		inflight?.abort();
		inflight = null;
		if (!ready || unavailable) {
			list = [];
			loaded = ready;
			return;
		}
		const ctrl = new AbortController();
		inflight = ctrl;
		try {
			const out = await listCompliance(org, ctrl.signal);
			if (inflight !== ctrl) return;
			list = out;
			error = null;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			list = [];
			if (isUnavailable(err)) unavailable = true;
			else error = t('fleet.compliance_failed', { error: message(err) });
		}
		loaded = true;
	}

	$effect(() => {
		void [ready, unavailable, org];
		untrack(() => void load());
	});
	$effect(() => () => untrack(() => inflight?.abort()));

	const summary = $derived(complianceSummary(list));
	const orgOptions = $derived([
		{ value: '', label: t('fleet.all_organizations') },
		...orgs.map((o) => ({ value: o.id, label: o.name || o.id }))
	]);

	/* ── Actions ── */

	let menuFor = $state<string | null>(null);
	let scanStatus = $state<{ text: string; tone: 'neutral' | 'ok' | 'error' }>({ text: '', tone: 'neutral' });
	let scanning = $state(false);

	async function scan(id: string) {
		try {
			await scanDevice(id);
			toast.success(t('fleet.scan_started', { device: id }));
			void load();
		} catch (err) {
			toast.error(t('fleet.scan_failed', { error: message(err) }));
		}
	}

	async function scanAll() {
		const devices = list.map(deviceOf);
		if (!devices.length) {
			scanStatus = { text: t('fleet.scan_nothing'), tone: 'error' };
			return;
		}
		scanning = true;
		scanStatus = { text: t('fleet.scanning', { count: devices.length }), tone: 'neutral' };
		let failed = 0;
		for (const id of devices) {
			try {
				await scanDevice(id);
			} catch {
				failed++;
			}
		}
		scanning = false;
		scanStatus = failed
			? { text: t('fleet.scan_all_partial', { failed, count: devices.length }), tone: 'error' }
			: { text: t('fleet.scan_all_done', { count: devices.length }), tone: 'ok' };
		void load();
	}

	async function remediate(id: string) {
		const ok = await confirm({
			title: t('fleet.remediate_title'),
			message: t('fleet.confirm_remediate'),
			confirmLabel: t('fleet.comp_remediate'),
			confirmIcon: ICONS.remediate
		});
		if (!ok) return;
		try {
			await remediateDevice(id);
			toast.success(t('fleet.remediate_started', { device: id }));
			void load();
		} catch (err) {
			toast.error(t('fleet.remediate_failed', { error: message(err) }));
		}
	}

	const LEVEL_LABEL = {
		good: 'fleet.compliant',
		warning: 'fleet.non_compliant',
		danger: 'fleet.critical_issues'
	} as const;

	const columns = $derived<Column<ComplianceRow>[]>([
		{
			id: 'device',
			label: t('fleet.col_device'),
			cell: deviceCell,
			primary: true,
			sortValue: (d) => deviceOf(d)
		},
		{ id: 'os', label: t('fleet.col_os'), cell: osCell, sortValue: (d) => d.os || d.platform },
		{ id: 'score', label: t('fleet.col_score'), cell: scoreCell, sortValue: (d) => score(d) },
		{
			id: 'issues',
			label: t('fleet.col_issues'),
			cell: issuesCell,
			align: 'num',
			sortValue: (d) => Number(d.issues ?? 0)
		},
		{ id: 'last_scan', label: t('fleet.col_last_scan'), cell: lastScanCell, sortValue: (d) => d.last_scan },
		{ id: 'actions', label: t('fleet.col_actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet deviceCell(d: ComplianceRow)}<span class="mono">{deviceOf(d)}</span>{#if d.hostname}<span
			class="cell-sub">{d.hostname}</span
		>{/if}{/snippet}

{#snippet osCell(d: ComplianceRow)}{d.os || d.platform || '–'}{/snippet}

{#snippet scoreCell(d: ComplianceRow)}{@const s = score(d)}{@const level = scoreLevel(s)}<span class="score"
		><Meter value={s} high={101} full={101} text={formatPercent(s)} /><Status
			tone={level}
			label={t(LEVEL_LABEL[level])}
		/></span
	>{/snippet}

{#snippet issuesCell(d: ComplianceRow)}{formatNumber(d.issues ?? 0)}{/snippet}

{#snippet lastScanCell(d: ComplianceRow)}<Time value={d.last_scan} />{/snippet}

{#snippet actionsCell(d: ComplianceRow)}<Button
		size="sm"
		icon={ICONS.compliance_scan}
		onclick={() => void scan(deviceOf(d))}>{t('fleet.comp_scan')}</Button
	><MenuButton
		kebab
		label={t('fleet.actions_for', { name: d.hostname || deviceOf(d) })}
		bind:open={
			() => menuFor === deviceOf(d),
			(v) => (menuFor = v ? deviceOf(d) : menuFor === deviceOf(d) ? null : menuFor)
		}
	>
		<MenuItem icon={ICONS.remediate} onselect={() => void remediate(deviceOf(d))}
			>{t('fleet.remediate_ellipsis')}</MenuItem
		>
	</MenuButton>{/snippet}

<p class="note">{t('fleet.compliance_note')}</p>
<Toolbar>
	<Filter label={t('fleet.scope_org')} options={orgOptions} bind:value={org} />
	{#snippet end()}
		<FormStatus message={scanStatus.text} tone={scanStatus.tone} />
		<Button
			variant="primary"
			icon={ICONS.compliance_scan}
			busy={scanning}
			disabled={unavailable}
			aria-describedby={unavailable ? noticeId : undefined}
			onclick={() => void scanAll()}>{t('fleet.scan_all')}</Button
		>
	{/snippet}
</Toolbar>
<p class="count-line" aria-live="polite">
	{#if list.length}
		<CountLine text={t('fleet.compliance_summary')} values={summary} />
	{/if}
</p>
<div class="fleet-table">
	<Table
		rows={list}
		{columns}
		key={(d) => deviceOf(d)}
		label={t('fleet.tab_compliance')}
		onrowclick={canOpen ? (d) => openDevice(deviceOf(d)) : undefined}
		loading={!loaded}
		loadingText={t('fleet.loading_compliance')}
		{error}
		onretry={() => void load()}
		emptyText={unavailable ? t('fleet.unavailable_table') : t('fleet.no_compliance_data')}
	/>
</div>

<style>
	.note {
		margin: 0;
		color: var(--text-muted);
	}
	.count-line {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
	}
	.mono {
		font-family: var(--mono);
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.score {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-3);
		min-width: 140px;
	}
	.fleet-table :global(.row-open) {
		text-align: start;
		white-space: normal;
	}
	@media (pointer: coarse) {
		.fleet-table :global(.row-open) {
			display: inline-flex;
			flex-direction: column;
			align-items: flex-start;
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
