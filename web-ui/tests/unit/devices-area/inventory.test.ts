import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { InventoryRow, listInventory, MAX_PAGES } from '../../../src/lib/api/inventory.ts';
import {
	countLine,
	fullDisks,
	fullMemory,
	hasDiskData,
	matches,
	osFamily,
	osName,
	osSummary,
	osText,
	percent,
	rowName
} from '../../../src/lib/devices-area/inventory.ts';
import { joinSentences } from '../../../src/lib/devices-area/sentences.ts';

const row = (o: Record<string, unknown>) => v.parse(InventoryRow, { device_id: '1', ...o });

afterEach(() => vi.unstubAllGlobals());

describe('names and systems', () => {
	test('the host name unless it is the ID again', () => {
		expect(rowName(row({ device_id: '900', hostname: 'reception' }))).toBe('reception');
		expect(rowName(row({ device_id: '900', hostname: '900' }))).toBe('');
		expect(rowName(row({ device_id: '900', hostname: null }))).toBe('');
	});

	test('the version is not said twice', () => {
		expect(osText({ os: 'macOS 15.1 15.1', os_name: 'macOS 15.1' })).toBe('macOS 15.1');
		expect(osText({ os: 'Debian 12 12', os_name: 'Debian 12' })).toBe('Debian 12');
		expect(osText({ os: 'Windows 11 Pro 23H2 (22631.4460)', os_name: 'Windows 11 Pro' })).toBe(
			'Windows 11 Pro 23H2 (22631.4460)'
		);
		expect(osText({ os: 'Ubuntu 24.04', os_name: '' })).toBe('Ubuntu 24.04');
	});

	test('the system without build numbers, and its family', () => {
		expect(osName({ os: 'Windows 11 Pro 23H2 (22631.4460)', os_name: '' })).toBe('Windows 11 Pro 23H2');
		expect(osName({ os: 'whatever', os_name: ' Windows 11 Pro ' })).toBe('Windows 11 Pro');
		expect(osFamily('Windows 10 Pro')).toBe('windows');
		expect(osFamily('Ubuntu 24.04')).toBe('linux');
		expect(osFamily('macOS 15.1')).toBe('apple');
		expect(osFamily('Android 14')).toBe('other');
	});

	test('search: ID, host name, system or CPU, any case', () => {
		const r = row({ device_id: '900100001', hostname: 'Reception', os: 'Windows 11', cpu: 'Intel Core i5' });
		expect(matches(r, 'recep')).toBe(true);
		expect(matches(r, '0100001')).toBe(true);
		expect(matches(r, 'windows')).toBe(true);
		expect(matches(r, 'i5')).toBe(true);
		expect(matches(r, 'linux')).toBe(false);
		expect(matches(r, '  ')).toBe(true);
	});
});

describe('count line', () => {
	const rows = [row({ cpu_usage: 10 }), row({ device_id: '2', cpu_usage: '31' }), row({ device_id: '3' })];

	test('devices, average load and what the search shows', () => {
		expect(countLine(rows, false, false, 3)).toEqual([
			{ key: 'inventory.count_many', params: { count: 3 } },
			{ key: 'inventory.count_cpu', params: { cpu: 21 } }
		]);
		expect(countLine(rows.slice(2), false, true, 0)).toEqual([
			{ key: 'inventory.count_one' },
			{ key: 'inventory.count_shown', params: { count: 0 } }
		]);
		expect(countLine([], false, false, 0)).toEqual([]);
		expect(countLine(rows, true, false, 3)).toEqual([
			{ key: 'inventory.count_no_reports', params: { count: 3 } }
		]);
	});

	test('sentences with the same placeholder keep their own numbers', () => {
		const strings: Record<string, string> = {
			'inventory.count_many': '{count} devices.',
			'inventory.count_shown': '{count} shown.'
		};
		const out = joinSentences(
			[
				{ key: 'inventory.count_many', params: { count: 12 } },
				{ key: 'inventory.count_shown', params: { count: 3 } }
			],
			(k) => strings[k] ?? k
		);
		expect(out.text).toBe('{0_count} devices. {1_count} shown.');
		expect(out.values).toEqual({ '0_count': 12, '1_count': 3 });
	});
});

describe('side column', () => {
	test('systems: families in order, the most common names first', () => {
		const rows = [
			row({ device_id: 'a', os: 'Windows 11 Pro 23H2 (1)', os_name: 'Windows 11 Pro' }),
			row({ device_id: 'b', os: 'Windows 11 Pro 23H2 (2)', os_name: 'Windows 11 Pro' }),
			row({ device_id: 'c', os: 'Windows 10 Pro', os_name: 'Windows 10 Pro' }),
			row({ device_id: 'd', os: 'Ubuntu 24.04', os_name: 'Ubuntu 24.04' }),
			row({ device_id: 'e', os: 'macOS 15.1', os_name: 'macOS 15.1' }),
			row({ device_id: 'f', os: '', os_name: '' })
		];
		const s = osSummary(rows);
		expect(s.families).toEqual([
			{ id: 'windows', count: 3 },
			{ id: 'linux', count: 1 },
			{ id: 'apple', count: 1 }
		]);
		expect(s.top[0]).toEqual({ name: 'Windows 11 Pro', count: 2 });
		expect(s.top.map((x) => x.name).slice(1)).toEqual(['macOS 15.1', 'Ubuntu 24.04', 'Windows 10 Pro']);
		expect(s.more).toBe(0);
	});

	test('more than six systems: the rest are counted', () => {
		const rows = Array.from({ length: 9 }, (_, i) => row({ device_id: String(i), os_name: `System ${i}` }));
		const s = osSummary(rows);
		expect(s.top).toHaveLength(6);
		expect(s.more).toBe(3);
	});

	test('almost full: disks and memory over 90 %, fullest first', () => {
		const rows = [
			row({ device_id: 'a', disk_max_used_percent: 93.6 }),
			row({ device_id: 'b', disk_max_used_percent: 90 }),
			row({ device_id: 'c', disk_max_used_percent: 99, memory_total_mb: 1000, memory_used_mb: 950 }),
			row({ device_id: 'd', memory_total_mb: 1000, memory_used_mb: 920 }),
			row({ device_id: 'e', memory_total_mb: 1000, memory_used_mb: 900 })
		];
		expect(fullDisks(rows).map((r) => r.device_id)).toEqual(['c', 'a']);
		expect(fullMemory(rows).map((m) => [m.row.device_id, m.pct])).toEqual([
			['c', 95],
			['d', 92]
		]);
		expect(hasDiskData(rows)).toBe(true);
		expect(hasDiskData([row({})])).toBe(false);
		expect(percent(5, 0)).toBeNull();
		expect(percent(null, 10)).toBeNull();
		expect(percent(15, 10)).toBe(100);
	});
});

describe('GET /api/inventory', () => {
	function pages(total: number) {
		const seen: number[] = [];
		vi.stubGlobal('fetch', async (input: string) => {
			const url = new URL(input, location.origin);
			const page = Number(url.searchParams.get('page'));
			seen.push(page);
			const body = {
				devices: [{ device_id: `d${page}`, source: page === 2 ? 'peer_list' : undefined }],
				total_pages: total
			};
			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});
		});
		return seen;
	}

	test('reads every page, the rest after the first all at once', async () => {
		const seen = pages(3);
		const out = await listInventory();
		expect(out.rows.map((r) => r.device_id)).toEqual(['d1', 'd2', 'd3']);
		expect(seen[0]).toBe(1);
		expect([...seen].sort()).toEqual([1, 2, 3]);
		expect(out.peerList).toBe(true);
	});

	test('stops after fifty pages, as the old page did', async () => {
		const seen = pages(400);
		const out = await listInventory();
		expect(seen).toHaveLength(MAX_PAGES);
		expect(out.rows).toHaveLength(MAX_PAGES);
	});
});
