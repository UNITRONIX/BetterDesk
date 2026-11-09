import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { ActivitySummary, TopApp } from '../../../src/lib/api/activity.ts';
import { SavedReportFull, Trends } from '../../../src/lib/api/reports.ts';
import {
	activeIdle,
	filterReports,
	mergeTopApps,
	presetOf,
	presetRange,
	rangeOf,
	sortReports
} from '../../../src/lib/people/activity.ts';
import { lastDays } from '../../../src/lib/people/dates.ts';
import {
	canManageReports,
	csvSection,
	genericBlocks,
	helpTrend,
	periodText,
	reportBlocks,
	reportFilters,
	savedByParts,
	sessionTrend,
	type Block
} from '../../../src/lib/people/reports.ts';

const t = (key: string, params?: Record<string, string | number>) => {
	const strings: Record<string, string> = {
		'reports.devices_sentence': '{total} devices: {online} online, {offline} offline, {banned} banned.',
		'reports.period_from_to': 'Period: {from} to {to}',
		'reports.period_all': 'Period: all dates',
		'reports.saved_by': 'Saved by {user} on {date}',
		'reports.recent_audit_note': 'The latest {shown} of {total} entries.',
		'network.status_down': 'Down'
	};
	const s = strings[key] ?? key;
	return s.replace(/\{(\w+)\}/g, (m, k: string) =>
		params && params[k] !== undefined ? String(params[k]) : m
	);
};

const report = (r: Record<string, unknown>) => v.parse(ActivitySummary, r);

describe('app usage', () => {
	const now = new Date(2026, 10, 9, 15);

	test('the "to" date covers its whole day; empty dates send nothing', () => {
		expect(rangeOf('2026-11-01', '2026-11-09')).toEqual({
			from: '2026-11-01',
			to: '2026-11-09T23:59:59.999Z'
		});
		expect(rangeOf('', '')).toEqual({ from: undefined, to: undefined });
	});

	test('presets: last 7 and 30 days include today; dates that match a preset select it', () => {
		expect(presetRange('7', now)).toEqual({ from: '2026-11-03', to: '2026-11-09' });
		expect(presetRange('30', now)).toEqual({ from: '2026-10-11', to: '2026-11-09' });
		expect(presetRange('', now)).toEqual({ from: '', to: '' });
		expect(presetOf('2026-11-03', '2026-11-09', now)).toBe('7');
		expect(presetOf('', '', now)).toBe('');
		expect(presetOf('2026-11-04', '2026-11-09', now)).toBeNull();
	});

	test('newest report first; search by name or ID', () => {
		const list = sortReports([
			report({ device_id: '1', hostname: 'reception', reported_at: '2026-11-05T08:00:00Z' }),
			report({ device_id: '2', hostname: 'lab', reported_at: '2026-11-07T08:00:00Z' })
		]);
		expect(list.map((r) => r.device_id)).toEqual(['2', '1']);
		expect(filterReports(list, 'RECEP').map((r) => r.device_id)).toEqual(['1']);
		expect(filterReports(list, '2').map((r) => r.device_id)).toEqual(['2']);
	});

	test('active against idle time, as a share', () => {
		expect(activeIdle([])).toBeNull();
		expect(
			activeIdle([
				report({ device_id: '1', total_active_secs: 300, idle_seconds: 100 }),
				report({ device_id: '2', total_active_secs: '300', idle_seconds: null })
			])
		).toEqual({ active: 600, idle: 100, pct: 86 });
	});

	test('apps of several devices add up per name, longest first, at most n', () => {
		const a = (name: string, secs: number) => v.parse(TopApp, { app_name: name, total_secs: secs });
		const merged = mergeTopApps(
			[
				[a('Edge', 100), a('Outlook', 50)],
				[a('Edge', 30), v.parse(TopApp, { name: 'Teams', total_seconds: 200 }), a('Idle', 0)]
			],
			2
		);
		expect(merged).toEqual([
			{ name: 'Teams', secs: 200, devices: 1 },
			{ name: 'Edge', secs: 130, devices: 2 }
		]);
		// Apps without any time are left out
		expect(mergeTopApps([[a('Idle', 0), a('Edge', 5)]], 8).map((x) => x.name)).toEqual(['Edge']);
	});
});

describe('reports', () => {
	test('saving and deleting: super_admin, admin and global_admin (the server role check)', () => {
		expect(['admin', 'super_admin', 'global_admin'].every(canManageReports)).toBe(true);
		expect(['server_admin', 'operator', 'viewer', '', null].some(canManageReports)).toBe(false);
	});

	test('the devices report: a sentence and the platforms by count, most first', () => {
		const blocks = reportBlocks(
			'devices',
			{ total_devices: 3, online: 1, offline: 2, banned: 0, platform_distribution: { Linux: 1, Windows: 2 } },
			t,
			'/x'
		);
		expect(blocks[0]).toEqual({ kind: 'lead', text: '3 devices: 1 online, 2 offline, 0 banned.' });
		const section = blocks[1] as Extract<Block, { kind: 'section' }>;
		const table = section.blocks[0] as Extract<Block, { kind: 'table' }>;
		expect(table.rows.map((r) => r[0])).toEqual([
			{ kind: 'text', text: 'Windows' },
			{ kind: 'text', text: 'Linux' }
		]);
	});

	test('the security report links to the audit log and marks people and actions', () => {
		const blocks = reportBlocks(
			'security',
			{
				dlp: { stats: { total: 2 } },
				banned_devices: [],
				recent_audit: [
					{ created_at: '2026-11-09 10:00:00', username: 'anna', action: 'login', details: 'x' }
				],
				audit_log_count: 40
			},
			t,
			'/app/security-audit?tab=audit'
		);
		const audit = blocks[2] as Extract<Block, { kind: 'section' }>;
		expect(audit.blocks[0]).toMatchObject({
			kind: 'note',
			text: 'The latest 1 of 40 entries.',
			link: { href: '/app/security-audit?tab=audit' }
		});
		const row = (audit.blocks[1] as Extract<Block, { kind: 'table' }>).rows[0]!;
		expect(row[1]).toEqual({ kind: 'user', text: 'anna' });
		expect(row[2]).toEqual({ kind: 'tag', text: 'Login' });
	});

	test('network targets: down is a danger status, up a good one', () => {
		const blocks = reportBlocks(
			'network',
			{
				targets: [
					{ name: 'gw', host: '10.0.0.1', last_status: 'down' },
					{ name: 'dns', last_status: 'up' }
				]
			},
			t,
			''
		);
		const table = (blocks[1] as Extract<Block, { kind: 'section' }>).blocks[0] as Extract<
			Block,
			{ kind: 'table' }
		>;
		expect(table.rows[0]![3]).toEqual({ kind: 'status', tone: 'down', text: 'Down' });
		expect(table.rows[1]![3]).toMatchObject({ kind: 'status', tone: 'good' });
		expect(table.rows[1]![1]).toEqual({ kind: 'empty' });
	});

	test('an unknown type, or data a known type cannot read, shows everything generically', () => {
		const data = { count: 3, items: [{ id: 1, created_at: '2026-11-09 10:00:00' }], meta: { a: 1 } };
		const blocks = reportBlocks('custom', data, t, '');
		expect(blocks).toEqual(genericBlocks(data, t));
		expect(blocks[0]).toEqual({ kind: 'facts', items: [['Count', '3']] });
		const items = (blocks[1] as Extract<Block, { kind: 'section' }>).blocks[0] as Extract<
			Block,
			{ kind: 'table' }
		>;
		expect(items.rows[0]![1]).toMatchObject({ kind: 'time' });
		expect(reportBlocks('tickets', { stats: null, category_distribution: 5 }, t, '').length).toBeGreaterThan(
			0
		);
	});

	test('the CSV exports the main table of the report', () => {
		expect(csvSection({ targets: [], top_applications: [{}] })).toBe('top_applications');
		expect(csvSection({ total: 1 })).toBeUndefined();
	});

	test('period sentence and filters', () => {
		expect(periodText({}, t)).toBe('Period: all dates');
		expect(periodText({ from: '2026-11-01', to: '2026-11-09T23:59:59.999Z' }, t)).toMatch(
			/^Period: .+ to .+$/
		);
		expect(reportFilters('', '2026-11-09')).toEqual({ to: '2026-11-09T23:59:59.999Z' });
		expect(reportFilters('', '')).toEqual({});
	});

	test('"Saved by" is split around the date so the date can be a time element', () => {
		expect(savedByParts('anna', t)).toEqual(['Saved by anna on ', '']);
	});

	test('saved reports: payload and filters arrive as JSON text or objects', () => {
		const r = v.parse(SavedReportFull, {
			id: 1,
			report_type: 'devices',
			payload: '{"total_devices":3}',
			filters: 'nope'
		});
		expect(r.payload).toEqual({ total_devices: 3 });
		expect(r.filters).toEqual({});
	});
});

describe('trends', () => {
	const days = lastDays(14, new Date(2026, 10, 9, 15));
	const at = (d: number, h = 10) => new Date(2026, 10, d, h).getTime();

	test('sessions per day, the busiest day and the average length of finished ones', () => {
		const tr = sessionTrend(
			[
				{ start: at(9), end: at(9, 11) },
				{ start: at(9, 12), end: null },
				{ start: at(3), end: at(3, 10) + 30 * 60000 },
				{ start: at(1, 10) - 40 * 86400000, end: at(1, 11) }
			],
			days
		);
		expect(tr.total).toBe(3);
		expect(tr.peak).toBe(13);
		expect(tr.avgMinutes).toBe(45);
		expect(sessionTrend([], days).avgMinutes).toBeNull();
	});

	test('help requests: opened on creation, resolved on the last change, the rest still open', () => {
		const h = helpTrend(
			[
				{ created: at(8), updated: at(9), status: 'resolved' },
				{ created: at(9), updated: null, status: 'open' },
				{ created: at(2), updated: at(4), status: 'Closed' }
			],
			days
		);
		expect(h.opened[13]).toBe(1);
		expect(h.opened[12]).toBe(1);
		expect(h.resolved[13]).toBe(1);
		expect(h.resolved[8]).toBe(1);
		expect(h.stillOpen).toBe(1);
		expect(v.parse(Trends, { sessions: null, help: null }).devicesTotal).toBe(0);
	});
});
