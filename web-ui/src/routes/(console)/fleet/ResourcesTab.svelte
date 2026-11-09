<!--
  Fleet > Resources: printers, network drives, DNS, VPN and proxy settings
  the devices of one organization receive. The organization (the first
  one at first) and a type filter; Add resource and a click on a row open
  the form sheet; the row menu edits or deletes.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		deleteResource,
		isUnavailable,
		listResources,
		RESOURCE_TYPES,
		type Resource
	} from '#lib/api/fleet.ts';
	import type { Organization } from '#lib/api/orgs.ts';
	import { filterResources, resourceActive, resourceTypeKey, scopeKey } from '#lib/canvas/fleet.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import Filter from './Filter.svelte';
	import ResourceSheet from './ResourceSheet.svelte';

	interface Props {
		ready: boolean;
		unavailable: boolean;
		orgs: Organization[];
		orgsState: 'loading' | 'ok' | 'failed';
		onreloadorgs: () => void;
		org: string;
		type: string;
	}

	let {
		ready,
		unavailable = $bindable(),
		orgs,
		orgsState,
		onreloadorgs,
		org = $bindable(),
		type = $bindable()
	}: Props = $props();

	const message = (err: unknown) => (err instanceof Error ? err.message : '');

	/* ── Data ── */

	let list = $state.raw<Resource[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let inflight: AbortController | null = null;

	async function load(): Promise<void> {
		inflight?.abort();
		inflight = null;
		error = null;
		if (!ready || unavailable || orgsState !== 'ok' || !org) {
			list = [];
			loading = !ready || orgsState === 'loading';
			return;
		}
		const ctrl = new AbortController();
		inflight = ctrl;
		loading = true;
		try {
			const out = await listResources(org, ctrl.signal);
			if (inflight !== ctrl) return;
			list = out;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			list = [];
			if (isUnavailable(err)) unavailable = true;
			else error = t('fleet.resources_failed', { error: message(err) });
		}
		loading = false;
	}

	$effect(() => {
		void [ready, unavailable, orgsState, org];
		untrack(() => void load());
	});
	$effect(() => () => untrack(() => inflight?.abort()));

	const rows = $derived(filterResources(list, type));

	const orgOptions = $derived([
		{ value: '', label: t('fleet.select_org_placeholder') },
		...orgs.map((o) => ({ value: o.id, label: o.name || o.id }))
	]);
	const typeOptions = $derived([
		{ value: '', label: t('fleet.all_types') },
		...RESOURCE_TYPES.map((x) => ({ value: x as string, label: t(`fleet.type_${x}`) }))
	]);

	const emptyText = $derived.by(() => {
		if (unavailable) return t('fleet.unavailable_table');
		if (!org) return orgs.length ? t('fleet.choose_org') : t('fleet.no_orgs');
		return type && list.length ? t('fleet.no_resources_type') : t('fleet.no_resources');
	});
	const tableError = $derived(orgsState === 'failed' ? t('fleet.orgs_failed') : error);

	/* ── Sheet and actions ── */

	let sheet = $state<{ resource: Resource | null } | null>(null);
	let menuFor = $state<string | null>(null);
	const orgName = $derived(orgs.find((o) => o.id === org)?.name || org);

	function add() {
		if (!org) {
			toast.error(orgs.length ? t('fleet.choose_org') : t('fleet.no_orgs'));
			return;
		}
		sheet = { resource: null };
	}

	async function remove(r: Resource) {
		const name = r.name || r.id;
		const ok = await confirm({
			title: t('fleet.delete_resource_title'),
			message: t('fleet.delete_resource_message', { name }),
			confirmLabel: t('fleet.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok || !org) return;
		try {
			await deleteResource(org, r.id);
			toast.success(t('fleet.resource_deleted', { name }));
			void load();
		} catch (err) {
			toast.error(t('fleet.delete_failed', { error: message(err) }));
		}
	}

	const columns = $derived<Column<Resource>[]>([
		{
			id: 'name',
			label: t('fleet.col_name'),
			cell: nameCell,
			primary: true,
			sortValue: (r) => r.name.toLowerCase()
		},
		{ id: 'type', label: t('fleet.col_type'), cell: typeCell, sortValue: (r) => r.type },
		{ id: 'address', label: t('fleet.address'), cell: addressCell },
		{ id: 'scope', label: t('fleet.col_scope'), cell: scopeCell, sortValue: (r) => r.scope },
		{ id: 'status', label: t('fleet.col_status'), cell: statusCell, sortValue: (r) => resourceActive(r) },
		{ id: 'actions', label: t('fleet.col_actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);
</script>

{#snippet nameCell(r: Resource)}{r.name}{/snippet}

{#snippet typeCell(r: Resource)}{@const key = resourceTypeKey(r.type)}<Tag
		label={key ? t(key) : r.type || '–'}
	/>{/snippet}

{#snippet addressCell(r: Resource)}<ValueCopy value={r.address || r.value} />{/snippet}

{#snippet scopeCell(r: Resource)}{@const key = scopeKey(r.scope)}{key
		? t(key)
		: r.scope}{#if r.scope_value}<span class="cell-sub">{r.scope_value}</span>{/if}{/snippet}

{#snippet statusCell(r: Resource)}<Status
		tone={resourceActive(r) ? 'good' : 'neutral'}
		label={resourceActive(r) ? t('fleet.active') : t('fleet.inactive')}
	/>{/snippet}

{#snippet actionsCell(r: Resource)}<MenuButton
		kebab
		label={t('fleet.actions_for', { name: r.name || r.id })}
		bind:open={() => menuFor === r.id, (v) => (menuFor = v ? r.id : menuFor === r.id ? null : menuFor)}
	>
		<MenuItem icon={ICONS.edit} onselect={() => (sheet = { resource: r })}>{t('fleet.edit')}</MenuItem>
		<MenuDivider />
		<MenuItem icon={ICONS.delete} danger onselect={() => void remove(r)}
			>{t('fleet.delete_ellipsis')}</MenuItem
		>
	</MenuButton>{/snippet}

<p class="note">{t('fleet.resources_note')}</p>
<Toolbar>
	<Filter label={t('fleet.scope_org')} options={orgOptions} bind:value={org} />
	<Filter label={t('fleet.col_type')} options={typeOptions} bind:value={type} />
	{#snippet end()}
		<Button variant="primary" icon={ICONS.add} onclick={add}>{t('fleet.add_resource')}</Button>
	{/snippet}
</Toolbar>
<p class="count-line" aria-live="polite">
	{#if list.length}
		{#if type}
			<CountLine
				text={t('fleet.count_resources_filtered')}
				values={{ count: rows.length, total: list.length }}
			/>
		{:else}
			<CountLine text={t('fleet.count_resources')} values={{ count: list.length }} />
		{/if}
	{/if}
</p>
<div class="fleet-table">
	<Table
		{rows}
		{columns}
		key={(r) => r.id}
		label={t('fleet.tab_resources')}
		onrowclick={(r) => (sheet = { resource: r })}
		loading={loading && !tableError}
		loadingText={t('fleet.loading_resources')}
		error={tableError}
		onretry={orgsState === 'failed' ? onreloadorgs : () => void load()}
		{emptyText}
	/>
</div>

{#if sheet}
	<ResourceSheet
		resource={sheet.resource}
		{org}
		{orgName}
		{unavailable}
		onclose={() => (sheet = null)}
		onsaved={() => {
			sheet = null;
			void load();
		}}
	/>
{/if}

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
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.fleet-table :global(.row-open) {
		text-align: start;
		white-space: normal;
	}
	@media (pointer: coarse) {
		.fleet-table :global(.row-open) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
</style>
