/**
 * Enrollment requests (lib/clients/registrations.ts): the two queues in one
 * row shape, one row per device and queue, decisions made on the page, the
 * filter and order, the row buttons and the mode notice.
 */
import { describe, expect, test } from 'vitest';
import {
	SOURCE_ENROLLMENT,
	SOURCE_LAN,
	bySource,
	canDeleteRecord,
	enrollmentMode,
	fromHistory,
	fromLan,
	fromPending,
	mergeRows,
	modeNotice,
	oldest,
	rowActions,
	splitTags,
	tagsValue,
	visibleRows,
	waitingRows,
	type Decided,
	type RequestRow
} from '#lib/clients/registrations.ts';

const lan = (over: Partial<Parameters<typeof fromLan>[0]> = {}) =>
	fromLan({
		id: 7,
		device_id: '900300001',
		hostname: 'printer',
		platform: 'Windows',
		version: '1.4.2',
		ip_address: '10.0.0.5',
		ip: '',
		status: 'pending',
		approved_by: '',
		approved_at: '',
		rejected_reason: '',
		created_at: '2026-11-08T10:00:00Z',
		updated_at: '',
		...over
	});

const pending = (id: string, created = '2026-11-08T09:00:00Z') =>
	fromPending({
		device_id: id,
		hostname: `h-${id}`,
		platform: 'Linux',
		version: '',
		ip: '10.1.1.1',
		ip_address: '',
		created_at: created
	});

const decision = (id: string, status: string, decided: string, actor = 'anna') =>
	fromHistory({
		device_id: id,
		hostname: `h-${id}`,
		platform: 'Linux',
		version: '',
		ip: '',
		ip_address: '10.2.2.2',
		status,
		banned: false,
		decided_at: decided,
		created_at: '2026-11-01T00:00:00Z',
		actor
	});

describe('rows from the two queues', () => {
	test('a LAN request keys on its row id, an enrollment on the device ID', () => {
		const a = lan();
		expect(a.key).toBe(`${SOURCE_LAN}:7`);
		expect(a.rowId).toBe('7');
		expect(a.ip).toBe('10.0.0.5');
		const b = pending('900200001');
		expect(b.key).toBe(`${SOURCE_ENROLLMENT}:900200001`);
		expect(b.rowId).toBe('900200001');
		expect(b.status).toBe('pending');
	});

	test('a rejected LAN request is decided when it was last updated', () => {
		const r = lan({ status: 'rejected', updated_at: '2026-11-09T08:00:00Z' });
		expect(r.status).toBe('rejected');
		expect(r.decided_at).toBe('2026-11-09T08:00:00Z');
		expect(lan({ status: 'approved', approved_at: 'A', updated_at: 'U' }).decided_at).toBe('A');
		expect(lan({ status: 'weird' }).status).toBe('pending');
	});

	test('the Go server records its API key, not a person: no "by" then', () => {
		expect(decision('1', 'approved', '2026-11-09T00:00:00Z', 'apikey:console-bridge').decided_by).toBe('');
		expect(decision('1', 'approved', '2026-11-09T00:00:00Z', 'anna').decided_by).toBe('anna');
		expect(decision('1', 'something', '2026-11-09T00:00:00Z').status).toBe('rejected');
	});
});

describe('mergeRows', () => {
	test('a device that asks again: the open request wins over its old decision', () => {
		const merged = mergeRows([decision('5', 'rejected', '2026-11-09T00:00:00Z'), pending('5')]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.status).toBe('pending');
		const other = mergeRows([pending('5'), decision('5', 'rejected', '2026-11-09T00:00:00Z')]);
		expect(other[0]?.status).toBe('pending');
	});

	test('two decisions: the later one wins', () => {
		const merged = mergeRows([
			decision('5', 'rejected', '2026-11-01T00:00:00Z'),
			decision('5', 'approved', '2026-11-05T00:00:00Z'),
			decision('5', 'rejected', '2026-11-03T00:00:00Z')
		]);
		expect(merged).toHaveLength(1);
		expect(merged[0]?.status).toBe('approved');
	});

	test('the same device in both queues stays twice', () => {
		const merged = mergeRows([lan({ device_id: '5' }), pending('5')]);
		expect(merged).toHaveLength(2);
	});
});

describe('visibleRows', () => {
	const rows: RequestRow[] = [
		pending('1', '2026-11-08T08:00:00Z'),
		pending('2', '2026-11-08T12:00:00Z'),
		decision('3', 'approved', '2026-11-09T00:00:00Z'),
		decision('4', 'rejected', '2026-11-07T00:00:00Z')
	];

	test('Waiting shows waiting requests, newest first; All puts waiting ones first', () => {
		expect(visibleRows(rows, new Map(), 'pending', '').map((r) => r.device_id)).toEqual(['2', '1']);
		expect(visibleRows(rows, new Map(), '', '').map((r) => r.device_id)).toEqual(['2', '1', '3', '4']);
		expect(visibleRows(rows, new Map(), 'approved', '').map((r) => r.device_id)).toEqual(['3']);
		expect(visibleRows(rows, new Map(), 'rejected', '').map((r) => r.device_id)).toEqual(['4']);
	});

	test('a request decided here stays under Waiting with its new status', () => {
		const row = rows[0] as RequestRow;
		const decided = new Map<string, Decided>([
			[
				row.key,
				{
					status: 'approved',
					decided_at: '2026-11-09T10:00:00Z',
					decided_by: 'me',
					row: { ...row, hostname: 'renamed' }
				}
			]
		]);
		const shown = visibleRows(rows, decided, 'pending', '');
		const kept = shown.find((r) => r.key === row.key);
		expect(kept?.status).toBe('approved');
		expect(kept?.hostname).toBe('renamed');
		expect(kept?.decided_by).toBe('me');
		expect(waitingRows(rows, decided).map((r) => r.device_id)).toEqual(['2']);
	});

	test('a decided request that left the server queue is still shown', () => {
		const gone = pending('99');
		const decided = new Map<string, Decided>([
			[gone.key, { status: 'rejected', decided_at: 'x', decided_by: 'me', banned: true, row: gone }]
		]);
		const shown = visibleRows(rows, decided, 'pending', '');
		expect(shown.find((r) => r.device_id === '99')?.banned).toBe(true);
	});

	test('search looks in ID, name, address, platform and version', () => {
		expect(visibleRows(rows, new Map(), '', 'h-3').map((r) => r.device_id)).toEqual(['3']);
		expect(visibleRows(rows, new Map(), '', '10.2.2').map((r) => r.device_id)).toEqual(['3', '4']);
		expect(visibleRows(rows, new Map(), '', 'LINUX')).toHaveLength(4);
		expect(visibleRows(rows, new Map(), '', 'nothing')).toHaveLength(0);
	});
});

describe('counts', () => {
	test('oldest waiting request and the split by source', () => {
		const rows = [pending('1', '2026-11-08T08:00:00Z'), pending('2', '2026-11-01T00:00:00Z'), lan()];
		expect(oldest(rows)?.device_id).toBe('2');
		expect(oldest([])).toBeNull();
		expect(bySource(rows)).toEqual({ rustdesk: 2, lan: 1 });
	});
});

describe('row buttons', () => {
	test('waiting: approve and reject; approved: open; rejected RustDesk client: allow again', () => {
		expect(rowActions(pending('1'), false)).toEqual(['approve', 'reject']);
		expect(rowActions(decision('1', 'approved', 'x'), false)).toEqual(['open']);
		expect(rowActions(decision('1', 'rejected', 'x'), false)).toEqual(['allow-again']);
		expect(rowActions(lan({ status: 'rejected' }), false)).toEqual([]);
	});

	test('decided on this page: no second decision from the row', () => {
		expect(rowActions({ ...pending('1'), status: 'rejected' }, true)).toEqual([]);
		expect(rowActions({ ...pending('1'), status: 'approved' }, true)).toEqual(['open']);
	});

	test('Delete record: decided LAN requests, with enrollment.manage only', () => {
		expect(canDeleteRecord(lan({ status: 'rejected' }), true)).toBe(true);
		expect(canDeleteRecord(lan({ status: 'rejected' }), false)).toBe(false);
		expect(canDeleteRecord(lan(), true)).toBe(false);
		expect(canDeleteRecord(decision('1', 'rejected', 'x'), true)).toBe(false);
	});
});

describe('mode', () => {
	test('unknown modes count as managed', () => {
		expect(enrollmentMode('open')).toBe('open');
		expect(enrollmentMode('locked')).toBe('locked');
		expect(enrollmentMode('bogus')).toBe('managed');
		expect(enrollmentMode(undefined)).toBe('managed');
	});

	test('a notice only outside Managed mode and only with waiting RustDesk clients', () => {
		expect(modeNotice('managed', 3)).toBeNull();
		expect(modeNotice('open', 0)).toBeNull();
		expect(modeNotice('open', 2)).toBe('open');
		expect(modeNotice('locked', 1)).toBe('locked');
	});
});

describe('tags', () => {
	test('picked tags and typed tags become one comma list', () => {
		expect(tagsValue([' a ', '', 'b'])).toBe('a, b');
		expect(splitTags('a, b ,,c ')).toEqual(['a', 'b', 'c']);
	});
});
