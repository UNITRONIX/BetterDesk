import { fireEvent, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Table from '../../../src/lib/ui/Table.svelte';
import ColumnChooser from '../../../src/lib/ui/ColumnChooser.svelte';
import type { Column } from '../../../src/lib/ui/table.ts';
import { openPopup } from '../../../src/lib/ui/popups.svelte.ts';
import { i18n } from '../../../src/lib/i18n/i18n.svelte.ts';

interface Dev {
	id: string;
	name: string;
	seen: number | null;
	banned?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const nameCell = createRawSnippet<[Dev]>((d) => ({ render: () => `<span>${esc(d().name)}</span>` }));
const idCell = createRawSnippet<[Dev]>((d) => ({ render: () => `<span class="mono">${esc(d().id)}</span>` }));
const seenCell = createRawSnippet<[Dev]>((d) => ({ render: () => `<span>${d().seen ?? '-'}</span>` }));
const actionsCell = createRawSnippet<[Dev]>(() => ({
	render: () => `<span><button type="button">Menu</button> <a href="#more">More</a></span>`
}));

function cols(over: Partial<Record<string, Partial<Column<Dev>>>> = {}): Column<Dev>[] {
	return [
		{ id: 'name', label: 'Name', primary: true, cell: nameCell, sortValue: (d) => d.name, ...over.name },
		{ id: 'id', label: 'ID', cell: idCell, sortValue: (d) => d.id, hideable: true, ...over.id },
		{
			id: 'seen',
			label: 'Seen',
			align: 'num',
			cell: seenCell,
			sortValue: (d) => d.seen,
			hideable: true,
			...over.seen
		},
		{
			id: 'actions',
			label: 'Actions',
			labelHidden: true,
			align: 'actions',
			cell: actionsCell,
			...over.actions
		}
	];
}

const few: Dev[] = [
	{ id: 'd1', name: 'Zebra', seen: 3 },
	{ id: 'd2', name: 'Äpfel', seen: null },
	{ id: 'd3', name: 'Apfel', seen: 10 },
	{ id: 'd4', name: 'Ofen', seen: 1, banned: true },
	{ id: 'd5', name: 'Öl', seen: 2 }
];

const many = (n: number): Dev[] =>
	Array.from({ length: n }, (_, i) => ({
		id: `id${String(i).padStart(5, '0')}`,
		name: `host-${i}`,
		seen: i % 7
	}));

const base = { key: (d: Dev) => d.id, label: 'Devices' };

/** Text of the primary cell of each rendered row, in DOM order */
const names = () =>
	[...document.querySelectorAll('tbody tr[data-index] th')].map((th) => th.textContent?.trim());
const rowOf = (key: string) => document.querySelector<HTMLTableRowElement>(`tbody tr[data-key="${key}"]`)!;
const header = (name: string) => screen.getByRole('columnheader', { name });

afterEach(() => {
	i18n.lang = 'en';
});

describe('Table: sorting', () => {
	test('a header click sorts and toggles aria-sort; the button fills the header cell', async () => {
		render(Table<Dev>, { ...base, rows: few, columns: cols() });
		const th = header('Seen');
		expect(th).toHaveAttribute('aria-sort', 'none');
		expect(th).toHaveClass('is-num');
		expect(header('Actions')).not.toHaveAttribute('aria-sort');

		await userEvent.click(within(th).getByRole('button', { name: 'Seen' }));
		expect(th).toHaveAttribute('aria-sort', 'ascending');
		expect(names()).toEqual(['Ofen', 'Öl', 'Zebra', 'Apfel', 'Äpfel']); // empty last

		await userEvent.click(within(th).getByRole('button'));
		expect(th).toHaveAttribute('aria-sort', 'descending');
		expect(names()).toEqual(['Apfel', 'Zebra', 'Öl', 'Ofen', 'Äpfel']); // still last

		await userEvent.click(within(header('Name')).getByRole('button'));
		expect(th).toHaveAttribute('aria-sort', 'none');
		expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
	});

	test('text sorts with the console language: German umlauts next to their letter', async () => {
		i18n.lang = 'de';
		render(Table<Dev>, { ...base, rows: few, columns: cols(), sort: { column: 'name', dir: 'asc' } });
		expect(names()).toEqual(['Apfel', 'Äpfel', 'Ofen', 'Öl', 'Zebra']);
	});

	test('the visible label of a hidden-label column stays for screen readers', () => {
		render(Table<Dev>, { ...base, rows: few, columns: cols() });
		expect(header('Actions').querySelector('.sr-only')?.textContent).toBe('Actions');
		expect(screen.getByRole('table', { name: 'Devices' })).toBeInTheDocument();
	});
});

describe('Table: selection', () => {
	test('header checkbox: none, all, some (indeterminate)', async () => {
		render(Table<Dev>, {
			...base,
			rows: few,
			columns: cols(),
			selectable: true,
			selectLabel: (d) => `Select ${d.name}`
		});
		const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(false);

		await userEvent.click(all);
		expect(all.checked).toBe(true);
		expect(document.querySelectorAll('tbody tr.selected')).toHaveLength(5);

		await userEvent.click(screen.getByRole('checkbox', { name: 'Select Ofen' }));
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(true);
		expect(rowOf('d4')).not.toHaveClass('selected');

		await userEvent.click(all); // some -> all
		expect(all.checked).toBe(true);
		await userEvent.click(all); // all -> none
		expect(all.checked).toBe(false);
		expect(all.indeterminate).toBe(false);
		expect(document.querySelectorAll('tbody tr.selected')).toHaveLength(0);
	});

	test('Shift-click selects the range from the last clicked row', async () => {
		render(Table<Dev>, {
			...base,
			rows: few,
			columns: cols(),
			selectable: true,
			selectLabel: (d) => `Select ${d.name}`
		});
		const user = userEvent.setup();
		await user.click(screen.getByRole('checkbox', { name: 'Select Äpfel' }));
		await user.keyboard('{Shift>}');
		await user.click(screen.getByRole('checkbox', { name: 'Select Öl' }));
		await user.keyboard('{/Shift}');
		const selected = [...document.querySelectorAll('tbody tr.selected')].map((tr) =>
			tr.getAttribute('data-key')
		);
		expect(selected).toEqual(['d2', 'd3', 'd4', 'd5']);
	});

	test('a click beside the checkbox in its cell selects instead of opening the row', async () => {
		const onrowclick = vi.fn();
		render(Table<Dev>, { ...base, rows: few, columns: cols(), selectable: true, onrowclick });
		await userEvent.click(rowOf('d3').querySelector('td.select-col')!);
		expect(rowOf('d3')).toHaveClass('selected');
		expect(onrowclick).not.toHaveBeenCalled();
	});

	test('selection follows the key through re-sorting', async () => {
		render(Table<Dev>, {
			...base,
			rows: few,
			columns: cols(),
			selectable: true,
			selectLabel: (d) => `Select ${d.name}`
		});
		await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zebra' }));
		await userEvent.click(within(header('Name')).getByRole('button'));
		await userEvent.click(within(header('Name')).getByRole('button'));
		expect(names()[0]).toBe('Zebra');
		expect(rowOf('d1')).toHaveClass('selected');
		expect(screen.getByRole('checkbox', { name: 'Select Zebra' })).toBeChecked();
		expect(document.querySelectorAll('tbody tr.selected')).toHaveLength(1);
	});
});

describe('Table: opening a row', () => {
	test('a click on a cell opens the row; buttons and links inside the row keep their own action', async () => {
		const onrowclick = vi.fn();
		render(Table<Dev>, { ...base, rows: few, columns: cols(), onrowclick });
		const row = rowOf('d3');
		expect(row).toHaveClass('is-clickable');

		await userEvent.click(within(row).getByText('10'));
		expect(onrowclick).toHaveBeenCalledTimes(1);
		expect(onrowclick).toHaveBeenLastCalledWith(few[2]);

		await userEvent.click(within(row).getByRole('button', { name: 'Menu' }));
		await userEvent.click(within(row).getByRole('link', { name: 'More' }));
		expect(onrowclick).toHaveBeenCalledTimes(1);

		await userEvent.click(within(row).getByRole('button', { name: 'Apfel' }));
		expect(onrowclick).toHaveBeenCalledTimes(2);
	});

	test('Enter on the row button opens it; arrow keys move between rows', async () => {
		const onrowclick = vi.fn();
		render(Table<Dev>, { ...base, rows: few, columns: cols(), onrowclick });
		const user = userEvent.setup();
		const open = within(rowOf('d1')).getByRole('button', { name: 'Zebra' });
		expect(open.closest('th')).toHaveAttribute('scope', 'row');
		open.focus();
		await user.keyboard('{Enter}');
		expect(onrowclick).toHaveBeenCalledWith(few[0]);

		await user.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(within(rowOf('d2')).getByRole('button', { name: 'Äpfel' }));
		await user.keyboard('{ArrowUp}');
		expect(document.activeElement).toBe(open);
	});

	test('without onrowclick the primary cell is a plain row header', () => {
		render(Table<Dev>, { ...base, rows: few, columns: cols() });
		expect(rowOf('d1').querySelector('th[scope="row"] button')).toBeNull();
		expect(rowOf('d1')).not.toHaveClass('is-clickable');
	});

	test('rowClass adds state classes', () => {
		render(Table<Dev>, { ...base, rows: few, columns: cols(), rowClass: (d) => d.banned && 'is-banned' });
		expect(rowOf('d4')).toHaveClass('is-banned');
		expect(rowOf('d1')).not.toHaveClass('is-banned');
	});

	test('a column with visible: false is not rendered', () => {
		render(Table<Dev>, { ...base, rows: few, columns: cols({ id: { visible: false } }) });
		expect(screen.queryByRole('columnheader', { name: 'ID' })).toBeNull();
		expect(document.querySelector('tbody .mono')).toBeNull();
	});
});

describe('Table: states', () => {
	test('loading, empty and error are one full-width cell; error has a retry', async () => {
		const onretry = vi.fn();
		const { rerender } = render(Table<Dev>, {
			...base,
			rows: [],
			columns: cols(),
			loading: true,
			emptyText: 'No devices yet.'
		});
		const cell = () => document.querySelector('td.state-cell')!;
		expect(cell()).toHaveTextContent('common.loading');
		expect(cell()).toHaveAttribute('colspan', '4');
		expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');

		await rerender({ loading: false });
		expect(cell()).toHaveTextContent('No devices yet.');

		await rerender({ error: 'The device list could not be loaded.', onretry });
		expect(cell()).toHaveClass('is-error');
		expect(cell()).toHaveTextContent('The device list could not be loaded.');
		await userEvent.click(within(cell() as HTMLElement).getByRole('button'));
		expect(onretry).toHaveBeenCalledTimes(1);

		await rerender({ error: null, rows: few });
		expect(cell()).toBeFalsy();
		expect(names()).toHaveLength(5);
	});
});

describe('Table: long lists', () => {
	test('5,000 rows: only a window is rendered, aria-rowcount and aria-rowindex give the full size', () => {
		render(Table<Dev>, { ...base, rows: many(5000), columns: cols() });
		const rendered = document.querySelectorAll('tbody tr[data-index]');
		expect(rendered.length).toBeGreaterThan(10);
		expect(rendered.length).toBeLessThan(80);
		expect(screen.getByRole('table')).toHaveAttribute('aria-rowcount', '5001');
		expect(document.querySelector('thead tr')).toHaveAttribute('aria-rowindex', '1');
		expect(rendered[0]).toHaveAttribute('aria-rowindex', '2');
		const spacer = document.querySelector<HTMLElement>('tbody tr.spacer:last-child td')!;
		expect(spacer.style.height).toBe(`${(5000 - rendered.length) * 44}px`);
		expect(spacer.closest('tr')).toHaveAttribute('aria-hidden', 'true');
	});

	test('short lists render every row without aria-rowcount', () => {
		render(Table<Dev>, { ...base, rows: many(150), columns: cols() });
		expect(document.querySelectorAll('tbody tr[data-index]')).toHaveLength(150);
		expect(screen.getByRole('table')).not.toHaveAttribute('aria-rowcount');
		expect(document.querySelector('tbody tr.spacer')).toBeNull();
	});

	test('scrolling moves the window', async () => {
		render(Table<Dev>, { ...base, rows: many(5000), columns: cols(), height: '440px', overscan: 10 });
		const box = document.querySelector<HTMLElement>('.table-scroll')!;
		const body = document.querySelector('tbody')!;
		Object.defineProperty(box, 'clientHeight', { configurable: true, value: 440 });
		vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
		vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({ top: 100 - 44 * 1000 } as DOMRect);
		await fireEvent.scroll(box);
		const rendered = document.querySelectorAll('tbody tr[data-index]');
		expect(rendered[0]).toHaveAttribute('aria-rowindex', String(990 + 2));
		expect(rendered[0]).toHaveAttribute('data-key', 'id00990');
		expect(rendered).toHaveLength(10 + 11 + 10);
		expect(document.querySelector<HTMLElement>('tbody tr.spacer td')!.style.height).toBe(`${990 * 44}px`);
	});

	test('arrow down from the last rendered row brings the next row in and focuses it', async () => {
		render(Table<Dev>, { ...base, rows: many(5000), columns: cols(), onrowclick: vi.fn() });
		const rendered = document.querySelectorAll<HTMLElement>('tbody tr[data-index]');
		const last = rendered[rendered.length - 1]!;
		const index = Number(last.dataset.index);
		last.querySelector<HTMLElement>('.row-open')!.focus();
		await userEvent.keyboard('{ArrowDown}');
		await tick();
		expect(document.activeElement?.closest('tr')).toHaveAttribute('data-index', String(index + 1));
	});

	test('selection survives re-sorting a long list', async () => {
		render(Table<Dev>, {
			...base,
			rows: many(5000),
			columns: cols(),
			selectable: true,
			selection: new Set(['id04999'])
		});
		expect(rowOf('id04999')).toBeNull(); // not rendered
		await userEvent.click(within(header('ID')).getByRole('button'));
		await userEvent.click(within(header('ID')).getByRole('button')); // descending
		expect(document.querySelector('tbody tr[data-index]')).toHaveAttribute('data-key', 'id04999');
		expect(rowOf('id04999')).toHaveClass('selected');
		expect(rowOf('id04998')).not.toHaveClass('selected');
		const all = screen.getByRole('checkbox', { name: 'Select all' }) as HTMLInputElement;
		expect(all.indeterminate).toBe(true);
	});

	test('timing: first render of 5,000 rows (printed, not asserted)', async () => {
		const rows = many(5000);
		const columns = cols();
		let t0 = performance.now();
		const virtualRun = render(Table<Dev>, { ...base, rows, columns, selectable: true, onrowclick: vi.fn() });
		const virtualMs = performance.now() - t0;
		t0 = performance.now();
		await userEvent.click(within(header('Name')).getByRole('button'));
		const sortMs = performance.now() - t0;
		t0 = performance.now();
		await virtualRun.rerender({ rows: rows.filter((r) => r.name.includes('1')) });
		const filterMs = performance.now() - t0;
		// For comparison, rendering all 5,000 rows (virtualThreshold: Infinity) took about 5-7 s here
		console.warn(
			`[table timing, jsdom] 5,000 rows: virtual first render ${virtualMs.toFixed(0)} ms, ` +
				`sort by name ${sortMs.toFixed(0)} ms, filter to ${rows.filter((r) => r.name.includes('1')).length} rows ${filterMs.toFixed(0)} ms`
		);
		expect(document.querySelectorAll('tbody tr[data-index]').length).toBeLessThan(80);
	}, 60_000);
});

describe('ColumnChooser', () => {
	const chooserCols = () => cols({ seen: { visible: false } });

	test('lists the hideable columns with their state and reports changes', async () => {
		const onchange = vi.fn();
		render(ColumnChooser, { columns: chooserCols(), onchange, label: 'Columns' });
		const button = screen.getByRole('button', { name: 'Columns' });
		expect(button).toHaveAttribute('aria-expanded', 'false');

		await userEvent.click(button);
		expect(button).toHaveAttribute('aria-expanded', 'true');
		const group = screen.getByRole('group', { name: 'Columns' });
		const boxes = within(group).getAllByRole('checkbox');
		expect(boxes.map((b) => b.parentElement?.textContent?.trim())).toEqual(['ID', 'Seen']);
		expect(boxes[0]).toBeChecked();
		expect(boxes[1]).not.toBeChecked();
		expect(document.activeElement).toBe(boxes[0]);

		await userEvent.click(boxes[1]!);
		expect(onchange).toHaveBeenCalledWith('seen', true);
		await userEvent.click(boxes[0]!);
		expect(onchange).toHaveBeenLastCalledWith('id', false);
	});

	test('Escape closes and returns focus; another popup or a click outside closes it', async () => {
		render(ColumnChooser, { columns: chooserCols(), onchange: vi.fn(), label: 'Columns' });
		const button = screen.getByRole('button', { name: 'Columns' });
		const group = () => screen.queryByRole('group', { name: 'Columns' });

		await userEvent.click(button);
		await userEvent.keyboard('{Escape}');
		expect(group()).toBeNull();
		expect(button).toHaveAttribute('aria-expanded', 'false');
		expect(document.activeElement).toBe(button);

		await userEvent.click(button);
		openPopup(() => {});
		await tick();
		expect(group()).toBeNull();

		await userEvent.click(button);
		await userEvent.click(document.body);
		expect(group()).toBeNull();
	});
});
