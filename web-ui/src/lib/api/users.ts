/**
 * Console users and user groups (routes/users.routes.js). Only what other
 * pages need so far; the users page adds the rest when it is ported.
 */

import * as v from 'valibot';
import { api, wrapped, Text } from './client.ts';

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
