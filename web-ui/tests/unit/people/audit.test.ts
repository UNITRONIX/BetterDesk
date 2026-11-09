import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { listServerEvents, Overview, PanelSession } from '../../../src/lib/api/audit.ts';
import {
	actionLabel,
	auditTab,
	describeUa,
	filterAudit,
	formatDetails,
	sessionState,
	toAuditEntries
} from '../../../src/lib/people/audit.ts';
import { countPerDay, coversDays, dayKey, lastDays } from '../../../src/lib/people/dates.ts';

const t = (key: string) => ({ 'audit.action_login': 'Signed in' })[key] ?? key;

const rows = [
	{
		id: 1,
		user_id: 7,
		username: 'anna',
		action: 'login',
		details: 'User logged in; ua=Firefox',
		ip_address: '10.0.0.1',
		created_at: '2026-11-09 10:00:00'
	},
	{
		id: 2,
		user_id: 7,
		username: 'anna',
		action: 'device_banned',
		details: 'Device 900100019 banned',
		ip_address: '',
		created_at: '2026-11-09 10:01:00'
	},
	{
		id: 3,
		user_id: null,
		username: '',
		action: 'login_failed',
		details: 'Bad password',
		ip_address: '10.0.0.9',
		created_at: '2026-11-09 10:02:00'
	},
	{
		id: 4,
		user_id: 8,
		username: '',
		action: 'settings_update',
		details: 'Changed SMTP host',
		ip_address: '',
		created_at: '2026-11-09 10:03:00'
	},
	{
		id: 5,
		user_id: 7,
		username: 'anna',
		action: 'user_created',
		details: 'Created ben',
		ip_address: '',
		created_at: '2026-11-09 10:04:00'
	}
];

describe('tabs in the URL', () => {
	test('known tabs, the old "vulnerabilities" name, anything else is the audit log', () => {
		expect(auditTab('events')).toBe('events');
		expect(auditTab('vulnerabilities')).toBe('hardening');
		expect(auditTab('sessions')).toBe('sessions');
		expect(auditTab('nonsense')).toBe('audit');
		expect(auditTab(null)).toBe('audit');
	});
});

describe('audit log', () => {
	const entries = toAuditEntries(rows, t);

	test('entries: the device named in the details, the person or #id, the action in words', () => {
		expect(entries[1]?.device).toBe('900100019');
		expect(entries[0]?.device).toBe('');
		expect(entries[0]?.label).toBe('Signed in');
		expect(entries[4]?.label).toBe('User created');
		expect(entries[3]?.who).toBe('#8');
		expect(entries[2]?.who).toBe('');
		expect(entries[2]?.userId).toBeNull();
	});

	test('kind filters: bans, sign-ins, failed sign-ins, devices, people, settings', () => {
		const ids = (type: Parameters<typeof filterAudit>[2], q = '') =>
			filterAudit(entries, q, type).map((e) => e.key);
		expect(ids('')).toEqual(['1', '2', '3', '4', '5']);
		expect(ids('bans')).toEqual(['2']);
		expect(ids('signins')).toEqual(['1', '3']);
		expect(ids('failed')).toEqual(['3']);
		expect(ids('devices')).toEqual(['2']);
		expect(ids('people')).toEqual(['5']);
		expect(ids('settings')).toEqual(['4']);
	});

	test('search covers who, action, its words, device, details and address', () => {
		expect(filterAudit(entries, '900100019', '').map((e) => e.key)).toEqual(['2']);
		expect(filterAudit(entries, 'SIGNED IN', '').map((e) => e.key)).toEqual(['1']);
		expect(filterAudit(entries, '10.0.0.9', '').map((e) => e.key)).toEqual(['3']);
		expect(filterAudit(entries, 'anna', 'people').map((e) => e.key)).toEqual(['5']);
	});

	test('the device in other wordings: deleted, restored, lower case', () => {
		const more = toAuditEntries(
			[
				{ id: 9, action: 'device_deleted', details: 'Deleted 900100028 (old laptop)' },
				{ id: 10, action: 'peer_restore', details: 'Restored ab12cd' },
				{ id: 11, action: 'x', details: 'Approved enrollment for device 900200005' }
			].map((r) => ({ user_id: null, username: '', ip_address: '', created_at: '', ...r })),
			t
		);
		expect(more.map((e) => e.device)).toEqual(['900100028', 'ab12cd', '900200005']);
	});

	test('unknown action codes become a sentence', () => {
		expect(actionLabel('device_group_saved', t)).toBe('Device group saved');
		expect(actionLabel('', t)).toBe('');
	});
});

describe('server events and sessions', () => {
	test('event details become one line, empty values left out', () => {
		expect(formatDetails({ mode: 'all', version: '3.5', empty: '', nested: { a: 1 } })).toBe(
			'mode: all, version: 3.5, nested: {"a":1}'
		);
		expect(formatDetails('plain')).toBe('plain');
		expect(formatDetails(null)).toBe('');
	});

	test('a browser string says browser and system', () => {
		const chrome =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36';
		expect(describeUa(chrome)).toEqual({ browser: 'Chrome 156', os: 'Windows' });
		expect(describeUa('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0')).toEqual({
			browser: 'Firefox 140',
			os: 'Linux'
		});
		expect(describeUa(`${chrome} Edg/156.0`).browser).toBe('Edge 156');
		expect(describeUa('curl/8')).toEqual({ browser: '', os: '' });
	});

	test('session state: this session, active, ended', () => {
		expect(sessionState({ current: true, active: true })).toBe('current');
		expect(sessionState({ current: false, active: true })).toBe('active');
		expect(sessionState({ current: false, active: false })).toBe('ended');
		expect(v.parse(PanelSession, { id: 'x', createdAt: 1, endReason: null })).toMatchObject({
			endReason: '',
			current: false
		});
	});

	test('checks: either "pass" or "passed", missing stats and TLS as unknown', () => {
		const o = v.parse(Overview, {
			checks: [
				{ id: 'a', name: 'A', passed: true },
				{ id: 'b', pass: false }
			],
			stats: { active_bans: 3 }
		});
		expect(o.checks).toEqual([
			{ id: 'a', name: 'A', pass: true },
			{ id: 'b', name: '', pass: false }
		]);
		expect(o.stats.bans).toBe(3);
		expect(o.stats.failed_logins).toBeNull();
		expect(o.tls).toEqual({ signal: null, relay: null, api: null, wss: null });
	});

	test('the events answer is read with or without a { data } wrapper', async () => {
		const answers = [
			{ events: [{ action: 'server_start', timestamp: 't1' }], total: 9 },
			{ success: true, data: { events: [{ action: 'x' }], total: 2 } }
		];
		const realFetch = globalThis.fetch;
		try {
			for (const body of answers) {
				globalThis.fetch = (async () =>
					new Response(JSON.stringify(body), {
						headers: { 'content-type': 'application/json' }
					})) as typeof fetch;
				const out = await listServerEvents({ limit: 25 });
				expect(out.events).toHaveLength(1);
				expect(out.total).toBe(body === answers[0] ? 9 : 2);
			}
		} finally {
			globalThis.fetch = realFetch;
		}
	});
});

describe('days', () => {
	const now = new Date(2026, 10, 9, 15, 0, 0);
	const days = lastDays(14, now);

	test('the last 14 days end today', () => {
		expect(days).toHaveLength(14);
		expect(dayKey(days[13]!)).toBe('2026-11-09');
		expect(dayKey(days[0]!)).toBe('2026-10-27');
	});

	test('times count on their local day; times outside the range are left out', () => {
		const counts = countPerDay(
			[
				new Date(2026, 10, 9, 1),
				new Date(2026, 10, 9, 23),
				new Date(2026, 10, 1, 12).getTime(),
				new Date(2026, 9, 1),
				null
			],
			days
		);
		expect(counts[13]).toBe(2);
		expect(counts[5]).toBe(1);
		expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
	});

	test('the chart needs events back to the first day', () => {
		expect(coversDays(new Date(2026, 9, 27, 0, 0), days)).toBe(true);
		expect(coversDays(new Date(2026, 9, 27, 9, 0), days)).toBe(false);
	});
});
