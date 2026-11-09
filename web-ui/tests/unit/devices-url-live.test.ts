import { describe, expect, test } from 'vitest';
import { applyStatuses, normaliseStatus, parseLiveMessage } from '../../src/lib/devices/live.ts';
import type { DeviceLike } from '../../src/lib/devices/model.ts';
import { panelToUrl, urlToPanel, withOpen } from '../../src/lib/devices/url.ts';

/**
 * A small model of the page: the URL's ?open=, the open panel, and a
 * history stack of entries (the list's own entries carry state). It runs
 * urlToPanel/panelToUrl the way +page.svelte does.
 */
function makePage(initialOpen: string | null) {
	const stack: { open: string | null; pushed: boolean }[] = [{ open: initialOpen, pushed: false }];
	let at = 0;
	let panel: string | null = null;
	const entry = () => stack[at]!;
	const onUrl = () => {
		const step = urlToPanel(entry().open, panel);
		if (step?.do === 'open') panel = step.id;
		else if (step?.do === 'close') panel = null;
	};
	const onPanel = () => {
		const step = panelToUrl(entry().open, panel, entry().pushed);
		if (!step) return;
		if (step.do === 'push') {
			stack.splice(at + 1);
			stack.push({ open: step.id, pushed: true });
			at++;
		} else if (step.do === 'replace') stack[at] = { open: step.id, pushed: entry().pushed && !!step.id };
		else back();
	};
	function back() {
		if (at === 0) return;
		at--;
		onUrl();
	}
	function forward() {
		if (at >= stack.length - 1) return;
		at++;
		onUrl();
	}
	onUrl();
	return {
		get url() {
			return entry().open;
		},
		get panel() {
			return panel;
		},
		get depth() {
			return stack.length;
		},
		open(id: string) {
			panel = id;
			onPanel();
		},
		close() {
			panel = null;
			onPanel();
		},
		back,
		forward
	};
}

describe('open device in the URL', () => {
	test('a link with ?open= opens the panel', () => {
		const p = makePage('900100001');
		expect(p.panel).toBe('900100001');
	});

	test('opening from the list adds an entry; Back closes, Forward opens again', () => {
		const p = makePage(null);
		p.open('A');
		expect(p.url).toBe('A');
		expect(p.depth).toBe(2);
		p.back();
		expect(p.panel).toBeNull();
		expect(p.url).toBeNull();
		p.forward();
		expect(p.panel).toBe('A');
	});

	test('closing the panel goes back over the entry the list added (no dead Back step)', () => {
		const p = makePage(null);
		p.open('A');
		p.close();
		expect(p.url).toBeNull();
		expect(p.panel).toBeNull();
		// The entry is still ahead (Forward reopens), not a second copy of the list behind
		p.forward();
		expect(p.panel).toBe('A');
	});

	test('closing a panel the page opened from a link takes ?open= out in place', () => {
		const p = makePage('A');
		p.close();
		expect(p.url).toBeNull();
		expect(p.depth).toBe(1);
	});

	test('another device while one is open replaces the entry', () => {
		const p = makePage(null);
		p.open('A');
		p.open('B');
		expect(p.url).toBe('B');
		expect(p.depth).toBe(2);
		p.back();
		expect(p.panel).toBeNull();
	});

	test('withOpen keeps the other parameters', () => {
		const u = withOpen({ href: 'http://x/app/devices?search=lab&status=online' }, '42');
		expect(u.searchParams.get('open')).toBe('42');
		expect(u.searchParams.get('search')).toBe('lab');
		expect(withOpen(u, null).search).toBe('?search=lab&status=online');
	});
});

describe('real-time status', () => {
	const devices: DeviceLike[] = [
		{ id: 'a', online: false, no_signal: false },
		{ id: 'b', online: true, no_signal: false },
		{ id: 'c', online: false, banned: true },
		{ id: 'd', online: false, soft_deleted: true }
	];

	test('reads the two messages the socket sends and nothing else', () => {
		expect(parseLiveMessage({ type: 'device_status', device_id: 'a', status: 'online' })).toEqual({
			kind: 'status',
			id: 'a',
			status: 'online'
		});
		expect(parseLiveMessage({ type: 'device_id_changed', old_id: 'a', new_id: 'z' })).toEqual({
			kind: 'id-changed',
			oldId: 'a',
			newId: 'z'
		});
		expect(parseLiveMessage({ type: 'help_request' })).toBeNull();
		expect(parseLiveMessage('hello')).toBeNull();
	});

	test('a batch changes only the devices it names, in new objects', () => {
		const next = applyStatuses(
			devices,
			new Map([
				['a', 'online'],
				['b', 'no_signal']
			])
		);
		expect(next).not.toBe(devices);
		expect(next[0]).toMatchObject({ id: 'a', online: true, no_signal: false });
		expect(next[1]).toMatchObject({ id: 'b', online: false, no_signal: true });
		expect(devices[0]!.online).toBe(false);
		expect(next[2]).toBe(devices[2]);
	});

	test('banned and deleted devices keep their state', () => {
		const next = applyStatuses(
			devices,
			new Map([
				['c', 'online'],
				['d', 'online']
			])
		);
		expect(next).toBe(devices);
	});

	test('nothing to change (unknown device, same state) keeps the same array', () => {
		expect(applyStatuses(devices, new Map([['zz', 'online']]))).toBe(devices);
		expect(applyStatuses(devices, new Map([['b', 'online']]))).toBe(devices);
		expect(applyStatuses(devices, new Map())).toBe(devices);
	});

	test('unknown status words count as offline', () => {
		expect(normaliseStatus('weird')).toBe('offline');
		expect(normaliseStatus('ONLINE')).toBe('online');
		const next = applyStatuses(devices, new Map([['b', 'weird']]));
		expect(next[1]).toMatchObject({ online: false });
	});
});
