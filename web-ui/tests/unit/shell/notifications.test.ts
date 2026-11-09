import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setCsrfToken, setUnauthorizedHandler } from '../../../src/lib/api/client.ts';
import {
	POLL_MS,
	describe as describeRow,
	markAllRead,
	markRead,
	notifications,
	onPanelEvent,
	resetNotifications,
	startNotifications
} from '../../../src/lib/shell/notifications.svelte.ts';
import type { Notification } from '../../../src/lib/shell/api.ts';

let hidden = false;
let status = 200;
const fetchMock = vi.fn();

function json(body: unknown, code = 200): Response {
	return new Response(JSON.stringify(body), {
		status: code,
		headers: { 'Content-Type': 'application/json' }
	});
}

const ITEMS = [
	{
		id: 'registration:lan:13',
		kind: 'registration',
		title: 'demo-lan-printer-pc',
		message: '900300001 · Windows · 10.0.9.14',
		link: '/registrations',
		read: false,
		created_at: '2026-11-08T18:24:40.000Z',
		device_id: '900300001',
		hostname: 'demo-lan-printer-pc'
	},
	{
		id: 29,
		kind: 'help_request',
		title: 'demo-reception-01',
		message: 'Printer',
		read: 1,
		created_at: '2026-11-08T17:00:00Z'
	}
];

const listCalls = () =>
	fetchMock.mock.calls.filter(([url]) => String(url).startsWith('/api/bd/notifications?')).length;

beforeEach(() => {
	hidden = false;
	status = 200;
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => (hidden ? 'hidden' : 'visible')
	});
	vi.useFakeTimers();
	fetchMock.mockReset();
	fetchMock.mockImplementation(async (url: string) => {
		if (status !== 200)
			return json({ success: false, error: 'Unauthorized', code: 'session_required' }, status);
		if (url.startsWith('/api/bd/notifications?'))
			return json({ success: true, items: ITEMS, unread_count: 7 });
		return json({ success: true });
	});
	vi.stubGlobal('fetch', fetchMock);
	setUnauthorizedHandler(() => {});
	resetNotifications();
});

afterEach(() => {
	resetNotifications();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function setHidden(h: boolean) {
	hidden = h;
	document.dispatchEvent(new Event('visibilitychange'));
}

describe('polling', () => {
	test('loads at start and every 30 s; the count is the server’s', async () => {
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		expect(listCalls()).toBe(1);
		expect(fetchMock.mock.calls[0]![0]).toBe('/api/bd/notifications?limit=10');
		expect(notifications.unread).toBe(7);
		expect(notifications.items.map((i) => i.id)).toEqual(['registration:lan:13', '29']);
		expect(notifications.items[1]!.read).toBe(true);
		await vi.advanceTimersByTimeAsync(POLL_MS * 2);
		expect(listCalls()).toBe(3);
	});

	test('makes no requests while the tab is hidden, and loads when it is shown', async () => {
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		setHidden(true);
		await vi.advanceTimersByTimeAsync(POLL_MS * 5);
		expect(listCalls()).toBe(1);
		setHidden(false);
		await vi.advanceTimersByTimeAsync(0);
		expect(listCalls()).toBe(2);
	});

	test('stops after a 401 (the sign-in page takes over)', async () => {
		const signedOut = vi.fn();
		setUnauthorizedHandler(signedOut);
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		status = 401;
		await vi.advanceTimersByTimeAsync(POLL_MS);
		expect(listCalls()).toBe(2);
		expect(signedOut).toHaveBeenCalledWith('session_required');
		expect(notifications.failed).toBe(true);
		await vi.advanceTimersByTimeAsync(POLL_MS * 20);
		setHidden(true);
		setHidden(false);
		await vi.advanceTimersByTimeAsync(POLL_MS * 2);
		expect(listCalls()).toBe(2);
	});
});

describe('read state', () => {
	test('mark one read: POST with the CSRF token, one fewer unread', async () => {
		setCsrfToken('tok-123');
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		await markRead('registration:lan:13');
		const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/read'))!;
		expect(call[0]).toBe('/api/bd/notifications/registration%3Alan%3A13/read');
		expect(call[1]).toMatchObject({
			method: 'POST',
			headers: expect.objectContaining({ 'X-CSRF-Token': 'tok-123' })
		});
		expect(notifications.unread).toBe(6);
		expect(notifications.items[0]!.read).toBe(true);
		// Already read: no request
		fetchMock.mockClear();
		await markRead('registration:lan:13');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test('mark all read', async () => {
		setCsrfToken('tok-123');
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		await markAllRead();
		const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/bd/notifications/read-all')!;
		expect(call[1]).toMatchObject({
			method: 'POST',
			headers: expect.objectContaining({ 'X-CSRF-Token': 'tok-123' })
		});
		expect(notifications.unread).toBe(0);
		expect(notifications.items.every((i) => i.read)).toBe(true);
	});
});

describe('panel events', () => {
	test('a new help request goes on top as unread; a status change reloads instead', async () => {
		startNotifications();
		await vi.advanceTimersByTimeAsync(0);
		onPanelEvent({
			type: 'help_request',
			id: 77,
			hostname: 'kiosk',
			device_id: '900100020',
			message: 'Help',
			status: 'pending'
		});
		expect(notifications.items[0]).toMatchObject({
			id: '77',
			hostname: 'kiosk',
			read: false,
			link: '/help-requests'
		});
		expect(notifications.unread).toBe(8);
		// The same request again does not count twice
		onPanelEvent({ type: 'help_request', id: 77, hostname: 'kiosk', status: 'open' });
		expect(notifications.unread).toBe(8);
		const before = listCalls();
		onPanelEvent({ type: 'help_request', id: 77, status: 'resolved' });
		await vi.advanceTimersByTimeAsync(0);
		expect(listCalls()).toBe(before + 1);
		onPanelEvent({ type: 'registration_pending' });
		await vi.advanceTimersByTimeAsync(0);
		expect(listCalls()).toBe(before + 2);
	});
});

describe('rows', () => {
	const base: Notification = {
		id: '1',
		kind: '',
		title: '',
		hostname: '',
		device_id: '',
		platform: '',
		ip: '',
		message: '',
		link: '',
		status: '',
		read: false,
		created_at: ''
	};

	test('a registration splits its message into platform and address, without dot separators', () => {
		const v = describeRow({
			...base,
			id: 'registration:lan:1',
			title: 'pc',
			device_id: '9001',
			message: '9001 · Windows · 10.0.0.5'
		});
		expect(v).toMatchObject({
			isRegistration: true,
			name: 'pc',
			platform: 'Windows',
			detail: 'Windows, 10.0.0.5'
		});
		expect(v.link).toBe('/registrations');
	});

	test('links from the server stay inside the console', () => {
		expect(describeRow({ ...base, link: 'javascript:alert(1)' }).link).toBe('/help-requests');
		expect(describeRow({ ...base, link: '//evil.example/x' }).link).toBe('/help-requests');
		expect(describeRow({ ...base, link: '/help-requests?id=3' }).link).toBe('/help-requests?id=3');
	});
});
