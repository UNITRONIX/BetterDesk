<!--
  A table widget: the rows the device reports, a search over every column,
  sorting by a column when the manifest allows it (the whole list, before
  it is split into pages), and pages of the manifest's page size. Cells by
  type: badge (a quiet tag; the manifest's colours are not used, tags are
  never coloured per value), datetime, number (decimals, suffix), boolean
  (On/Off), action (a button per action that sends the cell's value; with
  cdap.command only) and text.
-->
<script lang="ts">
	import { formatNumber } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		cellValue,
		filterRows,
		isOn,
		numberOf,
		pageOf,
		sortRows,
		tableRows,
		textOf,
		type Row,
		type TableColumn,
		type Widget
	} from '#lib/devices-area/cdap/model.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Pagination from '#lib/ui/Pagination.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';

	interface Props {
		widget: Widget;
		value: unknown;
		canAct: boolean;
		oncommand: (widget: Widget, action: string, value: unknown) => Promise<boolean>;
	}

	let { widget, value, canAct, oncommand }: Props = $props();

	let query = $state('');
	let sortBy = $state<string | null>(null);
	let dir = $state<'asc' | 'desc'>('asc');
	let page = $state(1);

	const all = $derived(tableRows(value));
	const filtered = $derived(filterRows(all, widget.columns, query));
	const sorted = $derived(
		sortRows(
			filtered,
			widget.columns.find((c) => c.id === sortBy),
			dir,
			i18n.locale
		)
	);
	const view = $derived(pageOf(sorted, page - 1, widget.pageSize));

	function sort(col: TableColumn) {
		if (sortBy === col.id) dir = dir === 'asc' ? 'desc' : 'asc';
		else {
			sortBy = col.id;
			dir = 'asc';
		}
	}

	function ariaSort(col: TableColumn): 'ascending' | 'descending' | 'none' {
		if (sortBy !== col.id) return 'none';
		return dir === 'asc' ? 'ascending' : 'descending';
	}

	const num = (v: unknown, col: TableColumn) => {
		const n = numberOf(v);
		return n === null
			? textOf(v)
			: formatNumber(n, { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals }) +
					col.suffix;
	};
</script>

<div class="table-widget">
	<div class="tw-search">
		<SearchField
			small
			label={tf('cdap.search_table', 'Search this table')}
			bind:value={query}
			oninput={() => (page = 1)}
		/>
	</div>
	<div class="tw-scroll" role="region" aria-label={widget.label}>
		<table class="tw-table">
			<thead>
				<tr>
					{#each widget.columns as col (col.id)}
						<th
							scope="col"
							class={col.type === 'number' ? 'is-num' : undefined}
							aria-sort={widget.sortable ? ariaSort(col) : undefined}
						>
							{#if widget.sortable && col.type !== 'action'}
								<button type="button" class="tw-sort" onclick={() => sort(col)}
									>{col.label}{#if sortBy === col.id}<span class="tw-dir" aria-hidden="true"
											>{dir === 'asc' ? '↑' : '↓'}</span
										>{/if}</button
								>
							{:else}{col.label}{/if}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each view.rows as row, ri (ri)}
					<tr>
						{#each widget.columns as col (col.id)}
							{@const v = cellValue(row as Row, col)}
							<td class={['tw-cell', `is-${col.type}`]}>
								{#if col.type === 'badge'}
									{#if textOf(v)}<Tag label={textOf(v)} />{:else}<Empty />{/if}
								{:else if col.type === 'datetime'}
									<Time value={v} />
								{:else if col.type === 'number'}
									<bdi>{num(v, col)}</bdi>
								{:else if col.type === 'boolean'}
									<Status
										tone={isOn(v) ? 'good' : 'neutral'}
										label={isOn(v) ? t('common.on') : t('common.off')}
									/>
								{:else if col.type === 'action'}
									{#if canAct}
										<span class="tw-actions">
											{#each col.actions as a, ai (ai)}
												<Button size="sm" onclick={() => void oncommand(widget, a.action, textOf(v))}
													>{a.label}</Button
												>
											{/each}
										</span>
									{:else}<Empty />{/if}
								{:else if textOf(v)}
									{textOf(v)}
								{:else}<Empty />{/if}
							</td>
						{/each}
					</tr>
				{:else}
					<tr><td class="tw-empty" colspan={Math.max(1, widget.columns.length)}><Empty /></td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	{#if view.pages > 1}
		<Pagination
			class="tw-pages"
			bind:page
			total={view.total}
			pageSize={widget.pageSize}
			label={widget.label}
		/>
	{/if}
</div>

<style>
	.table-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.tw-search {
		max-width: 260px;
	}
	.tw-scroll {
		max-height: 400px;
		overflow: auto;
	}
	.tw-table {
		width: 100%;
		border-collapse: collapse;
	}
	.tw-table th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		text-align: start;
		white-space: nowrap;
	}
	.tw-table th.is-num {
		text-align: end;
	}
	.tw-sort {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		min-height: var(--control-h-sm);
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	.tw-sort:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.tw-table td {
		max-width: 28rem;
		padding: var(--space-1) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		overflow-wrap: anywhere;
	}
	.tw-table tbody tr:hover td {
		background: var(--bg-subtle);
	}
	.tw-cell.is-number,
	.tw-cell.is-datetime {
		white-space: nowrap;
	}
	.tw-cell.is-number {
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.tw-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	@media (pointer: coarse) {
		.tw-sort {
			min-height: 44px;
		}
	}
</style>
