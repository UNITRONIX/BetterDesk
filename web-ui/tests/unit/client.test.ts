import * as v from 'valibot';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	api,
	ApiError,
	clientMessages,
	request,
	setCsrfToken,
	setUnauthorizedHandler,
	wrapped,
	BoolLike,
	Text
} from '../../src/lib/api/client.ts';

type Call = { url: string; init: RequestInit };
let calls: Call[];
let replies: (() => Response | Promise<Response>)[];

function json(body: unknown, status = 200, extra: Partial<Response> = {}): Response {
	const res = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	return Object.assign(res, extra);
}

beforeEach(() => {
	calls = [];
	replies = [];
	vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
		calls.push({ url, init });
		const next = replies.shift();
		if (!next) throw new Error('no reply queued');
		return Promise.resolve(next());
	});
	vi.useFakeTimers({ shouldAdvanceTime: true });
	setCsrfToken('tok-1');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('request', () => {
	test('sends the CSRF token on writes, never on reads', async () => {
		replies.push(
			() => json({ ok: 1 }),
			() => json({ ok: 2 })
		);
		await request('/api/x');
		await request('/api/x', { method: 'POST', body: { a: 1 } });
		const h0 = calls[0]!.init.headers as Record<string, string>;
		const h1 = calls[1]!.init.headers as Record<string, string>;
		expect(h0['X-CSRF-Token']).toBeUndefined();
		expect(h1['X-CSRF-Token']).toBe('tok-1');
		expect(h1['Content-Type']).toBe('application/json');
		expect(calls[1]!.init.body).toBe('{"a":1}');
	});

	test('POST without a body still sends JSON (Express answers 415 otherwise)', async () => {
		replies.push(() => json({}));
		await request('/api/x/do', { method: 'POST' });
		expect(calls[0]!.init.body).toBe('{}');
	});

	test('keepalive lets a write finish while the page is left', async () => {
		replies.push(
			() => json({}),
			() => json({})
		);
		await request('/api/x/read', { method: 'POST', keepalive: true });
		await request('/api/x/other', { method: 'POST' });
		expect(calls[0]!.init.keepalive).toBe(true);
		expect(calls[1]!.init.keepalive).toBe(false);
	});

	test('refuses other origins and protocol-relative paths', async () => {
		await expect(request('//evil.example/api')).rejects.toBeInstanceOf(ApiError);
		await expect(request('https://evil.example/api')).rejects.toBeInstanceOf(ApiError);
		expect(calls).toHaveLength(0);
	});

	test('adds query parameters and drops empty ones', async () => {
		replies.push(() => json([]));
		await request('/api/devices', { query: { q: 'a b', page: 2, empty: '', none: null } });
		expect(calls[0]!.url).toBe('/api/devices?q=a+b&page=2');
	});

	test('403 becomes a plain sentence and keeps the permission key', async () => {
		replies.push(() => json({ success: false, error: 'Permission denied: device.ban' }, 403));
		const err = await request('/api/devices/1/ban', { method: 'POST' }).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect((err as ApiError).message).toBe(clientMessages.permission);
		expect((err as ApiError).permission).toBe('device.ban');
		expect((err as ApiError).isPermission).toBe(true);
	});

	test('401 calls the sign-in handler with the reason', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		replies.push(() => json({ success: false, code: 'session_idle' }, 401));
		await expect(request('/api/x')).rejects.toMatchObject({ status: 401 });
		expect(handler).toHaveBeenCalledWith('session_idle');
	});

	test('a redirect to the login page counts as signed out', async () => {
		const handler = vi.fn();
		setUnauthorizedHandler(handler);
		replies.push(() => {
			const r = new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
			Object.defineProperty(r, 'redirected', { value: true });
			Object.defineProperty(r, 'url', { value: location.origin + '/login?expired=1' });
			return r;
		});
		await expect(request('/api/inventory')).rejects.toMatchObject({ status: 401 });
		expect(handler).toHaveBeenCalled();
	});

	test('retries reads on 503 but never writes', async () => {
		replies.push(
			() => json({}, 503),
			() => json({ ok: true })
		);
		await expect(request('/api/x')).resolves.toEqual({ ok: true });
		expect(calls).toHaveLength(2);
		calls = [];
		replies.push(() => json({ error: 'busy' }, 503));
		await expect(request('/api/x', { method: 'POST' })).rejects.toMatchObject({
			status: 503,
			message: 'busy'
		});
		expect(calls).toHaveLength(1);
	});

	test('network failure after retries is a network error', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
		const err = (await request('/api/x').catch((e: unknown) => e)) as ApiError;
		expect(err.isNetwork).toBe(true);
		expect(err.message).toBe(clientMessages.network);
	});

	test('a body cut off on the way is a network failure (reads retry), not an empty answer', async () => {
		const cutOff = () =>
			Object.assign(json({ ok: true }), { text: () => Promise.reject(new TypeError('NetworkError')) });
		replies.push(cutOff, () => json({ devices: [] }));
		await expect(request('/api/devices')).resolves.toEqual({ devices: [] });
		expect(calls).toHaveLength(2);

		replies.push(cutOff);
		const err = (await request('/api/x/do', { method: 'POST' }).catch((e: unknown) => e)) as ApiError;
		expect(err.isNetwork).toBe(true);
	});

	test('an empty or broken JSON body is no data', async () => {
		replies.push(
			() => new Response('', { status: 200, headers: { 'content-type': 'application/json' } }),
			() => new Response('{"cut', { status: 200, headers: { 'content-type': 'application/json' } })
		);
		expect(await request('/api/x')).toBeNull();
		expect(await request('/api/y')).toBeNull();
	});

	test('server error text is passed through', async () => {
		replies.push(() => json({ success: false, error: 'Device not found' }, 404));
		await expect(request('/api/devices/9')).rejects.toMatchObject({
			message: 'Device not found',
			status: 404
		});
	});
});

describe('api with a schema', () => {
	const Device = v.object({ id: v.string(), online: BoolLike, note: Text });

	test('returns checked and normalised data', async () => {
		replies.push(() => json({ success: true, data: { id: '9001', online: 1, note: null } }));
		const d = await api(wrapped(Device), '/api/devices/9001');
		expect(d).toEqual({ id: '9001', online: true, note: '' });
	});

	test('an unexpected shape is an error, not a crash later', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		replies.push(() => json({ success: true, data: { id: 5 } }));
		await expect(api(wrapped(Device), '/api/devices/5')).rejects.toMatchObject({ code: 'invalid_response' });
		expect(spy).toHaveBeenCalled();
	});
});
