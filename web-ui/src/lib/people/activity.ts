/**
 * App usage without a DOM: the date range the API gets, the presets, the
 * search, the active/idle sentence and the most used apps across devices.
 */

import type { ActivitySummary, Range, TopApp } from '#lib/api/activity.ts';
import { appSeconds } from '#lib/api/activity.ts';
import { isoDay } from './dates.ts';

/** The API compares ISO timestamps as text, so "to" must cover the whole day */
export function rangeOf(from: string, to: string): Range {
	return { from: from || undefined, to: to ? `${to}T23:59:59.999Z` : undefined };
}

/** A preset of the last `days` days (today included); '' is everything */
export function presetRange(days: '' | '7' | '30', now = new Date()): { from: string; to: string } {
	if (!days) return { from: '', to: '' };
	const from = new Date(now);
	from.setDate(from.getDate() - (Number(days) - 1));
	return { from: isoDay(from), to: isoDay(now) };
}

/** Which preset the two dates are, or null when they are something else */
export function presetOf(from: string, to: string, now = new Date()): '' | '7' | '30' | null {
	for (const p of ['', '7', '30'] as const) {
		const r = presetRange(p, now);
		if (r.from === from && r.to === to) return p;
	}
	return null;
}

/** Newest report first */
export function sortReports(list: readonly ActivitySummary[]): ActivitySummary[] {
	return [...list].sort((a, b) => b.reported_at.localeCompare(a.reported_at));
}

export function filterReports(list: readonly ActivitySummary[], query: string): ActivitySummary[] {
	const q = query.trim().toLowerCase();
	if (!q) return list as ActivitySummary[];
	return list.filter((s) => `${s.device_id} ${s.hostname}`.toLowerCase().includes(q));
}

/** Active and idle time over the reports, and the active share in percent (null without any time) */
export function activeIdle(
	list: readonly ActivitySummary[]
): { active: number; idle: number; pct: number } | null {
	let active = 0;
	let idle = 0;
	for (const r of list) {
		active += r.total_active_secs;
		idle += r.idle_seconds;
	}
	if (active + idle <= 0) return null;
	return { active, idle, pct: Math.round((active / (active + idle)) * 100) };
}

export interface AppTotal {
	name: string;
	secs: number;
	devices: number;
}

/** Add up the apps of several devices per app name; the `n` most used, longest first */
export function mergeTopApps(perDevice: readonly (readonly TopApp[])[], n = 8): AppTotal[] {
	const totals = new Map<string, AppTotal>();
	for (const apps of perDevice) {
		for (const a of apps) {
			const name = a.app_name || a.name;
			if (!name) continue;
			const t = totals.get(name) ?? { name, secs: 0, devices: 0 };
			t.secs += appSeconds(a);
			t.devices += 1;
			totals.set(name, t);
		}
	}
	return [...totals.values()]
		.filter((a) => a.secs > 0)
		.sort((a, b) => b.secs - a.secs)
		.slice(0, n);
}
