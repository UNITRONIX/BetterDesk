/**
 * Security and audit (routes/security-audit.routes.js, the console audit
 * log in routes/settings.routes.js and the person's own sessions in
 * routes/auth.routes.js). Everything here needs audit.view, except the own
 * sessions (any signed-in person).
 */

import * as v from 'valibot';
import { api, wrapped } from './client.ts';

const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
const Num = v.pipe(
	v.optional(v.nullable(v.number()), null),
	v.transform((n) => n ?? null)
);
const Flag = v.pipe(
	v.optional(v.nullable(v.boolean()), null),
	v.transform((b) => b ?? null)
);

/* ── Console audit log ── */

export const AuditRow = v.looseObject({
	id: v.optional(v.union([v.number(), v.string()])),
	user_id: v.optional(v.nullable(v.union([v.number(), v.string()]))),
	username: Str,
	action: Str,
	details: Str,
	ip_address: Str,
	created_at: Str
});
export type AuditRow = v.InferOutput<typeof AuditRow>;

/** What people did in this console, newest first */
export function listAuditLog(limit = 2000, signal?: AbortSignal): Promise<AuditRow[]> {
	return api(wrapped(v.array(AuditRow)), '/api/settings/audit', { query: { limit }, signal });
}

/* ── Server events (Go) ── */

export const ServerEvent = v.looseObject({
	timestamp: Str,
	created_at: Str,
	action: Str,
	actor: Str,
	user: Str,
	target: Str,
	resource: Str,
	details: v.optional(v.unknown())
});
export type ServerEvent = v.InferOutput<typeof ServerEvent>;

const EventsAnswer = v.pipe(
	v.looseObject({
		data: v.optional(v.unknown()),
		total: v.optional(v.nullable(v.number())),
		events: v.optional(v.nullable(v.array(ServerEvent))),
		items: v.optional(v.nullable(v.array(ServerEvent)))
	}),
	v.transform((o) => {
		// Some versions wrap the Go body in { data }
		const inner =
			o.data && typeof o.data === 'object'
				? (o.data as { total?: number; events?: unknown; items?: unknown })
				: o;
		const raw = (inner.events ?? inner.items ?? o.events ?? o.items ?? []) as unknown[];
		const events = raw.map((e) => v.parse(ServerEvent, e));
		const total =
			typeof inner.total === 'number' ? inner.total : typeof o.total === 'number' ? o.total : null;
		return { events, total };
	})
);

export function listServerEvents(
	q: { limit: number; offset?: number; action?: string },
	signal?: AbortSignal
): Promise<{ events: ServerEvent[]; total: number | null }> {
	return api(EventsAnswer, '/api/panel/security-audit/events', {
		query: { limit: q.limit, offset: q.offset, action: q.action },
		signal
	});
}

/* ── Checks ── */

export const SecurityCheck = v.looseObject({
	id: Str,
	name: Str,
	pass: v.optional(v.nullable(v.boolean())),
	passed: v.optional(v.nullable(v.boolean()))
});

export const Overview = v.looseObject({
	score: v.optional(v.nullable(v.number())),
	checks: v.pipe(
		v.optional(v.nullable(v.array(SecurityCheck)), null),
		v.transform((a) => (a ?? []).map((c) => ({ id: c.id, name: c.name, pass: !!(c.pass ?? c.passed) })))
	),
	stats: v.pipe(
		v.optional(
			v.nullable(
				v.looseObject({
					failed_logins: Num,
					bans: Num,
					active_bans: Num,
					config_changes: Num,
					api_keys: Num,
					old_keys: Num
				})
			),
			null
		),
		v.transform((s) => ({
			failed_logins: s?.failed_logins ?? null,
			bans: s?.bans ?? s?.active_bans ?? null,
			config_changes: s?.config_changes ?? null,
			api_keys: s?.api_keys ?? null,
			old_keys: s?.old_keys ?? null
		}))
	),
	tls: v.pipe(
		v.optional(v.nullable(v.looseObject({ signal: Flag, relay: Flag, api: Flag, wss: Flag })), null),
		v.transform((tl) => ({
			signal: tl?.signal ?? null,
			relay: tl?.relay ?? null,
			api: tl?.api ?? null,
			wss: tl?.wss ?? null
		}))
	)
});
export type Overview = v.InferOutput<typeof Overview>;

export function getOverview(signal?: AbortSignal): Promise<Overview> {
	return api(Overview, '/api/panel/security-audit/overview', { signal });
}

/* ── Hardening and dependency scan ── */

export const HardeningItem = v.looseObject({
	id: Str,
	name: Str,
	category: Str,
	severity: Str,
	implemented: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	),
	description: Str
});
export type HardeningItem = v.InferOutput<typeof HardeningItem>;

export async function listHardening(signal?: AbortSignal): Promise<HardeningItem[]> {
	const out = await api(
		v.looseObject({
			priorities: v.optional(v.nullable(v.array(HardeningItem)), null),
			items: v.optional(v.nullable(v.array(HardeningItem)), null)
		}),
		'/api/panel/security-audit/hardening',
		{ signal }
	);
	return out.priorities ?? out.items ?? [];
}

export const Vulnerability = v.looseObject({
	package: Str,
	name: Str,
	title: Str,
	description: Str,
	severity: Str
});
export type Vulnerability = v.InferOutput<typeof Vulnerability>;

export const VulnScan = v.looseObject({
	scan_available: v.optional(v.nullable(v.boolean())),
	counts: v.pipe(
		v.optional(
			v.nullable(v.looseObject({ total: Num, critical: Num, high: Num, medium: Num, low: Num })),
			null
		),
		v.transform((c) => ({
			total: c?.total ?? 0,
			critical: c?.critical ?? 0,
			high: c?.high ?? 0,
			medium: c?.medium ?? 0,
			low: c?.low ?? 0
		}))
	),
	vulnerabilities: v.pipe(
		v.optional(v.nullable(v.array(Vulnerability)), null),
		v.transform((a) => a ?? [])
	)
});
export type VulnScan = v.InferOutput<typeof VulnScan>;

export function getVulnerabilities(signal?: AbortSignal): Promise<VulnScan> {
	return api(VulnScan, '/api/panel/security-audit/vulnerabilities', { signal });
}

/* ── Own sessions ── */

const Time = v.optional(v.nullable(v.union([v.number(), v.string()])), null);

export const PanelSession = v.looseObject({
	id: Str,
	current: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	),
	active: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	),
	ipAddress: Str,
	userAgent: Str,
	createdAt: Time,
	lastActivityAt: Time,
	endedAt: Time,
	endReason: Str
});
export type PanelSession = v.InferOutput<typeof PanelSession>;

export async function listMySessions(
	signal?: AbortSignal
): Promise<{ sessions: PanelSession[]; idleTimeoutMs: number; maxAgeMs: number }> {
	const out = await api(
		wrapped(
			v.looseObject({
				sessions: v.optional(v.nullable(v.array(PanelSession)), null),
				policy: v.optional(
					v.nullable(
						v.looseObject({
							idleTimeoutMs: v.optional(v.nullable(v.number())),
							maxAgeMs: v.optional(v.nullable(v.number()))
						})
					)
				)
			})
		),
		'/api/auth/sessions',
		{ signal }
	);
	return {
		sessions: out.sessions ?? [],
		idleTimeoutMs: out.policy?.idleTimeoutMs ?? 0,
		maxAgeMs: out.policy?.maxAgeMs ?? 0
	};
}

/* ── Profile pictures for the "who" column ── */

/** Account id → picture version, for everyone who has a picture (any signed-in person) */
export async function listAvatarVersions(signal?: AbortSignal): Promise<Map<string, string>> {
	const out = await api(
		wrapped(
			v.looseObject({
				users: v.optional(
					v.nullable(v.array(v.looseObject({ id: v.union([v.number(), v.string()]), avatar_version: Str }))),
					null
				)
			})
		),
		'/api/users/avatars',
		{ signal }
	);
	return new Map(
		(out.users ?? []).filter((u) => u.avatar_version).map((u) => [String(u.id), u.avatar_version])
	);
}
