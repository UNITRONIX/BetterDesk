/**
 * Enrollment requests without a DOM: the two queues turned into one row
 * shape, one row per device and queue, the filter, the order, the count
 * line and the waiting requests per source. Tested in
 * tests/unit/clients/registrations.test.ts.
 */

import type { EnrollmentDecision, LanRegistration, PendingEnrollment } from '#lib/api/registrations.ts';
import { parseDate } from '#lib/i18n/format.ts';

/** The console's own queue: BetterDesk clients on the local network */
export const SOURCE_LAN = 'registration';
/** The Go server's queue: RustDesk clients */
export const SOURCE_ENROLLMENT = 'enrollment';
export type Source = typeof SOURCE_LAN | typeof SOURCE_ENROLLMENT;

export type RequestStatus = 'pending' | 'approved' | 'rejected';

export interface RequestRow {
	/** source:id, unique on the page */
	key: string;
	source: Source;
	/** The id the API wants: the LAN row id or the device ID */
	rowId: string;
	device_id: string;
	hostname: string;
	platform: string;
	version: string;
	ip: string;
	status: RequestStatus;
	asked_at: string;
	decided_at: string;
	decided_by: string;
	reason: string;
	banned: boolean;
}

function status(s: string): RequestStatus {
	return s === 'approved' || s === 'rejected' ? s : 'pending';
}

export function fromLan(item: LanRegistration): RequestRow {
	const st = status(item.status);
	return {
		key: `${SOURCE_LAN}:${item.id}`,
		source: SOURCE_LAN,
		rowId: String(item.id),
		device_id: item.device_id,
		hostname: item.hostname,
		platform: item.platform,
		version: item.version,
		ip: item.ip_address || item.ip,
		status: st,
		asked_at: item.created_at,
		decided_at: item.approved_at || (st === 'rejected' ? item.updated_at : ''),
		decided_by: item.approved_by,
		reason: item.rejected_reason,
		banned: false
	};
}

export function fromPending(item: PendingEnrollment): RequestRow {
	return {
		key: `${SOURCE_ENROLLMENT}:${item.device_id}`,
		source: SOURCE_ENROLLMENT,
		rowId: item.device_id,
		device_id: item.device_id,
		hostname: item.hostname,
		platform: item.platform,
		version: item.version,
		ip: item.ip || item.ip_address,
		status: 'pending',
		asked_at: item.created_at,
		decided_at: '',
		decided_by: '',
		reason: '',
		banned: false
	};
}

export function fromHistory(item: EnrollmentDecision): RequestRow {
	return {
		key: `${SOURCE_ENROLLMENT}:${item.device_id}`,
		source: SOURCE_ENROLLMENT,
		rowId: item.device_id,
		device_id: item.device_id,
		hostname: item.hostname,
		platform: item.platform,
		version: item.version,
		ip: item.ip || item.ip_address,
		status: item.status === 'approved' ? 'approved' : 'rejected',
		asked_at: item.created_at,
		decided_at: item.decided_at,
		// The Go server records the console's API key, not the person
		decided_by: /^apikey:/.test(item.actor) ? '' : item.actor,
		reason: '',
		banned: item.banned
	};
}

/** When the row last changed: asked for a waiting one, decided otherwise */
export function rowTime(row: RequestRow): number {
	const d = parseDate(row.status === 'pending' ? row.asked_at : row.decided_at || row.asked_at);
	return d ? d.getTime() : 0;
}

/**
 * One row per device and queue. The Go server keeps a device in its history
 * after a decision and lists it as waiting again when it asks again: the
 * open request wins, otherwise the latest decision.
 */
export function mergeRows(list: readonly RequestRow[]): RequestRow[] {
	const byKey = new Map<string, RequestRow>();
	for (const row of list) {
		const prev = byKey.get(row.key);
		if (!prev) {
			byKey.set(row.key, row);
			continue;
		}
		if (prev.status === 'pending') continue;
		if (row.status === 'pending' || rowTime(row) > rowTime(prev)) byKey.set(row.key, row);
	}
	return [...byKey.values()];
}

/** A decision made on this page: the row keeps showing it until the filter changes */
export interface Decided {
	status: RequestStatus;
	decided_at: string;
	decided_by: string;
	banned?: boolean;
	/** The row as it was, for when it drops out of the server's queue */
	row: RequestRow;
}

export type StatusFilter = '' | RequestStatus;

export function matchesSearch(row: RequestRow, search: string): boolean {
	const needle = search.trim().toLowerCase();
	if (!needle) return true;
	return [row.device_id, row.hostname, row.ip, row.platform, row.version].some((v) =>
		v.toLowerCase().includes(needle)
	);
}

/**
 * The rows to show: decisions made here applied, decided rows kept under
 * Waiting until the filter changes, waiting requests first, newest first.
 */
export function visibleRows(
	rows: readonly RequestRow[],
	decided: ReadonlyMap<string, Decided>,
	filter: StatusFilter,
	search: string
): RequestRow[] {
	const shown = new Map<string, RequestRow>();
	for (const row of rows) {
		const d = decided.get(row.key);
		shown.set(row.key, d ? withDecision(row, d) : row);
	}
	for (const [key, d] of decided) {
		if (!shown.has(key)) shown.set(key, withDecision(d.row, d));
	}
	return [...shown.values()]
		.filter((r) => !filter || r.status === filter || (filter === 'pending' && decided.has(r.key)))
		.filter((r) => matchesSearch(r, search))
		.sort((a, b) => {
			const ap = a.status === 'pending' ? 0 : 1;
			const bp = b.status === 'pending' ? 0 : 1;
			if (ap !== bp) return ap - bp;
			return rowTime(b) - rowTime(a);
		});
}

function withDecision(row: RequestRow, d: Decided): RequestRow {
	return {
		...row,
		hostname: d.row.hostname || row.hostname,
		status: d.status,
		decided_at: d.decided_at,
		decided_by: d.decided_by,
		banned: d.banned ?? row.banned
	};
}

/** Requests still waiting (decisions made here count as done) */
export function waitingRows(
	rows: readonly RequestRow[],
	decided: ReadonlyMap<string, Decided>
): RequestRow[] {
	return rows.filter((r) => r.status === 'pending' && !decided.has(r.key));
}

/** The oldest waiting request, for "3 waiting, oldest 2 h ago" */
export function oldest(rows: readonly RequestRow[]): RequestRow | null {
	let best: RequestRow | null = null;
	for (const r of rows) if (!best || rowTime(r) < rowTime(best)) best = r;
	return best;
}

export function bySource(rows: readonly RequestRow[]): { rustdesk: number; lan: number } {
	let rustdesk = 0;
	let lan = 0;
	for (const r of rows) {
		if (r.source === SOURCE_ENROLLMENT) rustdesk++;
		else lan++;
	}
	return { rustdesk, lan };
}

export type RowAction = 'approve' | 'reject' | 'open' | 'allow-again';

/**
 * The buttons in a row, in order: a waiting request is approved or
 * rejected, an approved one opens its device, a RustDesk client rejected
 * earlier can be allowed again.
 */
export function rowActions(row: RequestRow, decidedHere: boolean): RowAction[] {
	if (row.status === 'pending' && !decidedHere) return ['approve', 'reject'];
	if (row.status === 'approved') return ['open'];
	if (row.status === 'rejected' && row.source === SOURCE_ENROLLMENT && !decidedHere) return ['allow-again'];
	return [];
}

/** Deleting a record: decided LAN requests, with enrollment.manage */
export function canDeleteRecord(row: RequestRow, canManage: boolean): boolean {
	return canManage && row.source === SOURCE_LAN && row.status !== 'pending';
}

export type EnrollmentMode = 'open' | 'managed' | 'locked';

export function enrollmentMode(mode: string | null | undefined): EnrollmentMode {
	return mode === 'open' || mode === 'locked' ? mode : 'managed';
}

/**
 * Which notice the mode needs: none in Managed mode or without waiting
 * RustDesk requests; otherwise what Open or Locked means for them.
 */
export function modeNotice(mode: EnrollmentMode, waitingRustdesk: number): 'open' | 'locked' | null {
	if (mode === 'managed' || waitingRustdesk === 0) return null;
	return mode;
}

/** The tags the approve form sends: picked ones as a comma list */
export function tagsValue(picked: readonly string[]): string {
	return picked
		.map((t) => t.trim())
		.filter(Boolean)
		.join(', ');
}

/** Free-text tags ("a, b ,,c") into a list */
export function splitTags(text: string): string[] {
	return text
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
}
