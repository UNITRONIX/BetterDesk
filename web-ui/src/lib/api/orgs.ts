/**
 * Organizations (routes/organizations.routes.js, a proxy to the Go server's
 * /api/org). Go answers without the { success, data } envelope: lists as
 * { organizations }, { users }, ..., single objects bare, deletes with 204.
 * Reads need a session (members and invitations need org.manage_users),
 * writes the org.* permission named on each function.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';

const enc = (s: string) => encodeURIComponent(s);

/** Text that is always a string ('' for missing or null) */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
const base = (id: string) => `/api/panel/org/${enc(id)}`;
const Any = v.unknown();

/** A list under `key`, or [] when Go sends null */
function listOf<S extends v.GenericSchema>(key: string, item: S) {
	return v.pipe(
		v.looseObject({ [key]: v.optional(v.nullable(v.array(item)), null) }),
		v.transform((o) => ((o as Record<string, unknown>)[key] as v.InferOutput<S>[] | null) ?? [])
	);
}

export const Organization = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Str,
	slug: Str,
	logo_url: Str,
	settings: Str,
	created_at: v.optional(v.nullable(v.string()))
});
export type Organization = v.InferOutput<typeof Organization>;

export function listOrgs(signal?: AbortSignal): Promise<Organization[]> {
	return api(listOf('organizations', Organization), '/api/panel/org', { signal });
}

export function getOrg(id: string, signal?: AbortSignal): Promise<Organization> {
	return api(Organization, base(id), { signal });
}

export interface OrgInput {
	name: string;
	slug: string;
	logo_url: string;
}

/** Needs org.create */
export function createOrg(body: OrgInput) {
	return api(Any, '/api/panel/org', { method: 'POST', body });
}

/** Needs org.edit */
export function updateOrg(id: string, body: OrgInput) {
	return api(Any, base(id), { method: 'PUT', body });
}

/** Needs org.delete */
export function deleteOrg(id: string) {
	return request(base(id), { method: 'DELETE' });
}

/* ── Members ── */

export const OrgUser = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	server_user_id: v.optional(v.nullable(v.number())),
	username: Str,
	display_name: Str,
	email: Str,
	role: Str,
	avatar_url: Str,
	last_login: v.optional(v.nullable(v.string())),
	created_at: v.optional(v.nullable(v.string()))
});
export type OrgUser = v.InferOutput<typeof OrgUser>;

/** Needs user.view and org.manage_users */
export function listOrgUsers(id: string, signal?: AbortSignal): Promise<OrgUser[]> {
	return api(listOf('users', OrgUser), `${base(id)}/users`, { signal });
}

/** Needs org.manage_users: a new account that belongs to this organization */
export function createOrgUser(id: string, body: { username: string; password: string; role: string }) {
	return api(Any, `${base(id)}/users`, { method: 'POST', body });
}

/** Needs org.manage_users */
export function setOrgUserRole(id: string, uid: string, role: string) {
	return api(Any, `${base(id)}/users/${enc(uid)}`, { method: 'PUT', body: { role } });
}

/** Needs org.manage_users */
export function removeOrgUser(id: string, uid: string) {
	return request(`${base(id)}/users/${enc(uid)}`, { method: 'DELETE' });
}

export const ServerUser = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(Number)),
	username: Str,
	role: Str
});
export type ServerUser = v.InferOutput<typeof ServerUser>;

/** Server accounts not in this organization yet. Needs org.manage_users */
export function listAvailableUsers(id: string, signal?: AbortSignal): Promise<ServerUser[]> {
	return api(listOf('users', ServerUser), `${base(id)}/available-users`, { signal });
}

/** Link a server account (Go user id). Needs org.manage_users */
export function addOrgMember(id: string, userId: number, role: string) {
	return api(Any, `${base(id)}/members`, { method: 'POST', body: { user_id: userId, role } });
}

/* ── Invitations ── */

export const OrgInvitation = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	token: Str,
	email: Str,
	role: Str,
	expires_at: v.optional(v.nullable(v.string())),
	used_at: v.optional(v.nullable(v.string()))
});
export type OrgInvitation = v.InferOutput<typeof OrgInvitation>;

/** Needs org.manage_users */
export function listInvitations(id: string, signal?: AbortSignal): Promise<OrgInvitation[]> {
	return api(listOf('invitations', OrgInvitation), `${base(id)}/invitations`, { signal });
}

/** Needs org.manage_users */
export function createInvitation(
	id: string,
	body: { email: string; role: string; expires_in_hours: number }
) {
	return api(Any, `${base(id)}/invite`, { method: 'POST', body });
}

/* ── Devices ── */

export const OrgDevice = v.looseObject({
	device_id: Str,
	assigned_user_id: Str,
	department: Str,
	location: Str,
	building: Str,
	tags: Str
});
export type OrgDevice = v.InferOutput<typeof OrgDevice>;

export function listOrgDevices(id: string, signal?: AbortSignal): Promise<OrgDevice[]> {
	return api(listOf('devices', OrgDevice), `${base(id)}/devices`, { signal });
}

/** Needs org.manage_devices */
export function assignOrgDevice(
	id: string,
	body: { device_id: string; department: string; building: string }
) {
	return api(Any, `${base(id)}/devices`, { method: 'POST', body });
}

/** Needs org.manage_devices */
export function unassignOrgDevice(id: string, deviceId: string) {
	return request(`${base(id)}/devices/${enc(deviceId)}`, { method: 'DELETE' });
}

const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), 0),
	v.transform((n) => Number(n) || 0)
);

export const OrgDeviceGroup = v.looseObject({
	guid: Str,
	name: Str,
	note: Str,
	source_type: Str,
	tag_filter: Str,
	member_count: Num,
	allowed_user_groups: v.pipe(
		v.optional(v.nullable(v.array(v.looseObject({ guid: Str, name: Str }))), null),
		v.transform((a) => a ?? [])
	)
});
export type OrgDeviceGroup = v.InferOutput<typeof OrgDeviceGroup>;

export const OrgUserGroup = v.looseObject({ guid: Str, name: Str, note: Str, member_count: Num });
export type OrgUserGroup = v.InferOutput<typeof OrgUserGroup>;

/** Device groups and user groups linked to this organization (team_id) */
export async function listOrgGroups(
	id: string,
	signal?: AbortSignal
): Promise<{ deviceGroups: OrgDeviceGroup[]; userGroups: OrgUserGroup[] }> {
	const out = await api(
		v.looseObject({
			device_groups: v.optional(v.nullable(v.array(OrgDeviceGroup)), null),
			user_groups: v.optional(v.nullable(v.array(OrgUserGroup)), null)
		}),
		`${base(id)}/device-groups`,
		{ signal }
	);
	return { deviceGroups: out.device_groups ?? [], userGroups: out.user_groups ?? [] };
}

/* ── Settings ── */

export const OrgSetting = v.looseObject({ key: Str, value: Str });
export type OrgSetting = v.InferOutput<typeof OrgSetting>;

export function listOrgSettings(id: string, signal?: AbortSignal): Promise<OrgSetting[]> {
	return api(listOf('settings', OrgSetting), `${base(id)}/settings`, { signal });
}

/** One key per call. Needs org.edit */
export function saveOrgSetting(id: string, key: string, value: string) {
	return api(Any, `${base(id)}/settings`, { method: 'PUT', body: { key, value } });
}

/* ── Shared address book ── */

export const AddressBook = v.looseObject({
	/** The book as JSON text or as an object */
	data: v.optional(v.unknown()),
	enabled: v.pipe(
		v.optional(v.nullable(v.boolean()), true),
		v.transform((b) => b !== false)
	)
});
export type AddressBook = v.InferOutput<typeof AddressBook>;

export function getAddressBook(id: string, signal?: AbortSignal): Promise<AddressBook> {
	return api(AddressBook, `${base(id)}/address-book`, { signal });
}

/** Needs org.edit */
export function saveAddressBook(id: string, data: unknown, enabled: boolean) {
	return api(Any, `${base(id)}/address-book`, { method: 'PUT', body: { data, enabled } });
}

/** Device IDs in the book that have a stored password (flags only, never the password) */
export async function listPeerCredentials(id: string, signal?: AbortSignal): Promise<Set<string>> {
	const list = await api(
		listOf('credentials', v.looseObject({ peer_id: Str, password_set: v.optional(v.nullable(v.boolean())) })),
		`${base(id)}/peer-credentials`,
		{ signal }
	);
	return new Set(
		list.filter((c) => c.peer_id.trim() && c.password_set !== false).map((c) => c.peer_id.trim())
	);
}

/** Needs org.edit */
export function setPeerCredential(id: string, peerId: string, password: string) {
	return api(Any, `${base(id)}/peer-credentials/${enc(peerId)}`, { method: 'PUT', body: { password } });
}

/** Needs org.edit */
export function clearPeerCredential(id: string, peerId: string) {
	return request(`${base(id)}/peer-credentials/${enc(peerId)}`, { method: 'DELETE' });
}

/* ── Support packages (billing.view) ── */

export const Contract = v.looseObject({
	id: Str,
	target_type: Str,
	target_key: Str,
	org_id: Str,
	target_name: Str,
	package_name: Str,
	status: Str
});
export type Contract = v.InferOutput<typeof Contract>;

/** Needs billing.view */
export function listContracts(signal?: AbortSignal): Promise<Contract[]> {
	return api(listOf('contracts', Contract), '/api/panel/billing/contracts', { signal });
}
