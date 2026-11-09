/**
 * App usage reports from devices with the BetterDesk agent's activity
 * tracking (routes/activity.routes.js). Every call needs audit.view.
 * Answers come without the { success, data } envelope. `from` and `to`
 * are ISO strings compared to the report time as text.
 */

import * as v from 'valibot';
import { api } from './client.ts';

const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), 0),
	v.transform((n) => Number(n) || 0)
);

export interface Range {
	from?: string | undefined;
	to?: string | undefined;
}

export const ActivitySummary = v.looseObject({
	device_id: Str,
	hostname: Str,
	idle_seconds: Num,
	session_count: Num,
	total_active_secs: Num,
	reported_at: Str
});
export type ActivitySummary = v.InferOutput<typeof ActivitySummary>;

export async function listActivity(range: Range, signal?: AbortSignal): Promise<ActivitySummary[]> {
	const out = await api(
		v.union([
			v.array(ActivitySummary),
			v.pipe(
				v.looseObject({ summaries: v.optional(v.nullable(v.array(ActivitySummary)), null) }),
				v.transform((o) => o.summaries ?? [])
			)
		]),
		'/api/activity',
		{ query: { from: range.from, to: range.to }, signal }
	);
	return out;
}

export const TopApp = v.looseObject({
	app_name: Str,
	name: Str,
	category: Str,
	total_secs: v.optional(v.nullable(v.number())),
	total_seconds: v.optional(v.nullable(v.number())),
	session_count: Num
});
export type TopApp = v.InferOutput<typeof TopApp>;

/** Seconds an app was used (older servers send total_seconds) */
export const appSeconds = (a: TopApp) => Number(a.total_secs ?? a.total_seconds) || 0;

export async function topApps(
	id: string,
	range: Range & { limit?: number },
	signal?: AbortSignal
): Promise<TopApp[]> {
	const out = await api(
		v.union([
			v.array(TopApp),
			v.pipe(
				v.looseObject({ top_apps: v.optional(v.nullable(v.array(TopApp)), null) }),
				v.transform((o) => o.top_apps ?? [])
			)
		]),
		`/api/activity/${encodeURIComponent(id)}/top`,
		{ query: { from: range.from, to: range.to, limit: range.limit }, signal }
	);
	return out;
}

export const AppSession = v.looseObject({
	app_name: Str,
	window_title: Str,
	category: Str,
	started_at: Str,
	session_start: Str,
	duration_secs: v.optional(v.nullable(v.number())),
	duration_seconds: v.optional(v.nullable(v.number()))
});
export type AppSession = v.InferOutput<typeof AppSession>;

export async function deviceSessions(id: string, range: Range, signal?: AbortSignal): Promise<AppSession[]> {
	const out = await api(
		v.union([
			v.array(AppSession),
			v.pipe(
				v.looseObject({ sessions: v.optional(v.nullable(v.array(AppSession)), null) }),
				v.transform((o) => o.sessions ?? [])
			)
		]),
		`/api/activity/${encodeURIComponent(id)}`,
		{ query: { from: range.from, to: range.to }, signal }
	);
	return out;
}
