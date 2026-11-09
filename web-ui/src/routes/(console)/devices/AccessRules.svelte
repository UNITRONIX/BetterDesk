<!--
  Access rules (RustDesk client settings per user group and device group),
  folded under the device list: set up rarely. The count shows next to the
  heading; opening the section loads where each rule is applied. With
  device.edit: Add rule, and per rule Apply to…, Edit, Delete (side sheets
  for the forms, a confirm for delete).
-->
<script lang="ts">
	import type { Device, DeviceGroup } from '#lib/api/devices.ts';
	import { deleteStrategy, getStrategy, listStrategies, type Strategy } from '#lib/api/strategies.ts';
	import { listUserGroups, type UserGroup } from '#lib/api/users.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import StrategyAssignSheet from './StrategyAssignSheet.svelte';
	import StrategySheet from './StrategySheet.svelte';

	let { groups, devices }: { groups: DeviceGroup[]; devices: Device[] } = $props();

	let rules = $state.raw<Strategy[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let open = $state(false);
	let userGroups = $state.raw<UserGroup[]>([]);
	/** "3 devices, 1 user, 0 groups" per rule, loaded when the section is open */
	let applied = $state.raw<Record<string, string>>({});
	let editing = $state<{ rule: Strategy | null } | null>(null);
	let assigning = $state.raw<Strategy | null>(null);

	const canEdit = $derived(can('device.edit'));

	async function load() {
		try {
			rules = await listStrategies();
			loadError = null;
		} catch (err) {
			loadError = err instanceof Error ? err.message : t('errors.server_error');
		} finally {
			loaded = true;
		}
	}

	async function loadUserGroups() {
		// The route needs user.view or device.edit; without them there is nothing to show
		if (!can('device.edit') && !can('user.view')) return;
		try {
			userGroups = await listUserGroups();
		} catch {
			userGroups = [];
		}
	}

	async function loadApplied() {
		const entries = await Promise.all(
			rules.map(async (r): Promise<[string, string]> => {
				try {
					const s = await getStrategy(r.guid);
					const any = s.peer_count || s.user_count || s.device_group_count;
					return [
						r.guid,
						any
							? t('devices.strategy_assign_counts', {
									peers: s.peer_count,
									users: s.user_count,
									groups: s.device_group_count
								})
							: t('devices.strategy_assign_none')
					];
				} catch {
					return [r.guid, t('devices.strategy_assign_none')];
				}
			})
		);
		applied = Object.fromEntries(entries);
	}

	$effect(() => {
		void load();
	});

	// Opening the section: names of the user groups and where each rule applies
	let filled = false;
	$effect(() => {
		if (!open || !loaded || filled) return;
		filled = true;
		void loadUserGroups();
		void loadApplied();
	});

	async function reload() {
		await load();
		if (open) await loadApplied();
	}

	async function remove(r: Strategy) {
		const ok = await confirm({
			title: t('devices.delete_strategy'),
			message: t('devices.delete_strategy_confirm').replace('{name}', r.name ?? ''),
			confirmLabel: t('actions.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteStrategy(r.guid);
			toast.success(t('devices.strategy_deleted'));
			await reload();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	const userGroupName = (guid: string | undefined) =>
		guid ? (userGroups.find((g) => g.guid === guid)?.name ?? guid) : t('devices.strategy_any_user_group');
	const deviceGroupName = (guid: string | undefined) =>
		guid ? (groups.find((g) => g.guid === guid)?.name ?? guid) : t('devices.strategy_any_device_group');

	const columns = $derived<Column<Strategy>[]>([
		{ id: 'name', label: t('devices.strategy_col_rule'), cell: nameCell, primary: true },
		{ id: 'scope', label: t('devices.strategy_col_scope'), cell: scopeCell },
		{ id: 'settings', label: t('devices.strategy_permissions'), cell: settingsCell },
		{ id: 'applied', label: t('devices.strategy_col_assigned'), cell: appliedCell },
		{ id: 'status', label: t('devices.strategy_col_status'), cell: statusCell },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);

	const meta = $derived(
		loaded && rules.length ? t('devices.strategies_count', { count: rules.length }) : undefined
	);
</script>

{#snippet nameCell(r: Strategy)}<span class={['rule-name', !r.enabled && 'is-off']}>{r.name}</span>{/snippet}
{#snippet scopeCell(r: Strategy)}{userGroupName(r.user_group_guid)}
	<span aria-hidden="true">→</span><span class="sr-only">,</span>
	{deviceGroupName(r.device_group_guid)}{/snippet}
{#snippet settingsCell(r: Strategy)}{t('devices.strategy_permissions_count', {
		count: Object.keys(r.permissions).length
	})}{/snippet}
{#snippet appliedCell(r: Strategy)}{applied[r.guid] ?? t('devices.strategy_assign_none')}{/snippet}
{#snippet statusCell(r: Strategy)}<Status
		tone={r.enabled ? 'good' : 'neutral'}
		label={r.enabled ? t('devices.strategy_enabled') : t('devices.strategy_disabled')}
	/>{/snippet}
{#snippet actionsCell(r: Strategy)}{#if canEdit}<MenuButton
			kebab
			label={t('devices.strategy_actions_for', { name: r.name ?? '' })}
		>
			<MenuItem icon={ICONS.link} onselect={() => (assigning = r)}>{t('devices.strategy_assign')}</MenuItem>
			<MenuItem icon={ICONS.edit} onselect={() => (editing = { rule: r })}>{t('actions.edit')}</MenuItem>
			<MenuDivider />
			<MenuItem icon={ICONS.delete} danger onselect={() => void remove(r)}>{t('actions.delete')}</MenuItem>
		</MenuButton>{/if}{/snippet}

<Disclosure title={t('devices.strategies_title')} {meta} bind:open class="access-rules">
	<div class="rules">
		<div class="rules-head">
			<p class="note">{t('devices.strategies_hint')}</p>
			{#if canEdit}
				<Button size="sm" icon={ICONS.add} onclick={() => (editing = { rule: null })}
					>{t('devices.create_strategy')}</Button
				>
			{/if}
		</div>
		{#if !loaded}
			<p class="state">{t('devices.loading_strategies')}</p>
		{:else if loadError}
			<p class="state is-error">
				{loadError}
				<Button size="sm" icon={ICONS.refresh} onclick={() => void load()}>{t('actions.retry')}</Button>
			</p>
		{:else if !rules.length}
			<p class="state">{t('devices.no_strategies')}</p>
		{:else}
			<Table
				rows={rules}
				{columns}
				key={(r) => r.guid}
				label={t('devices.strategies_title')}
				rowClass={(r) => !r.enabled && 'is-off'}
			/>
		{/if}
	</div>
</Disclosure>

{#if editing}
	<StrategySheet
		rule={editing.rule}
		{groups}
		onclose={() => (editing = null)}
		onsaved={async () => {
			editing = null;
			await reload();
		}}
	/>
{/if}

{#if assigning}
	<StrategyAssignSheet
		rule={assigning}
		{groups}
		{devices}
		onclose={() => (assigning = null)}
		onsaved={async () => {
			assigning = null;
			await loadApplied();
		}}
	/>
{/if}

<style>
	.rules {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.rules-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		gap: var(--space-2) var(--space-3);
	}
	.note {
		max-width: var(--measure);
		margin: 0;
		margin-inline-end: auto;
		color: var(--text-muted);
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		margin: 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	.rule-name {
		font-weight: 600;
	}
	.rule-name.is-off {
		color: var(--text-muted);
	}
</style>
