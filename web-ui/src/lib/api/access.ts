/**
 * Panel access policies (routes/panel-access.routes.js): which console
 * sections a user or a user group may read or change, and which client
 * features they may use. Reading needs user.view, saving user.edit.
 *
 * A policy is a list of overrides: per section or per catalog group
 * ("group:<key>") an access level, per feature on or off. Anything not in
 * the list falls back (user: own group setting, then the user's groups,
 * then the role; group: not set). Saving replaces the whole list.
 */

import * as v from 'valibot';
import { api, wrapped } from './client.ts';

export const ACCESS_LEVELS = ['none', 'read', 'write'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
const Level = v.pipe(
	v.optional(v.nullable(v.string()), 'none'),
	v.transform((s): AccessLevel =>
		(ACCESS_LEVELS as readonly string[]).includes(s ?? '') ? (s as AccessLevel) : 'none'
	)
);
const Flag = v.pipe(
	v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), false),
	v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
);
const list = <S extends v.GenericSchema>(item: S) =>
	v.pipe(
		v.optional(v.nullable(v.array(item)), null),
		v.transform((a) => a ?? [])
	);

export const AccessCatalog = v.looseObject({
	groups: list(v.looseObject({ key: v.string(), label: Str })),
	sections: list(v.looseObject({ key: v.string(), label: Str, group: Str })),
	features: list(v.looseObject({ key: v.string(), label: Str, hardLock: Flag }))
});
export type AccessCatalog = v.InferOutput<typeof AccessCatalog>;

/** The sections, catalog groups and client features an editor shows. Needs user.view */
export function getAccessCatalog(signal?: AbortSignal): Promise<AccessCatalog> {
	return api(wrapped(AccessCatalog), '/api/panel/access/catalog', { signal });
}

const SectionRow = v.looseObject({ resource_key: v.string(), access_level: Level });
const FeatureRow = v.looseObject({ feature_key: v.string(), enabled: Flag });

const EffectiveSection = v.looseObject({
	access: Level,
	/** user, group or role (for a user); group or unset (for a group) */
	source: Str,
	/** What the role allows (users only) */
	role_ceiling: v.optional(Level)
});
const EffectiveFeature = v.looseObject({
	enabled: Flag,
	/** user, group or default */
	source: Str,
	hard_lock: Flag
});

export const AccessPolicy = v.looseObject({
	sections: list(SectionRow),
	features: list(FeatureRow),
	effective: v.pipe(
		v.optional(
			v.nullable(
				v.looseObject({
					sections: v.optional(v.nullable(v.record(v.string(), EffectiveSection)), null),
					features: v.optional(v.nullable(v.record(v.string(), EffectiveFeature)), null),
					groups: list(v.looseObject({ guid: Str, name: Str }))
				})
			),
			null
		),
		v.transform((e) => ({
			sections: e?.sections ?? {},
			features: e?.features ?? {},
			groups: e?.groups ?? []
		}))
	)
});
export type AccessPolicy = v.InferOutput<typeof AccessPolicy>;

export interface AccessPolicyInput {
	sections: { resource_key: string; access_level: AccessLevel }[];
	features: { feature_key: string; enabled: boolean }[];
}

export type AccessSubject = { kind: 'user'; id: number | string } | { kind: 'group'; guid: string };

function path(subject: AccessSubject): string {
	return subject.kind === 'user'
		? `/api/panel/access/users/${encodeURIComponent(String(subject.id))}`
		: `/api/panel/access/groups/${encodeURIComponent(subject.guid)}`;
}

/** The overrides and what they add up to now. Needs user.view */
export function getAccessPolicy(subject: AccessSubject, signal?: AbortSignal): Promise<AccessPolicy> {
	return api(wrapped(AccessPolicy), path(subject), { signal });
}

/** Replace the overrides; answers with the saved overrides and the new result. Needs user.edit */
export function saveAccessPolicy(subject: AccessSubject, body: AccessPolicyInput): Promise<AccessPolicy> {
	return api(wrapped(AccessPolicy), path(subject), { method: 'PUT', body });
}
