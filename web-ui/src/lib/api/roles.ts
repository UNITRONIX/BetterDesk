/**
 * Roles and permission overrides (routes/permissions.routes.js, a proxy to
 * the Go server's /api/roles and /api/role-permissions). Reading roles needs
 * user.view, reading overrides server.config; changing them needs a super
 * admin (commit 024540ff).
 */

import * as v from 'valibot';
import { api, Ok, wrapped } from './client.ts';

const Strings = v.pipe(
	v.optional(v.nullable(v.array(v.string())), null),
	v.transform((a) => a ?? [])
);

export const RoleInfo = v.looseObject({
	name: v.string(),
	level: v.pipe(
		v.optional(v.nullable(v.number()), 0),
		v.transform((n) => n ?? 0)
	),
	is_super_admin: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	),
	is_server_level: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	),
	/** The role's defaults */
	permissions: Strings
});
export type RoleInfo = v.InferOutput<typeof RoleInfo>;

export async function listRoles(signal?: AbortSignal): Promise<{ roles: RoleInfo[]; all: string[] }> {
	const out = await api(
		wrapped(
			v.looseObject({ roles: v.optional(v.nullable(v.array(RoleInfo)), null), all_permissions: Strings })
		),
		'/api/panel/roles',
		{ signal }
	);
	return { roles: out.roles ?? [], all: out.all_permissions };
}

/** What the role has now: defaults with the overrides applied */
export async function roleEffective(role: string, signal?: AbortSignal): Promise<string[]> {
	const out = await api(
		wrapped(v.looseObject({ permissions: Strings })),
		`/api/panel/roles/${encodeURIComponent(role)}/permissions`,
		{ signal }
	);
	return out.permissions;
}

export const RoleOverride = v.looseObject({
	role: v.string(),
	permission: v.string(),
	granted: v.pipe(
		v.union([v.boolean(), v.number()]),
		v.transform((b) => b === true || b === 1)
	)
});
export type RoleOverride = v.InferOutput<typeof RoleOverride>;

/** Needs server.config */
export async function listOverrides(signal?: AbortSignal): Promise<RoleOverride[]> {
	const out = await api(
		wrapped(v.looseObject({ overrides: v.optional(v.nullable(v.array(RoleOverride)), null) })),
		'/api/panel/role-permissions',
		{ signal }
	);
	return out.overrides ?? [];
}

/** Allow or deny one permission for a role. Needs a super admin */
export function setOverride(role: string, permission: string, granted: boolean) {
	return api(Ok, '/api/panel/role-permissions', { method: 'POST', body: { role, permission, granted } });
}

/** Back to the role's default for one permission. Needs a super admin */
export function clearOverride(role: string, permission: string) {
	return api(
		Ok,
		`/api/panel/role-permissions/${encodeURIComponent(role)}/${encodeURIComponent(permission)}`,
		{
			method: 'DELETE'
		}
	);
}
