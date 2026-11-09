<!--
  Alerts and automation (/automation, ?tab=alerts|commands). Three tabs:
  alert rules (create, edit, enable or disable, delete), the alerts they
  raised (filter by severity, acknowledge) and remote commands (send, read
  the result). Each tab loads its list when it opens.

  Who: server.config, for the page route and every call (command payloads
  and results come from scripts run on devices). Other roles get the 403
  text and the page asks the server for nothing.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import {
		acknowledgeAlert,
		deleteRule,
		listAlerts,
		listCommands,
		listRules,
		updateRule,
		type Alert,
		type AlertRule,
		type Command
	} from '#lib/api/automation.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		commandTone,
		isAcknowledged,
		labelFor,
		severityTone,
		tabFrom,
		truncate,
		urlForTab,
		type AutomationTab
	} from '#lib/rules/automation.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import CommandDialog from './CommandDialog.svelte';
	import CommandSheet from './CommandSheet.svelte';
	import RuleSheet from './RuleSheet.svelte';

	$effect(() => setPageTitle(t('nav.automation')));

	const allowed = $derived(can('server.config'));
	const message = (err: unknown) => (err instanceof Error ? err.message : '');

	/* ── Tabs, kept in ?tab= ── */

	let tab = $state<AutomationTab>(untrack(() => tabFrom(page.url.searchParams.get('tab'))));

	function selectTab(id: string) {
		tab = tabFrom(id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL with ?tab=
		replaceState(urlForTab(new URL(location.href), tab), page.state);
	}

	// Each tab loads its list when it opens (again on every switch, as before)
	$effect(() => {
		if (!allowed) return;
		const current = tab;
		untrack(() => load(current));
	});
	$effect(() =>
		onRefresh(() => {
			if (allowed) load(tab);
		})
	);

	function load(which: AutomationTab) {
		if (which === 'rules') void loadRules();
		else if (which === 'alerts') void loadAlerts();
		else void loadCommands();
	}

	/* ── Rules ── */

	let rules = $state.raw<AlertRule[]>([]);
	let rulesLoaded = $state(false);
	let rulesError = $state<string | null>(null);

	async function loadRules() {
		try {
			rules = await listRules();
			rulesError = null;
		} catch (err) {
			rulesError = `${t('automation.load_failed')} ${message(err)}`.trim();
		} finally {
			rulesLoaded = true;
		}
	}

	let ruleSheet = $state<{ rule: AlertRule | null } | null>(null);
	let ruleMenuFor = $state<string | null>(null);

	async function toggleRule(r: AlertRule) {
		const enable = !r.enabled;
		try {
			await updateRule(r.id, { enabled: enable });
			toast.success(
				t(enable ? 'automation.rule_enabled_toast' : 'automation.rule_disabled_toast', { name: r.name })
			);
			void loadRules();
		} catch (err) {
			toast.error(`${t('automation.rule_save_failed')} ${message(err)}`.trim());
		}
	}

	async function removeRule(r: AlertRule) {
		const ok = await confirm({
			title: t('automation.delete_rule'),
			message: t('automation.delete_rule_confirm', { name: r.name }),
			confirmLabel: t('automation.delete_rule_menu'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteRule(r.id);
			toast.success(t('automation.rule_deleted', { name: r.name }));
			void loadRules();
		} catch (err) {
			toast.error(`${t('automation.rule_delete_failed')} ${message(err)}`.trim());
		}
	}

	const enabledRules = $derived(rules.filter((r) => r.enabled).length);
	// "3 rules, 2 enabled": two strings joined, the second with its own placeholder
	const rulesCountText = $derived(
		`${t(rules.length === 1 ? 'automation.rules_count_one' : 'automation.rules_count_many')}, ${t('automation.enabled_count').replace('{count}', '{enabled}')}`
	);

	const ruleColumns = $derived<Column<AlertRule>[]>([
		{
			id: 'name',
			label: t('automation.rule_name'),
			cell: ruleNameCell,
			primary: true,
			sortValue: (r) => r.name.toLowerCase(),
			class: 'col-name'
		},
		{
			id: 'condition',
			label: t('automation.condition_type'),
			cell: conditionCell,
			sortValue: (r) => r.condition_type
		},
		{
			id: 'value',
			label: t('automation.condition_value'),
			cell: valueCell,
			align: 'num',
			sortValue: (r) => (r.condition_type === 'custom' ? null : r.condition_value)
		},
		{ id: 'severity', label: t('automation.severity'), cell: severityCell, sortValue: (r) => r.severity },
		{
			id: 'scope',
			label: t('automation.scope_device'),
			cell: scopeCell,
			sortValue: (r) => r.scope_device_id ?? ''
		},
		{
			id: 'enabled',
			label: t('automation.status'),
			cell: enabledCell,
			sortValue: (r) => (r.enabled ? 1 : 0)
		},
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: ruleActionsCell,
			align: 'actions'
		}
	]);

	/* ── Alerts ── */

	let alerts = $state.raw<Alert[]>([]);
	let alertsLoaded = $state(false);
	let alertsError = $state<string | null>(null);
	let severity = $state('');
	let alertSeq = 0;

	async function loadAlerts() {
		const mine = ++alertSeq;
		try {
			const list = await listAlerts(severity);
			if (mine !== alertSeq) return;
			alerts = list;
			alertsError = null;
		} catch (err) {
			if (mine !== alertSeq) return;
			alertsError = `${t('automation.load_failed')} ${message(err)}`.trim();
		} finally {
			if (mine === alertSeq) alertsLoaded = true;
		}
	}

	function setSeverity(next: string) {
		severity = next;
		void loadAlerts();
	}

	let acking = $state<string | null>(null);
	async function ack(a: Alert) {
		acking = a.id;
		try {
			await acknowledgeAlert(a.id);
			toast.success(t('automation.alert_acknowledged'));
			await loadAlerts();
		} catch (err) {
			toast.error(`${t('automation.ack_failed')} ${message(err)}`.trim());
		} finally {
			acking = null;
		}
	}

	const openAlerts = $derived(alerts.filter((a) => !isAcknowledged(a)).length);
	const alertShare = $derived([
		{ value: openAlerts, label: t('automation.legend_open'), tone: 'warning' as const },
		{ value: alerts.length - openAlerts, label: t('automation.legend_acknowledged'), tone: 'ok' as const }
	]);
	const severityOptions = $derived([
		{ value: '', label: t('common.all') },
		{ value: 'info', label: t('automation.severity_info') },
		{ value: 'warning', label: t('automation.severity_warning') },
		{ value: 'critical', label: t('automation.severity_critical') }
	]);

	const alertColumns = $derived<Column<Alert>[]>([
		{
			id: 'time',
			label: t('automation.triggered_at'),
			cell: alertTimeCell,
			sortValue: (a) => a.triggered_at,
			class: 'col-time'
		},
		{ id: 'rule', label: t('automation.rule_name'), cell: alertRuleCell, sortValue: (a) => a.rule_name },
		{ id: 'device', label: t('automation.device'), cell: alertDeviceCell, sortValue: (a) => a.device_id },
		{ id: 'details', label: t('automation.details'), cell: alertDetailsCell, class: 'col-details' },
		{
			id: 'severity',
			label: t('automation.severity'),
			cell: alertSeverityCell,
			sortValue: (a) => a.severity
		},
		{
			id: 'state',
			label: t('automation.status'),
			cell: alertStateCell,
			sortValue: (a) => (isAcknowledged(a) ? 1 : 0)
		},
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: alertActionsCell, align: 'actions' }
	]);

	/* ── Commands ── */

	let commands = $state.raw<Command[]>([]);
	let commandsLoaded = $state(false);
	let commandsError = $state<string | null>(null);
	let sendOpen = $state(false);
	let openCommand = $state.raw<Command | null>(null);

	async function loadCommands() {
		try {
			commands = await listCommands();
			commandsError = null;
		} catch (err) {
			commandsError = `${t('automation.load_failed')} ${message(err)}`.trim();
		} finally {
			commandsLoaded = true;
		}
	}

	const waiting = $derived(commands.filter((c) => c.status === 'pending').length);
	const commandsCountText = $derived(
		`${t(commands.length === 1 ? 'automation.commands_count_one' : 'automation.commands_count_many')}, ${t('automation.waiting_count').replace('{count}', '{waiting}')}`
	);

	const commandColumns = $derived<Column<Command>[]>([
		{
			id: 'sent',
			label: t('automation.sent_at'),
			cell: sentCell,
			sortValue: (c) => c.created_at,
			class: 'col-time'
		},
		{
			id: 'device',
			label: t('automation.device'),
			cell: commandDeviceCell,
			primary: true,
			sortValue: (c) => c.device_id
		},
		{
			id: 'type',
			label: t('automation.command_type'),
			cell: commandTypeCell,
			sortValue: (c) => c.command_type
		},
		{ id: 'payload', label: t('automation.command_payload'), cell: payloadCell, class: 'col-payload' },
		{
			id: 'status',
			label: t('automation.command_status'),
			cell: commandStatusCell,
			sortValue: (c) => c.status
		},
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: commandActionsCell,
			align: 'actions'
		}
	]);

	const tabs = $derived([
		{ id: 'rules', label: t('automation.rules') },
		{ id: 'alerts', label: t('automation.alerts') },
		{ id: 'commands', label: t('automation.commands') }
	]);
</script>

<!-- Rules -->
{#snippet ruleNameCell(r: AlertRule)}<span class="strong">{r.name}</span>{#if r.description}<span
			class="cell-sub">{r.description}</span
		>{/if}{/snippet}
{#snippet conditionCell(r: AlertRule)}<Tag
		label={labelFor(t, 'type', r.condition_type)}
	/>{#if r.condition_type !== 'custom'}<span class="cell-sub">{labelFor(t, 'op', r.condition_op)}</span
		>{/if}{/snippet}
{#snippet valueCell(r: AlertRule)}{#if r.condition_type === 'custom' || r.condition_value === null}<Empty
		/>{:else}{formatNumber(r.condition_value)}{/if}{/snippet}
{#snippet severityCell(r: AlertRule)}<Status
		tone={severityTone(r.severity)}
		label={labelFor(t, 'severity', r.severity)}
	/>{/snippet}
{#snippet scopeCell(r: AlertRule)}{#if r.scope_device_id}<ValueCopy value={r.scope_device_id} />{:else}{t(
			'automation.scope_all'
		)}{/if}{/snippet}
{#snippet enabledCell(r: AlertRule)}<BooleanStatus
		value={r.enabled}
		on={t('automation.enabled')}
		off={t('automation.disabled')}
	/>{/snippet}
{#snippet ruleActionsCell(r: AlertRule)}<Button size="sm" onclick={() => (ruleSheet = { rule: r })}
		>{t('actions.edit')}</Button
	><MenuButton
		kebab
		label={t('automation.rule_actions', { name: r.name })}
		bind:open={
			() => ruleMenuFor === r.id, (v) => (ruleMenuFor = v ? r.id : ruleMenuFor === r.id ? null : ruleMenuFor)
		}
	>
		<MenuItem icon={r.enabled ? ICONS.disable : ICONS.enable} onselect={() => void toggleRule(r)}
			>{r.enabled ? t('automation.disable_rule') : t('automation.enable_rule')}</MenuItem
		>
		<MenuDivider />
		<MenuItem icon={ICONS.delete} danger onselect={() => void removeRule(r)}
			>{t('automation.delete_rule_menu')}…</MenuItem
		>
	</MenuButton>{/snippet}

<!-- Alerts -->
{#snippet alertTimeCell(a: Alert)}<Time value={a.triggered_at} />{/snippet}
{#snippet alertRuleCell(a: Alert)}{#if a.rule_name}{a.rule_name}{:else}<Empty />{/if}{/snippet}
{#snippet alertDeviceCell(a: Alert)}{#if a.device_id}<ValueCopy value={a.device_id} />{:else}<Empty
		/>{/if}{/snippet}
{#snippet alertDetailsCell(
	a: Alert
)}{#if a.message}{a.message}{:else if a.measured_value !== null}{formatNumber(a.measured_value)}{:else}<Empty
		/>{/if}{/snippet}
{#snippet alertSeverityCell(a: Alert)}<Status
		tone={severityTone(a.severity)}
		label={labelFor(t, 'severity', a.severity)}
	/>{/snippet}
{#snippet alertStateCell(a: Alert)}{#if isAcknowledged(a)}<Status
			tone="good"
			label={a.acknowledged_by
				? t('automation.acknowledged_by', { name: a.acknowledged_by })
				: t('automation.acknowledged')}
		/>{:else}<Status tone="waiting" label={t('automation.unacknowledged')} />{/if}{/snippet}
{#snippet alertActionsCell(a: Alert)}{#if !isAcknowledged(a)}<Button
			size="sm"
			icon={ICONS.accept}
			busy={acking === a.id}
			onclick={() => void ack(a)}>{t('automation.acknowledge')}</Button
		>{/if}{/snippet}

<!-- Commands -->
{#snippet sentCell(c: Command)}<Time value={c.created_at} />{#if c.created_by}<span class="cell-sub"
			>{t('automation.sent_by', { name: c.created_by })}</span
		>{/if}{/snippet}
{#snippet commandDeviceCell(c: Command)}<span class="mono">{c.device_id}</span>{/snippet}
{#snippet commandTypeCell(c: Command)}<Tag label={labelFor(t, 'cmd_type', c.command_type)} />{/snippet}
{#snippet payloadCell(c: Command)}<span class="mono" title={c.payload}>{truncate(c.payload)}</span>{/snippet}
{#snippet commandStatusCell(c: Command)}<Status
		tone={commandTone(c.status)}
		label={labelFor(t, 'status', c.status)}
	/>{/snippet}
{#snippet commandActionsCell(c: Command)}<Button size="sm" onclick={() => (openCommand = c)}
		>{c.result ? t('automation.view_result') : t('automation.details')}</Button
	>{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide automation-page">
		<div class="page-head">
			<h1>{t('nav.automation')}</h1>
			<p class="page-description">{t('automation.page_description')}</p>
		</div>

		<Tabs {tabs} value={tab} label={t('nav.automation')} onchange={selectTab}>
			{#snippet children(id)}
				{#if id === 'rules'}
					<div class="panel">
						<div class="panel-head">
							<div class="notes">
								<p class="note">{t('automation.rules_note')}</p>
								<p class="note">
									{tf(
										'automation.rules_checked',
										'Rules are checked as values come in: CPU and memory with each usage report from a device, disk use with its inventory, idle time with its activity report, and offline time once a minute. Custom rules are not checked.'
									)}
								</p>
							</div>
							<Button variant="primary" icon={ICONS.add} onclick={() => (ruleSheet = { rule: null })}
								>{t('automation.create_rule')}</Button
							>
						</div>
						{#if rulesLoaded && !rulesError && rules.length}
							<CountLine text={rulesCountText} values={{ count: rules.length, enabled: enabledRules }} />
						{/if}
						<Table
							rows={rules}
							columns={ruleColumns}
							key={(r) => r.id}
							label={t('automation.rules')}
							onrowclick={(r) => (ruleSheet = { rule: r })}
							loading={!rulesLoaded}
							loadingText={t('automation.loading_rules')}
							error={rulesError}
							onretry={() => void loadRules()}
							emptyText={t('automation.no_rules_hint')}
						/>
					</div>
				{:else if id === 'alerts'}
					<div class="panel">
						<p class="note">{t('automation.alerts_note')}</p>
						<SegmentedFilter
							label={t('automation.severity')}
							options={severityOptions}
							value={severity}
							onchange={setSeverity}
						/>
						{#if alertsLoaded && !alertsError && alerts.length}
							<CountLine
								text={t(alerts.length === 1 ? 'automation.alerts_count_one' : 'automation.alerts_count_many')}
								values={{ count: alerts.length }}
							/>
							<ShareBar parts={alertShare} label={t('automation.alerts')} />
						{/if}
						<Table
							rows={alerts}
							columns={alertColumns}
							key={(a) => a.id}
							label={t('automation.alerts')}
							loading={!alertsLoaded}
							loadingText={t('automation.loading_alerts')}
							error={alertsError}
							onretry={() => void loadAlerts()}
							emptyText={severity ? t('automation.no_alerts_filtered') : t('automation.no_alerts_hint')}
						/>
					</div>
				{:else}
					<div class="panel">
						<div class="panel-head">
							<p class="note">{t('automation.commands_note')}</p>
							<Button variant="primary" icon={ICONS.send} onclick={() => (sendOpen = true)}
								>{t('automation.send_command')}</Button
							>
						</div>
						{#if commandsLoaded && !commandsError && commands.length}
							<CountLine text={commandsCountText} values={{ count: commands.length, waiting }} />
						{/if}
						<Table
							rows={commands}
							columns={commandColumns}
							key={(c) => c.id}
							label={t('automation.commands')}
							onrowclick={(c) => (openCommand = c)}
							loading={!commandsLoaded}
							loadingText={t('automation.loading_commands')}
							error={commandsError}
							onretry={() => void loadCommands()}
							emptyText={t('automation.no_commands_hint')}
						/>
					</div>
				{/if}
			{/snippet}
		</Tabs>
	</div>
{/if}

{#if ruleSheet}
	<RuleSheet
		rule={ruleSheet.rule}
		onclose={() => (ruleSheet = null)}
		onsaved={() => {
			ruleSheet = null;
			void loadRules();
		}}
	/>
{/if}

{#if sendOpen}
	<CommandDialog
		onclose={() => (sendOpen = false)}
		onsent={() => {
			sendOpen = false;
			void loadCommands();
		}}
	/>
{/if}

{#if openCommand}
	<CommandSheet command={openCommand} onclose={() => (openCommand = null)} />
{/if}

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: 0;
	}
	/* The tab's note on the start side, its one action right after it */
	.panel-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-3) var(--space-4);
	}
	.notes {
		display: flex;
		flex: 0 1 var(--measure);
		flex-direction: column;
		gap: var(--space-1);
	}
	.panel-head > .note {
		flex: 0 1 var(--measure);
	}
	.note {
		max-width: var(--measure);
		margin: 0;
		color: var(--text-muted);
	}
	.strong {
		font-weight: 600;
	}
	.automation-page :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.automation-page :global(td.col-time) {
		white-space: nowrap;
	}
	.automation-page :global(td.col-details) {
		min-width: 20ch;
		max-width: 48ch;
		overflow-wrap: anywhere;
	}
	.automation-page :global(td.col-payload) {
		max-width: 32ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
