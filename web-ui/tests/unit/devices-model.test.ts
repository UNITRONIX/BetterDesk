import { describe, expect, test } from 'vitest';
import {
	countDevices,
	deviceState,
	filterDevices,
	inGroup,
	isFiltered,
	lastSeenValue,
	NO_FILTERS,
	searchText,
	typeLabel,
	type DeviceLike,
	type Filters
} from '../../src/lib/devices/model.ts';
import { sortRows } from '../../src/lib/ui/table.ts';

const dev = (id: string, over: Partial<DeviceLike> = {}): DeviceLike => ({
	id,
	hostname: `host-${id}`,
	display_name: '',
	tags: [],
	groups: [],
	folder_id: null,
	online: false,
	banned: false,
	soft_deleted: false,
	device_type: 'rustdesk',
	...over
});

const list: DeviceLike[] = [
	dev('100001', {
		hostname: 'reception-pc',
		online: true,
		tags: ['office', 'Ground-floor'],
		folder_id: 1,
		platform: 'Windows 11'
	}),
	dev('100002', {
		hostname: 'warehouse-scanner',
		tags: ['warehouse', 'scanner'],
		folder_id: 2,
		note: 'shelf 4'
	}),
	dev('100003', { hostname: 'build-server', online: true, tags: ['server', 'linux'], ip: '10.0.1.20' }),
	dev('100004', { hostname: 'old-laptop', banned: true, tags: ['laptop'] }),
	dev('100005', { hostname: 'gone-box', soft_deleted: true, folder_id: 1 }),
	dev('100006', {
		hostname: 'mesh-host',
		device_type: 'mesh_agent',
		groups: [{ guid: 'g-manual', source_type: 'manual' }]
	})
];
const groups = [
	{ guid: 'g-manual', source_type: 'manual', tag_filter: '' },
	{ guid: 'g-office', source_type: 'tag', tag_filter: 'office' }
];
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const ids = (ds: DeviceLike[]) => ds.map((d) => d.id);

describe('device state', () => {
	test('deleted and banned win over online; no signal before offline', () => {
		expect(deviceState(dev('1', { online: true, banned: true }))).toBe('banned');
		expect(deviceState(dev('1', { online: true, soft_deleted: true, banned: true }))).toBe('deleted');
		expect(deviceState(dev('1', { online: true }))).toBe('online');
		expect(deviceState(dev('1', { no_signal: true }))).toBe('no_signal');
		expect(deviceState(dev('1'))).toBe('offline');
	});

	test('type labels: product names, translated words, unknown types capitalised', () => {
		const t = (k: string) => `T:${k}`;
		expect(typeLabel('rustdesk', t)).toBe('RustDesk');
		expect(typeLabel('mesh_agent', t)).toBe('T:devices.type_mesh_agent');
		expect(typeLabel('smart_fridge', t)).toBe('Smart fridge');
		expect(typeLabel('', t)).toBe('');
	});
});

describe('filters', () => {
	test('deleted devices only with Show deleted', () => {
		expect(ids(filterDevices(list, f({}), groups))).not.toContain('100005');
		expect(ids(filterDevices(list, f({ showDeleted: true }), groups))).toContain('100005');
	});

	test('search: every word somewhere, any order, any case, across ID, names, tags, note and IP', () => {
		expect(ids(filterDevices(list, f({ query: 'SCANNER shelf' }), groups))).toEqual(['100002']);
		expect(ids(filterDevices(list, f({ query: '10.0.1.20' }), groups))).toEqual(['100003']);
		expect(ids(filterDevices(list, f({ query: '100001' }), groups))).toEqual(['100001']);
		expect(ids(filterDevices(list, f({ query: 'scanner office' }), groups))).toEqual([]);
		expect(ids(filterDevices(list, f({ query: '  ' }), groups))).toHaveLength(5);
	});

	test('status: online, offline (not banned), banned, mesh agents', () => {
		expect(ids(filterDevices(list, f({ status: 'online' }), groups))).toEqual(['100001', '100003']);
		expect(ids(filterDevices(list, f({ status: 'offline' }), groups))).toEqual(['100002', '100006']);
		expect(ids(filterDevices(list, f({ status: 'banned' }), groups))).toEqual(['100004']);
		expect(ids(filterDevices(list, f({ status: 'mesh_agent' }), groups))).toEqual(['100006']);
	});

	test('folders: one folder, or the devices in none', () => {
		expect(ids(filterDevices(list, f({ scope: { kind: 'folder', id: 1 } }), groups))).toEqual(['100001']);
		expect(ids(filterDevices(list, f({ scope: { kind: 'unassigned' } }), groups))).toEqual([
			'100003',
			'100004',
			'100006'
		]);
	});

	test('groups: manual members, and tag groups by tag (case does not matter)', () => {
		expect(ids(filterDevices(list, f({ scope: { kind: 'group', guid: 'g-manual' } }), groups))).toEqual([
			'100006'
		]);
		expect(ids(filterDevices(list, f({ scope: { kind: 'group', guid: 'g-office' } }), groups))).toEqual([
			'100001'
		]);
		expect(ids(filterDevices(list, f({ scope: { kind: 'group', guid: 'missing' } }), groups))).toEqual([]);
		expect(inGroup(dev('x', { tags: ['OFFICE'] }), groups[1]!)).toBe(true);
	});

	test('tags: every ticked tag must be on the device', () => {
		expect(ids(filterDevices(list, f({ tags: ['ground-floor'] }), groups))).toEqual(['100001']);
		expect(ids(filterDevices(list, f({ tags: ['office', 'server'] }), groups))).toEqual([]);
	});

	test('filters combine, and the order of the list is kept', () => {
		expect(ids(filterDevices(list, f({ status: 'online', query: 'server' }), groups))).toEqual(['100003']);
		expect(isFiltered(f({}))).toBe(false);
		expect(isFiltered(f({ showDeleted: true }))).toBe(false);
		expect(isFiltered(f({ tags: ['x'] }))).toBe(true);
	});

	test('the search text function is used when given (cached text)', () => {
		const calls: string[] = [];
		filterDevices(list, f({ query: 'x' }), groups, (d) => {
			calls.push(d.id);
			return searchText(d);
		});
		expect(calls).toHaveLength(5);
	});

	test('filtering is linear up to 10,000 devices and reads each cached text once', () => {
		const make = (n: number) =>
			Array.from({ length: n }, (_, i) =>
				dev(String(200000 + i), {
					hostname: `pc-${i}`,
					tags: i % 3 ? ['office'] : ['lab'],
					online: i % 2 === 0
				})
			);
		const run = (list: DeviceLike[]) => {
			const cache = new Map(list.map((d) => [d, searchText(d)]));
			let reads = 0;
			const filters = f({ query: 'pc-49 office', status: 'online', tags: ['office'] });
			let best = Infinity;
			let out: DeviceLike[] = [];
			for (let k = 0; k < 5; k++) {
				reads = 0;
				const t0 = performance.now();
				out = filterDevices(list, filters, groups, (d) => {
					reads++;
					return cache.get(d) ?? '';
				});
				best = Math.min(best, performance.now() - t0);
			}
			return { best, reads, out };
		};
		run(make(500)); // warm up
		const small = run(make(500));
		const large = run(make(10000));
		// The text is read only for devices the cheaper filters let through (online, tag office), once each
		expect(large.reads).toBe(make(10000).filter((d) => d.online && d.tags?.includes('office')).length);
		expect(large.out.every((d) => d.hostname?.startsWith('pc-49'))).toBe(true);
		// Linear: 20 times the devices takes about 20 times as long (quadratic: 400); room left for a busy machine
		expect(large.best / Math.max(small.best, 0.05)).toBeLessThan(80);
	});
});

describe('counts and sorting', () => {
	test('counts beside folders and groups come from one pass over the list', () => {
		const c = countDevices(list, [{ id: 1 }, { id: 2 }, { id: 3 }], groups);
		expect(c.all).toBe(6);
		expect(c.unassigned).toBe(3);
		expect(c.online).toBe(2);
		expect(c.folders.get(1)).toBe(2);
		expect(c.folders.get(2)).toBe(1);
		expect(c.folders.get(3)).toBe(0);
		expect(c.groups.get('g-manual')).toBe(1);
		expect(c.groups.get('g-office')).toBe(1);
	});

	test('last seen sorts newest first, never seen last', () => {
		const rows = [
			dev('a', { last_online: '2026-11-01 10:00:00' }),
			dev('b', { last_online: '' }),
			dev('c', { last_online: '2026-11-08T10:00:00Z' })
		];
		const sorted = sortRows(rows, { sortValue: lastSeenValue, dir: 'desc' });
		expect(ids(sorted)).toEqual(['c', 'a', 'b']);
	});
});
