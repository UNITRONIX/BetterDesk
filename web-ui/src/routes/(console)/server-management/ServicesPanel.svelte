<!--
  Services (?tab=services): BetterDesk's own system services on the
  console's machine, with Restart and Start/Stop per row and a menu for
  Reload, Start at boot and Don't start at boot (not on Windows). Stop,
  Restart and Don't start at boot ask first. Without any service (the
  Docker image), one sentence instead of the search and an empty table.
  Refresh sits in the page head (the page calls refresh()).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		controlService,
		listServices,
		type Service,
		type ServiceAction
	} from '#lib/api/serverManagement.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import {
		confirmFor,
		filterServices,
		isRunning,
		menuActions,
		serviceState
	} from '#lib/serverarea/management.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let services = $state.raw<Service[]>([]);
	let platform = $state('');
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let query = $state('');
	let busy = $state(false);

	export async function refresh() {
		busy = true;
		try {
			const data = await listServices();
			services = data.services;
			platform = data.platform;
			loadError = null;
		} catch (err) {
			services = [];
			loadError = t('server_mgmt.svc_load_failed_reason', {
				error: err instanceof Error ? err.message : String(err)
			});
		} finally {
			loaded = true;
			busy = false;
		}
	}

	$effect(() => untrack(() => void refresh()));

	const shown = $derived(filterServices(services, query));
	const running = $derived(services.filter(isRunning).length);
	const none = $derived(loaded && !loadError && !services.length);

	const label = (action: string) => t('server_mgmt.svc_' + action);

	async function act(name: string, action: ServiceAction) {
		const ask = confirmFor(action);
		if (ask !== 'none') {
			const ok = await confirm({
				title: t('server_mgmt.svc_confirm_title', { action: label(action), name }),
				message: t('server_mgmt.svc_confirm_' + action, { name }),
				confirmLabel: label(action),
				danger: ask === 'danger'
			});
			if (!ok) return;
		}
		try {
			const r = await controlService(name, action);
			if (r.exitCode === 0 || r.exitCode === undefined || r.exitCode === null)
				toast.success(t('server_mgmt.svc_done', { action: label(action), name }));
			else toast.error(t('server_mgmt.svc_done_exit', { action: label(action), name, code: r.exitCode }));
		} catch (err) {
			toast.error(
				t('server_mgmt.svc_action_failed_reason', { error: err instanceof Error ? err.message : String(err) })
			);
		}
		void refresh();
	}

	let menuFor = $state<string | null>(null);
	const MENU_ICONS: Record<string, string> = {
		reload: ICONS.reload,
		enable: ICONS.enable,
		disable: ICONS.disable
	};

	const columns = $derived<Column<Service>[]>([
		{ id: 'name', label: t('server_mgmt.svc_name'), cell: nameCell, primary: true },
		{ id: 'state', label: t('server_mgmt.svc_state'), cell: stateCell },
		{ id: 'actions', label: t('common.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet nameCell(s: Service)}
	<ValueCopy value={s.name} copy={false} />{#if s.description}<span class="cell-sub">{s.description}</span
		>{/if}
{/snippet}

{#snippet stateCell(s: Service)}
	{@const st = serviceState(s)}
	<Status tone={st.tone} label={st.raw ? st.label : t(st.label)} />{#if st.sub}<span class="cell-sub"
			>{st.sub}</span
		>{/if}
{/snippet}

{#snippet actionsCell(s: Service)}
	{@const main = isRunning(s) ? 'stop' : 'start'}
	<Button size="sm" class="svc-restart" onclick={() => void act(s.name, 'restart')}
		>{t('server_mgmt.svc_restart')}</Button
	>
	<Button
		size="sm"
		class="svc-{main}"
		variant={main === 'stop' ? 'danger-quiet' : 'secondary'}
		onclick={() => void act(s.name, main)}>{label(main)}</Button
	>
	{#if menuActions(platform).length}
		<MenuButton
			kebab
			label={t('server_mgmt.svc_actions_for', { name: s.name })}
			bind:open={
				() => menuFor === s.name, (v) => (menuFor = v ? s.name : menuFor === s.name ? null : menuFor)
			}
		>
			{#each menuActions(platform) as a (a)}
				<MenuItem class="act-{a}" icon={MENU_ICONS[a]} onselect={() => void act(s.name, a)}
					>{label(a)}</MenuItem
				>
			{/each}
		</MenuButton>
	{/if}
{/snippet}

<section class="section" aria-label={t('server_mgmt.tab_services')}>
	{#if none}
		<p class="none">{t('server_mgmt.svc_empty')}</p>
	{:else}
		{#if services.length}
			<div class="toolbar">
				<div class="search"><SearchField label={t('server_mgmt.svc_search_label')} bind:value={query} /></div>
			</div>
		{/if}
		<div class="count" aria-live="polite">
			{#if services.length}
				{#if query.trim()}
					<CountLine
						text={t('server_mgmt.svc_count_filtered')}
						values={{ shown: shown.length, total: services.length }}
					/>
				{:else}
					<CountLine text={t('server_mgmt.svc_count')} values={{ total: services.length, running }} />
				{/if}
			{/if}
		</div>
		<Table
			rows={shown}
			{columns}
			key={(s) => s.name}
			label={t('server_mgmt.tab_services')}
			loading={!loaded || (busy && !services.length && !loadError)}
			loadingText={t('server_mgmt.svc_loading')}
			error={loadError}
			onretry={() => void refresh()}
			emptyText={t('server_mgmt.svc_no_match')}
		/>
	{/if}
</section>

<style>
	.none {
		margin: 0;
		max-width: var(--measure);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.search {
		flex: 1 1 200px;
		max-width: 360px;
	}
	.count {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
