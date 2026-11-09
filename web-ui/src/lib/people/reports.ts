/**
 * Reports without a DOM: each report type's data as blocks (a sentence,
 * facts, tables) that ReportView draws, the period sentence, the list the
 * CSV export takes, and the trend charts' numbers. Values are text or
 * marks (time, tag, status, mono value, person); nothing here is markup.
 */

import { formatDate, formatDuration, formatNumber, parseDate } from '#lib/i18n/format.ts';
import { countPerDay, dayKey } from './dates.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

export const REPORT_TYPES = [
	'devices',
	'activity',
	'security',
	'tickets',
	'network',
	'inventory',
	'alerts'
] as const;

/** Saving and deleting a saved report: the server's role check */
export function canManageReports(role: string | null | undefined): boolean {
	return ['admin', 'super_admin', 'global_admin'].includes(String(role ?? ''));
}

export type Cell =
	| { kind: 'text'; text: string }
	| { kind: 'value'; text: string }
	| { kind: 'time'; value: unknown; relative?: boolean }
	| { kind: 'tag'; text: string }
	| { kind: 'status'; tone: string; text: string }
	| { kind: 'user'; text: string }
	| { kind: 'empty' };

export interface TableBlock {
	kind: 'table';
	columns: { label: string; num?: boolean }[];
	rows: Cell[][];
}

export type Block =
	| { kind: 'lead'; text: string }
	| { kind: 'facts'; items: [string, string][] }
	| { kind: 'state'; text: string }
	| { kind: 'note'; text: string; link?: { href: string; text: string } }
	| TableBlock
	| { kind: 'section'; title: string; blocks: Block[] };

const has = (t: T, key: string) => t(key) !== key;

export function humanize(key: string): string {
	const words = String(key).replace(/_/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function fieldLabel(key: string, t: T): string {
	return has(t, `reports.field_${key}`) ? t(`reports.field_${key}`) : humanize(key);
}

export function typeLabel(type: string, t: T): string {
	return has(t, `reports.type_${type}`) ? t(`reports.type_${type}`) : humanize(type || '');
}

const levelLabel = (t: T, prefix: string) => (v: string) =>
	has(t, prefix + v) ? t(prefix + v) : humanize(v);

function num(v: unknown): string {
	const n = Number(v);
	if (v === null || v === undefined || v === '' || Number.isNaN(n)) return '';
	return formatNumber(n);
}

function text(v: unknown): Cell {
	if (v === null || v === undefined || v === '' || v === '—') return { kind: 'empty' };
	return { kind: 'text', text: typeof v === 'object' ? JSON.stringify(v) : String(v) };
}

function value(v: unknown): Cell {
	return v === null || v === undefined || v === '' ? { kind: 'empty' } : { kind: 'value', text: String(v) };
}

function duration(seconds: unknown, t: T): string {
	const s = Number(seconds) || 0;
	return s <= 0 ? t('reports.none_time') : formatDuration(s, { largest: 'hour' });
}

const obj = (v: unknown): Record<string, unknown> =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj) : []);

function countTable(
	o: unknown,
	nameLabel: string,
	countLabel: string,
	t: T,
	translate?: (v: string) => string
): Block {
	const entries = Object.entries(obj(o))
		.map(([k, v]) => [k, Number(v) || 0] as const)
		.sort((a, b) => b[1] - a[1]);
	if (!entries.length) return { kind: 'state', text: t('reports.no_rows') };
	return {
		kind: 'table',
		columns: [{ label: nameLabel }, { label: countLabel, num: true }],
		rows: entries.map(([k, n]) => [
			text(translate ? translate(k) : k),
			{ kind: 'text', text: formatNumber(n) }
		])
	};
}

function genericTable(rows: Record<string, unknown>[], t: T): Block {
	const first = rows[0];
	if (!first) return { kind: 'state', text: t('reports.no_rows') };
	const cols = Object.keys(first);
	return {
		kind: 'table',
		columns: cols.map((c) => ({ label: fieldLabel(c, t) })),
		rows: rows.map((r) =>
			cols.map((c): Cell => {
				const v = r[c];
				if (v === null || v === undefined || v === '') return { kind: 'empty' };
				if (typeof v === 'object') return { kind: 'text', text: JSON.stringify(v) };
				if (/_at$/.test(c)) return { kind: 'time', value: v, relative: false };
				return { kind: 'text', text: String(v) };
			})
		)
	};
}

const section = (title: string, ...blocks: Block[]): Block => ({ kind: 'section', title, blocks });

type Renderer = (d: Record<string, unknown>, t: T, auditHref: string) => Block[];

const RENDERERS: Record<string, Renderer> = {
	devices: (d, t) => [
		{
			kind: 'lead',
			text: t('reports.devices_sentence', {
				total: num(d.total_devices),
				online: num(d.online),
				offline: num(d.offline),
				banned: num(d.banned)
			})
		},
		section(
			t('reports.platforms'),
			countTable(d.platform_distribution, t('reports.platform'), t('reports.devices'), t)
		)
	],
	activity: (d, t) => {
		// Reports saved before a field fix carry *_ms fields
		const ms = (k: string) => (Number(d[k]) ? Number(d[k]) / 1000 : 0);
		const active = d.total_active_secs ?? ms('total_active_ms');
		const idle = d.total_idle_secs ?? ms('total_idle_ms');
		const facts: [string, string][] = [];
		if (d.devices_with_activity !== undefined)
			facts.push([t('reports.field_devices_with_activity'), num(d.devices_with_activity)]);
		facts.push([t('reports.field_daily_reports'), num(d.daily_reports ?? d.total_devices_with_activity)]);
		facts.push([t('reports.total_active'), duration(active, t)]);
		facts.push([t('reports.total_idle'), duration(idle, t)]);
		const apps = arr(d.top_applications);
		const category = levelLabel(t, 'activity.category_');
		return [
			{ kind: 'facts', items: facts },
			section(
				t('reports.top_applications'),
				apps.length
					? {
							kind: 'table',
							columns: [
								{ label: t('reports.app') },
								{ label: t('reports.category') },
								{ label: t('reports.time_used'), num: true },
								{ label: t('reports.app_sessions'), num: true },
								{ label: t('reports.devices'), num: true }
							],
							rows: apps.map((a) => [
								text(a.name),
								a.category ? { kind: 'tag', text: category(String(a.category)) } : { kind: 'empty' },
								{
									kind: 'text',
									text: duration(a.total_secs ?? (Number(a.total_ms) ? Number(a.total_ms) / 1000 : 0), t)
								},
								text(num(a.sessions)),
								text(num(a.devices))
							])
						}
					: { kind: 'state', text: t('reports.no_apps') }
			)
		];
	},
	security: (d, t, auditHref) => {
		const dlp = obj(obj(d.dlp).stats);
		const banned = arr(d.banned_devices);
		const audit = arr(d.recent_audit);
		const dlpEvents = arr(obj(d.dlp).recent_events);
		const out: Block[] = [
			{
				kind: 'facts',
				items: [
					[t('reports.field_dlp_total'), num(dlp.total ?? 0)],
					[t('reports.field_dlp_blocked'), num(dlp.blocked ?? 0)],
					[t('reports.field_dlp_logged'), num(dlp.logged ?? 0)]
				]
			},
			section(
				t('reports.banned_devices'),
				banned.length
					? {
							kind: 'table',
							columns: [
								{ label: t('reports.device_id') },
								{ label: t('reports.device_name') },
								{ label: t('reports.ip_address') },
								{ label: t('reports.ban_reason') }
							],
							rows: banned.map((b) => [value(b.id), text(b.hostname), value(b.ip), text(b.ban_reason)])
						}
					: { kind: 'state', text: t('reports.no_banned') }
			),
			audit.length
				? section(
						t('reports.recent_audit'),
						{
							kind: 'note',
							text: t('reports.recent_audit_note', {
								shown: audit.length,
								total: Number(d.audit_log_count ?? audit.length)
							}),
							link: { href: auditHref, text: t('reports.open_audit_log') }
						},
						{
							kind: 'table',
							columns: [
								{ label: t('reports.when') },
								{ label: t('reports.who') },
								{ label: t('reports.action') },
								{ label: t('reports.details') }
							],
							rows: audit.map((a) => [
								{ kind: 'time', value: a.created_at, relative: false },
								a.username ? { kind: 'user', text: String(a.username) } : { kind: 'empty' },
								a.action
									? {
											kind: 'tag',
											text: has(t, `audit.action_${String(a.action)}`)
												? t(`audit.action_${String(a.action)}`)
												: humanize(String(a.action))
										}
									: { kind: 'empty' },
								text(a.details)
							])
						}
					)
				: section(t('reports.recent_audit'), { kind: 'state', text: t('reports.no_rows') })
		];
		if (dlpEvents.length) out.push(section(t('reports.dlp_events'), genericTable(dlpEvents, t)));
		return out;
	},
	tickets: (d, t) => {
		const s = obj(d.stats);
		return [
			{
				kind: 'lead',
				text: t('reports.tickets_sentence', {
					total: num(s.total ?? d.total_tickets),
					open: num(s.open ?? 0),
					in_progress: num(s.in_progress ?? 0),
					resolved: num(s.resolved ?? 0),
					closed: num(s.closed ?? 0)
				})
			},
			section(
				t('reports.category_distribution'),
				countTable(
					d.category_distribution,
					t('reports.category'),
					t('reports.tickets'),
					t,
					levelLabel(t, 'tickets.category_')
				)
			),
			section(
				t('reports.priority_distribution'),
				countTable(
					d.priority_distribution,
					t('reports.priority'),
					t('reports.tickets'),
					t,
					levelLabel(t, 'tickets.priority_')
				)
			)
		];
	},
	network: (d, t) => {
		const targets = arr(d.targets);
		const status = (s: string) => (has(t, `network.status_${s}`) ? t(`network.status_${s}`) : humanize(s));
		return [
			{
				kind: 'lead',
				text: t('reports.network_sentence', {
					total: num(d.total_targets),
					up: num(d.up),
					down: num(d.down),
					unknown: num(d.unknown)
				})
			},
			section(
				t('reports.targets_status'),
				targets.length
					? {
							kind: 'table',
							columns: [
								{ label: t('reports.target_name') },
								{ label: t('reports.target_host') },
								{ label: t('reports.check_type') },
								{ label: t('reports.status') },
								{ label: t('reports.response_time'), num: true },
								{ label: t('reports.last_check') }
							],
							rows: targets.map((x) => [
								text(x.name),
								value(x.host),
								x.check_type ? { kind: 'tag', text: String(x.check_type) } : { kind: 'empty' },
								x.last_status
									? {
											kind: 'status',
											tone: x.last_status === 'up' ? 'good' : String(x.last_status),
											text: status(String(x.last_status))
										}
									: { kind: 'empty' },
								x.last_rtt_ms !== null && x.last_rtt_ms !== undefined
									? { kind: 'text', text: t('reports.ms', { ms: num(x.last_rtt_ms) }) }
									: { kind: 'empty' },
								{ kind: 'time', value: x.last_check_at }
							])
						}
					: { kind: 'state', text: t('reports.no_targets') }
			)
		];
	},
	inventory: (d, t) => {
		const avg = Number(d.avg_ram_mb) || 0;
		return [
			{
				kind: 'facts',
				items: [
					[t('reports.field_total_inventoried'), num(d.total_inventoried)],
					[
						t('reports.avg_ram'),
						avg ? t('reports.gb', { gb: formatNumber(avg / 1024, { maximumFractionDigits: 1 }) }) : ''
					]
				]
			},
			section(
				t('reports.os_distribution'),
				countTable(d.os_distribution, t('reports.operating_system'), t('reports.devices'), t)
			)
		];
	},
	alerts: (d, t) => [
		{
			kind: 'facts',
			items: [
				[t('reports.field_total_rules'), num(d.total_rules)],
				[t('reports.field_active_rules'), num(d.active_rules)],
				[t('reports.field_total_alerts'), num(d.total_alerts)]
			]
		},
		section(
			t('reports.alerts_per_rule'),
			countTable(d.alerts_per_rule, t('reports.rule'), t('reports.alerts'), t)
		),
		section(t('reports.recent_alerts'), genericTable(arr(d.recent_alerts), t))
	]
};

/** Any other report: its scalars as facts, lists as tables, objects as facts */
export function genericBlocks(data: Record<string, unknown>, t: T): Block[] {
	const facts: [string, string][] = [];
	const blocks: Block[] = [];
	for (const [k, v] of Object.entries(data)) {
		if (v === null || v === undefined) continue;
		if (Array.isArray(v)) {
			blocks.push(
				section(
					fieldLabel(k, t),
					v.length && typeof v[0] === 'object'
						? genericTable(arr(v), t)
						: { kind: 'lead', text: v.join(', ') || '-' }
				)
			);
		} else if (typeof v === 'object') {
			blocks.push(
				section(fieldLabel(k, t), {
					kind: 'facts',
					items: Object.entries(v as Record<string, unknown>).map(([sk, sv]) => [
						fieldLabel(sk, t),
						typeof sv === 'object' ? JSON.stringify(sv) : String(sv)
					])
				})
			);
		} else {
			facts.push([fieldLabel(k, t), String(v)]);
		}
	}
	return facts.length ? [{ kind: 'facts', items: facts }, ...blocks] : blocks;
}

/** A report's data as blocks; a known type that can't read its data falls back to the generic view */
export function reportBlocks(type: string, data: Record<string, unknown>, t: T, auditHref: string): Block[] {
	const render = RENDERERS[type];
	if (!render) return genericBlocks(data, t);
	try {
		return render(data, t, auditHref);
	} catch {
		return genericBlocks(data, t);
	}
}

/** The list the CSV export flattens: the report's main table */
export function csvSection(data: Record<string, unknown>): string | undefined {
	return ['top_applications', 'targets', 'banned_devices', 'recent_alerts'].find(
		(k) => Array.isArray(data[k]) && (data[k] as unknown[]).length
	);
}

function formatDay(v: unknown): string {
	const d = parseDate(`${String(v).slice(0, 10)}T12:00:00Z`);
	return d ? formatDate(d, { hour: undefined, minute: undefined }) : String(v);
}

/** "Period: 1 Nov 2026 to 9 Nov 2026", "Period: all dates" */
export function periodText(filters: Record<string, unknown> | undefined, t: T): string {
	const from = filters?.from ? formatDay(filters.from) : '';
	const to = filters?.to ? formatDay(filters.to) : '';
	if (from && to) return t('reports.period_from_to', { from, to });
	if (from) return t('reports.period_since', { from });
	if (to) return t('reports.period_until', { to });
	return t('reports.period_all');
}

/** The filters the API gets for the two date fields ("to" covers the whole day) */
export function reportFilters(from: string, to: string): { from?: string; to?: string } {
	return { ...(from ? { from } : {}), ...(to ? { to: `${to}T23:59:59.999Z` } : {}) };
}

/* ── Trends ── */

export interface SessionTrend {
	perDay: number[];
	total: number;
	peak: number;
	avgMinutes: number | null;
}

export function sessionTrend(
	sessions: readonly { start: number; end: number | null }[],
	days: readonly Date[]
): SessionTrend {
	const keys = days.map(dayKey);
	const perDay = countPerDay(
		sessions.map((s) => s.start),
		days
	);
	let durTotal = 0;
	let durCount = 0;
	for (const s of sessions) {
		if (!keys.includes(dayKey(new Date(s.start)))) continue;
		if (s.end && s.end > s.start) {
			durTotal += s.end - s.start;
			durCount++;
		}
	}
	const total = perDay.reduce((a, b) => a + b, 0);
	return {
		perDay,
		total,
		peak: perDay.indexOf(Math.max(...perDay)),
		avgMinutes: durCount ? Math.round(durTotal / durCount / 60000) : null
	};
}

export interface HelpTrend {
	opened: number[];
	resolved: number[];
	stillOpen: number;
}

/** A help request counts as resolved on the day it was last changed */
export function helpTrend(
	help: readonly { created: number; updated: number | null; status: string }[],
	days: readonly Date[]
): HelpTrend {
	const opened = countPerDay(
		help.map((r) => r.created),
		days
	);
	const done = help.filter((r) => /resolved|closed/i.test(r.status));
	const resolved = countPerDay(
		done.map((r) => r.updated),
		days
	);
	return { opened, resolved, stillOpen: help.length - done.length };
}

/** "Saved by {user} on {date}" split around the date, so the date can be a <time> */
export function savedByParts(user: string, t: T): [string, string] {
	const parts = t('reports.saved_by', { user, date: '\u0000' }).split('\u0000');
	return [parts[0] ?? '', parts[1] ?? ''];
}
