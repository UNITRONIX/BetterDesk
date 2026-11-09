<!--
  Hardware (/inventory): what the BetterDesk agent reports from each device.
  The table lists every device; a click anywhere on a row opens the device
  panel on its Hardware tab, which shows the full report (disks, network
  adapters, programs). Beside it: the systems across all devices (a system
  name filters the table) and the devices short of disk space or memory.

  Data: GET /api/inventory, every page, on load and on Refresh (the top
  bar's or the page's). The search runs here on that list.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listInventory, type InventoryRow } from '#lib/api/inventory.ts';
	import {
		countLine,
		fullDisks,
		fullMemory,
		FULL_PERCENT,
		hasDiskData,
		matches,
		memoryPercent,
		osSummary,
		osText,
		rowName,
		type OsFamily
	} from '#lib/devices-area/inventory.ts';
	import { joinSentences } from '#lib/devices-area/sentences.ts';
	import { openDeviceAt } from '#lib/devices/panel.svelte.ts';
	import { formatBytes, formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import { collatorFor, type Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';

	/* ── Data ── */

	let rows = $state.raw<InventoryRow[]>([]);
	let peerList = $state(false);
	let loaded = $state(false);
	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let inflight: AbortController | null = null;

	async function load(): Promise<void> {
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		loading = true;
		try {
			const out = await listInventory(ctrl.signal);
			if (inflight !== ctrl) return;
			rows = out.rows;
			peerList = out.peerList;
			loadError = null;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			rows = [];
			loadError = err instanceof Error && err.message ? err.message : '';
		} finally {
			if (inflight === ctrl) {
				loading = false;
				loaded = true;
			}
		}
	}

	$effect(() => {
		untrack(() => void load());
		return () => inflight?.abort();
	});
	$effect(() => onRefresh(() => void load()));

	/* ── Search ── */

	let searchInput = $state('');
	let search = $state('');
	// The table follows typing after 200 ms, as before
	$effect(() => {
		const q = searchInput;
		const timer = setTimeout(() => (search = q.trim()), 200);
		return () => clearTimeout(timer);
	});

	const shown = $derived(search ? rows.filter((r) => matches(r, search)) : rows);
	const counted = $derived(
		loadError === null ? joinSentences(countLine(rows, peerList, !!search, shown.length), t) : null
	);

	/** A system name in the side column fills the search and moves there */
	let searchEl = $state<HTMLInputElement | null>(null);
	function searchFor(name: string) {
		searchInput = name;
		search = name;
		searchEl?.focus();
	}

	function open(r: InventoryRow) {
		openDeviceAt(r.device_id, 'hardware');
	}

	/* ── Table ── */

	const mb = (n: number | null) => (n === null ? null : n * 1048576);
	const used = (r: InventoryRow) =>
		r.memory_total_mb
			? t('inventory.used_of', {
					used: formatBytes(mb(r.memory_used_mb)),
					total: formatBytes(mb(r.memory_total_mb))
				})
			: '';
	const cpuSub = (r: InventoryRow) => {
		const out: string[] = [];
		if (r.cpu_cores) out.push(t('inventory.cores_count', { count: formatNumber(r.cpu_cores) }));
		if (r.cpu_usage !== null)
			out.push(t('inventory.load_percent', { value: formatNumber(Math.round(r.cpu_usage)) }));
		return out.join(', ');
	};
	const hasCpu = (r: InventoryRow) => !!r.cpu && r.cpu !== 'Unknown';

	const columns = $derived<Column<InventoryRow>[]>([
		{
			id: 'device',
			class: 'col-device',
			label: t('inventory.col_device'),
			cell: deviceCell,
			primary: true,
			sortValue: (r) => rowName(r) || r.device_id
		},
		{ id: 'os', class: 'col-os', label: t('inventory.os'), cell: osCell, sortValue: (r) => osText(r) },
		{
			id: 'cpu',
			class: 'col-cpu',
			label: t('inventory.cpu'),
			cell: cpuCell,
			sortValue: (r) => (hasCpu(r) ? r.cpu : null)
		},
		{
			id: 'memory',
			class: 'col-memory',
			label: t('inventory.memory'),
			cell: memoryCell,
			sortValue: (r) => memoryPercent(r)
		},
		{
			id: 'disks',
			class: 'col-disks',
			label: t('inventory.disks'),
			cell: disksCell,
			align: 'num',
			sortValue: (r) => r.disk_count
		},
		{
			id: 'updated',
			class: 'col-updated',
			label: t('inventory.col_updated'),
			cell: updatedCell,
			sortValue: (r) => {
				const d = new Date(r.collected_at || (r.last_seen ? r.last_seen.replace(' ', 'T') + 'Z' : ''));
				return Number.isNaN(d.getTime()) ? null : d;
			}
		}
	]);

	/* ── Side column ── */

	const summary = $derived(osSummary(rows, collatorFor(i18n.locale)));
	const familyLabel = (id: OsFamily) =>
		id === 'windows'
			? t('cross_platform.platform_windows')
			: id === 'linux'
				? t('cross_platform.platform_linux')
				: id === 'apple'
					? t('cross_platform.platform_macos')
					: t('inventory.os_other');
	const disks = $derived(hasDiskData(rows) ? fullDisks(rows) : null);
	const memory = $derived(fullMemory(rows));
	const showSide = $derived(loaded && loadError === null && rows.length > 0);
	const label = (r: InventoryRow) => rowName(r) || r.device_id;
</script>

{#snippet deviceCell(r: InventoryRow)}<span class="device"
		><span class="device-name">{rowName(r) || r.device_id}</span>{#if rowName(r)}<span class="cell-sub mono"
				>{r.device_id}</span
			>{/if}{#if r.os}<span class="cell-sub phone-only">{osText(r)}</span>{/if}</span
	>{/snippet}

{#snippet osCell(r: InventoryRow)}<Platform platform={r.os ? osText(r) : ''} />{/snippet}

{#snippet cpuCell(r: InventoryRow)}{#if hasCpu(r)}<span class="cpu-name" title={r.cpu}>{r.cpu}</span
		>{:else}<Empty />{/if}{#if cpuSub(r)}<span class="cell-sub">{cpuSub(r)}</span>{/if}{/snippet}

{#snippet memoryCell(r: InventoryRow)}{#if memoryPercent(r) === null}<Empty />{:else}<Meter
			value={memoryPercent(r)}
		/><span class="cell-sub memory-detail">{used(r)}</span>{/if}{/snippet}

{#snippet disksCell(r: InventoryRow)}{#if r.disk_count}{formatNumber(r.disk_count)}{:else}<Empty
		/>{/if}{/snippet}

{#snippet updatedCell(r: InventoryRow)}<Time
		value={r.collected_at || (r.last_seen ? r.last_seen.replace(' ', 'T') + 'Z' : '')}
	/>{/snippet}

<div class="page page-wide inventory-page">
	<div class="page-head">
		<h1>{t('nav.inventory')}</h1>
		<p class="page-description">{t('inventory.page_description')}</p>
	</div>

	<div class="page-cols">
		<section class="section page-main" aria-label={t('nav.inventory')}>
			<Toolbar>
				{#snippet search()}<SearchField
						label={t('inventory.search_label')}
						bind:value={searchInput}
						bind:element={searchEl}
					/>{/snippet}
				<!-- Next to the search, not alone at the far end of the line -->
				<Button icon={ICONS.refresh} busy={loading && loaded} onclick={() => void load()}
					>{t('actions.refresh')}</Button
				>
			</Toolbar>
			<div class="count" aria-live="polite">
				{#if counted && counted.text}<CountLine text={counted.text} values={counted.values} />{/if}
			</div>

			<div class="inventory-table">
				<Table
					rows={shown}
					{columns}
					key={(r) => r.device_id}
					label={t('nav.inventory')}
					onrowclick={open}
					loading={!loaded}
					loadingText={t('inventory.loading')}
					error={loadError !== null ? `${t('inventory.load_failed')} ${loadError}`.trim() : null}
					onretry={() => void load()}
					emptyText={rows.length ? t('inventory.no_match') : t('inventory.empty')}
				/>
			</div>
		</section>

		{#if showSide}
			<!-- What the whole fleet runs and which devices are short of space -->
			<aside class="page-side" aria-label={t('inventory.side_label')}>
				<section class="section" aria-labelledby="inv-os-title">
					<h2 id="inv-os-title">{t('inventory.os_title')}</h2>
					<p class="section-note">{t('inventory.os_note')}</p>
					{#if summary.families.length}
						<!-- One whole split into OS families; the legend names each part with its number -->
						<div class="share-bar" aria-hidden="true">
							{#each summary.families as f (f.id)}<span class="fam-{f.id}" style:flex-grow={f.count}
								></span>{/each}
						</div>
						<ul class="share-legend" aria-label={t('inventory.os_title')}>
							{#each summary.families as f (f.id)}
								<li>
									<span class="key fam-{f.id}" aria-hidden="true"></span><span
										><strong>{formatNumber(f.count)}</strong> {familyLabel(f.id)}</span
									>
								</li>
							{/each}
						</ul>
					{/if}
					<table class="os-table">
						<thead>
							<tr>
								<th scope="col">{t('inventory.os_col_system')}</th>
								<th scope="col" class="num">{t('inventory.os_col_devices')}</th>
							</tr>
						</thead>
						<tbody>
							{#each summary.top as s (s.name)}
								<tr>
									<td
										><Button variant="link" class="os-filter" onclick={() => searchFor(s.name)}
											>{s.name}</Button
										></td
									>
									<td class="num">{formatNumber(s.count)}</td>
								</tr>
							{:else}
								<tr><td colspan="2" class="state-cell">{t('inventory.os_none')}</td></tr>
							{/each}
						</tbody>
					</table>
					{#if summary.more > 0}
						<CountLine text={t('inventory.os_more')} values={{ count: summary.more }} />
					{/if}
				</section>

				{#if !peerList}
					<!-- Devices from the plain device list have no report, so there is no space to judge -->
					<section class="section" aria-labelledby="inv-space-title">
						<h2 id="inv-space-title">{t('inventory.space_title')}</h2>
						<p class="section-note">{t('inventory.space_note')}</p>
						{#if disks}
							<h3 id="inv-disk-title">{t('inventory.disks')}</h3>
							<div role="group" aria-labelledby="inv-disk-title">
								<RowList>
									{#each disks as r (r.device_id)}
										<ListRow
											title={label(r)}
											sub={t('inventory.disk_full_row', {
												mount: r.disk_max_mount,
												pct: formatNumber(Math.round(r.disk_max_used_percent ?? 0)),
												free: r.disk_max_free_bytes ? formatBytes(r.disk_max_free_bytes) : formatBytes(0)
											}).trim()}
											chevron
											onclick={() => open(r)}
										/>
									{:else}
										<ListRow empty title={t('inventory.disks_none', { pct: FULL_PERCENT })} />
									{/each}
								</RowList>
							</div>
						{/if}
						<h3 id="inv-mem-title">{t('inventory.memory')}</h3>
						<div role="group" aria-labelledby="inv-mem-title">
							<RowList>
								{#each memory as m (m.row.device_id)}
									<ListRow
										title={label(m.row)}
										sub={t('inventory.memory_full_row', {
											pct: formatNumber(m.pct),
											used: formatBytes(mb(m.row.memory_used_mb)),
											total: formatBytes(mb(m.row.memory_total_mb))
										})}
										chevron
										onclick={() => open(m.row)}
									/>
								{:else}
									<ListRow empty title={t('inventory.memory_none', { pct: FULL_PERCENT })} />
								{/each}
							</RowList>
						</div>
					</section>
				{/if}
			</aside>
		{/if}
	</div>
</div>

<style>
	.count {
		min-height: 1.5em;
	}
	.device {
		display: block;
		overflow-wrap: anywhere;
	}
	.device-name {
		font-weight: 600;
	}
	.cell-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.cpu-name {
		display: block;
		max-width: 28ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Two classes: wins over .cell-sub whatever order the build puts them in */
	.cell-sub.phone-only {
		display: none;
	}
	/* The table shares the width with the side column: measure the column, not the window */
	.inventory-table {
		container: invtable / inline-size;
	}
	.inventory-table :global(:is(th, td).col-memory) {
		min-width: 160px;
	}
	.inventory-table :global(:is(th, td).col-device) {
		min-width: 10rem;
	}
	.inventory-table :global(td.col-updated) {
		color: var(--text-muted);
		white-space: nowrap;
	}
	/* CPU and disks are also in each device's report */
	@container invtable (max-width: 1000px) {
		.inventory-table :global(.col-disks),
		.inventory-table :global(.col-cpu) {
			display: none;
		}
	}
	/* Phone: name, ID and system on the start side, memory and age below */
	@container invtable (max-width: 600px) {
		.inventory-table :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
		.inventory-table :global(table),
		.inventory-table :global(tbody) {
			display: block;
		}
		.inventory-table :global(tbody tr:not(.state-row)) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			align-items: start;
			gap: var(--space-1) var(--space-3);
			padding: var(--row-pad-y) var(--row-pad-x);
			border-bottom: 1px solid var(--rule);
		}
		.inventory-table :global(tbody tr:not(.state-row) > :is(td, th)) {
			display: none;
			height: auto;
			padding: 0;
			border: 0;
		}
		.inventory-table :global(tbody tr:not(.state-row) > .col-device) {
			display: block;
			grid-column: 1;
		}
		.inventory-table :global(tbody tr:not(.state-row) > .col-updated) {
			display: block;
			grid-column: 2;
			grid-row: 1;
			font-size: var(--text-sm);
		}
		.inventory-table :global(tbody tr:not(.state-row) > .col-memory) {
			display: block;
			grid-column: 1 / -1;
			min-width: 0;
		}
		.cell-sub.memory-detail {
			display: none;
		}
		.cell-sub.phone-only {
			display: block;
		}
	}
	@media (pointer: coarse) {
		.inventory-table :global(.row-open) {
			min-height: 44px;
		}
	}

	/* Systems: one whole split into OS families, in the chart series colours */
	.share-bar {
		display: flex;
		gap: 2px;
		height: 8px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--hover);
	}
	.share-bar > span {
		display: block;
		height: 100%;
		min-width: 2px;
	}
	.share-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
	}
	.share-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.share-legend strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.key {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.fam-windows {
		background: var(--series-1);
	}
	.fam-linux {
		background: var(--series-2);
	}
	.fam-apple {
		background: var(--series-3);
	}
	.fam-other {
		background: var(--border);
	}
	@media (forced-colors: active) {
		.share-bar > span,
		.key {
			forced-color-adjust: none;
			border: 1px solid CanvasText;
		}
	}

	/* The systems table: names that filter, counts at the end */
	.os-table {
		width: calc(100% + 2 * var(--row-pad-x));
		margin: 0 calc(-1 * var(--row-pad-x));
		border-collapse: collapse;
	}
	.os-table th,
	.os-table td {
		padding: 0 var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		text-align: start;
	}
	.os-table th {
		height: var(--row-h);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.os-table td {
		height: var(--control-h);
	}
	.os-table .num {
		width: 6rem;
		text-align: end;
		font-variant-numeric: tabular-nums;
	}
	.os-table :global(.os-filter) {
		min-height: var(--control-h);
		text-align: start;
	}
	.state-cell {
		color: var(--text-muted);
	}
	h3 {
		margin: var(--space-2) 0 0;
		font-size: var(--text-base);
	}
</style>
