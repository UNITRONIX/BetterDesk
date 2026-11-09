/**
 * Security and audit without a DOM: the tabs and their URL names, the
 * audit log's filters and search, labels for action codes, the device a
 * log line is about, event details as text, the browser a session used,
 * and the server events per day for the chart.
 */

import type { AuditRow } from '#lib/api/audit.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

export const AUDIT_TABS = ['audit', 'events', 'overview', 'hardening', 'sessions'] as const;
export type AuditTab = (typeof AUDIT_TABS)[number];

/** ?tab= as a tab; the old name "vulnerabilities" opens Hardening, anything else the audit log */
export function auditTab(value: string | null | undefined): AuditTab {
	const v = value === 'vulnerabilities' ? 'hardening' : (value ?? '');
	return (AUDIT_TABS as readonly string[]).includes(v) ? (v as AuditTab) : 'audit';
}

/* ── Audit log ── */

export const AUDIT_FILTERS = ['bans', 'signins', 'failed', 'devices', 'people', 'settings'] as const;
export type AuditFilter = (typeof AUDIT_FILTERS)[number];

export function isAuditFilter(v: string | null | undefined): v is AuditFilter {
	return !!v && (AUDIT_FILTERS as readonly string[]).includes(v);
}

const CATEGORY_TESTS: Record<AuditFilter, (action: string) => boolean> = {
	bans: (a) => /(^|_)(un)?ban|banned|blocklist|ip_block/.test(a),
	signins: (a) => /^(login|logout|auth_|session_|2fa_|password_)/.test(a),
	failed: (a) => /(login|auth)(_login)?_failed/.test(a),
	devices: (a) => /^(device_|devices_|enrollment_|folder_|peer_|remote_|registration)/.test(a),
	people: (a) => /^(user_|role_|permission|group_|org_|organization_|invite)/.test(a),
	settings: (a) =>
		/^(settings|setting_|config|theme_|branding_|backup_|restore|server_|update|smtp|commercialization_|billing_|key_|token_|policy)/.test(
			a
		)
};

/** "Device 900100019 banned", "Approved enrollment for device 900200005", "Banned 900100028 (...)" */
const DEVICE_RE =
	/\b(?:device|Device|Banned|Unbanned|Deleted|Restored|Connected to)\s+([A-Za-z0-9_-]*\d[A-Za-z0-9_-]*)\b/;

export interface AuditEntry {
	key: string;
	time: string;
	who: string;
	userId: string | null;
	action: string;
	label: string;
	device: string;
	details: string;
	ip: string;
}

/** An action code in words: the translation, or "device_group_saved" → "Device group saved" */
export function actionLabel(action: string, t: T): string {
	const raw = String(action || '').trim();
	if (!raw) return '';
	const key = `audit.action_${raw.replace(/[^a-z0-9_]/gi, '_')}`;
	const label = t(key);
	if (label && label !== key) return label;
	const words = raw
		.replace(/[_.-]+/g, ' ')
		.trim()
		.toLowerCase();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function toAuditEntries(rows: readonly AuditRow[], t: T): AuditEntry[] {
	return rows.map((r, i) => {
		const m = r.details.match(DEVICE_RE);
		const userId =
			r.user_id === null || r.user_id === undefined || r.user_id === '' ? null : String(r.user_id);
		return {
			key: String(r.id ?? i),
			time: r.created_at,
			who: r.username || (userId ? `#${userId}` : ''),
			userId,
			action: r.action,
			label: actionLabel(r.action, t),
			device: m?.[1] ?? '',
			details: r.details,
			ip: r.ip_address
		};
	});
}

/** Entries of the chosen kind whose text contains the search */
export function filterAudit(
	entries: readonly AuditEntry[],
	query: string,
	type: AuditFilter | ''
): AuditEntry[] {
	const q = query.trim().toLowerCase();
	const test = type ? CATEGORY_TESTS[type] : null;
	return entries.filter((e) => {
		if (test && !test(e.action.toLowerCase())) return false;
		if (!q) return true;
		return [e.who, e.action, e.label, e.device, e.details, e.ip].join(' ').toLowerCase().includes(q);
	});
}

/* ── Server events ── */

export const EVENT_FILTERS = [
	'login_failed',
	'login_success',
	'peer_banned',
	'peer_unbanned',
	'ip_banned',
	'device_approved',
	'config_changed',
	'key_created'
] as const;

/** Event details as one line: "mode: all, version: 3.5" */
export function formatDetails(details: unknown): string {
	if (details === null || details === undefined || details === '') return '';
	if (typeof details !== 'object') return String(details);
	return Object.entries(details as Record<string, unknown>)
		.filter(([, v]) => v !== '' && v !== null && v !== undefined)
		.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
		.join(', ');
}

/** Long details are cut after two lines; shorter ones never get "Show all" */
export const DETAILS_CLAMP = 140;

/* ── Sessions ── */

/** "Chrome 156" and "Windows" from a browser string (either may be empty) */
export function describeUa(ua: string): { browser: string; os: string } {
	const m = (re: RegExp) => ua.match(re)?.[1] ?? '';
	let browser = '';
	if (/Edg\//.test(ua)) browser = `Edge ${m(/Edg\/(\d+)/)}`;
	else if (/OPR\//.test(ua)) browser = `Opera ${m(/OPR\/(\d+)/)}`;
	else if (/Firefox\//.test(ua)) browser = `Firefox ${m(/Firefox\/(\d+)/)}`;
	else if (/Chrome\//.test(ua))
		browser = `${/HeadlessChrome/.test(ua) ? 'Headless Chrome' : 'Chrome'} ${m(/Chrome\/(\d+)/)}`;
	else if (/Safari\//.test(ua)) browser = `Safari ${m(/Version\/(\d+)/)}`;
	let os = '';
	if (/Windows/.test(ua)) os = 'Windows';
	else if (/iPhone|iPad/.test(ua)) os = 'iOS';
	else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
	else if (/Android/.test(ua)) os = 'Android';
	else if (/CrOS/.test(ua)) os = 'ChromeOS';
	else if (/Linux/.test(ua)) os = 'Linux';
	return { browser: browser.trim(), os };
}

export type SessionState = 'current' | 'active' | 'ended';

export function sessionState(s: { current: boolean; active: boolean }): SessionState {
	return s.current ? 'current' : s.active ? 'active' : 'ended';
}
