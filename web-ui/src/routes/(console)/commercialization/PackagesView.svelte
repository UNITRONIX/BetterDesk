<!--
  Billing packages (?tab=packages): the packages with this month's use,
  the assignments that give them to device groups, and beside them what a
  package is and the billing settings. A click on a package opens its
  month; a click on an assignment opens it for editing (billing.manage).
  Creating, editing and deleting need billing.manage; the page calls
  newPackage() from its head.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		deleteContract,
		deletePackage,
		listBillingPackages,
		listContracts,
		packagePreview,
		updateContract,
		type BillingPackage,
		type Contract,
		type Preview
	} from '#lib/api/billing.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		filterContracts,
		filterPackages,
		formatMinutes,
		formatMoney,
		STATUS_TONE
	} from '#lib/serverarea/billing.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import Button from '#lib/ui/Button.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Select from '#lib/ui/Select.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import AssignSheet from './AssignSheet.svelte';
	import BillingSettings from './BillingSettings.svelte';
	import PackageSheet from './PackageSheet.svelte';
	import PreviewSheet from './PreviewSheet.svelte';

	let { canManage, settingsOpen }: { canManage: boolean; settingsOpen: boolean } = $props();

	const uid = $props.id();

	/* ── Data ── */

	let packages = $state.raw<BillingPackage[] | null>(null);
	let packagesError = $state<string | null>(null);
	let previews = $state.raw<Record<string, Preview>>({});
	let contracts = $state.raw<Contract[] | null>(null);
	let contractsError = $state<string | null>(null);

	async function loadPackages(): Promise<BillingPackage[]> {
		try {
			const list = await listBillingPackages();
			// This month's use per package comes with the list: rows that filled in one
			// by one would grow and push the page down. A package without an answer
			// shows dashes.
			const answers = await Promise.allSettled(list.map((p) => packagePreview(p.id)));
			const next: Record<string, Preview> = {};
			list.forEach((p, i) => {
				const a = answers[i];
				if (a?.status === 'fulfilled') next[p.id] = a.value;
			});
			previews = next;
			packages = list;
			packagesError = null;
			return list;
		} catch {
			packagesError = t('commercialization.ui.error_packages');
			return packages ?? [];
		}
	}

	let statusFilter = $state('');

	/** Both lists have answered: the page draws at once instead of growing table by table */
	const settled = $derived(
		(packages !== null || packagesError !== null) && (contracts !== null || contractsError !== null)
	);

	async function loadContracts() {
		try {
			contracts = await listContracts(statusFilter ? { status: statusFilter } : {});
			contractsError = null;
		} catch {
			contractsError = t('commercialization.ui.error_assignments');
		}
	}

	$effect(() => {
		untrack(() => {
			void loadPackages();
			void loadContracts();
		});
	});

	/* ── Filters ── */

	let packageQuery = $state('');
	let contractQuery = $state('');
	const shownPackages = $derived(filterPackages(packages ?? [], packageQuery));
	const shownContracts = $derived(filterContracts(contracts ?? [], contractQuery));

	/* ── Sheets ── */

	let packageSheet = $state<{ pkg: BillingPackage | null } | null>(null);
	let assignSheet = $state<{ contract: Contract | null } | null>(null);
	let previewFor = $state.raw<BillingPackage | null>(null);

	export function newPackage() {
		packageSheet = { pkg: null };
	}

	async function assign() {
		const list = packages?.length ? packages : await loadPackages();
		if (!list.length) {
			toast.error(t('commercialization.contracts.no_packages'));
			return;
		}
		assignSheet = { contract: null };
	}

	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	async function removePackage(p: BillingPackage) {
		const ok = await confirm({
			title: t('commercialization.ui.delete_package_title', { name: p.name }),
			message: t('commercialization.packages.delete_confirm'),
			confirmLabel: t('commercialization.ui.delete_package'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deletePackage(p.id);
			toast.success(t('commercialization.packages.deleted'));
			void loadPackages();
		} catch (err) {
			toast.error(message(err));
		}
	}

	async function toggle(c: Contract) {
		const status = c.status === 'suspended' ? 'active' : 'suspended';
		try {
			await updateContract(c.id, { status });
			toast.success(
				status === 'suspended'
					? t('commercialization.ui.assignment_suspended')
					: t('commercialization.ui.assignment_activated')
			);
			void loadContracts();
		} catch (err) {
			toast.error(message(err));
		}
	}

	async function removeContract(c: Contract) {
		const ok = await confirm({
			title: t('commercialization.ui.remove_assignment_title', {
				name: c.target_name || c.target_key,
				package: c.package_name
			}),
			message: t('commercialization.ui.remove_assignment_message'),
			confirmLabel: t('commercialization.ui.remove_assignment'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteContract(c.id);
			toast.success(t('commercialization.contracts.deleted'));
			void loadContracts();
		} catch (err) {
			toast.error(message(err));
		}
	}

	/* ── Tables ── */

	let menuFor = $state<string | null>(null);
	const bindMenu = (id: string) => ({
		get: () => menuFor === id,
		set: (v: boolean) => (menuFor = v ? id : menuFor === id ? null : menuFor)
	});

	const packageColumns = $derived<Column<BillingPackage>[]>([
		{
			id: 'name',
			label: t('commercialization.packages.name'),
			cell: pkgName,
			primary: true,
			class: 'col-name'
		},
		{ id: 'company', label: t('commercialization.preview.company'), cell: pkgCompany, class: 'col-company' },
		{ id: 'devices', label: t('commercialization.preview.devices'), cell: pkgDevices, align: 'num' },
		{ id: 'included', label: t('commercialization.ui.included_time'), cell: pkgIncluded, align: 'num' },
		{ id: 'used', label: t('commercialization.ui.used_this_month'), cell: pkgUsed, class: 'col-usage' },
		{
			id: 'overage',
			label: t('commercialization.packages.overage_rate'),
			cell: pkgOverage,
			align: 'num',
			class: 'col-overage'
		},
		{
			id: 'actions',
			label: t('commercialization.contracts.actions'),
			labelHidden: true,
			cell: pkgActions,
			align: 'actions'
		}
	]);

	const contractColumns = $derived<Column<Contract>[]>([
		{
			id: 'target',
			label: t('commercialization.contracts.target'),
			cell: cTarget,
			primary: true,
			class: 'col-name'
		},
		{ id: 'package', label: t('commercialization.contracts.package'), cell: cPackage },
		{ id: 'remaining', label: t('commercialization.preview.remaining'), cell: cRemaining, align: 'num' },
		{ id: 'status', label: t('commercialization.contracts.status'), cell: cStatus },
		{
			id: 'validity',
			label: t('commercialization.contracts.validity'),
			cell: cValidity,
			class: 'col-nowrap'
		},
		{
			id: 'actions',
			label: t('commercialization.contracts.actions'),
			labelHidden: true,
			cell: cActions,
			align: 'actions'
		}
	]);

	const statusOptions = $derived([
		{ value: '', label: t('commercialization.filters.all_statuses') },
		{ value: 'active', label: t('commercialization.status.active') },
		{ value: 'suspended', label: t('commercialization.status.suspended') }
	]);

	const money = (amount: unknown, currency: string) => formatMoney(amount, currency, i18n.locale);
	const dayOnly = { hour: undefined, minute: undefined } as const;
</script>

{#snippet pkgName(p: BillingPackage)}
	<span class="cell-title">{p.name}</span>{#if p.description}<span class="cell-sub">{p.description}</span
		>{/if}
{/snippet}

{#snippet pkgCompany(p: BillingPackage)}
	{@const c = previews[p.id]?.companies ?? []}
	{#if c.length}{c.join(', ')}{:else}<Empty />{/if}
{/snippet}

{#snippet pkgDevices(p: BillingPackage)}
	{@const n = previews[p.id]?.device_count}
	{#if n !== null && n !== undefined}{formatNumber(n)}{:else}<Empty />{/if}
{/snippet}

{#snippet pkgIncluded(p: BillingPackage)}{formatMinutes(p.included_minutes)}{/snippet}

{#snippet pkgUsed(p: BillingPackage)}
	{@const prev = previews[p.id]}
	{@const used = prev?.included_minutes_used ?? 0}
	{@const included = prev?.included_limit ?? p.included_minutes ?? 0}
	{#if included > 0}
		<span class="usage"
			><Meter
				value={used}
				max={included}
				high={80}
				full={100}
				text={t('commercialization.ui.used_of_included', {
					used: formatMinutes(used),
					included: formatMinutes(included)
				})}
			/></span
		>
	{:else}
		<Empty word={t('commercialization.ui.no_included_time')} />
	{/if}
{/snippet}

{#snippet pkgOverage(p: BillingPackage)}{money(p.overage_rate, p.currency)}{/snippet}

{#snippet pkgActions(p: BillingPackage)}
	<Button size="sm" class="pkg-preview" icon={ICONS.view} onclick={() => (previewFor = p)}
		>{t('commercialization.preview.open')}</Button
	>
	{#if canManage}
		{@const m = bindMenu('p:' + p.id)}
		<MenuButton
			kebab
			label={t('commercialization.ui.actions_for', { name: p.name })}
			bind:open={m.get, m.set}
		>
			<MenuItem class="act-edit" icon={ICONS.edit} onselect={() => (packageSheet = { pkg: p })}
				>{t('commercialization.actions.edit')}</MenuItem
			>
			<MenuDivider />
			<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void removePackage(p)}
				>{t('commercialization.ui.delete_package')}</MenuItem
			>
		</MenuButton>
	{/if}
{/snippet}

{#snippet cTarget(c: Contract)}
	<span class="cell-title">{c.target_name || c.target_key}</span><span class="cell-sub"
		><Tag label={tf(`commercialization.targets.${c.target_type}`, c.target_type)} /></span
	>
{/snippet}

{#snippet cPackage(c: Contract)}{c.package_name || c.package_id}{/snippet}

{#snippet cRemaining(c: Contract)}{formatMinutes(c.remaining_minutes)}{/snippet}

{#snippet cStatus(c: Contract)}
	<Status
		tone={STATUS_TONE[c.status] ?? c.status}
		label={tf(`commercialization.status.${c.status}`, c.status)}
	/>
{/snippet}

{#snippet cValidity(c: Contract)}
	{#if !c.valid_from && !c.valid_until}
		<Empty word={t('commercialization.ui.no_end')} />
	{:else}
		{#if c.valid_from}<Time value={c.valid_from} relative={false} format={dayOnly} />{:else}…{/if} –
		{#if c.valid_until}<Time value={c.valid_until} relative={false} format={dayOnly} />{:else}…{/if}
	{/if}
{/snippet}

{#snippet cActions(c: Contract)}
	{#if canManage}
		{@const m = bindMenu('c:' + c.id)}
		{@const suspended = c.status === 'suspended'}
		<MenuButton
			kebab
			label={t('commercialization.ui.actions_for', { name: c.target_name || c.target_key })}
			bind:open={m.get, m.set}
		>
			<MenuItem class="act-edit" icon={ICONS.edit} onselect={() => (assignSheet = { contract: c })}
				>{t('commercialization.actions.edit')}</MenuItem
			>
			<MenuItem
				class="act-toggle"
				icon={suspended ? ICONS.enable : ICONS.disable}
				onselect={() => void toggle(c)}
				>{suspended
					? t('commercialization.contracts.activate')
					: t('commercialization.contracts.suspend')}</MenuItem
			>
			<MenuDivider />
			<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void removeContract(c)}
				>{t('commercialization.ui.remove_assignment')}</MenuItem
			>
		</MenuButton>
	{/if}
{/snippet}

{#if !settled}
	<States kind="loading" message={t('commercialization.ui.loading_packages')} />
{:else}
	<div class="page-cols billing-cols">
		<div class="page-main">
			<section class="section" aria-labelledby="{uid}-packages">
				<div class="section-head"><h2 id="{uid}-packages">{t('commercialization.packages.heading')}</h2></div>
				{#if packages?.length}
					<div class="toolbar">
						<div class="search">
							<SearchField label={t('commercialization.ui.search_packages')} bind:value={packageQuery} />
						</div>
					</div>
				{/if}
				<div class="packages-table">
					<Table
						rows={shownPackages}
						columns={packageColumns}
						key={(p) => p.id}
						label={t('commercialization.packages.heading')}
						onrowclick={(p) => (previewFor = p)}
						loading={packages === null && !packagesError}
						loadingText={t('commercialization.ui.loading_packages')}
						error={packages === null ? packagesError : null}
						onretry={() => void loadPackages()}
						emptyText={packages?.length
							? t('commercialization.ui.no_match_packages')
							: t('commercialization.empty.packages')}
					/>
				</div>
			</section>

			<section class="section" aria-labelledby="{uid}-contracts">
				<div class="section-head">
					<h2 id="{uid}-contracts">{t('commercialization.contracts.assignments_title')}</h2>
					{#if canManage}
						<Button size="sm" class="contract-new" icon={ICONS.add} onclick={() => void assign()}
							>{t('commercialization.contracts.new')}</Button
						>
					{/if}
				</div>
				<p class="section-note">{t('commercialization.ui.assignments_note')}</p>
				<div class="toolbar">
					<div class="search">
						<SearchField label={t('commercialization.ui.search_assignments')} bind:value={contractQuery} />
					</div>
					<Select
						width="medium"
						aria-label={t('commercialization.contracts.status')}
						options={statusOptions}
						bind:value={statusFilter}
						onchange={() => void loadContracts()}
					/>
				</div>
				<div class="contracts-table">
					<Table
						rows={shownContracts}
						columns={contractColumns}
						key={(c) => c.id}
						label={t('commercialization.contracts.assignments_title')}
						onrowclick={canManage ? (c) => (assignSheet = { contract: c }) : undefined}
						loading={contracts === null && !contractsError}
						loadingText={t('commercialization.ui.loading_assignments')}
						error={contractsError}
						onretry={() => void loadContracts()}
						emptyText={contractQuery.trim() || statusFilter
							? t('commercialization.ui.no_match_assignments')
							: t('commercialization.empty.contracts')}
					/>
				</div>
			</section>
		</div>

		<aside class="page-side" aria-labelledby="{uid}-explain">
			<section class="section">
				<div class="section-head"><h2 id="{uid}-explain">{t('commercialization.ui.explain_title')}</h2></div>
				<p class="explain">{t('commercialization.ui.explain_text')}</p>
			</section>
			<BillingSettings open={settingsOpen} {canManage} />
		</aside>
	</div>
{/if}

{#if packageSheet}
	<PackageSheet
		pkg={packageSheet.pkg}
		defaultCurrency={packages?.[0]?.currency || 'EUR'}
		onclose={() => (packageSheet = null)}
		onsaved={() => {
			packageSheet = null;
			void loadPackages();
		}}
	/>
{/if}

{#if assignSheet}
	<AssignSheet
		contract={assignSheet.contract}
		packages={packages ?? []}
		onclose={() => (assignSheet = null)}
		onsaved={() => {
			assignSheet = null;
			void Promise.all([loadContracts(), loadPackages()]);
		}}
	/>
{/if}

{#if previewFor}
	<PreviewSheet
		pkg={previewFor}
		cached={previews[previewFor.id] ?? null}
		onclose={() => (previewFor = null)}
	/>
{/if}

<style>
	/* The two tables need about 1,000 px; the side column only goes beside them on wide screens */
	@media (max-width: 1679px) {
		.billing-cols {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.search {
		flex: 1 1 200px;
		max-width: 360px;
	}
	.cell-title {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		margin-top: 2px;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.usage {
		display: block;
		min-width: 180px;
	}
	/* The bar above the numbers */
	.usage :global(.meter) {
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.usage :global(.meter-bar) {
		flex-basis: 100%;
	}
	.packages-table :global(td.col-name),
	.packages-table :global(th.col-name) {
		min-width: 200px;
	}
	.packages-table :global(th.col-overage) {
		white-space: normal;
	}
	.contracts-table :global(td.col-nowrap) {
		white-space: nowrap;
	}
	.explain {
		margin: 0;
		max-width: var(--measure);
	}
</style>
