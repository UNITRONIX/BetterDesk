<!--
  The BetterDesk agent's inventory report in the Hardware tab: hardware
  facts, disks, network adapters, the system, and the installed programs
  with a search. The same data the inventory page lists.
-->
<script lang="ts">
	import { formatBytes, formatDuration, formatPercent } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import { filterApps, type InventoryApp, type InventoryDisk, type InventoryView } from '../panel-logic.ts';
	import PanelSection from './PanelSection.svelte';

	let { report }: { report: InventoryView } = $props();

	/** Facts without the empty ones */
	const keep = (...items: (Fact | false | '' | 0 | null | undefined)[]): Fact[] =>
		items.filter((f): f is Fact => !!f);

	type Nic = InventoryView['nics'][number];

	const bytes = (n: number) => (n > 0 ? formatBytes(n) : '');
	const pct = (used: number | null, total: number) =>
		!total || total <= 0 || used === null
			? null
			: Math.max(0, Math.min(100, Math.round((used / total) * 100)));
	const memPct = $derived(pct(report.memoryUsed, report.memoryTotal));
	const coresText = $derived(
		!report.cores
			? ''
			: report.physicalCores && report.physicalCores !== report.cores
				? t('inventory.cores_detail', { logical: report.cores, physical: report.physicalCores })
				: String(report.cores)
	);

	let query = $state('');
	const apps = $derived(filterApps(report.apps, query));
	const countText = $derived(
		query.trim()
			? t('inventory.programs_shown', { shown: apps.length, count: report.apps.length })
			: report.apps.length === 1
				? t('inventory.programs_one')
				: t('inventory.programs_many', { count: report.apps.length })
	);

	const hardwareFacts = $derived<Fact[]>(
		keep(
			report.cpuBrand && { label: t('inventory.processor'), value: report.cpuBrand },
			coresText && { label: t('inventory.cores'), value: coresText },
			report.cpuLoad !== null && { label: t('inventory.cpu_load'), value: cpuLoad },
			report.memoryTotal > 0 && { label: t('inventory.memory'), value: memory },
			report.architecture && { label: t('inventory.architecture'), value: report.architecture }
		)
	);
	const softwareFacts = $derived<Fact[]>(
		keep(
			report.osName && { label: t('inventory.os'), value: report.osName },
			report.osVersion && { label: t('inventory.os_version'), value: osVersion },
			report.kernel && { label: t('inventory.kernel'), value: report.kernel },
			(report.uptimeSeconds ?? 0) > 0 && {
				label: t('inventory.uptime'),
				value: formatDuration(report.uptimeSeconds)
			},
			report.collectedAt && { label: t('inventory.collected_at'), value: collected },
			report.receivedAt && { label: t('inventory.received_at'), value: received }
		)
	);

	const diskColumns = $derived<Column<InventoryDisk>[]>([
		{ id: 'drive', label: t('inventory.drive'), cell: driveCell, sortValue: (d) => d.name },
		{ id: 'fs', label: t('inventory.file_system'), cell: fsCell, sortValue: (d) => d.fs },
		{
			id: 'used',
			label: t('inventory.used'),
			cell: usedCell,
			minWidth: '9rem',
			sortValue: (d) => pct(d.used, d.total)
		}
	]);
	const nicColumns = $derived<Column<Nic>[]>([
		{ id: 'name', label: t('inventory.adapter'), cell: nicName, sortValue: (n) => n.name },
		{ id: 'mac', label: t('inventory.mac_address'), cell: nicMac },
		{ id: 'ips', label: t('inventory.ip_addresses'), cell: nicIps }
	]);
	const appColumns = $derived<Column<InventoryApp>[]>([
		{ id: 'name', label: t('inventory.program'), cell: appName, sortValue: (a) => a.name },
		{
			id: 'version',
			label: t('inventory.version'),
			cell: appVersion,
			sortValue: (a) => a.version,
			class: 'dp-col-version'
		},
		{
			id: 'publisher',
			label: t('inventory.publisher'),
			cell: appPublisher,
			sortValue: (a) => a.publisher,
			class: 'dp-col-wide'
		},
		{
			id: 'installed',
			label: t('inventory.installed'),
			cell: appInstalled,
			sortValue: (a) => (a.installed ? new Date(a.installed) : null),
			class: 'dp-col-wide'
		}
	]);
</script>

{#snippet cpuLoad()}<span class="dp-meter"
		><Meter value={report.cpuLoad} text={formatPercent(report.cpuLoad, { digits: 1 })} /></span
	>{/snippet}
{#snippet memory()}
	{#if memPct === null}{bytes(report.memoryTotal)}{:else}<span class="dp-meter"
			><Meter
				value={memPct}
				text={t('inventory.used_of', { used: bytes(report.memoryUsed), total: bytes(report.memoryTotal) })}
			/></span
		>{/if}
{/snippet}
{#snippet osVersion()}<Version version={report.osVersion} />{/snippet}
{#snippet collected()}<Time value={report.collectedAt} relative={false} />{/snippet}
{#snippet received()}<Time value={report.receivedAt} relative={false} />{/snippet}

{#snippet driveCell(d: InventoryDisk)}
	<ValueCopy value={d.name} copy={false} />
	{#if d.device}<span class="dp-sub"><ValueCopy value={d.device} copy={false} /></span>{/if}
	{#if d.removable}<span class="dp-sub">{t('inventory.removable_drive')}</span>{/if}
{/snippet}
{#snippet fsCell(d: InventoryDisk)}{#if d.fs}{d.fs}{:else}<Empty />{/if}{/snippet}
{#snippet usedCell(d: InventoryDisk)}
	{@const p = pct(d.used, d.total)}
	{#if p === null}
		{#if d.total}{bytes(d.total)}{:else}<Empty />{/if}
	{:else}
		<Meter value={p} text={t('inventory.used_of', { used: bytes(d.used ?? 0), total: bytes(d.total) })} />
	{/if}
{/snippet}
{#snippet nicName(n: Nic)}{n.name}{/snippet}
{#snippet nicMac(n: Nic)}<ValueCopy value={n.mac} label={t('inventory.mac_address')} />{/snippet}
{#snippet nicIps(n: Nic)}
	{#each n.ips as ip (ip)}<span class="dp-ip"><ValueCopy value={ip} /></span>{:else}<Empty />{/each}
{/snippet}
{#snippet appName(a: InventoryApp)}
	{a.name}{#if a.publisher}<span class="dp-sub dp-phone-only">{a.publisher}</span>{/if}
{/snippet}
{#snippet appVersion(a: InventoryApp)}<Version version={a.version} />{/snippet}
{#snippet appPublisher(a: InventoryApp)}{#if a.publisher}{a.publisher}{:else}<Empty />{/if}{/snippet}
{#snippet appInstalled(a: InventoryApp)}<Time
		value={a.installed}
		relative={false}
		format={{ year: 'numeric', month: 'short', day: 'numeric', hour: undefined, minute: undefined }}
	/>{/snippet}

<PanelSection title={t('inventory.group_hardware')}>
	{#if hardwareFacts.length}<Facts items={hardwareFacts} />{/if}
	{#if report.disks.length}
		<h4 class="dp-sub-title">{t('inventory.disks')}</h4>
		<Table
			rows={report.disks}
			columns={diskColumns}
			key={(d) => d.name + d.device}
			label={t('inventory.disks')}
		/>
	{/if}
	{#if report.nics.length}
		<h4 class="dp-sub-title">{t('inventory.network_interfaces')}</h4>
		<Table
			rows={report.nics}
			columns={nicColumns}
			key={(n) => n.name + n.mac}
			label={t('inventory.network_interfaces')}
		/>
	{/if}
</PanelSection>

<PanelSection title={t('inventory.group_software')}>
	{#if softwareFacts.length}<Facts items={softwareFacts} />{/if}
	<div class="dp-apps-head">
		<h4 class="dp-sub-title">{t('inventory.installed_programs')}</h4>
		<span class="dp-count" aria-live="polite">{countText}</span>
	</div>
	{#if !report.apps.length}
		<p class="dp-state">{t('inventory.no_programs')}</p>
	{:else}
		<div class="dp-apps-search">
			<SearchField label={t('inventory.search_programs')} bind:value={query} />
		</div>
		<div class="dp-apps">
			<Table
				rows={apps}
				columns={appColumns}
				key={(a) => `${a.name}\n${a.version}\n${a.publisher}`}
				label={t('inventory.installed_programs')}
				emptyText={t('inventory.no_programs_match')}
			/>
		</div>
	{/if}
</PanelSection>

<style>
	.dp-meter {
		flex: 1;
		max-width: 360px;
	}
	.dp-sub-title {
		margin: var(--space-3) 0 0;
		font-size: var(--text-base);
		font-weight: 600;
	}
	.dp-apps-head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
	}
	.dp-count {
		color: var(--text-muted);
	}
	.dp-state {
		margin: 0;
		color: var(--text-muted);
	}
	.dp-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dp-ip {
		display: block;
	}
	.dp-phone-only {
		display: none;
	}
	.dp-apps :global(.dp-col-version) {
		overflow-wrap: anywhere;
	}
	.dp-apps :global(.dp-col-wide) {
		white-space: nowrap;
	}
	@media (max-width: 640px) {
		.dp-apps :global(.dp-col-wide) {
			display: none;
		}
		.dp-phone-only {
			display: block;
		}
	}
	.dp-apps-search {
		max-width: 320px;
	}
</style>
