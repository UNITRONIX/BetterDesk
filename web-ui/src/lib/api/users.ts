/**
 * Console users and user groups (routes/users.routes.js). Only what other
 * pages need so far; the users page adds the rest when it is ported.
 */

import * as v from 'valibot';
import { api, request, wrapped, Ok, Text } from './client.ts';

export const UserGroup = v.looseObject({
	guid: v.string(),
	name: Text,
	note: Text
});
export type UserGroup = v.InferOutput<typeof UserGroup>;

/** Needs user.view or device.edit */
export async function listUserGroups(signal?: AbortSignal): Promise<UserGroup[]> {
	const out = await api(wrapped(v.looseObject({ groups: v.array(UserGroup) })), '/api/panel/user-groups', {
		signal
	});
	return out.groups;
}

export const UserRow = v.looseObject({
	id: v.union([v.number(), v.string()]),
	username: Text,
	role: Text
});
export type UserRow = v.InferOutput<typeof UserRow>;

/** Needs user.view */
export async function listUsers(signal?: AbortSignal): Promise<UserRow[]> {
	const out = await api(wrapped(v.looseObject({ users: v.array(UserRow) })), '/api/users', { signal });
	return out.users;
}

/* ── The users page (routes/users.routes.js) ── */

/** Text that is always a string ('' for missing or null) */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);

const StrArray = v.pipe(
	v.optional(v.nullable(v.array(v.union([v.string(), v.number()]))), null),
	v.transform((a) => (a ?? []).map(String))
);

/** A console account as GET /api/users lists it */
export const ConsoleUser = v.looseObject({
	id: v.union([v.number(), v.string()]),
	username: Str,
	role: Str,
	email: Str,
	auth_provider: Str,
	created_at: v.optional(v.nullable(v.string())),
	last_login: v.optional(v.nullable(v.string())),
	user_groups: StrArray,
	folder_ids: StrArray,
	peer_grants: StrArray,
	strategy_guid: Str,
	has_avatar: v.optional(v.nullable(v.boolean())),
	avatar_version: v.optional(v.nullable(v.union([v.string(), v.number()]))),
	/** Two-factor sign-in is on (older servers leave it out) */
	totp_enabled: v.optional(v.nullable(v.union([v.boolean(), v.number()])))
});
export type ConsoleUser = v.InferOutput<typeof ConsoleUser>;

/** Every account with its groups, folders and direct devices. Needs user.view */
export async function listConsoleUsers(signal?: AbortSignal): Promise<ConsoleUser[]> {
	const out = await api(wrapped(v.looseObject({ users: v.array(ConsoleUser) })), '/api/users', { signal });
	return out.users;
}

/** What a new or edited account gets; the server changes only the keys sent */
export interface UserInput {
	username?: string;
	password?: string;
	role?: string;
	email?: string;
	groupGuids?: string[];
	folderIds?: number[];
	peerIds?: string[];
	strategyGuid?: string;
}

/** Needs user.create; the role must be one the caller may give */
export function createUser(body: UserInput & { username: string; password: string }) {
	return api(Ok, '/api/users', { method: 'POST', body });
}

/** Needs user.edit */
export function updateUser(id: number | string, body: UserInput) {
	return api(Ok, `/api/users/${encodeURIComponent(String(id))}`, { method: 'PATCH', body });
}

/** Needs user.delete; never yourself */
export function deleteUser(id: number | string) {
	return api(Ok, `/api/users/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
}

/** Needs user.edit (local accounts) */
export function resetUserPassword(id: number | string, newPassword: string) {
	return api(Ok, `/api/users/${encodeURIComponent(String(id))}/reset-password`, {
		method: 'POST',
		body: { newPassword }
	});
}

export const EffectiveScope = v.object({
	count: v.pipe(
		v.optional(v.nullable(v.number()), 0),
		v.transform((n) => n ?? 0)
	),
	restricted: v.pipe(
		v.optional(v.nullable(v.boolean()), false),
		v.transform((b) => !!b)
	)
});
export type EffectiveScope = v.InferOutput<typeof EffectiveScope>;

/** How many devices the account can see. Needs user.view */
export function getEffectiveScope(id: number | string, signal?: AbortSignal): Promise<EffectiveScope> {
	return api(wrapped(EffectiveScope), `/api/users/${encodeURIComponent(String(id))}/effective-scope`, {
		signal
	});
}

/** An organization the account belongs to, with its role there */
export const UserOrg = v.pipe(
	v.looseObject({
		id: Str,
		org_id: Str,
		organization_id: Str,
		name: Str,
		org_name: Str,
		role: Str
	}),
	v.transform((o) => {
		const id = o.org_id || o.id || o.organization_id;
		const name = o.org_name || o.name;
		return { id, name, role: o.role };
	})
);
export type UserOrg = v.InferOutput<typeof UserOrg>;

/** Needs user.view (Go answers without `success`) */
export async function listUserOrgs(id: number | string, signal?: AbortSignal): Promise<UserOrg[]> {
	const out = await api(
		v.looseObject({ organizations: v.optional(v.nullable(v.array(UserOrg)), null) }),
		`/api/users/${encodeURIComponent(String(id))}/organizations`,
		{ signal }
	);
	return (out.organizations ?? []).filter((o) => o.id);
}

/** Needs org.manage_users */
export function addUserToOrg(id: number | string, orgId: string, role: string) {
	return request(`/api/users/${encodeURIComponent(String(id))}/organizations`, {
		method: 'POST',
		body: { org_id: orgId, role }
	});
}

/** Needs org.manage_users; userId is the console user id */
export function removeUserFromOrg(orgId: string, userId: number | string) {
	return request(
		`/api/panel/org/${encodeURIComponent(orgId)}/members/${encodeURIComponent(String(userId))}`,
		{ method: 'DELETE' }
	);
}

/* ── User groups ── */

export const UserGroupRow = v.looseObject({
	...UserGroup.entries,
	name: Str,
	note: Str,
	team_id: Str,
	member_count: v.pipe(
		v.optional(v.nullable(v.number()), 0),
		v.transform((n) => n ?? 0)
	)
});
export type UserGroupRow = v.InferOutput<typeof UserGroupRow>;

/** With member counts. Needs user.view or device.edit */
export async function listUserGroupRows(signal?: AbortSignal): Promise<UserGroupRow[]> {
	const out = await api(wrapped(v.looseObject({ groups: v.array(UserGroupRow) })), '/api/panel/user-groups', {
		signal
	});
	return out.groups;
}

/** Needs user.edit. PATCH replaces name and note (name is required) */
export function saveUserGroup(guid: string | null, body: { name: string; note: string }) {
	return guid
		? api(Ok, `/api/panel/user-groups/${encodeURIComponent(guid)}`, { method: 'PATCH', body })
		: api(Ok, '/api/panel/user-groups', { method: 'POST', body });
}

/** Needs user.edit */
export function deleteUserGroup(guid: string) {
	return api(Ok, `/api/panel/user-groups/${encodeURIComponent(guid)}`, { method: 'DELETE' });
}
