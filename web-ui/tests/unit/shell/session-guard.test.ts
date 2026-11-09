import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const assign = vi.fn();

beforeEach(() => {
	vi.resetModules();
	assign.mockReset();
	localStorage.clear();
	vi.stubGlobal('location', {
		pathname: '/app/devices',
		search: '?open=900100001',
		origin: 'http://localhost',
		href: 'http://localhost/app/devices?open=900100001',
		assign
	});
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
	vi.useFakeTimers();
});

afterEach(async () => {
	const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
	g.stopGuard();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('session guard', () => {
	test('another tab ending the session sends this one to sign-in, with the way back', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		g.startGuard(null);
		window.dispatchEvent(new StorageEvent('storage', { key: g.EXPIRED_KEY, newValue: '{"at":1}' }));
		expect(assign).toHaveBeenCalledTimes(1);
		const url = new URL(assign.mock.calls[0]![0] as string, 'http://localhost');
		expect(url.pathname).toBe('/login');
		expect(url.searchParams.get('expired')).toBe('1');
		expect(url.searchParams.get('return')).toBe('/app/devices?open=900100001');
	});

	test('other storage keys do nothing', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		g.startGuard(null);
		window.dispatchEvent(new StorageEvent('storage', { key: 'bd-theme-choice', newValue: 'dark' }));
		expect(assign).not.toHaveBeenCalled();
	});

	test('ending the session here tells the other tabs (old key and channel)', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		g.startGuard(null);
		const received: unknown[] = [];
		const other = typeof BroadcastChannel === 'function' ? new BroadcastChannel(g.CHANNEL) : null;
		if (other) other.onmessage = (e) => received.push(e.data);
		g.broadcastExpired('logout');
		expect(JSON.parse(localStorage.getItem('betterdesk.session.expired')!)).toMatchObject({ code: 'logout' });
		if (other) {
			await vi.waitFor(() => expect(received).toEqual([{ type: 'expired', code: 'logout' }]), {
				timeout: 1000
			});
			other.close();
		}
	});

	test('a 401 anywhere goes to sign-in once and tells the other tabs', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		const client = await import('../../../src/lib/api/client.ts');
		g.startGuard(null);
		// A fresh response per request, as fetch gives (a body can be read once)
		vi.mocked(fetch).mockImplementation(() =>
			Promise.resolve(
				new Response('{"code":"session_idle"}', {
					status: 401,
					headers: { 'Content-Type': 'application/json' }
				})
			)
		);
		await expect(client.request('/api/x')).rejects.toMatchObject({ status: 401 });
		await expect(client.request('/api/y')).rejects.toMatchObject({ status: 401 });
		expect(assign).toHaveBeenCalledTimes(1);
		expect(new URL(assign.mock.calls[0]![0] as string, 'http://localhost').searchParams.get('reason')).toBe(
			'session_idle'
		);
		expect(localStorage.getItem('betterdesk.session.expired')).toContain('session_idle');
	});

	test('activity here reaches the server at most once a minute, the last one late', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		g.startGuard({ idleTimeoutMs: 30 * 60_000, warnBeforeMs: 60_000 });
		vi.mocked(fetch).mockClear();
		vi.mocked(fetch).mockImplementation(() =>
			Promise.resolve(new Response('{"success":true}', { headers: { 'Content-Type': 'application/json' } }))
		);
		const pings = () =>
			vi
				.mocked(fetch)
				.mock.calls.filter(([url]) => String(url).startsWith('/api/auth/verify'))
				.map(([, init]) => (init?.headers as Record<string, string>)['X-BD-Background']);
		// Loading the page counted on the server; a key right away doesn't ping
		document.dispatchEvent(new Event('keydown'));
		expect(pings()).toEqual([]);
		await vi.advanceTimersByTimeAsync(61_000);
		// The key press reaches the server when the minute is over, as activity
		expect(pings()).toEqual([undefined]);
		await vi.advanceTimersByTimeAsync(5 * 60_000);
		// No more activity: only the 5-minute sync, which doesn't count
		expect(pings()).toEqual([undefined, '1']);
		document.dispatchEvent(new Event('mousedown'));
		expect(pings()).toEqual([undefined, '1', undefined]);
	});

	test('idle: a warning before the timeout, hidden again by any activity', async () => {
		const g = await import('../../../src/lib/shell/session-guard.svelte.ts');
		g.startGuard({ idleTimeoutMs: 120_000, warnBeforeMs: 30_000 });
		await vi.advanceTimersByTimeAsync(89_000);
		expect(g.guard.warning).toBeNull();
		await vi.advanceTimersByTimeAsync(1_500);
		expect(g.guard.warning).toBe(30);
		document.dispatchEvent(new Event('keydown'));
		expect(g.guard.warning).toBeNull();
	});
});
