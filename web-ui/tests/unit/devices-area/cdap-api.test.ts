import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiError, setCsrfToken } from '../../../src/lib/api/client.ts';
import {
	getAlerts,
	getCdapDevice,
	getGatewayStatus,
	getManifest,
	getWidgetState,
	listCdapDevices,
	sendCommand,
	setLink
} from '../../../src/lib/api/cdap.ts';

let calls: { url: string; init: RequestInit }[];
let replies: unknown[];

beforeEach(() => {
	calls = [];
	replies = [];
	vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const body = replies.shift();
		const status =
			body && typeof body === 'object' && '__status' in body
				? Number((body as { __status: number }).__status)
				: 200;
		return Promise.resolve(
			new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
		);
	});
	setCsrfToken('tok');
});
afterEach(() => vi.unstubAllGlobals());

// The route answers a failed Go call with HTTP 200 and this body
const goFailed = (code: number) => ({ success: false, error: `Request failed with status code ${code}` });

describe('CDAP API', () => {
	test('a failed Go call becomes an error with its status, even with HTTP 200', async () => {
		replies.push(goFailed(404));
		const err = await getCdapDevice('CDAP-1').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).status).toBe(404);
		replies.push(goFailed(503));
		expect(((await listCdapDevices().catch((e: unknown) => e)) as ApiError).status).toBe(503);
	});

	test('flat Go answers and wrapped ones both work', async () => {
		replies.push({ id: 'CDAP-1', connected: true, heartbeat_count: 4, manifest: { device: { name: 'B' } } });
		expect(await getCdapDevice('CDAP-1')).toMatchObject({
			id: 'CDAP-1',
			connected: true,
			heartbeat_count: 4
		});
		replies.push({ success: true, data: { id: 'CDAP-2', connected: false } });
		expect(await getCdapDevice('CDAP-2')).toMatchObject({ id: 'CDAP-2', connected: false });
		expect(calls[0]!.url).toBe('/api/cdap/devices/CDAP-1');
	});

	test('widget state: Go puts it under widget_state; a device that is not connected has none', async () => {
		replies.push({ device_id: 'd', widget_state: { pump: true }, connected: true });
		expect(await getWidgetState('d')).toEqual({ pump: true });
		replies.push(goFailed(404));
		expect(await getWidgetState('d')).toEqual({});
		replies.push({ success: true, data: { pump: false } });
		expect(await getWidgetState('d')).toEqual({ pump: false });
	});

	test('no manifest is null, not an error', async () => {
		replies.push(goFailed(404));
		expect(await getManifest('d')).toBeNull();
		replies.push({ device: { name: 'X' }, widgets: [] });
		expect(await getManifest('d')).toEqual({ device: { name: 'X' }, widgets: [] });
	});

	test('gateway status, devices and alerts', async () => {
		replies.push({ enabled: true, connected: 2, port: 21122, tls: false });
		expect(await getGatewayStatus()).toMatchObject({ enabled: true, connected: 2, port: 21122, tls: false });
		replies.push({ devices: [{ id: 'a' }, { id: 'b', connected: false }], total: 2 });
		expect((await listCdapDevices()).map((d) => d.connected)).toEqual([true, false]);
		replies.push({ alerts: [{ alert_id: 'x', label: 'Hot', severity: 'critical', firing: true }], total: 1 });
		expect(await getAlerts('d 1')).toHaveLength(1);
		expect(calls.at(-1)!.url).toBe('/api/cdap/alerts?device_id=d+1');
	});

	test('a command and a link are writes with the token; a refused one is an error', async () => {
		replies.push({ status: 'sent' });
		await sendCommand('d', { widget_id: 'pump', action: 'set', value: false });
		expect(calls[0]!.init.method).toBe('POST');
		expect((calls[0]!.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('tok');
		expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
			widget_id: 'pump',
			action: 'set',
			value: false
		});
		replies.push({ status: 'updated' });
		await setLink('900100003', 'CDAP-1');
		expect(calls[1]!.url).toBe('/api/cdap/devices/900100003/link');
		expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ linked_peer_id: 'CDAP-1' });
		replies.push({ error: 'No fields to update' });
		await expect(setLink('900100003', '')).rejects.toBeInstanceOf(ApiError);
	});
});
