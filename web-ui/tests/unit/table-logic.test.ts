import { describe, expect, test } from 'vitest';
import { ariaSort, nextSort, sortRows, visibleWindow } from '../../src/lib/ui/table.ts';

interface Row {
	id: string;
	name?: string | null;
	n?: number | null;
	seen?: Date | null;
}

const ids = (rows: Row[]) => rows.map((r) => r.id);

describe('sortRows', () => {
	test('stable: equal values keep their order in both directions', () => {
		const rows: Row[] = [
			{ id: 'a', n: 2 },
			{ id: 'b', n: 1 },
			{ id: 'c', n: 2 },
			{ id: 'd', n: 1 },
			{ id: 'e', n: 2 }
		];
		expect(ids(sortRows(rows, { sortValue: (r) => r.n, dir: 'asc' }))).toEqual(['b', 'd', 'a', 'c', 'e']);
		expect(ids(sortRows(rows, { sortValue: (r) => r.n, dir: 'desc' }))).toEqual(['a', 'c', 'e', 'b', 'd']);
	});

	test('empty values go last in both directions', () => {
		const rows: Row[] = [
			{ id: 'none', name: null },
			{ id: 'b', name: 'beta' },
			{ id: 'blank', name: '  ' },
			{ id: 'a', name: 'alpha' },
			{ id: 'undef' }
		];
		expect(ids(sortRows(rows, { sortValue: (r) => r.name, dir: 'asc' }))).toEqual([
			'a',
			'b',
			'none',
			'blank',
			'undef'
		]);
		expect(ids(sortRows(rows, { sortValue: (r) => r.name, dir: 'desc' }))).toEqual([
			'b',
			'a',
			'none',
			'blank',
			'undef'
		]);
	});

	test('numbers compare as numbers, not as text', () => {
		const rows: Row[] = [
			{ id: 'ten', n: 10 },
			{ id: 'two', n: 2 },
			{ id: 'nan', n: NaN },
			{ id: 'one', n: 1 }
		];
		expect(ids(sortRows(rows, { sortValue: (r) => r.n, dir: 'asc' }))).toEqual(['one', 'two', 'ten', 'nan']);
	});

	test('dates compare by time; invalid dates are empty', () => {
		const rows: Row[] = [
			{ id: 'new', seen: new Date('2026-11-08T10:00:00Z') },
			{ id: 'bad', seen: new Date('nope') },
			{ id: 'old', seen: new Date('2025-01-01T00:00:00Z') },
			{ id: 'never', seen: null }
		];
		expect(ids(sortRows(rows, { sortValue: (r) => r.seen, dir: 'desc' }))).toEqual([
			'new',
			'old',
			'bad',
			'never'
		]);
	});

	test('text uses the collator of the console language (German umlauts, numbers in names)', () => {
		const rows: Row[] = ['Zebra', 'Öl', 'Apfel', 'Äpfel', 'Ofen', 'PC10', 'PC2'].map((name) => ({
			id: name,
			name
		}));
		expect(ids(sortRows(rows, { sortValue: (r) => r.name, dir: 'asc', locale: 'de' }))).toEqual([
			'Apfel',
			'Äpfel',
			'Ofen',
			'Öl',
			'PC2',
			'PC10',
			'Zebra'
		]);
		// Swedish puts Ä and Ö after Z: the locale is really used
		expect(ids(sortRows(rows, { sortValue: (r) => r.name, dir: 'asc', locale: 'sv' })).slice(-2)).toEqual([
			'Äpfel',
			'Öl'
		]);
	});

	test('a comparator wins over sortValue and is reversed for desc, still stable', () => {
		const rows: Row[] = [
			{ id: 'x1', n: 1 },
			{ id: 'y', n: 3 },
			{ id: 'x2', n: 1 }
		];
		const compare = (a: Row, b: Row) => (a.n ?? 0) - (b.n ?? 0);
		expect(ids(sortRows(rows, { compare, sortValue: (r) => r.id, dir: 'desc' }))).toEqual(['y', 'x1', 'x2']);
	});

	test('returns a copy and leaves the input alone', () => {
		const rows: Row[] = [
			{ id: 'b', n: 2 },
			{ id: 'a', n: 1 }
		];
		const out = sortRows(rows, { sortValue: (r) => r.n, dir: 'asc' });
		expect(ids(rows)).toEqual(['b', 'a']);
		expect(out).not.toBe(rows);
	});
});

describe('sort state', () => {
	test('a new column starts ascending, the same column flips', () => {
		expect(nextSort(null, 'name')).toEqual({ column: 'name', dir: 'asc' });
		expect(nextSort({ column: 'name', dir: 'asc' }, 'name')).toEqual({ column: 'name', dir: 'desc' });
		expect(nextSort({ column: 'name', dir: 'desc' }, 'name')).toEqual({ column: 'name', dir: 'asc' });
		expect(nextSort({ column: 'name', dir: 'desc' }, 'id')).toEqual({ column: 'id', dir: 'asc' });
		expect(ariaSort({ column: 'id', dir: 'desc' }, 'id')).toBe('descending');
		expect(ariaSort({ column: 'id', dir: 'desc' }, 'name')).toBe('none');
	});
});

describe('visibleWindow', () => {
	const base = { viewportHeight: 440, rowHeight: 44, count: 5000, overscan: 5 };

	test('top of the list: no spacer above, the viewport plus overscan below', () => {
		// 440 / 44 = 10 rows in view, +1 for a cut row, +5 overscan
		expect(visibleWindow({ ...base, scrollTop: 0 })).toEqual({
			start: 0,
			end: 16,
			padTop: 0,
			padBottom: (5000 - 16) * 44
		});
	});

	test('table starting below the top of the viewport counts as the top', () => {
		expect(visibleWindow({ ...base, scrollTop: -300 })).toMatchObject({ start: 0, end: 16 });
	});

	test('middle: overscan on both sides, spacers add up to the full height', () => {
		const w = visibleWindow({ ...base, scrollTop: 44 * 1000 + 20 });
		expect(w).toMatchObject({ start: 995, end: 1016 });
		expect(w.padTop + (w.end - w.start) * 44 + w.padBottom).toBe(5000 * 44);
	});

	test('end of the list: no spacer below, and scrolling past the end stays clamped', () => {
		expect(visibleWindow({ ...base, scrollTop: 44 * 4990 })).toMatchObject({
			start: 4985,
			end: 5000,
			padBottom: 0
		});
		expect(visibleWindow({ ...base, scrollTop: 44 * 9000 })).toMatchObject({
			start: 4994,
			end: 5000,
			padBottom: 0
		});
	});

	test('overscan widens the window on both sides', () => {
		const narrow = visibleWindow({ ...base, overscan: 0, scrollTop: 44 * 100 });
		const wide = visibleWindow({ ...base, overscan: 20, scrollTop: 44 * 100 });
		expect(narrow).toMatchObject({ start: 100, end: 111 });
		expect(wide).toMatchObject({ start: 80, end: 131 });
	});

	test('a new row height moves the window and the spacers', () => {
		const at = 48 * 200;
		expect(visibleWindow({ ...base, rowHeight: 44, scrollTop: at })).toMatchObject({
			start: 213,
			padTop: 213 * 44
		});
		expect(visibleWindow({ ...base, rowHeight: 48, scrollTop: at })).toMatchObject({
			start: 195,
			end: 216,
			padTop: 195 * 48
		});
	});

	test('short lists and empty lists', () => {
		expect(visibleWindow({ ...base, count: 3, scrollTop: 0 })).toEqual({
			start: 0,
			end: 3,
			padTop: 0,
			padBottom: 0
		});
		expect(visibleWindow({ ...base, count: 0, scrollTop: 100 })).toEqual({
			start: 0,
			end: 0,
			padTop: 0,
			padBottom: 0
		});
	});
});
