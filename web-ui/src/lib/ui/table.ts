/**
 * The data table's logic without a DOM: column types, sorting and the
 * window of rows a long table renders. Table.svelte uses these; they are
 * unit tested on their own (tests/unit/table-logic.test.ts).
 */

import type { Snippet } from 'svelte';

export type SortDir = 'asc' | 'desc';

export interface SortState {
	/** Column id */
	column: string;
	dir: SortDir;
}

/** What a column sorts by. Empty values (null, undefined, '', NaN, an invalid date) go last. */
export type SortValue = string | number | boolean | Date | null | undefined;

export interface Column<T> {
	/** Stable id: sort state, visibility and the page's CSS hooks use it */
	id: string;
	/** Header text, already translated */
	label: string;
	/** The label is read by screen readers only (the row actions column) */
	labelHidden?: boolean;
	/** Renders the cell's content. Text only through {value}, never {@html}. */
	cell: Snippet<[T]>;
	/** The value to sort by: numbers and dates compare as such, text with the console language's collator */
	sortValue?: (row: T) => SortValue;
	/** Or a full comparator (ascending); wins over sortValue */
	compare?: (a: T, b: T) => number;
	/** start (default), num (end-aligned, tabular figures), actions (row buttons and the row menu, end-aligned on one line) */
	align?: 'start' | 'num' | 'actions';
	/** CSS lengths for the header cell, which sets the column's width */
	width?: string;
	minWidth?: string;
	/** Listed in the column chooser */
	hideable?: boolean;
	/** false hides the column (the page keeps and stores the choice) */
	visible?: boolean;
	/**
	 * The cell that names the row: a row header (th scope="row"), and when the
	 * table has onrowclick its content is wrapped in a button that opens the row.
	 * Its content must then be text or static marks, nothing interactive.
	 */
	primary?: boolean;
	/** Extra class on the header and every cell of the column */
	class?: string;
}

export function isSortable<T>(col: Column<T>): boolean {
	return Boolean(col.compare || col.sortValue);
}

/** Clicking a header: a new column starts ascending, the same column flips */
export function nextSort(current: SortState | null | undefined, column: string): SortState {
	if (current?.column === column) return { column, dir: current.dir === 'asc' ? 'desc' : 'asc' };
	return { column, dir: 'asc' };
}

export function ariaSort(
	current: SortState | null | undefined,
	column: string
): 'ascending' | 'descending' | 'none' {
	if (current?.column !== column) return 'none';
	return current.dir === 'asc' ? 'ascending' : 'descending';
}

/* ── Sorting ───────────────────────────────────────────────────────── */

const collators = new Map<string, Intl.Collator>();

/** One collator per language: numbers inside text in order ("PC2" before "PC10") */
export function collatorFor(locale?: string): Intl.Collator {
	const key = locale ?? '';
	let c = collators.get(key);
	if (!c) {
		try {
			c = new Intl.Collator(locale, { numeric: true });
		} catch {
			c = new Intl.Collator(undefined, { numeric: true });
		}
		collators.set(key, c);
	}
	return c;
}

/** Normalised sort key: null for empty, a number for numbers/dates/booleans, or text */
function normalise(value: SortValue): number | string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'number') return Number.isNaN(value) ? null : value;
	if (typeof value === 'boolean') return value ? 1 : 0;
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isNaN(time) ? null : time;
	}
	const text = String(value).trim();
	return text === '' ? null : text;
}

/**
 * Compare two sort values ascending. Empty values are not handled here
 * (sortRows puts them last in both directions); numbers come before text
 * when a column mixes them.
 */
export function compareValues(a: number | string, b: number | string, collator: Intl.Collator): number {
	if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
	if (typeof a === 'number') return -1;
	if (typeof b === 'number') return 1;
	return collator.compare(a, b);
}

export interface SortSpec<T> {
	sortValue?: (row: T) => SortValue;
	compare?: (a: T, b: T) => number;
	dir: SortDir;
	locale?: string;
}

/**
 * A sorted copy. Stable (equal rows keep their order), empty values last in
 * both directions, text compared with Intl.Collator in `locale`. Each row's
 * value is read once, so a 5,000-row sort calls sortValue 5,000 times.
 */
export function sortRows<T>(rows: readonly T[], spec: SortSpec<T>): T[] {
	const sign = spec.dir === 'desc' ? -1 : 1;
	const order = rows.map((_, i) => i);
	if (spec.compare) {
		const cmp = spec.compare;
		order.sort((i, j) => sign * cmp(rows[i] as T, rows[j] as T) || i - j);
		return order.map((i) => rows[i] as T);
	}
	const read = spec.sortValue;
	if (!read) return rows.slice();
	const keys = rows.map((row) => normalise(read(row)));
	const collator = collatorFor(spec.locale);
	order.sort((i, j) => {
		const a = keys[i] ?? null;
		const b = keys[j] ?? null;
		if (a === null || b === null) {
			if (a === b) return i - j;
			return a === null ? 1 : -1;
		}
		return sign * compareValues(a, b, collator) || i - j;
	});
	return order.map((i) => rows[i] as T);
}

/* ── Visible window of a long table ───────────────────────────────── */

export interface WindowInput {
	/** How far the first row's top has scrolled above the top of the viewport (negative: the table starts below it) */
	scrollTop: number;
	/** Height of the scroll viewport */
	viewportHeight: number;
	/** Height of one row (all rows have the same height in a virtual table) */
	rowHeight: number;
	/** Number of rows */
	count: number;
	/** Rows rendered beyond each edge of the viewport */
	overscan: number;
}

export interface WindowRange {
	/** First rendered row (index into the sorted rows) */
	start: number;
	/** One past the last rendered row */
	end: number;
	/** Height of the spacer above the first rendered row */
	padTop: number;
	/** Height of the spacer below the last rendered row */
	padBottom: number;
}

export function visibleWindow({
	scrollTop,
	viewportHeight,
	rowHeight,
	count,
	overscan
}: WindowInput): WindowRange {
	if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0 };
	const h = rowHeight > 0 ? rowHeight : 1;
	const over = Math.max(0, Math.floor(overscan));
	const top = Math.max(0, scrollTop);
	const first = Math.min(count - 1, Math.floor(top / h));
	// visible rows: the viewport may cut one row at each edge
	const shown = Math.ceil(Math.max(0, viewportHeight) / h) + 1;
	const start = Math.max(0, first - over);
	const end = Math.min(count, first + shown + over);
	return { start, end, padTop: start * h, padBottom: (count - end) * h };
}
