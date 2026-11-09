<!--
  The remote client's device list: folders, groups and tags on the start
  side; search, status filter, list or tiles, Refresh, and per device
  Connect (or "Open in RustDesk app" on phones, or "Already connected" in
  the viewer's New connection dialog). Data: GET /api/devices, /api/folders,
  /api/device-groups, /api/tags (the last three may fail on their own).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listDeviceGroups, listDevices, listFolders, listTags } from '#lib/api/devices.ts';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import Button from '#lib/ui/Button.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import SegmentedFilter from '#lib/ui/SegmentedFilter.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import TagSet from '#lib/ui/TagSet.svelte';
	import Time from '#lib/ui/Time.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import LinkButton from './LinkButton.svelte';
	import {
		ALL,
		chooseScope,
		countDevices,
		deviceStatus,
		displayName,
		filterDevices,
		normalizeTags,
		sameScope,
		scopeTitle,
		type BookDevice,
		type BookFolder,
		type BookGroup,
		type Scope,
		type StatusFilter
	} from './address-book.ts';

	interface Props {
		/** The New connection dialog: smaller tiles, tiles first */
		compact?: boolean;
		view?: 'list' | 'grid';
		phone?: boolean;
		connected?: readonly string[];
		onconnect: (id: string, name: string) => void;
		onviewchange?: (view: 'list' | 'grid') => void;
		/** After each load: whether it worked (the dashboard's "Updated" line) */
		onsync?: (ok: boolean) => void;
		/** Increase to reload in the background */
		reload?: number;
		headingLevel?: 2 | 3;
		/** After the count: when the list was last refreshed (the dashboard) */
		syncText?: string;
		syncFailed?: boolean;
	}

	let {
		compact = false,
		view = $bindable(compact ? 'grid' : 'list'),
		phone = false,
		connected = [],
		onconnect,
		onviewchange,
		onsync,
		reload = 0,
		headingLevel = 2,
		syncText = '',
		syncFailed = false
	}: Props = $props();

	const uid = $props.id();
	let devices = $state.raw<BookDevice[]>([]);
	let folders = $state.raw<BookFolder[]>([]);
	let groups = $state.raw<BookGroup[]>([]);
	let tags = $state.raw<string[]>([]);
	let loaded = $state(false);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let scope = $state.raw<Scope>(ALL);
	let status = $state<StatusFilter>('all');
	let query = $state('');

	const shown = $derived(filterDevices(devices, { scope, status, query, groups }));
	const counts = $derived(countDevices(devices, folders, groups, tags));
	const onlineShown = $derived(shown.filter((d) => d.online).length);
	const title = $derived(scopeTitle(scope, folders, groups));

	export async function load(silent = false): Promise<boolean> {
		if (loading) return false;
		loading = true;
		if (!silent) error = null;
		try {
			const [d, f, g, t] = await Promise.all([
				listDevices(),
				listFolders().catch(() => []),
				listDeviceGroups().catch(() => []),
				listTags().catch(() => [])
			]);
			devices = d as unknown as BookDevice[];
			folders = f as unknown as BookFolder[];
			groups = g as unknown as BookGroup[];
			tags = t;
			loaded = true;
			error = null;
			onsync?.(true);
			return true;
		} catch (err) {
			if (!silent || !loaded)
				error =
					err instanceof Error ? err.message : tf('remote_dashboard.error_load', 'Failed to load devices');
			onsync?.(false);
			return false;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		void reload;
		untrack(() => void load(loaded));
	});

	function setView(v: 'list' | 'grid') {
		view = v;
		onviewchange?.(v);
	}

	// The filter headings come before the list's title, so they share its level
	const H = $derived(`h${headingLevel}`);

	const columns: Column<BookDevice>[] = $derived([
		{ id: 'name', label: tf('remote_dashboard.col_name', 'Name'), cell: nameCell, primary: true },
		{ id: 'id', label: tf('remote_dashboard.col_id', 'ID'), cell: idCell, class: 'col-id' },
		{ id: 'status', label: tf('remote_dashboard.col_status', 'Status'), cell: statusCell },
		{
			id: 'platform',
			label: tf('remote_dashboard.col_platform', 'Platform'),
			cell: platformCell,
			class: 'col-platform'
		},
		{
			id: 'last',
			label: tf('remote_dashboard.col_last_seen', 'Last seen'),
			cell: lastCell,
			class: 'col-last'
		},
		{
			id: 'actions',
			label: tf('remote.actions', 'Actions'),
			labelHidden: true,
			align: 'actions',
			cell: actionCell
		}
	]);
</script>

{#snippet nameCell(d: BookDevice)}
	<span class="hostname">{displayName(d)}</span>
	<span class="cell-sub mono row-id">{d.id}</span>
	{#if normalizeTags(d.tags).length}<span class="cell-sub"><TagSet tags={normalizeTags(d.tags)} /></span>{/if}
{/snippet}
{#snippet idCell(d: BookDevice)}<span class="mono">{d.id}</span>{/snippet}
{#snippet statusCell(d: BookDevice)}
	{@const st = deviceStatus(d)}<Status tone={st.tone} label={st.label} />
{/snippet}
{#snippet platformCell(d: BookDevice)}<Platform platform={d.platform || d.os || ''} />{/snippet}
{#snippet lastCell(d: BookDevice)}
	{#if d.online}{tf('status.online', 'Online')}{:else}<Time value={d.last_online} />{/if}
{/snippet}
{#snippet actionCell(d: BookDevice)}
	{@const name = displayName(d)}
	{#if connected.includes(d.id)}
		<span class="connected-label">{tf('remote.session_picker.already_connected', 'Already connected')}</span>
	{:else if d.banned}
		<!-- Banned devices cannot be reached; the status says why -->
	{:else if phone}
		<LinkButton size="sm" href="rustdesk://{encodeURIComponent(d.id)}"
			>{tf('remote_viewer.open_in_app', 'Open in RustDesk app')}</LinkButton
		>
	{:else}
		<Button
			size="sm"
			aria-label={tf('remote_dashboard.connect_to', 'Connect to {name}', { name })}
			onclick={() => onconnect(d.id, name)}>{tf('remote_dashboard.connect', 'Connect')}</Button
		>
	{/if}
{/snippet}

{#snippet navItem(item: Scope, label: string, count: number)}
	{@const on = sameScope(scope, item)}
	<li>
		<button
			type="button"
			class={['nav-item', on && 'active']}
			aria-pressed={on}
			onclick={() => (scope = chooseScope(scope, item))}
		>
			<span class="nav-label">{label}</span>
			<span class="nav-count">{formatNumber(count)}</span>
		</button>
	</li>
{/snippet}

<div class={['book', compact && 'compact']}>
	<aside class="book-side" aria-label={tf('remote_dashboard.filters_label', 'Filters')}>
		<!-- Filled once the lists are in: before that it would say there are no
		     groups or tags, then grow -->
		{#if loaded}
			<div class="filter-block">
				<svelte:element this={H} class="filter-head"
					>{tf('remote_dashboard.nav_folders', 'Folders')}</svelte:element
				>
				<ul class="filter-list">
					{@render navItem(ALL, tf('remote_dashboard.all_devices', 'All devices'), counts.all)}
					{@render navItem(
						{ kind: 'folder', id: 'unassigned' },
						tf('remote_dashboard.unassigned', 'Unassigned'),
						counts.unassigned
					)}
					{#each folders as f (f.id)}
						{@render navItem(
							{ kind: 'folder', id: String(f.id) },
							f.name,
							counts.folders.get(String(f.id)) ?? 0
						)}
					{/each}
				</ul>
			</div>
			<div class="filter-block">
				<svelte:element this={H} class="filter-head"
					>{tf('remote_dashboard.nav_groups', 'Groups')}</svelte:element
				>
				{#if groups.length}
					<ul class="filter-list">
						{#each groups as g (g.guid)}
							{@render navItem({ kind: 'group', id: g.guid }, g.name, counts.groups.get(g.guid) ?? 0)}
						{/each}
					</ul>
				{:else}
					<p class="filter-empty">{tf('remote_dashboard.no_groups', 'No groups')}</p>
				{/if}
			</div>
			<div class="filter-block">
				<svelte:element this={H} class="filter-head">{tf('remote_dashboard.nav_tags', 'Tags')}</svelte:element
				>
				{#if tags.length}
					<ul class="filter-list">
						{#each tags as tag (tag)}
							{@render navItem({ kind: 'tag', id: tag }, tag, counts.tags.get(tag) ?? 0)}
						{/each}
					</ul>
				{:else}
					<p class="filter-empty">{tf('remote_dashboard.no_tags', 'No tags')}</p>
				{/if}
			</div>
		{/if}
	</aside>

	<section class="book-main" aria-labelledby="{uid}-title">
		<svelte:element this={H} class="book-title" id="{uid}-title">{title}</svelte:element>
		<div class="book-toolbar">
			<SearchField
				class="book-search"
				label={tf('remote_dashboard.search_placeholder', 'Search devices')}
				placeholder={tf('remote_dashboard.search_placeholder', 'Search devices')}
				bind:value={query}
			/>
			<SegmentedFilter
				label={tf('remote_dashboard.col_status', 'Status')}
				options={[
					{ value: 'all', label: tf('remote_dashboard.filter_all', 'All') },
					{ value: 'online', label: tf('remote_dashboard.filter_online', 'Online') },
					{ value: 'offline', label: tf('remote_dashboard.filter_offline', 'Offline') }
				]}
				bind:value={status}
			/>
			<div class="toolbar-end">
				<SegmentedFilter
					label={tf('remote_dashboard.view_label', 'View')}
					options={[
						{ value: 'list', label: tf('remote_dashboard.view_list', 'List') },
						{ value: 'grid', label: tf('remote_dashboard.view_grid', 'Tiles') }
					]}
					value={view}
					onchange={setView}
				/>
				<Button icon="refresh" busy={loading} onclick={() => void load(false)}
					>{tf('remote_dashboard.sync_now', 'Refresh')}</Button
				>
			</div>
		</div>
		<p class="count-line" aria-live="polite">
			{#if loaded}
				{tf('remote_dashboard.devices_count_online', '{count} devices, {online} online.', {
					count: formatNumber(shown.length),
					online: formatNumber(onlineShown)
				})}
			{/if}
			{#if syncText}<span class={['sync', syncFailed && 'is-error']}>{syncText}</span>{/if}
		</p>

		{#if error}
			<p class="state is-error" role="alert">
				<span>{error}</span>
				<Button size="sm" onclick={() => void load(false)}>{tf('remote_dashboard.retry', 'Retry')}</Button>
			</p>
		{:else if !loaded}
			<p class="state">{tf('remote_dashboard.loading', 'Loading devices…')}</p>
		{:else if shown.length === 0}
			<p class="state">{tf('remote_dashboard.empty', 'No devices match.')}</p>
		{:else if view === 'list'}
			<Table
				class="book-table"
				rows={shown}
				{columns}
				key={(d) => d.id}
				label={title}
				virtualThreshold={200}
				rowClass={(d) => (!d.online ? 'is-offline' : null)}
			/>
		{:else}
			<ul class="book-grid">
				{#each shown as d (d.id)}
					{@const st = deviceStatus(d)}
					{@const name = displayName(d)}
					{@const tagList = normalizeTags(d.tags)}
					<li class={['card', !d.online && 'is-offline', connected.includes(d.id) && 'is-connected']}>
						<div class="card-body">
							<span class="card-name" title={name}>{name}</span>
							<span class="mono card-id">{d.id}</span>
							<span><Status tone={st.tone} label={st.label} /></span>
							{#if d.platform || d.os}<span class="card-meta"
									><Platform platform={d.platform || d.os || ''} /></span
								>{/if}
							{#if tagList.length}<span class="card-tags"><TagSet tags={tagList} /></span>{/if}
						</div>
						<div class="card-footer">{@render actionCell(d)}</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.book {
		display: grid;
		grid-template-columns: minmax(180px, 220px) minmax(0, 1fr);
		gap: var(--space-5);
		min-height: 0;
	}
	.book-side {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		min-width: 0;
	}
	.filter-head {
		margin: 0 0 var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-xs);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.filter-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.filter-empty {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		width: 100%;
		min-height: var(--row-h);
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.nav-item:hover {
		background: var(--hover);
	}
	.nav-item.active {
		background: var(--accent-tint);
		font-weight: 600;
	}
	.nav-item:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.nav-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nav-count {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.book-main {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}
	.book-title {
		margin: 0;
		font-size: var(--text-lg);
	}
	.book-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.book-toolbar :global(.book-search) {
		flex: 1 1 220px;
		max-width: 360px;
	}
	.toolbar-end {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-inline-start: auto;
	}
	.count-line {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.sync {
		margin-inline-start: var(--space-2);
	}
	.sync.is-error {
		color: var(--danger);
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-5) 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	.hostname {
		font-weight: 600;
	}
	/* The ID has its own column in the table; under the name only where that column is hidden */
	.book .row-id.cell-sub {
		display: none;
	}
	.connected-label {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.book :global(.book-table tr.is-offline) {
		color: var(--text-muted);
	}
	/* Tiles: plain tiles on rules, no colours */
	.book-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.compact .book-grid {
		grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
	}
	.card {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg);
	}
	.card.is-connected {
		border-color: var(--accent);
	}
	.card-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.card-name {
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-id,
	.card-meta {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.card.is-offline .card-name {
		color: var(--text-muted);
	}
	@media (max-width: 900px) {
		.book {
			grid-template-columns: minmax(0, 1fr);
		}
		.book-side {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		}
	}
	@media (max-width: 640px) {
		.book :global(.book-table .col-id),
		.book :global(.book-table .col-platform),
		.book :global(.book-table .col-last) {
			display: none;
		}
		.book .row-id.cell-sub {
			display: block;
		}
	}
</style>
