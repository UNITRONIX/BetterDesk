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
		const d = v.parse(Device, { id: 9001, online: 1, banned: '0', note: null, tags: 'office, finance', folder_id: '3' });
		expect(d).toMatchObject({ id: '9001', online: true, banned: false, note: '', tags: ['office', 'finance'], folder_id: 3 });
	});

	test('a device without an id is refused', () => {
		expect(v.safeParse(Device, { hostname: 'x' }).success).toBe(false);
	});

	test('5,000 devices validate fast enough for the list budget', () => {
		const base = fixture.data.devices;
		const devices = Array.from({ length: 5000 }, (_, i) => ({ ...base[i % base.length], id: String(100000 + i) }));
		const t0 = performance.now();
		const out = v.parse(DeviceList, { success: true, data: { devices, total: 5000 } });
		const ms = performance.now() - t0;
		expect(out.devices).toHaveLength(5000);
		console.warn(`validated 5000 devices in ${ms.toFixed(1)} ms`);
		expect(ms).toBeLessThan(250);
	});
});
