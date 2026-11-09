import { describe, expect, test } from 'vitest';
import {
	CommandGate,
	MAX_LOG,
	MAX_WIDGETS,
	addLog,
	connectedSeconds,
	describeDevice,
	filterListed,
	filterRows,
	firingAlerts,
	gaugeTone,
	groupWidgets,
	isOn,
	joinPath,
	pageOf,
	parentPath,
	percentOf,
	readEntries,
	readManifest,
	severityOf,
	sortRows,
	terminalLines,
	textOf,
	type ListedDevice,
	type LogEntry,
	type Row
} from '../../../src/lib/devices-area/cdap/model.ts';

describe('manifest', () => {
	test('reads the old console spelling', () => {
		const m = readManifest({
			device: { name: 'Boiler', type: 'scada', firmware_version: '4.2' },
			widgets: [
				{ id: 'a', type: 'toggle', label: 'Pump', read_only: true, category: 'Controls' },
				{ id: 'b', type: 'button', confirm: 'Sure?' },
				{ id: 'c', type: 'gauge', decimals: 2, min: 5, max: 50 },
				{ id: 'd', type: 'chart', series: [{ key: 'l1', label: 'L1', max: 10 }] }
			]
		});
		expect(m).toMatchObject({ name: 'Boiler', type: 'scada', firmware: '4.2' });
		expect(m.widgets[0]).toMatchObject({ readOnly: true, category: 'Controls', label: 'Pump' });
		expect(m.widgets[1]).toMatchObject({ confirm: 'Sure?', label: 'b' });
		expect(m.widgets[2]).toMatchObject({ decimals: 2, min: 5, max: 50 });
		expect(m.widgets[3]!.series).toEqual([{ key: 'l1', label: 'L1', min: 0, max: 10 }]);
	});

	test("reads the Go gateway's spelling", () => {
		const m = readManifest({
			device: { name: 'Pump', firmware: '1.0' },
			widgets: [
				{ id: 'a', type: 'toggle', readonly: true, group: 'G' },
				{ id: 'b', type: 'button', confirm: true, confirm_message: 'Restart now?' },
				{ id: 'c', type: 'button', confirm: true },
				{ id: 'd', type: 'gauge', precision: 3 },
				{ id: 'e', type: 'chart', series: [{ id: 's1', label: 'One' }] },
				{
					id: 'f',
					type: 'table',
					columns: [
						{ id: 't', label: 'When', type: 'date' },
						{ id: 'n', type: 'string' }
					]
				}
			]
		});
		expect(m.firmware).toBe('1.0');
		expect(m.widgets[0]).toMatchObject({ readOnly: true, category: 'G' });
		expect(m.widgets[1]!.confirm).toBe('Restart now?');
		// Confirm without a message: confirm with the default question
		expect(m.widgets[2]!.confirm).toBe('');
		expect(m.widgets[3]!.decimals).toBe(3);
		expect(m.widgets[4]!.series[0]!.key).toBe('s1');
		expect(m.widgets[5]!.columns.map((c) => [c.id, c.label, c.type])).toEqual([
			['t', 'When', 'datetime'],
			['n', 'n', 'text']
		]);
	});

	test('a manifest as JSON text (the device list) and broken ones', () => {
		expect(readManifest('{"device":{"name":"X"}}').name).toBe('X');
		expect(readManifest('{not json').widgets).toEqual([]);
		expect(readManifest(null).name).toBe('');
		expect(readManifest([1, 2]).widgets).toEqual([]);
	});

	test('widgets without an id or type are left out, a repeated id keeps the first', () => {
		const m = readManifest({
			widgets: [
				{ type: 'led' },
				{ id: 'x' },
				{ id: 'a', type: 'led', label: 'first' },
				{ id: 'a', type: 'text', label: 'second' },
				7
			]
		});
		expect(m.widgets.map((w) => [w.id, w.label])).toEqual([['a', 'first']]);
	});

	test(`at most ${MAX_WIDGETS} widgets`, () => {
		const m = readManifest({
			widgets: Array.from({ length: 300 }, (_, i) => ({ id: `w${i}`, type: 'led' }))
		});
		expect(m.widgets).toHaveLength(MAX_WIDGETS);
	});

	test('sizes: the manifest wins, otherwise by type', () => {
		const m = readManifest({
			widgets: [
				{ id: 'a', type: 'desktop' },
				{ id: 'b', type: 'table' },
				{ id: 'c', type: 'toggle', size: 'large' },
				{ id: 'd', type: 'chart', size: 'small' },
				{ id: 'e', type: 'toggle' }
			]
		});
		expect(m.widgets.map((w) => w.size)).toEqual(['xl', 'lg', 'lg', 'sm', '']);
	});

	test('select options as text or as objects, numbers become text', () => {
		const m = readManifest({
			widgets: [{ id: 's', type: 'select', options: ['eco', { value: 2, label: 'Two' }, { value: 'x' }] }]
		});
		expect(m.widgets[0]!.options).toEqual([
			{ value: 'eco', label: 'eco' },
			{ value: '2', label: 'Two' },
			{ value: 'x', label: 'x' }
		]);
	});

	test('min and max that are not numbers fall back (they used to go into markup as they were)', () => {
		const m = readManifest({ widgets: [{ id: 'g', type: 'gauge', min: '1"><img>', max: 'x' }] });
		expect(m.widgets[0]).toMatchObject({ min: 0, max: 100 });
	});

	test('groups keep the order in which categories first appear', () => {
		const m = readManifest({
			widgets: [
				{ id: 'a', type: 'led', category: 'B' },
				{ id: 'b', type: 'led' },
				{ id: 'c', type: 'led', category: 'B' },
				{ id: 'd', type: 'led', category: 'A' }
			]
		});
		expect(groupWidgets(m.widgets).map((g) => [g.category, g.widgets.map((w) => w.id)])).toEqual([
			['B', ['a', 'c']],
			['', ['b']],
			['A', ['d']]
		]);
	});
});

describe('values', () => {
	test('on and off', () => {
		for (const v of [true, 1, 'on', 'true', '1']) expect(isOn(v)).toBe(true);
		for (const v of [false, 0, 'off', '', null, undefined, 'yes']) expect(isOn(v)).toBe(false);
	});

	test('a gauge between min and max, and its tone', () => {
		expect(percentOf(50, 0, 200)).toBe(25);
		expect(percentOf(-5, 0, 10)).toBe(0);
		expect(percentOf(15, 0, 10)).toBe(100);
		expect(percentOf(5, 10, 10)).toBe(0);
		expect(gaugeTone(70)).toBe('normal');
		expect(gaugeTone(70.5)).toBe('warning');
		expect(gaugeTone(90)).toBe('warning');
		expect(gaugeTone(90.5)).toBe('danger');
	});

	test('text of objects is JSON, not [object Object]', () => {
		expect(textOf({ a: 1 })).toBe('{"a":1}');
		expect(textOf(null)).toBe('');
		expect(textOf(3)).toBe('3');
	});

	test('terminal lines: a list replaces them, the same single line is not added twice', () => {
		let lines = terminalLines([], ['a', 'b'], undefined);
		expect(lines).toEqual(['a', 'b']);
		lines = terminalLines(lines, 'c', ['a', 'b']);
		expect(lines).toEqual(['a', 'b', 'c']);
		// The next poll reports the same line again
		lines = terminalLines(lines, 'c', 'c');
		expect(lines).toEqual(['a', 'b', 'c']);
		lines = terminalLines(lines, 'd', 'c');
		expect(lines).toEqual(['a', 'b', 'c', 'd']);
		expect(
			terminalLines(
				[],
				Array.from({ length: 900 }, (_, i) => String(i)),
				undefined
			)
		).toHaveLength(500);
	});
});

describe('table widget', () => {
	const cols = readManifest({
		widgets: [
			{
				id: 't',
				type: 'table',
				columns: [
					{ id: 'name', label: 'Name' },
					{ id: 'n', label: 'N', type: 'number' }
				]
			}
		]
	}).widgets[0]!.columns;
	const rows: Row[] = [
		{ name: 'beta', n: '10' },
		{ name: 'Alpha', n: 9 },
		{ name: 'gamma', n: 100 },
		{ Name: 'by label', n: 1 }
	];

	test('search covers every column, by id or by label', () => {
		expect(filterRows(rows, cols, 'ALP')).toHaveLength(1);
		expect(filterRows(rows, cols, 'by label')).toHaveLength(1);
		expect(filterRows(rows, cols, '100')).toHaveLength(1);
		expect(filterRows(rows, cols, '  ')).toHaveLength(4);
	});

	test('numbers sort as numbers, the whole list before paging, both ways', () => {
		expect(sortRows(rows, cols[1], 'asc').map((r) => r.n)).toEqual([1, 9, '10', 100]);
		expect(sortRows(rows, cols[1], 'desc').map((r) => r.n)).toEqual([100, '10', 9, 1]);
		expect(sortRows(rows, cols[0], 'asc', 'en').map((r) => r.name ?? r.Name)).toEqual([
			'Alpha',
			'beta',
			'by label',
			'gamma'
		]);
	});

	test('pages', () => {
		const many: Row[] = Array.from({ length: 12 }, (_, i) => ({ i }));
		expect(pageOf(many, 0, 5)).toMatchObject({ page: 0, pages: 3, from: 1, to: 5, total: 12 });
		expect(pageOf(many, 2, 5)).toMatchObject({ page: 2, from: 11, to: 12 });
		// A page past the end (the search made the list shorter) shows the last one
		expect(pageOf(many, 9, 5).page).toBe(2);
		expect(pageOf([], 3, 5)).toMatchObject({ page: 0, pages: 1, from: 0, to: 0 });
	});
});

describe('device list', () => {
	const list: ListedDevice[] = [
		describeDevice({
			id: 'CDAP-1',
			connected: true,
			manifest: { device: { name: 'Boiler', type: 'scada' } },
			client_ip: '10.0.0.5'
		}),
		describeDevice({
			id: 'CDAP-2',
			connected: true,
			manifest: '{"device":{"type":"camera"}}',
			username: 'gate'
		}),
		describeDevice({ id: 'CDAP-3', connected: false, hostname: 'hall' })
	];

	test('name and type from the manifest, then the host name or ID, custom without a type', () => {
		expect(list.map((d) => [d.name, d.type])).toEqual([
			['Boiler', 'scada'],
			['CDAP-2', 'camera'],
			['hall', 'custom']
		]);
	});

	test('type filter and search over ID, name, type, user and address', () => {
		expect(filterListed(list, 'camera', '')).toHaveLength(1);
		expect(filterListed(list, '', '10.0.0')).toHaveLength(1);
		expect(filterListed(list, '', 'GATE')).toHaveLength(1);
		expect(filterListed(list, '', 'scada')).toHaveLength(1);
		expect(filterListed(list, 'scada', 'hall')).toHaveLength(0);
	});

	test('connected for: only while connected', () => {
		const now = Date.parse('2026-11-09T12:00:00Z');
		expect(connectedSeconds({ id: 'a', connected: true, connected_at: '2026-11-09T11:00:00Z' }, now)).toBe(
			3600
		);
		expect(
			connectedSeconds({ id: 'a', connected: false, connected_at: '2026-11-09T11:00:00Z' }, now)
		).toBeNull();
		expect(connectedSeconds({ id: 'a', connected: true, connected_at: 'soon' }, now)).toBeNull();
	});
});

describe('commands', () => {
	test('one per widget per second', () => {
		const g = new CommandGate();
		expect(g.allow('pump', 1000)).toBe(true);
		expect(g.allow('pump', 1500)).toBe(false);
		expect(g.allow('fan', 1500)).toBe(true);
		expect(g.allow('pump', 2000)).toBe(true);
	});

	test('the log keeps the newest 50, newest first', () => {
		let log: LogEntry[] = [];
		for (let i = 0; i < 60; i++)
			log = addLog(log, {
				id: i,
				time: new Date(),
				widgetId: 'w',
				action: 'set',
				value: i,
				ok: true,
				error: ''
			});
		expect(log).toHaveLength(MAX_LOG);
		expect(log[0]!.id).toBe(59);
		expect(log.at(-1)!.id).toBe(10);
	});
});

describe('alerts', () => {
	test('firing only, the most severe first, unknown severities as notes', () => {
		const a = firingAlerts([
			{ label: 'i', severity: 'info', firing: true },
			{ label: 'gone', severity: 'critical', firing: false },
			{ label: 'w', severity: 'warning', firing: true },
			{ label: 'c', severity: 'critical', firing: true },
			{ label: 'x', severity: '<b>', firing: true }
		]);
		expect(a.map((x) => x.label)).toEqual(['c', 'w', 'i', 'x']);
		expect(severityOf('<b>')).toBe('info');
	});
});

describe('file browser', () => {
	test('folders first, both spellings, no entries that leave the folder', () => {
		const e = readEntries(
			[
				{ name: 'b.txt', is_dir: false, size: 3 },
				{ name: 'logs', type: 'dir' },
				{ name: 'a', is_dir: true },
				{ name: '..', is_dir: true },
				{ name: '../../etc/passwd' },
				{ name: '' },
				'junk'
			],
			'en'
		);
		expect(e.map((x) => [x.name, x.dir])).toEqual([
			['a', true],
			['logs', true],
			['b.txt', false]
		]);
		expect(e[2]!.size).toBe(3);
	});

	test('paths', () => {
		expect(joinPath('/', 'var')).toBe('/var');
		expect(joinPath('/var/', 'log')).toBe('/var/log');
		expect(parentPath('/var/log')).toBe('/var');
		expect(parentPath('/var')).toBe('/');
		expect(parentPath('/')).toBe('/');
	});
});
