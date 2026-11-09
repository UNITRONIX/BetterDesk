import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	BillingSession,
	Contract,
	listOrgs,
	sessionsExportUrl,
	reportsExportUrl
} from '../../../src/lib/api/billing.ts';
import { listRelays, getCapacity } from '../../../src/lib/api/scaling.ts';
import { Status as AttestationStatus } from '../../../src/lib/api/serverAttestation.ts';
import { listFiles, ServerInfo } from '../../../src/lib/api/serverManagement.ts';

function answer(body: unknown, status = 200) {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockResolvedValue(
			new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
		);
}

afterEach(() => vi.restoreAllMocks());

describe('server management answers', () => {
	test('info as the dev server sends it', () => {
		const out = v.safeParse(ServerInfo, {
			success: true,
			platform: 'linux',
			nodeVersion: 'v22.23.2',
			pid: 45,
			ptyAvailable: true,
			fileRoots: ['/opt/rustdesk', '/app', 7],
			mutableFileRoots: ['/opt/rustdesk', '/app'],
			server: { running: true, uptimeSeconds: 25792, version: '3.5.219' }
		});
		expect(out.issues).toBeUndefined();
		expect(out.output).toMatchObject({
			server: { version: '3.5.219' },
			fileRoots: ['/opt/rustdesk', '/app']
		});
	});

	test('an older console without the server part or the writable folders', () => {
		const out = v.parse(ServerInfo, { success: true, platform: 'win32', fileRoots: null });
		expect(out.server).toBeNull();
		expect(out.mutableFileRoots).toBeNull();
		expect(out.fileRoots).toEqual([]);
		expect(out.ptyAvailable).toBe(false);
	});

	test('a folder listing takes cwd or path, entries or items', async () => {
		answer({
			success: true,
			path: '/app',
			items: [{ name: 'a', path: '/app/a', isDirectory: true, mode: 493 }]
		});
		const out = await listFiles('/app');
		expect(out.cwd).toBe('/app');
		expect(out.entries[0]).toMatchObject({
			name: 'a',
			isDirectory: true,
			isSymlink: false,
			mode: 493,
			size: null
		});
		expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe('/api/server-management/files?path=%2Fapp');
	});
});

describe('relay server answers', () => {
	test('a list in { data } or bare, numbers from strings', async () => {
		answer({ data: [{ id: 'r-1', name: 'A', address: 'a:1', max_sessions: '20', status: null }] });
		const list = await listRelays();
		expect(list[0]).toMatchObject({ id: 'r-1', max_sessions: 20, status: '', cpu: 0 });
		vi.restoreAllMocks();
		answer([{ id: 7, name: 'B' }]);
		expect((await listRelays())[0]?.id).toBe('7');
	});

	test('capacity is unwrapped from { data }', async () => {
		answer({ data: { relay_count: 0, max_devices: 500, max_sessions: 50, max_bandwidth_mbps: 100 } });
		expect(await getCapacity()).toMatchObject({ max_devices: 500 });
	});
});

describe('capacity test answers', () => {
	test('a status with a running test and no result yet', () => {
		const s = v.parse(AttestationStatus, {
			success: true,
			running: true,
			phase: 'ramp-up',
			progress: { phase: 'ramp-up', connections: 40 },
			lastResult: null
		});
		expect(s).toMatchObject({
			running: true,
			progress: { phase: 'ramp-up', connections: 40 },
			lastResult: null
		});
	});

	test('a result keeps the fields the page does not read (for the report download)', () => {
		const s = v.parse(AttestationStatus, {
			running: false,
			lastResult: {
				tier: 'iron',
				maxConnections: 60,
				rampSteps: [1, 2],
				finalMetrics: { cpu: 80, mem: 40, disk: 10 }
			}
		});
		expect(s.lastResult).toMatchObject({ tier: 'iron', rampSteps: [1, 2], valid: false, aborted: false });
	});
});

describe('billing answers', () => {
	test('a running session has no end and nulls become empty values', () => {
		const s = v.parse(BillingSession, {
			id: 'demo-bs-010',
			status: 'active',
			started_at: '2026-11-08T17:59:40Z',
			ended_at: null,
			raw_seconds: 0,
			clock_synced_at_start: 1
		});
		expect(s).toMatchObject({
			ended_at: '',
			raw_seconds: 0,
			billed_minutes: null,
			clock_synced_at_start: true
		});
	});

	test('an assignment without dates or its own overage rate', () => {
		const c = v.parse(Contract, { id: 'c1', status: 'active', remaining_minutes: 940 });
		expect(c).toMatchObject({ valid_from: '', valid_until: '', overage_rate: null, remaining_minutes: 940 });
	});

	test('organizations under any of the names the server uses', async () => {
		answer({ organizations: [{ id: 'o1', name: 'Harbor' }] });
		expect(await listOrgs()).toEqual([{ id: 'o1', name: 'Harbor' }]);
		vi.restoreAllMocks();
		answer({ success: true, data: { organizations: [{ id: 'o2', name: 'Lab' }] } });
		expect((await listOrgs())[0]?.id).toBe('o2');
	});

	test('export URLs carry the filters', () => {
		expect(sessionsExportUrl({ org_id: 'o1', status: '', device_id: '9001' })).toBe(
			'/api/panel/billing/sessions/export?format=csv&org_id=o1&device_id=9001'
		);
		expect(reportsExportUrl('pdf')).toBe('/api/panel/billing/reports/export?format=pdf');
		expect(reportsExportUrl('csv', 'o 1')).toBe('/api/panel/billing/reports/export?format=csv&org_id=o+1');
	});
});
