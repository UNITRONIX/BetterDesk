<!--
  Data table (components.css "Tables"). Generic over the row type.

  Sorting: a sortable column (sortValue or compare) has a button that fills
  its header cell; aria-sort on the th. The table sorts `rows` itself
  (stable, empty values last, text in the console language).

  Opening a row: with onrowclick, one click anywhere on the row opens it,
  except on controls inside it (buttons, links, fields, labels, menus).
  The keyboard way is the primary column: its cell is a row header with a
  button around the content, so Tab reaches every row with a real button
  (Enter and Space open it, screen readers announce "button" plus the row's
  name). Arrow up and down move between those buttons, also into rows a
  long table has not rendered yet.

  Long tables (more than virtualThreshold rows) render only the rows in
  view plus `overscan` above and below, with a spacer row on each side so
  the native table layout, the sticky header and the column widths stay.
  All rows have the height of the first rendered ones (measured, then
  re-measured when the table's width changes). aria-rowcount on the table
  and aria-rowindex on each rendered row give screen readers the full size.
  Pass rows as $state.raw: the table never needs them deeply reactive.

  Scrolling: `height` gives the table its own scroll box (both directions,
  the header sticks inside it). Without it the table follows `scroller` or
  the nearest scrolling ancestor (or the window). The header sticks against
  that only with scrollX={false}, because a box that scrolls sideways is
  also the box a sticky header sticks to.
-->
<script lang="ts" generics="T">
	import { tick, untrack } from 'svelte';
	import type { ClassValue } from 'svelte/elements';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import {
		ariaSort,
		isSortable,
		nextSort,
		sortRows,
		visibleWindow,
		type Column,
		type SortState
	} from './table.ts';

	interface Props {
		rows: T[];
		columns: Column<T>[];
		/** Stable, unique key of a row (the device ID) */
		key: (row: T) => string;
		/** Accessible name of the table (its caption) */
		label: string;
		/** Show the caption; by default only screen readers read it (the page has a heading) */
		labelVisible?: boolean;
		sort?: SortState | null;
		/** A checkbox column; the selected keys are in `selection` */
		selectable?: boolean;
		/** Selected row keys. Replaced (never mutated) on every change. */
		selection?: Set<string>;
		/** Accessible name of a row's checkbox ("Select laptop-12") */
		selectLabel?: (row: T) => string;
		selectAllLabel?: string;
		onrowclick?: (row: T) => void;
		/** Classes for a row's state (banned, deleted) */
		rowClass?: (row: T) => ClassValue | false | null | undefined;
		loading?: boolean;
		loadingText?: string;
		/** One sentence; shown instead of the rows */
		error?: string | null;
		onretry?: () => void;
		/** One sentence for no rows (after filtering too) */
		emptyText?: string;
		/** Above this many rows only the rows in view are rendered */
		virtualThreshold?: number;
		overscan?: number;
		/** Row height in px for a virtual table; measured when not given */
		rowHeight?: number;
		/** The element that scrolls the table, when not the nearest scrolling ancestor */
		scroller?: HTMLElement | null;
		/** Max height of the table's own scroll box (a CSS length) */
		height?: string;
		/** The box scrolls sideways when the table is wider than it */
		scrollX?: boolean;
		class?: string;
	}

	let {
		rows,
		columns,
		key,
		label,
		labelVisible = false,
		sort = $bindable(null),
		selectable = false,
		selection = $bindable(new Set<string>()),
		selectLabel,
		selectAllLabel,
		onrowclick,
		rowClass,
		loading = false,
		loadingText,
		error = null,
		onretry,
		emptyText = '',
		virtualThreshold = 200,
		overscan = 10,
		rowHeight,
		scroller = null,
		height,
		scrollX = true,
		class: cls = ''
	}: Props = $props();

	const captionId = $props.id();

	let box = $state<HTMLDivElement | null>(null);
	let tbody = $state<HTMLTableSectionElement | null>(null);

	const shown = $derived(columns.filter((c) => c.visible !== false));
	const colspan = $derived(shown.length + (selectable ? 1 : 0));

	const sortColumn = $derived(sort ? columns.find((c) => c.id === sort?.column && isSortable(c)) : undefined);
	const sorted = $derived.by(() => {
		if (!sort || !sortColumn) return rows;
		return sortRows(rows, {
			sortValue: sortColumn.sortValue,
			compare: sortColumn.compare,
			dir: sort.dir,
			locale: i18n.locale
		});
	});

	/* ── Virtual window ── */

	const virtual = $derived(sorted.length > virtualThreshold);
	let measuredRowH = $state(0);
	let cssRowH = $state(44);
	const rowH = $derived(rowHeight ?? (measuredRowH || cssRowH));
	/** The rendered range; null until the first measurement */
	let win = $state.raw<{ start: number; end: number } | null>(null);

	const range = $derived.by(() => {
		const count = sorted.length;
		if (!virtual) return { start: 0, end: count, padTop: 0, padBottom: 0 };
		const w =
			win ??
			visibleWindow({
				scrollTop: 0,
				viewportHeight: typeof window === 'undefined' ? 800 : window.innerHeight,
				rowHeight: rowH,
				count,
				overscan
			});
		const end = Math.min(count, w.end);
		const start = Math.min(w.start, end);
		return { start, end, padTop: start * rowH, padBottom: (count - end) * rowH };
	});
	const windowRows = $derived(virtual ? sorted.slice(range.start, range.end) : sorted);

	type ScrollTarget = HTMLElement | Window;

	function findScroller(): ScrollTarget {
		if (height && box) return box;
		if (scroller) return scroller;
		for (
			let el = box?.parentElement;
			el && el !== document.body && el !== document.documentElement;
			el = el.parentElement
		) {
			const oy = getComputedStyle(el).overflowY;
			if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return el;
		}
		return window;
	}

	let target: ScrollTarget | null = null;

	/** Recompute the window from the scroll position (reads layout, writes only state) */
	function update() {
		if (!virtual || !tbody) return;
		const sc = target ?? findScroller();
		const isWin = sc === window;
		const viewTop = isWin ? 0 : (sc as HTMLElement).getBoundingClientRect().top;
		const viewH = (isWin ? window.innerHeight : (sc as HTMLElement).clientHeight) || window.innerHeight;
		const r = visibleWindow({
			scrollTop: viewTop - tbody.getBoundingClientRect().top,
			viewportHeight: viewH,
			rowHeight: rowH,
			count: sorted.length,
			overscan
		});
		if (!win || r.start !== win.start || r.end !== win.end) win = { start: r.start, end: r.end };
	}

	/** Average height of the rendered rows */
	function measure() {
		if (!virtual || !tbody || rowHeight) return;
		const rendered = tbody.querySelectorAll<HTMLElement>('tr[data-index]');
		const first = rendered[0];
		const last = rendered[rendered.length - 1];
		if (!first || !last) return;
		const n = Number(last.dataset.index) - Number(first.dataset.index) + 1;
		const h = (last.getBoundingClientRect().bottom - first.getBoundingClientRect().top) / n;
		if (h > 0 && Math.abs(h - measuredRowH) > 0.5) measuredRowH = h;
	}

	// Listen to the scroller while the table is long
	$effect(() => {
		if (!virtual || !box) return;
		const table = box.querySelector('table');
		if (table) cssRowH = parseFloat(getComputedStyle(table).getPropertyValue('--row-h')) || cssRowH;
		const sc = findScroller();
		target = sc;
		const onScroll = () => update();
		sc.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll, { passive: true });
		let width = 0;
		const ro =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver((entries) => {
						const w = entries[0]?.contentRect.width ?? 0;
						if (w === width) return;
						width = w;
						// text may wrap differently at the new width
						requestAnimationFrame(() => {
							measure();
							update();
						});
					});
		ro?.observe(box);
		return () => {
			sc.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			ro?.disconnect();
			target = null;
		};
	});

	// New rows, another sort or a new row height: recompute the window
	$effect(() => {
		void sorted;
		void rowH;
		void overscan;
		if (!virtual) return;
		untrack(update);
	});

	// Measure once rows are on screen
	$effect(() => {
		void range.start;
		if (!virtual || measuredRowH) return;
		untrack(measure);
	});

	/* ── Selection ── */

	let anchorKey: string | null = null;

	const selectedCount = $derived.by(() => {
		if (!selectable || selection.size === 0) return 0;
		let n = 0;
		for (const row of sorted) if (selection.has(key(row))) n++;
		return n;
	});
	const allSelected = $derived(sorted.length > 0 && selectedCount === sorted.length);
	const someSelected = $derived(selectedCount > 0 && !allSelected);

	function toggleAll() {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a new set replaces the old one, it is never mutated after that
		const next = new Set(selection);
		for (const row of sorted) {
			if (allSelected) next.delete(key(row));
			else next.add(key(row));
		}
		selection = next;
		anchorKey = null;
	}

	function select(index: number, on: boolean, extend: boolean) {
		const row = sorted[index];
		if (row === undefined) return;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a new set replaces the old one, it is never mutated after that
		const next = new Set(selection);
		const from = extend && anchorKey !== null ? sorted.findIndex((r) => key(r) === anchorKey) : -1;
		if (from >= 0) {
			for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
				const k = key(sorted[i] as T);
				if (on) next.add(k);
				else next.delete(k);
			}
		} else if (on) next.add(key(row));
		else next.delete(key(row));
		anchorKey = key(row);
		selection = next;
	}

	/* ── Clicks and keys (one listener on the body, none per row) ── */

	const OWN_ACTION =
		'a, button, input, select, textarea, label, summary, [role="menu"], [role="menuitem"], [contenteditable="true"], [data-no-row-click]';

	function rowIndex(el: Element | null): number {
		const tr = el?.closest<HTMLElement>('tr[data-index]');
		if (!tr || !tbody?.contains(tr)) return -1;
		return Number(tr.dataset.index);
	}

	function onBodyClick(e: MouseEvent) {
		const el = e.target instanceof Element ? e.target : null;
		const index = rowIndex(el);
		const row = sorted[index];
		if (!el || row === undefined) return;
		// The checkbox, or the space around it in its cell
		if (selectable && el.closest('.select-col')) {
			const input = el.closest<HTMLInputElement>('input.row-check');
			select(index, input ? input.checked : !selection.has(key(row)), e.shiftKey);
			return;
		}
		if (!onrowclick) return;
		if (el.closest('.row-open')) {
			onrowclick(row);
			return;
		}
		if (el.closest(OWN_ACTION)) return;
		// Selecting text (an ID, a host name) is not a click on the row
		const sel = window.getSelection?.();
		if (sel && !sel.isCollapsed && sel.anchorNode && el.closest('tr')?.contains(sel.anchorNode)) return;
		onrowclick(row);
	}

	async function focusRow(index: number) {
		if (index < 0 || index >= sorted.length || !tbody) return;
		const find = () => tbody?.querySelector<HTMLElement>(`tr[data-index="${index}"] .row-open`);
		if (!find() && virtual) {
			win = { start: Math.max(0, index - overscan), end: Math.min(sorted.length, index + overscan + 1) };
			await tick();
		}
		find()?.focus();
	}

	function onBodyKeydown(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const el = e.target instanceof Element ? e.target : null;
		if (!el?.closest('.row-open')) return;
		e.preventDefault();
		void focusRow(rowIndex(el) + (e.key === 'ArrowDown' ? 1 : -1));
	}

	function cellClass(col: Column<T>): ClassValue {
		return [col.class, col.align === 'num' && 'is-num', col.align === 'actions' && 'actions'];
	}
</script>

<div
	bind:this={box}
	class={['table-scroll', height && 'is-box', !scrollX && 'no-scroll-x', cls]}
	style:max-height={height}
>
	<table
		class={['data-table', virtual && 'is-virtual']}
		aria-labelledby={captionId}
		aria-rowcount={virtual ? sorted.length + 1 : undefined}
		aria-busy={loading || undefined}
	>
		<caption id={captionId} class={labelVisible ? 'table-caption' : 'sr-only'}>{label}</caption>
		<thead>
			<tr aria-rowindex={virtual ? 1 : undefined}>
				{#if selectable}
					<th scope="col" class="select-col">
						<input
							type="checkbox"
							class="row-check-all"
							aria-label={selectAllLabel ?? tf('table.select_all', 'Select all')}
							checked={allSelected}
							indeterminate={someSelected}
							disabled={sorted.length === 0}
							onchange={toggleAll}
						/>
					</th>
				{/if}
				{#each shown as col (col.id)}
					{@const sortable = isSortable(col)}
					{@const dir = sortable ? ariaSort(sort, col.id) : undefined}
					<th
						scope="col"
						class={[
							cellClass(col),
							sortable && 'sortable',
							dir === 'ascending' && 'sort-asc',
							dir === 'descending' && 'sort-desc'
						]}
						aria-sort={dir}
						style:width={col.width}
						style:min-width={col.minWidth}
					>
						{#if sortable}
							<button type="button" class="sort-btn" onclick={() => (sort = nextSort(sort, col.id))}>
								<span class={col.labelHidden ? 'sr-only' : undefined}>{col.label}</span>
							</button>
						{:else if col.labelHidden}
							<span class="sr-only">{col.label}</span>
						{:else}
							{col.label}
						{/if}
					</th>
				{/each}
			</tr>
		</thead>
		<!-- Mouse convenience only: every row has a button for the keyboard (the primary cell) -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<tbody bind:this={tbody} onclick={onBodyClick} onkeydown={onBodyKeydown}>
			{#if error}
				<tr class="state-row">
					<td class="state-cell is-error" {colspan}>
						<span class="state">
							<span>{error}</span>
							{#if onretry}
								<Button size="sm" icon="refresh" onclick={onretry}>{t('actions.retry')}</Button>
							{/if}
						</span>
					</td>
				</tr>
			{:else if sorted.length === 0}
				{#if loading || emptyText}
					<tr class="state-row">
						<td class="state-cell" {colspan}>{loading ? (loadingText ?? t('common.loading')) : emptyText}</td>
					</tr>
				{/if}
			{:else}
				{#if range.padTop > 0}
					<tr class="spacer" aria-hidden="true"><td {colspan} style:height="{range.padTop}px"></td></tr>
				{/if}
				{#each windowRows as row, i (key(row))}
					{@const k = key(row)}
					{@const index = range.start + i}
					{@const selected = selectable && selection.has(k)}
					<tr
						data-index={index}
						data-key={k}
						aria-rowindex={virtual ? index + 2 : undefined}
						class={[rowClass?.(row), selected && 'selected', onrowclick && 'is-clickable']}
					>
						{#if selectable}
							<td class="select-col">
								<input
									type="checkbox"
									class="row-check"
									aria-label={selectLabel?.(row) ?? tf('table.select_row', 'Select {name}', { name: k })}
									checked={selected}
								/>
							</td>
						{/if}
						{#each shown as col (col.id)}
							{#if col.primary}
								<th scope="row" class={cellClass(col)}>
									{#if onrowclick}
										<button type="button" class="row-open">{@render col.cell(row)}</button>
									{:else}
										{@render col.cell(row)}
									{/if}
								</th>
							{:else}
								<td class={cellClass(col)}>{@render col.cell(row)}</td>
							{/if}
						{/each}
					</tr>
				{/each}
				{#if range.padBottom > 0}
					<tr class="spacer" aria-hidden="true"><td {colspan} style:height="{range.padBottom}px"></td></tr>
				{/if}
			{/if}
		</tbody>
	</table>
</div>

<style>
	/* Row edges: the rows hang their padding outside the column, so the first
	   column's text lines up with the headings above (components.css "Row edges").
	   position: relative contains the visually hidden caption. */
	.table-scroll {
		position: relative;
		overflow-x: auto;
		min-width: 0;
		margin-inline: calc(-1 * var(--row-pad-x));
	}
	.table-scroll.is-box {
		overflow: auto;
		overscroll-behavior: contain;
	}
	.table-scroll.no-scroll-x {
		overflow: visible;
	}

	.data-table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-base);
	}

	.table-caption {
		padding: 0 var(--row-pad-x) var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-align: start;
	}

	.data-table th {
		position: sticky;
		top: 0;
		z-index: var(--layer-sticky);
		height: 40px;
		padding: var(--row-pad-y) var(--row-pad-x);
		border-top: 1px solid var(--rule);
		border-bottom: 1px solid var(--rule);
		/* No band: muted text between two rules. The background only covers rows scrolling under it. */
		background: var(--bg);
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 600;
		text-align: start;
		white-space: nowrap;
	}
	:global(:is(.modal, .sheet, .menu)) .data-table thead th {
		background: var(--bg-float);
	}

	.data-table td {
		height: var(--row-h);
		padding: var(--space-1) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		vertical-align: middle;
	}

	/* Row headers (the primary cell) read as the first cell of their row */
	.data-table tbody th {
		position: static;
		height: var(--row-h);
		padding: var(--space-1) var(--row-pad-x);
		border-top: 0;
		background: transparent;
		color: var(--text);
		font-size: inherit;
		font-weight: 400;
		white-space: normal;
	}

	.data-table tbody tr:not(.state-row, .spacer):hover > :is(td, th) {
		background: var(--bg-subtle);
	}
	.data-table tr.selected > :is(td, th) {
		background: var(--accent-tint);
	}
	.data-table tbody tr.is-clickable {
		cursor: pointer;
	}

	/* Spacers of a virtual table: exactly their set height */
	.data-table tr.spacer > td {
		padding: 0;
		border: 0;
	}

	/* Sortable header: the button fills the cell, so the whole cell is the control */
	.data-table th.sortable {
		padding: 0;
	}
	.sort-btn {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: 40px;
		padding: var(--row-pad-y) var(--row-pad-x);
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: inherit;
		white-space: nowrap;
		cursor: pointer;
		user-select: none;
	}
	.sort-btn:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	th.sortable:hover,
	th.sort-asc,
	th.sort-desc {
		color: var(--text);
	}
	.sort-btn::after {
		content: '';
		display: inline-block;
		width: 1ch;
		margin-inline-start: var(--space-1);
	}
	th.sort-asc .sort-btn::after {
		content: '↑' / '';
	}
	th.sort-desc .sort-btn::after {
		content: '↓' / '';
	}
	th.is-num .sort-btn {
		justify-content: flex-end;
	}
	@media (pointer: coarse) {
		.sort-btn {
			min-height: var(--control-h);
		}
	}

	/* The primary cell's button: the row's name, opens the row */
	.row-open {
		max-width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		vertical-align: middle;
		cursor: pointer;
	}
	.row-open:hover {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* Checkbox column */
	.data-table .select-col {
		width: 1%;
		padding-inline-end: 0;
	}
	.data-table th.select-col {
		cursor: default;
	}
	.select-col input {
		display: block;
		width: var(--check-size);
		height: var(--check-size);
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.select-col input:disabled {
		cursor: not-allowed;
	}

	/* Numbers: end-aligned, figures of equal width */
	.data-table :is(td, th).is-num {
		text-align: end;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	/* Row actions: buttons and menu buttons on one line with one gap. The
	   cell's font size is 0 so spaces between them add nothing; each child
	   gets the table's size back. */
	.data-table :is(td, th).actions {
		text-align: end;
		white-space: nowrap;
	}
	.data-table td.actions {
		font-size: 0;
	}
	.data-table td.actions > :global(*) {
		font-size: var(--text-base);
		vertical-align: middle;
	}
	.data-table td.actions > :global(.btn-sm) {
		font-size: var(--text-sm);
	}
	.data-table td.actions > :global(* + *) {
		margin-inline-start: var(--space-2);
	}

	/* Loading, empty and error: one sentence, optional action */
	.data-table td.state-cell {
		padding: var(--space-4) var(--row-pad-x);
		color: var(--text-muted);
	}
	.data-table td.state-cell.is-error {
		color: var(--danger);
	}
	.state {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}

	/* Cell helpers the page's snippets use */
	.data-table :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.data-table td.mono,
	.data-table td :global(.mono) {
		font-family: var(--mono);
	}
</style>
