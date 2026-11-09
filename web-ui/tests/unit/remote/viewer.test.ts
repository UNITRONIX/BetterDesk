/**
 * The viewer's sessions with a fake transport client: the connecting steps,
 * the password prompt, streaming, the ways a session ends or fails, cancel,
 * reconnect (a new client; the old one's late events are ignored), tabs and
 * the guest allowlist.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushSync } from 'svelte';

type Listener = (...args: unknown[]) => void;

class FakeClient {
	static made: FakeClient[] = [];
	listeners = new Map<string, Listener[]>();
	disconnected = false;
	viewOnly = false;
	renderer = { resize: vi.fn() };
	sent: string[] = [];
	_state = 'idle';
	constructor(
		public canvas: HTMLCanvasElement,
		public opts: Record<string, unknown>
	) {
		FakeClient.made.push(this);
	}
	on(ev: string, fn: Listener) {
		this.listeners.set(ev, [...(this.listeners.get(ev) ?? []), fn]);
	}
	emit(ev: string, ...args: unknown[]) {
		for (const fn of this.listeners.get(ev) ?? []) fn(...args);
	}
	connect = vi.fn(async () => {});
	disconnect = vi.fn(() => {
		this.disconnected = true;
	});
	authenticate = vi.fn();
	submit2FA = vi.fn();
	sendChat = vi.fn((t: string) => this.sent.push(t));
	sendCtrlAltDel = vi.fn();
	setAudioMuted = vi.fn();
	setSessionActive = vi.fn();
	setQualityPreset = vi.fn();
	setScaleMode = vi.fn();
	setCodec = vi.fn();
	setBlockInput = vi.fn();
	setViewOnly = vi.fn();
	getMonitors = () => [];
	switchMonitor = vi.fn();
	toggleVirtualDisplay = vi.fn();
	selectWindowsSession = vi.fn();
}

vi.mock('../../../src/lib/remote/rdclient.ts', () => ({
	createClient: (canvas: HTMLCanvasElement, opts: Record<string, unknown>) => new FakeClient(canvas, opts),
	fileSheet: () => null,
	touchInput: () => null,
	videoDecodingSupported: () => true
}));
vi.mock('../../../src/lib/api/devices.ts', () => ({ getDevice: vi.fn(async () => ({})) }));
vi.mock('../../../src/lib/api/remote.ts', () => ({
	acceptCertificate: vi.fn(),
	getBillingCheck: vi.fn(async () => null),
	getConnectPassword: vi.fn(async () => ''),
	getPendingBillingSession: vi.fn(async () => null),
	submitWorkReport: vi.fn()
}));

const { Viewer } = await import('../../../src/lib/remote/viewer.svelte.ts');
type ViewerData = ConstructorParameters<typeof Viewer>[0]['data'];

function data(extra: Partial<ViewerData> = {}): ViewerData {
	return {
		success: true,
		deviceId: '900100012',
		device: { name: 'demo-build-server', platform: 'Ubuntu 24.04' },
		capabilities: { transport: 'rd' },
		serverPubKey: 'KEY',
		connection: null,
		guestToken: '',
		mockRemote: null,
		user: { id: 1, name: 'demo_ui_admin' },
		csrfToken: '',
		...extra
	} as ViewerData;
}

function setup(d = data()) {
	const leave = vi.fn();
	const v = new Viewer({ data: d, onleave: leave });
	v.open(d.deviceId, d.device.name, d.device.platform);
	const s = v.sessions[0]!;
	v.attach(s, document.createElement('canvas'));
	return { v, s, c: FakeClient.made.at(-1)!, leave };
}

beforeEach(() => {
	FakeClient.made = [];
	vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('remote viewer sessions', () => {
	test('connects with the server key and the account name, then walks the steps', () => {
		const { s, c } = setup();
		expect(c.connect).toHaveBeenCalled();
		expect(c.opts).toMatchObject({ deviceId: '900100012', serverPubKey: 'KEY', myName: 'demo_ui_admin' });
		expect(s.view).toBe('connecting');
		expect(s.stepId).toBe('find');
		c.emit('log', 'Requesting relay (uuid: x)...');
		expect(s.stepId).toBe('route');
		expect(s.statusText).toBe('Setting up the connection through the relay server.');
		// Steps never go back
		c.emit('log', 'Connecting to rendezvous server...');
		expect(s.stepId).toBe('route');
		c.emit('state', 'waiting_password');
		expect(s.stepId).toBe('accept');
	});

	test('a long wait on one step shows what may be wrong', () => {
		const { s, c } = setup();
		c.emit('state', 'waiting_password');
		expect(s.slowHint).toBe('');
		vi.advanceTimersByTime(8000);
		expect(s.slowHint).toMatch(/may be asleep, or someone has to accept/);
	});

	test('password prompt, sign-in, then the picture', () => {
		const { s, c } = setup();
		c.emit('password_required');
		expect(s.view).toBe('password');
		s.password = 'demo';
		c.emit('login_error', 'Wrong Password');
		expect(s.loginError).toBe('That password was not accepted. Check it and try again.');
		expect(s.password).toBe('');
		c.emit('login_success');
		expect(s.view).toBe('connecting');
		expect(s.stepId).toBe('screen');
		c.emit('state', 'streaming');
		c.emit('session_start');
		expect(s.view).toBe('streaming');
		expect(s.everStreamed).toBe(true);
		expect(c.setSessionActive).toHaveBeenLastCalledWith(true);
	});

	test('a failure says what happened and keeps the details', () => {
		const { s, c } = setup();
		c.emit('error', 'Connection refused: Device offline');
		expect(s.view).toBe('failed');
		expect(s.statusText).toBe('demo-build-server is offline.');
		expect(s.tryText).toMatch(/Turn it on or wake it up/);
		expect(s.endInfo?.reason).toBe('Connection refused: Device offline');
	});

	test('a drop after the picture is a drop, not "closed before it answered"', () => {
		const { s, c } = setup();
		c.emit('state', 'streaming');
		c.emit('disconnected', 'Relay connection closed (WebSocket 1006)', { closeCode: 1006 });
		expect(s.view).toBe('failed');
		expect(s.outcomeKind).toBe('dropped');
	});

	test('Disconnect ends the session by you; Cancel while connecting says so', () => {
		const a = setup();
		a.c.emit('state', 'streaming');
		a.v.disconnect();
		expect(a.c.disconnected).toBe(true);
		a.c.emit('state', 'disconnected');
		vi.advanceTimersByTime(1);
		expect(a.s.view).toBe('ended');
		expect(a.s.statusText).toBe('You ended the session with demo-build-server.');

		const b = setup();
		b.v.cancel(b.s);
		expect(b.s.view).toBe('ended');
		expect(b.s.statusText).toBe('You cancelled the connection.');
	});

	test('Reconnect starts a new client; the old one cannot change the screen any more', () => {
		const { v, s, c } = setup();
		c.emit('error', 'timeout');
		v.reconnect(s);
		const next = FakeClient.made.at(-1)!;
		expect(next).not.toBe(c);
		expect(c.disconnected).toBe(true);
		expect(s.view).toBe('connecting');
		c.emit('error', 'Connection refused: Device offline');
		expect(s.view).toBe('connecting');
		next.emit('session_start');
		expect(s.view).toBe('streaming');
	});

	test('tabs: one per device, closing the last leaves the viewer', () => {
		const { v, leave } = setup();
		v.open('900100001');
		expect(v.sessions.map((x) => x.deviceId)).toEqual(['900100012', '900100001']);
		expect(v.activeId).toBe('900100001');
		v.open('900100012');
		expect(v.sessions).toHaveLength(2);
		expect(v.activeId).toBe('900100012');
		v.close('900100012');
		expect(v.activeId).toBe('900100001');
		expect(leave).not.toHaveBeenCalled();
		v.close('900100001');
		expect(leave).toHaveBeenCalledOnce();
	});

	test('a guest link opens only its own devices', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { v } = setup(
			data({ capabilities: { transport: 'rd', guest_access: true, guest_peer_ids: ['900100012'] } })
		);
		v.open('900100001');
		expect(v.sessions.map((x) => x.deviceId)).toEqual(['900100012']);
		expect(warn).toHaveBeenCalled();
	});

	test('chat goes to the device and replies show in the session', () => {
		const { v, s, c } = setup();
		expect(v.sendChat(s, '  hello ')).toBe(true);
		expect(c.sent).toEqual(['hello']);
		c.emit('chat', 'hi back');
		flushSync();
		expect(s.chat.map((m) => [m.type, m.text])).toEqual([
			['sent', 'hello'],
			['received', 'hi back']
		]);
		expect(v.sendChat(s, '   ')).toBe(false);
	});

	test('settings go to the client and stay the default for the account', () => {
		const { v, s, c } = setup();
		v.setPref('quality', 'Low');
		expect(c.setQualityPreset).toHaveBeenCalledWith('speed');
		expect(s.prefs.quality).toBe('Low');
		v.setToggle('blockInput', true);
		expect(c.setBlockInput).toHaveBeenCalledWith(true);
		expect(s.toggles.blockInput).toBe(true);
	});
});
