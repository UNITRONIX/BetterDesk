/**
 * The typed edge around the wrapped remote client: scripts load once, in
 * the old viewer's order, and the dev mock device's script loads only when
 * the viewer data has the mock on (the server sets it only with
 * BD_DEV_MOCK_REMOTE=1 and ?mock=1).
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

type Mod = typeof import('../../../src/lib/remote/rdclient.ts');

async function fresh(): Promise<Mod> {
	vi.resetModules();
	document.head.innerHTML = '';
	for (const k of [
		'__mockRemote',
		'MockRemoteSession',
		'RDClient',
		'CDAPSession',
		'MeshSession',
		'RemoteTargetSession'
	])
		Reflect.deleteProperty(window, k);
	return import('../../../src/lib/remote/rdclient.ts');
}

function loadAll() {
	for (const el of document.head.querySelectorAll<HTMLScriptElement>('script[data-rdclient]'))
		el.onload?.(new Event('load'));
}

const caps = { transport: 'rd' };

describe('loading the remote client', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
	});

	test('adds the scripts in the old order, ordered execution, once', async () => {
		const m = await fresh();
		const p = m.loadRdClient({
			deviceId: '900100012',
			capabilities: caps,
			guestToken: '',
			csrfToken: 't',
			mock: null
		});
		const scripts = [...document.head.querySelectorAll<HTMLScriptElement>('script[data-rdclient]')];
		expect(scripts.map((s) => new URL(s.src).pathname.replace(/^.*\/rdclient\//, ''))).toEqual([
			...m.RDCLIENT_SCRIPTS
		]);
		expect(scripts.every((s) => s.async === false)).toBe(true);
		loadAll();
		await p;
		// A second viewer on the page reuses the loaded scripts
		await m.loadRdClient({
			deviceId: '900100013',
			capabilities: caps,
			guestToken: '',
			csrfToken: 't',
			mock: null
		});
		expect(document.head.querySelectorAll('script[data-rdclient]')).toHaveLength(m.RDCLIENT_SCRIPTS.length);
		expect((window as unknown as { __initialDeviceId: string }).__initialDeviceId).toBe('900100013');
	});

	test('never loads the dev mock unless the viewer data turned it on', async () => {
		const m = await fresh();
		void m.loadRdClient({
			deviceId: '900100012',
			capabilities: caps,
			guestToken: '',
			csrfToken: '',
			mock: null
		});
		expect(document.head.querySelector(`script[src="${m.MOCK_SCRIPT}"]`)).toBeNull();
		expect((window as unknown as { __mockRemote: unknown }).__mockRemote).toBeNull();

		const m2 = await fresh();
		void m2.loadRdClient({
			deviceId: '900100012',
			capabilities: caps,
			guestToken: '',
			csrfToken: '',
			mock: { scenario: 'refused' }
		});
		const all = [...document.head.querySelectorAll<HTMLScriptElement>('script[data-rdclient]')];
		expect(all.at(-1)?.getAttribute('src')).toBe('/dev/mock-remote.js');
		expect((window as unknown as { __mockRemote: unknown }).__mockRemote).toEqual({ scenario: 'refused' });
	});

	test('a failed script lets the next attempt start over', async () => {
		const m = await fresh();
		const p = m.loadRdClient({
			deviceId: 'x01',
			capabilities: caps,
			guestToken: '',
			csrfToken: '',
			mock: null
		});
		document.head.querySelector<HTMLScriptElement>('script[data-rdclient]')?.onerror?.(new Event('error'));
		await expect(p).rejects.toThrow(/Could not load/);
		expect(document.head.querySelectorAll('script[data-rdclient]')).toHaveLength(0);
	});

	test('the mock replaces every transport only when it is on; otherwise the transport picks the client', async () => {
		const m = await fresh();
		const made: string[] = [];
		/** A constructor that records which client was made */
		const ctor = (name: string) =>
			function Client() {
				made.push(name);
			};
		const w = window as unknown as Record<string, unknown>;
		w.RDClient = ctor('rd');
		w.CDAPSession = ctor('cdap');
		w.MeshSession = ctor('mesh');
		w.RemoteTargetSession = ctor('target');
		w.MockRemoteSession = ctor('mock');
		const canvas = document.createElement('canvas');
		const opts = {} as Parameters<Mod['createClient']>[1];
		m.createClient(canvas, opts, 'rd');
		m.createClient(canvas, opts, 'cdap');
		m.createClient(canvas, opts, 'mesh');
		m.createClient(canvas, opts, 'rdp');
		// The script is there but the server did not turn the mock on
		w.__mockRemote = null;
		m.createClient(canvas, opts, 'rd');
		w.__mockRemote = { scenario: 'ok' };
		m.createClient(canvas, opts, 'cdap');
		expect(made).toEqual(['rd', 'cdap', 'mesh', 'target', 'rd', 'mock']);
	});
});
