import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { Device, DeviceList } from '../../src/lib/api/devices.ts';
import fixture from '../fixtures/devices.json';

describe('device list schema', () => {
	test('accepts what the dev server sends and normalises it', () => {
		const out = v.parse(DeviceList, fixture);
		expect(out.devices.length).toBe(fixture.data.devices.length);
		const d = out.devices[0]!;
		expect(typeof d.id).toBe('string');
		expect(typeof d.online).toBe('boolean');
		expect(Array.isArray(d.tags)).toBe(true);
		expect(Array.isArray(d.groups)).toBe(true);
	});

	test('SQLite booleans, null text and comma tags become clean values', () => {
		const d = v.parse(Device, {
			id: 9001,
			online: 1,
			banned: '0',
			note: null,
			tags: 'office, finance',
			folder_id: '3'
		});
		expect(d).toMatchObject({
			id: '9001',
			online: true,
			banned: false,
			note: '',
			tags: ['office', 'finance'],
			folder_id: 3
		});
	});

	test('a device without an id is refused', () => {
		expect(v.safeParse(Device, { hostname: 'x' }).success).toBe(false);
	});

	test('validation time grows with the list, not faster (5,000 devices)', () => {
		// Absolute times depend on the machine and on the other test files running
		// next to this one; the ratio between two sizes much less. Linear work makes
		// 5,000 devices about 10 times 500; quadratic work would make it about 100.
		const base = fixture.data.devices;
		const make = (n: number) => ({
			success: true,
			data: {
				devices: Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], id: String(100000 + i) })),
				total: n
			}
		});
		const small = make(500);
		const large = make(5000);
		const time = (input: unknown) => {
			let best = Infinity;
			for (let i = 0; i < 5; i++) {
				const t0 = performance.now();
				v.parse(DeviceList, input);
				best = Math.min(best, performance.now() - t0);
			}
			return best;
		};
		time(small); // warm up
		const tSmall = time(small);
		const tLarge = time(large);
		expect(v.parse(DeviceList, large).devices).toHaveLength(5000);
		console.warn(`validated 500 devices in ${tSmall.toFixed(1)} ms, 5000 in ${tLarge.toFixed(1)} ms`);
		expect(tLarge / tSmall).toBeLessThan(40);
	});
});
