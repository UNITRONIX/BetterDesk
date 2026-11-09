/**
 * Help request rules without a DOM: which requests a filter shows, their
 * order, what a fresh list keeps of changes made on this page, the counts
 * per status and the opened/resolved trend. The page and its tests use
 * these.
 */

import type { HelpRequest } from '#lib/api/helpRequests.ts';

/** '' is All; 'open' is waiting or accepted */
export type HelpFilter = 'open' | 'pending' | 'accepted' | 'resolved' | '';
export type HelpSort = 'oldest' | 'newest';

/** Same key as the old page, so the choice carries over */
export const PREF_HELP_SORT = 'betterdesk_help_requests_sort';
export const TREND_DAYS = 14;

/** A request changed here, waiting for the server to report the same */
export type LocalRequest = HelpRequest & { local?: boolean };

export function isHelpFilter(v: unknown): v is HelpFilter {
	return v === 'open' || v === 'pending' || v === 'accepted' || v === 'resolved' || v === '';
}

export function matchesFilter(r: HelpRequest, filter: HelpFilter): boolean {
	if (!filter) return true;
	if (filter === 'open') return r.status === 'pending' || r.status === 'accepted';
	return r.status === filter;
}

/**
 * The rows to show. Requests changed on this page (touched) stay in view
 * until the filter changes, so the new status shows next to the row the
 * operator acted on.
 */
export function visibleRequests(
	list: readonly HelpRequest[],
	filter: HelpFilter,
	sort: HelpSort,
	touched: ReadonlySet<string>
): HelpRequest[] {
	const out = list.filter((r) => touched.has(r.id) || matchesFilter(r, filter));
	const at = (r: HelpRequest) => r.created_at ?? 0;
	out.sort((a, b) => (sort === 'oldest' ? at(a) - at(b) : at(b) - at(a)));
	return out;
}

function rank(status: string): number {
	return status === 'resolved' ? 2 : status === 'accepted' ? 1 : 0;
}

/**
 * A fresh list from the server. A request this page just accepted or
 * resolved keeps that state until the server reports it (the list can lag
 * behind the action by a poll).
 */
export function mergeFresh(current: readonly LocalRequest[], fresh: readonly HelpRequest[]): LocalRequest[] {
	const byId = new Map(current.map((r) => [r.id, r]));
	return fresh.map((r) => {
		const local = byId.get(r.id);
		if (local?.local && local.status !== r.status && rank(local.status) > rank(r.status)) return local;
		return r;
	});
}

export function countWaiting(list: readonly HelpRequest[]): number {
	return list.filter((r) => r.status === 'pending').length;
}

/** The oldest waiting request (for "The oldest waiting request was sent 5 minutes ago") */
export function oldestWaiting(list: readonly HelpRequest[]): HelpRequest | null {
	let oldest: HelpRequest | null = null;
	for (const r of list) {
		if (r.status !== 'pending') continue;
		if (!oldest || (r.created_at ?? Infinity) < (oldest.created_at ?? Infinity)) oldest = r;
	}
	return oldest;
}

export interface StatusCounts {
	pending: number;
	accepted: number;
	resolved: number;
}

export function statusCounts(list: readonly HelpRequest[]): StatusCounts {
	const c: StatusCounts = { pending: 0, accepted: 0, resolved: 0 };
	for (const r of list) {
		if (r.status === 'pending' || r.status === 'accepted' || r.status === 'resolved') c[r.status]++;
	}
	return c;
}

/** Status word tone: waiting for someone, taken (good), resolved (nothing left to do) */
export function statusTone(status: string): 'waiting' | 'good' | 'neutral' {
	return status === 'pending' ? 'waiting' : status === 'accepted' ? 'good' : 'neutral';
}

function dayKey(d: Date): string {
	return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export interface Trend {
	days: Date[];
	opened: number[];
	resolved: number[];
	/** The server sends when a request last changed; without it only openings are counted */
	hasUpdated: boolean;
	/** The list stopped at its limit and the oldest request is newer than the first day */
	capped: boolean;
}

/**
 * Opened and resolved per day for the last `days` days (today included).
 * Opened counts on the day a request came in; resolved on the day of its
 * last change (the server keeps no separate resolve time).
 */
export function trend(
	list: readonly HelpRequest[],
	limit: number,
	now = new Date(),
	days = TREND_DAYS
): Trend {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const dayList: Date[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(today.getDate() - i);
		dayList.push(d);
	}
	const index = new Map(dayList.map((d, i) => [dayKey(d), i]));
	const opened = dayList.map(() => 0);
	const resolved = dayList.map(() => 0);
	const hasUpdated = list.some((r) => r.updated_at !== undefined);
	let oldest = Infinity;
	for (const r of list) {
		if (r.created_at !== null) {
			oldest = Math.min(oldest, r.created_at);
			const i = index.get(dayKey(new Date(r.created_at)));
			if (i !== undefined) opened[i] = (opened[i] ?? 0) + 1;
		}
		if (r.status === 'resolved' && r.updated_at) {
			const i = index.get(dayKey(new Date(r.updated_at)));
			if (i !== undefined) resolved[i] = (resolved[i] ?? 0) + 1;
		}
	}
	const first = dayList[0]?.getTime() ?? 0;
	const capped = list.length >= limit && oldest > first;
	return { days: dayList, opened, resolved, hasUpdated, capped };
}
