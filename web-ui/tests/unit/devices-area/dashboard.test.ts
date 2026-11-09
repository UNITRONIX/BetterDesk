import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	ClientConfig,
	ServerStatus,
	countOpenHelpRequests,
	getDeviceStats,
	listPendingAgents
} from '../../../src/lib/api/dashboard.ts';
import {
	configText,
	deviceParts,
	intuneScript,
	partState,
	portList,
	readClientHost,
	readPairingCode,
	serverProblem,
	writeClientHost
} from '../../../src/lib/devices-area/dashboard.ts';

const status = (over: Record<string, unknown> = {}) =>
	v.parse(ServerStatus, {
		uptime: 24083,
		hbbs: { status: 'running' },
		hbbr: { status: 'running' },
		api_port: 21121,
		signal_port: 21116,
		relay_port: 21117,
		nat_port: 21115,
		ws_signal_port: 21118,
		ws_relay_port: 21119,
		client_api_port: 21121,
		console_port: 5000,
		...over
	});

function answer(body: unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
		)
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	sessionStorage.clear();
});

describe('server status', () => {
	test('running, stopped and unknown parts', () => {
		expect(partState({ status: 'running' })).toBe('running');
		expect(partState({ online: true })).toBe('running');
		expect(partState({ status: 'stopped' })).toBe('stopped');
		expect(partState({ online: false })).toBe('stopped');
		expect(partState({ status: 'starting' })).toBe('unknown');
		expect(partState(null)).toBe('unknown');
	});

	test('"Needs attention" says which server is down, and nothing while both run', () => {
		expect(serverProblem(status())).toBeNull();
		expect(serverProblem(status({ hbbr: { status: 'stopped' } }))).toBe('dashboard.status_relay_down');
		expect(serverProblem(status({ hbbs: { status: 'stopped' } }))).toBe('dashboard.status_signal_down');
		expect(serverProblem(status({ hbbs: { status: 'stopped' }, hbbr: null }))).toBe(
			'dashboard.status_both_down'
		);
		// The status request failed: the line says Unknown
		expect(serverProblem(null)).toBe('status.unknown');
	});

	test('ports in the old order, the signal and relay ports from either name', () => {
		const list = portList(status());
		expect(list.map((p) => p.value)).toEqual([
			'21116',
			'21115',
			'21118',
			'21121',
			'21117',
			'21119',
			'5000',
			'21121'
		]);
		const older = portList(
			status({ signal_port: null, hbbs_port: 21216, relay_port: undefined, hbbr_port: '21217' })
		);
		expect(older[0]!.value).toBe('21216');
		expect(older[4]!.value).toBe('21217');
		expect(portList(null).every((p) => p.value === null)).toBe(true);
	});
});

describe('device counts', () => {
	test('banned devices are counted once: offline means offline and not banned', () => {
		expect(deviceParts({ total: 33, online: 14, offline: 19, banned: 2 })).toEqual({
			online: 14,
			offline: 17,
			banned: 2
		});
		expect(deviceParts({ total: 2, online: 0, offline: 1, banned: 2 }).offline).toBe(0);
	});

	test('/api/stats: counts as numbers, missing ones as 0', async () => {
		answer({ success: true, data: { devices: { total: '33', online: 14, offline: null, banned: -1 } } });
		expect(await getDeviceStats()).toMatchObject({ total: 33, online: 14, offline: 0, banned: 0 });
		answer({ success: true, data: {} });
		expect(await getDeviceStats()).toEqual({ total: 0, online: 0, offline: 0, banned: 0 });
	});
});

describe('what waits for someone', () => {
	test('only help requests nobody has taken count', async () => {
		answer({
			success: true,
			requests: [{ status: 'pending' }, { status: 'accepted' }, { status: 'pending' }, { status: 'resolved' }]
		});
		expect(await countOpenHelpRequests()).toBe(2);
		answer({ success: true, requests: null });
		expect(await countOpenHelpRequests()).toBe(0);
	});

	test('pending agents: ID and host name', async () => {
		answer({
			success: true,
			data: [{ device_id: 'A1B2C3', hostname: 'reception', extra: 1 }, { device_id: 7 }]
		});
		expect(await listPendingAgents()).toEqual([
			{ device_id: 'A1B2C3', hostname: 'reception' },
			{ device_id: '7', hostname: '' }
		]);
	});
});

describe('client values', () => {
	const config = v.parse(ClientConfig, {
		server_id: "desk.example.com'; Remove-Item C:\\ -Recurse; '",
		relay_server: 'desk.example.com',
		api_url: 'http://desk.example.com:21121',
		public_key: 'QP6vEurD0QqCk/8xawwa90CQ7tStDiywWJ2J2as5U5g=',
		deploy_config_string: 'abc',
		config_uri: 'rustdesk://config/abc',
		client_server_host: 'desk.example.com',
		env_override_active: null
	});

	test('missing flags and text become false and empty', () => {
		expect(config.env_override_active).toBe(false);
		expect(config.phone_unreachable_host).toBe(false);
		expect(v.parse(ClientConfig, {}).public_key).toBe('');
	});

	test('"Copy all" puts one labelled line per value', () => {
		const text = configText({ ...config, server_id: 'desk.example.com' }, (k) => k.split('.').pop()!);
		expect(text.split('\n')).toEqual([
			'config_server_id: desk.example.com',
			'config_relay_server: desk.example.com',
			'config_api_server: http://desk.example.com:21121',
			'config_key: QP6vEurD0QqCk/8xawwa90CQ7tStDiywWJ2J2as5U5g='
		]);
		expect(configText(v.parse(ClientConfig, {}), (k) => k).split('\n')[3]).toBe('dashboard.config_key: -');
	});

	test('the install script quotes values for PowerShell', () => {
		const script = intuneScript(config);
		// A quote in a value is doubled, so it can't end the string
		expect(script).toContain("$ServerHost = 'desk.example.com''; Remove-Item C:\\ -Recurse; '''");
		expect(script).toContain("$PublicKey = 'QP6vEurD0QqCk/8xawwa90CQ7tStDiywWJ2J2as5U5g='");
		expect(script).toContain("$ApiUrl = 'http://desk.example.com:21121'");
		expect(intuneScript(null)).toContain("$ServerHost = 'YOUR_SERVER_HOST'");
	});

	test('the typed address lasts for this tab only', () => {
		expect(readClientHost()).toBe('');
		writeClientHost('10.0.0.5');
		expect(sessionStorage.getItem('bd_client_config_host')).toBe('10.0.0.5');
		expect(readClientHost()).toBe('10.0.0.5');
		writeClientHost('');
		expect(readClientHost()).toBe('');
		expect(localStorage.getItem('bd_client_config_host')).toBeNull();
	});
});

describe('support agent pairing code', () => {
	const code = (o: Record<string, unknown>) =>
		JSON.stringify({ type: 'betterdesk-agent-pairing', version: 1, device_id: ' 123456789 ', ...o });

	test('a code from the agent gives its device ID', () => {
		expect(readPairingCode(code({}), 'console.example.com')).toBe('123456789');
		expect(readPairingCode(code({ server: 'https://console.example.com/x' }), 'console.example.com')).toBe(
			'123456789'
		);
	});

	test('anything else is refused', () => {
		const host = 'console.example.com';
		expect(readPairingCode('not json', host)).toBeNull();
		expect(readPairingCode('"text"', host)).toBeNull();
		expect(readPairingCode(code({ type: 'other' }), host)).toBeNull();
		expect(readPairingCode(code({ version: 2 }), host)).toBeNull();
		expect(readPairingCode(code({ device_id: '   ' }), host)).toBeNull();
		expect(readPairingCode(code({ device_id: 42 }), host)).toBeNull();
		// A code made for another server
		expect(readPairingCode(code({ server: 'https://evil.example.com' }), host)).toBeNull();
		expect(readPairingCode(code({ server: 'not a url' }), host)).toBeNull();
		expect(readPairingCode(code({ server: 7 }), host)).toBeNull();
	});
});
