/**
 * Network monitoring (routes/network.routes.js, /api/network): targets the
 * server checks, their history, and the monitor loop. Reading needs
 * device.view; adding, editing, deleting and starting or stopping the
 * monitor need server.config; running a check needs device.connect. The
 * answers are bare (no { success, data } wrapper).
 */

import * as v from 'valibot';
import { api, request } from './client.ts';

const Str = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

const Num = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => {
			if (n === null || n === '') return null;
			const num = Number(n);
			return Number.isFinite(num) ? num : null;
		})
	),
	null
);

/** SQLite booleans (0/1) as well as true/false; missing counts as on, as the server stores it */
const OnOff = v.optional(
	v.pipe(
		v.nullable(v.union([v.boolean(), v.number(), v.string()])),
		v.transform((b) => !(b === false || b === 0 || b === '0' || b === 'false'))
	),
	true
);

export type CheckType = 'ping' | 'tcp' | 'http' | 'https';
export const CHECK_TYPES: readonly CheckType[] = ['ping', 'tcp', 'http', 'https'];

export const Target = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Str,
	host: Str,
	port: Num,
	url: Str,
	check_type: v.optional(
		v.pipe(
			v.nullable(v.string()),
			v.transform((s): CheckType => (CHECK_TYPES.includes(s as CheckType) ? (s as CheckType) : 'ping'))
		),
		'ping'
	),
	interval_ms: Num,
	enabled: OnOff,
	/** 'up', 'down', or '' before the first check */
	last_status: Str,
	last_rtt_ms: Num,
	last_check_at: Str
});
export type Target = v.InferOutput<typeof Target>;

export function listTargets(signal?: AbortSignal): Promise<Target[]> {
	return api(v.array(Target), '/api/network/targets', { signal });
}

export interface TargetInput {
	name: string;
	host: string;
	check_type: CheckType;
	port: number | null;
	interval_ms: number;
	enabled: boolean;
}

export function createTarget(body: TargetInput): Promise<Target> {
	return api(Target, '/api/network/targets', { method: 'POST', body });
}

export function updateTarget(id: string, body: TargetInput): Promise<Target> {
	return api(Target, `/api/network/targets/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export async function deleteTarget(id: string): Promise<void> {
	await request(`/api/network/targets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const CheckResult = v.looseObject({ status: Str, rtt_ms: Num, error: Str });
export type CheckResult = v.InferOutput<typeof CheckResult>;

/** Check now (device.connect): the result of this one check */
export function checkTarget(id: string): Promise<CheckResult> {
	return api(CheckResult, `/api/network/targets/${encodeURIComponent(id)}/check`, { method: 'POST' });
}

export const HistoryEntry = v.looseObject({
	checked_at: Str,
	status: Str,
	rtt_ms: Num,
	error_msg: Str,
	status_code: Num
});
export type HistoryEntry = v.InferOutput<typeof HistoryEntry>;

/** The last `limit` checks of a target, newest first */
export function targetHistory(id: string, limit = 100, signal?: AbortSignal): Promise<HistoryEntry[]> {
	return api(v.array(HistoryEntry), `/api/network/targets/${encodeURIComponent(id)}/history`, {
		query: { limit },
		signal
	});
}

const Monitor = v.looseObject({ running: v.optional(v.nullable(v.boolean()), false) });

export async function monitorRunning(signal?: AbortSignal): Promise<boolean> {
	const out = await api(Monitor, '/api/network/monitor/status', { signal });
	return out.running === true;
}

/** The monitor loop runs this often and checks each target when its own interval is due */
export const MONITOR_TICK_MS = 30_000;

export async function startMonitor(): Promise<void> {
	await request('/api/network/monitor/start', { method: 'POST', body: { interval_ms: MONITOR_TICK_MS } });
}

export async function stopMonitor(): Promise<void> {
	await request('/api/network/monitor/stop', { method: 'POST', body: {} });
}
