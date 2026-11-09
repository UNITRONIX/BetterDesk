import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	addFromHash,
	guestTokenFromSearch,
	isDeviceId,
	isGuestMode,
	peerAllowed,
	transportOf
} from '../../../src/lib/remote/access.ts';
import {
	ALL,
	chooseScope,
	countDevices,
	deviceMatchesGroup,
	deviceStatus,
	filterDevices,
	folderIdsEqual,
	normalizeTags,
	readQuickId,
	scopeTitle,
	type BookDevice
} from '../../../src/lib/remote/address-book.ts';
import { safeRemoteReturn, splitBase, totpDigits } from '../../../src/lib/remote/login.ts';
import {
	DEFAULT_PREFS,
	fpsForMode,
	loadPrefs,
	prefsKey,
	presetForQuality,
	sanitizePrefs,
	savePrefs
} from '../../../src/lib/remote/prefs.ts';

describe('who may open which session', () => {
	test('device IDs as the server accepts them', () => {
		expect(isDeviceId('900100012')).toBe(true);
		expect(isDeviceId('rt_abc')).toBe(true);
		expect(isDeviceId('ab')).toBe(false);
		expect(isDeviceId('<img>')).toBe(false);
		expect(isDeviceId('a'.repeat(65))).toBe(false);
	});

	test('transport from the server, RustDesk otherwise', () => {
		expect(transportOf({ transport: 'CDAP' })).toBe('cdap');
		expect(transportOf({ transport: 'rdp' })).toBe('rdp');
		expect(transportOf({ transport: 'ssh' })).toBe('rd');
		expect(transportOf(null)).toBe('rd');
	});

	test('a guest opens only the devices of the link; a mesh share only its device', () => {
		const guest = { transport: 'rd', guest_access: true, guest_peer_ids: ['A01', 'B02'] };
		expect(isGuestMode(guest)).toBe(true);
		expect(peerAllowed(guest, 'A01', 'B02')).toBe(true);
		expect(peerAllowed(guest, 'A01', 'C03')).toBe(false);
		const share = { transport: 'mesh', mesh_share: true };
		expect(peerAllowed(share, 'M01', 'M01')).toBe(true);
		expect(peerAllowed(share, 'M01', 'M02')).toBe(false);
		// A guest grant without devices allows nothing
		expect(peerAllowed({ transport: 'rd', guest_access: true }, 'A01', 'A01')).toBe(false);
		// Console sessions: the server decides
		expect(peerAllowed({ transport: 'rd' }, 'A01', 'Z99')).toBe(true);
	});

	test('#add=<id> and the guest token in the address', () => {
		expect(addFromHash('#add=900100001')).toBe('900100001');
		expect(addFromHash('#add=<x>')).toBeNull();
		expect(guestTokenFromSearch('?guest=abc')).toBe('abc');
		expect(guestTokenFromSearch('?t=xyz&mock=1')).toBe('xyz');
		expect(guestTokenFromSearch('')).toBe('');
	});
});

describe('viewer preferences', () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => vi.useRealTimers());

	test('only known values survive', () => {
		expect(
			sanitizePrefs({ quality: 'Ultra', scale: '1:1', fpsMode: '60', backgroundFps: 9, keyboardMode: 'Map' })
		).toEqual({
			...DEFAULT_PREFS,
			scale: '1:1',
			fpsMode: '60',
			keyboardMode: 'Map'
		});
		expect(sanitizePrefs('nope')).toEqual(DEFAULT_PREFS);
	});

	test('per account, under the key the old viewer used, written once after a run of changes', () => {
		vi.useFakeTimers();
		savePrefs(7, { ...DEFAULT_PREFS, quality: 'Low' });
		savePrefs(7, { ...DEFAULT_PREFS, quality: 'Balanced' });
		expect(localStorage.getItem(prefsKey(7))).toBeNull();
		vi.advanceTimersByTime(400);
		expect(prefsKey(7)).toBe('betterdesk_remote_prefs_7');
		expect(loadPrefs(7).quality).toBe('Balanced');
		expect(loadPrefs(8).quality).toBe('Best');
	});

	test('quality presets and frame rates', () => {
		expect(presetForQuality('Low')).toBe('speed');
		expect(presetForQuality('x')).toBe('balanced');
		expect(fpsForMode('adaptive', 'Low')).toBe(60);
		expect(fpsForMode('30', 'Best')).toBe(30);
	});
});

describe('address book', () => {
	const devices: BookDevice[] = [
		{
			id: 'A01',
			hostname: 'alpha',
			online: false,
			last_online: '2026-11-01T10:00:00Z',
			folder_id: 3,
			tags: '["office","linux"]'
		},
		{ id: 'B02', hostname: 'bravo', online: true, folder_id: null, tags: 'office', groups: [{ guid: 'g1' }] },
		{ id: 'C03', display_name: 'Charlie', online: false, last_online: '2026-11-05T10:00:00Z', banned: true },
		{ id: 'D04', hostname: 'delta', platform: 'Windows 11', online: true, folder_id: '3' }
	];
	const groups = [
		{ guid: 'g1', name: 'Manual' },
		{ guid: 'g2', name: 'By tag', source_type: 'tag', tag_filter: 'Linux' }
	];

	test('tags from JSON, comma lists and arrays', () => {
		expect(normalizeTags('["a"," b "]')).toEqual(['a', 'b']);
		expect(normalizeTags('a, b,,c')).toEqual(['a', 'b', 'c']);
		expect(normalizeTags(['x', ''])).toEqual(['x']);
		expect(normalizeTags(null)).toEqual([]);
	});

	test('folders: no folder equals 0, empty and null; ids compare as numbers', () => {
		expect(folderIdsEqual(null, 0)).toBe(true);
		expect(folderIdsEqual('3', 3)).toBe(true);
		expect(folderIdsEqual(3, null)).toBe(false);
	});

	test('groups by membership or by tag', () => {
		expect(deviceMatchesGroup(devices[1]!, groups[0]!)).toBe(true);
		expect(deviceMatchesGroup(devices[0]!, groups[1]!)).toBe(true);
		expect(deviceMatchesGroup(devices[1]!, groups[1]!)).toBe(false);
	});

	test('online first, then the most recently seen; filters combine', () => {
		const all = filterDevices(devices, { scope: ALL, status: 'all', query: '', groups });
		expect(all.map((d) => d.id)).toEqual(['B02', 'D04', 'C03', 'A01']);
		expect(
			filterDevices(devices, { scope: { kind: 'folder', id: '3' }, status: 'all', query: '', groups }).map(
				(d) => d.id
			)
		).toEqual(['D04', 'A01']);
		expect(
			filterDevices(devices, {
				scope: { kind: 'folder', id: 'unassigned' },
				status: 'all',
				query: '',
				groups
			}).map((d) => d.id)
		).toEqual(['B02', 'C03']);
		// Offline leaves out banned devices
		expect(
			filterDevices(devices, { scope: ALL, status: 'offline', query: '', groups }).map((d) => d.id)
		).toEqual(['A01']);
		expect(
			filterDevices(devices, {
				scope: { kind: 'tag', id: 'OFFICE' },
				status: 'online',
				query: '',
				groups
			}).map((d) => d.id)
		).toEqual(['B02']);
		expect(
			filterDevices(devices, { scope: ALL, status: 'all', query: 'windows', groups }).map((d) => d.id)
		).toEqual(['D04']);
		expect(
			filterDevices(devices, { scope: { kind: 'group', id: 'g2' }, status: 'all', query: '', groups }).map(
				(d) => d.id
			)
		).toEqual(['A01']);
	});

	test('counts for the filter list', () => {
		const c = countDevices(devices, [{ id: 3, name: 'Office' }], groups, ['office', 'linux']);
		expect(c.all).toBe(4);
		expect(c.unassigned).toBe(2);
		expect(c.folders.get('3')).toBe(2);
		expect(c.groups.get('g1')).toBe(1);
		expect(c.tags.get('office')).toBe(2);
	});

	test('choosing the same tag again goes back to all devices; the heading names the choice', () => {
		const tag = { kind: 'tag' as const, id: 'office' };
		expect(chooseScope(ALL, tag)).toEqual(tag);
		expect(chooseScope(tag, tag)).toEqual(ALL);
		expect(scopeTitle(tag, [], [])).toBe('office');
		expect(scopeTitle({ kind: 'folder', id: '3' }, [{ id: 3, name: 'Office' }], [])).toBe('Office');
		expect(scopeTitle(ALL, [], [])).toBe('All devices');
	});

	test('status words and tones', () => {
		expect(deviceStatus(devices[2]!).tone).toBe('danger');
		expect(deviceStatus(devices[1]!).label).toBe('Online');
	});

	test('quick connect takes an ID without spaces, or nothing', () => {
		expect(readQuickId(' 900 100 012 ')).toBe('900100012');
		expect(readQuickId('ab')).toBe('');
		expect(readQuickId('<script>')).toBe('');
	});
});

describe('remote sign-in return path', () => {
	test('only paths under /remote, never the sign-in itself or another site', () => {
		expect(safeRemoteReturn('/remote/900100012?panel=files#add=9001')).toBe(
			'/remote/900100012?panel=files#add=9001'
		);
		expect(safeRemoteReturn('/remote')).toBe('/remote');
		for (const bad of [
			'//evil.example',
			'https://evil.example/remote',
			'/devices',
			'/remote/login',
			'/remote%5c..',
			'/remotex',
			'\\remote'
		])
			expect(safeRemoteReturn(bad)).toBeNull();
	});

	test('a return path under the new console base stays there', () => {
		expect(splitBase('/app/remote/9001', '/app')).toEqual({ path: '/remote/9001', underBase: true });
		expect(splitBase('/remote/9001', '/app')).toEqual({ path: '/remote/9001', underBase: false });
		expect(splitBase('/app/remotex', '/app')).toEqual({ path: '/app/remotex', underBase: false });
	});

	test('the code field keeps six digits', () => {
		expect(totpDigits('12 34-567')).toBe('123456');
	});
});
