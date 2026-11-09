import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { Distribution, Protocols } from '../../../src/lib/api/crossPlatform.ts';
import {
	countRows,
	LIMITATIONS,
	MATRIX,
	mergeFamilies,
	noArchitecture,
	PLATFORMS,
	platformFamily,
	tabFrom
} from '../../../src/lib/devices-area/crossPlatform.ts';

describe('tabs', () => {
	test('?tab= picks a tab; anything else is the feature matrix', () => {
		expect(tabFrom('distribution')).toBe('distribution');
		expect(tabFrom('protocols')).toBe('protocols');
		expect(tabFrom('limitations')).toBe('limitations');
		expect(tabFrom('matrix')).toBe('matrix');
		expect(tabFrom('nope')).toBe('matrix');
		expect(tabFrom(null)).toBe('matrix');
	});
});

describe('fixed data', () => {
	test('every feature has a word for each system', () => {
		for (const row of MATRIX) {
			expect(row.values).toHaveLength(PLATFORMS.length);
			expect(row.feature).toMatch(/^feat_/);
			for (const value of row.values) expect(['full', 'partial', 'none', 'planned']).toContain(value);
		}
		expect(MATRIX).toHaveLength(16);
		expect(MATRIX.find((r) => r.feature === 'feat_chat')?.values.every((x) => x === 'full')).toBe(true);
	});

	test('the limits per system, as the old page listed them', () => {
		expect(LIMITATIONS.map((l) => l.platform)).toEqual([
			'windows',
			'linux',
			'macos',
			'android',
			'ios',
			'web',
			'chromeos'
		]);
		for (const l of LIMITATIONS) for (const item of l.items) expect(item).toMatch(/^limit_/);
		expect(LIMITATIONS.flatMap((l) => l.items)).toHaveLength(23);
	});
});

describe('counts', () => {
	test('one row per system, however the clients spell it', () => {
		expect(platformFamily('Ubuntu 22.04')).toBe('linux');
		expect(platformFamily('debian 12')).toBe('linux');
		expect(platformFamily('Windows 11')).toBe('windows');
		expect(platformFamily('Darwin')).toBe('macos');
		expect(platformFamily('iPadOS 17')).toBe('ios');
		expect(platformFamily('Chrome OS')).toBe('chromeos');
		expect(platformFamily('')).toBe('unknown');
		expect(platformFamily('FreeBSD')).toBe('freebsd');
		expect(mergeFamilies({ windows: 3, 'Ubuntu 22.04': 2, 'debian 12': 1 })).toEqual({
			windows: 3,
			linux: 3
		});
	});

	test('most first, with the share of the total', () => {
		expect(countRows({ a: 1, b: 3 }, 4)).toEqual([
			{ name: 'b', count: 3, share: 75 },
			{ name: 'a', count: 1, share: 25 }
		]);
		expect(countRows({ a: 1 }, 0)[0]?.share).toBe(0);
		expect(noArchitecture(countRows({ unknown: 5 }, 5))).toBe(true);
		expect(noArchitecture(countRows({ unknown: 5, x86_64: 1 }, 6))).toBe(false);
		expect(noArchitecture([])).toBe(false);
	});

	test('answers: counts as numbers, junk dropped, missing parts empty', () => {
		expect(
			v.parse(Distribution, { total: '5', platforms: { windows: 3, linux: 'x', mac: 0 } })
		).toMatchObject({
			total: 5,
			platforms: { windows: 3 },
			archs: {},
			versions: {}
		});
		expect(v.parse(Protocols, { totalOnline: null, codecs: { vp9: 2 } })).toMatchObject({
			totalOnline: 0,
			codecs: { vp9: 2 },
			features: {}
		});
	});
});
