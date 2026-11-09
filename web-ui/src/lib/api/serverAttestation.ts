/**
 * The capacity test (routes/server-attestation.routes.js): run, stop, the
 * last result and the sign-in page badge. Every call needs
 * server.attestation. Answers are `{ success: true, ...fields }`.
 */

import * as v from 'valibot';
import { api } from './client.ts';

/* Fields that are always there in the output, whatever the server leaves out */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null ? '' : String(s)))
);
const Bool = v.pipe(
	v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), false),
	v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
);

export const TIERS = ['bronze', 'iron', 'platinum', 'titanium', 'obsidian'] as const;
export type Tier = (typeof TIERS)[number];

const Num = v.optional(v.nullable(v.number()), null);

/** A test result; extra fields (ramp steps, probe log) stay for the report download */
export const Result = v.looseObject({
	valid: Bool,
	mode: Str,
	tier: v.optional(v.nullable(v.string()), null),
	maxConnections: Num,
	signalConnections: Num,
	relaySessions: Num,
	testedAt: v.optional(v.nullable(v.string()), null),
	aborted: Bool,
	finalMetrics: v.optional(v.nullable(v.looseObject({ cpu: Num, mem: Num, disk: Num })), null)
});
export type Result = v.InferOutput<typeof Result>;

export const Progress = v.looseObject({
	phase: Str,
	connections: Num,
	message: Str,
	result: v.optional(v.nullable(Result), null)
});
export type Progress = v.InferOutput<typeof Progress>;

export const Status = v.looseObject({
	running: Bool,
	progress: v.optional(v.nullable(Progress), null),
	lastResult: v.optional(v.nullable(Result), null)
});
export type Status = v.InferOutput<typeof Status>;

export function getStatus(signal?: AbortSignal) {
	return api(Status, '/api/server-attestation/status', { signal });
}

export function runTest() {
	return api(v.looseObject({ started: v.optional(v.boolean()) }), '/api/server-attestation/run', {
		method: 'POST'
	});
}

export function stopTest() {
	return api(v.looseObject({ aborted: v.optional(v.boolean()) }), '/api/server-attestation/abort', {
		method: 'POST'
	});
}

const Labels = v.pipe(
	v.optional(v.nullable(v.record(v.string(), v.unknown())), {}),
	v.transform((r) => {
		const out: Record<string, string> = {};
		for (const [k, val] of Object.entries(r ?? {})) if (typeof val === 'string') out[k] = val;
		return out;
	})
);

export const BadgeConfig = v.looseObject({ badgeTitle: Str, tierLabels: Labels });
export type BadgeConfig = v.InferOutput<typeof BadgeConfig>;

export const BadgePresentation = v.looseObject({ brand: Str, badgeTitle: Str, tierLabels: Labels });
export type BadgePresentation = v.InferOutput<typeof BadgePresentation>;

const Badge = v.looseObject({
	config: v.optional(BadgeConfig, { badgeTitle: '', tierLabels: {} }),
	presentation: v.optional(v.nullable(BadgePresentation), null)
});
export type Badge = v.InferOutput<typeof Badge>;

export function getBadge(signal?: AbortSignal) {
	return api(Badge, '/api/server-attestation/badge-config', { signal });
}

export function saveBadge(config: { badgeTitle: string; tierLabels: Record<string, string> }) {
	return api(Badge, '/api/server-attestation/badge-config', { method: 'PUT', body: config });
}
