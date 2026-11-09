/**
 * Organization policies (routes/policies.routes.js, proxied to the Go
 * server's /api/org/{id}/policy): five groups per organization, each saved
 * on its own, and the change log the Go server keeps in memory.
 *
 * listOrgs and the two counts read /api/panel/org (routes/organizations.routes.js);
 * they are here only for the Policies page and can move to an
 * organizations API file when that page is ported.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';
import { listIn, Str } from './lists.ts';

const enc = encodeURIComponent;

const Id = v.pipe(v.union([v.string(), v.number()]), v.transform(String));

export const Org = v.looseObject({ id: Id, name: Str });
export type Org = v.InferOutput<typeof Org>;

/** The Go server answers { organizations }, older builds a bare list or { data } */
const OrgList = listIn(Org, 'organizations', 'data');

export async function listOrgs(signal?: AbortSignal): Promise<Org[]> {
	return api(OrgList, '/api/panel/org', { signal });
}

const Group = v.optional(v.nullable(v.record(v.string(), v.unknown())), null);

/** One organization's policies by group; a group never saved is {} (or missing) */
export const Policies = v.looseObject({
	connection: Group,
	features: Group,
	security: Group,
	network: Group,
	update: Group
});
export type Policies = v.InferOutput<typeof Policies>;

const PoliciesAnswer = v.pipe(
	v.unknown(),
	v.transform((o) => {
		const inner = o && typeof o === 'object' ? (o as Record<string, unknown>).data : undefined;
		return inner && typeof inner === 'object' && !Array.isArray(inner) ? inner : o;
	}),
	Policies
);

export async function getPolicies(orgId: string, signal?: AbortSignal): Promise<Policies> {
	return api(PoliciesAnswer, `/api/panel/policies/${enc(orgId)}`, { signal });
}

/** PUT one group; the server stores the body as it is */
export async function savePolicyGroup(
	orgId: string,
	group: string,
	body: Record<string, unknown>
): Promise<void> {
	await request(`/api/panel/policies/${enc(orgId)}/${enc(group)}`, { method: 'PUT', body });
}

export const AuditEntry = v.looseObject({
	timestamp: Str,
	created_at: Str,
	action: Str,
	actor: Str,
	user: Str,
	target: Str,
	section: Str,
	category: Str,
	detail: Str,
	description: Str,
	details: v.optional(v.nullable(v.record(v.string(), v.unknown())), null)
});
export type AuditEntry = v.InferOutput<typeof AuditEntry>;

/** Go answers { entries } (null when there are none) */
const AuditAnswer = listIn(AuditEntry, 'entries', 'data');

export async function getPolicyAudit(orgId: string, signal?: AbortSignal): Promise<AuditEntry[]> {
	return api(AuditAnswer, `/api/panel/policies/${enc(orgId)}/audit`, { signal });
}

const Listed = (key: string) =>
	v.pipe(
		listIn(v.unknown(), key),
		v.transform((a) => a.length)
	);

/** Devices in the organization (any signed-in user) */
export async function countOrgDevices(orgId: string, signal?: AbortSignal): Promise<number> {
	return api(Listed('devices'), `/api/panel/org/${enc(orgId)}/devices`, { signal });
}

/** People in the organization (needs user.view and org.manage_users) */
export async function countOrgUsers(orgId: string, signal?: AbortSignal): Promise<number> {
	return api(Listed('users'), `/api/panel/org/${enc(orgId)}/users`, { signal });
}
