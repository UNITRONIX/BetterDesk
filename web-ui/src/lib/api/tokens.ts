/**
 * Device tokens (routes/tokens.routes.js, Go /api/tokens). Every call needs
 * enrollment.manage. A new token's value is in the create answer only.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';

const Text = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);
const Num = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => (n === null || n === '' ? 0 : Number(n) || 0))
	),
	0
);

export const DeviceToken = v.object({
	id: v.pipe(v.union([v.number(), v.string()]), v.transform(String)),
	name: Text,
	token_prefix: Text,
	status: Text,
	max_uses: Num,
	use_count: Num,
	peer_id: Text,
	note: Text,
	expires_at: Text,
	created_at: Text,
	created_by: Text
});
export type DeviceToken = v.InferOutput<typeof DeviceToken>;

/** A token as created: its whole value, shown once */
export const NewToken = v.object({
	id: v.optional(v.pipe(v.union([v.number(), v.string()]), v.transform(String))),
	name: Text,
	token: Text
});
export type NewToken = v.InferOutput<typeof NewToken>;

export async function listTokens(signal?: AbortSignal): Promise<DeviceToken[]> {
	const out = await api(
		v.object({
			data: v.optional(v.nullable(v.object({ tokens: v.optional(v.nullable(v.array(DeviceToken))) })))
		}),
		'/api/panel/tokens',
		{ query: { include_revoked: 'true' }, signal }
	);
	return out.data?.tokens ?? [];
}

export interface TokenInput {
	name: string;
	/** 0: no limit */
	max_uses: number;
	note: string;
	/** Seconds; 0: never. Only when creating */
	expires_in?: number;
}

export async function createToken(body: TokenInput): Promise<NewToken | null> {
	const out = await api(v.object({ data: v.optional(v.nullable(NewToken)) }), '/api/panel/tokens', {
		method: 'POST',
		body
	});
	return out.data && out.data.token ? out.data : null;
}

export async function updateToken(id: string, body: TokenInput): Promise<void> {
	await request(`/api/panel/tokens/${encodeURIComponent(id)}`, { method: 'PUT', body });
}

export interface BulkInput {
	count: number;
	name_prefix: string;
	max_uses: number;
	expires_in: number;
}

export async function createTokens(body: BulkInput): Promise<NewToken[]> {
	const out = await api(
		v.object({
			data: v.optional(v.nullable(v.object({ tokens: v.optional(v.nullable(v.array(NewToken))) })))
		}),
		'/api/panel/tokens/generate-bulk',
		{ method: 'POST', body }
	);
	return (out.data?.tokens ?? []).filter((t) => t.token);
}

/** Revokes (the token stays in the list as revoked) */
export async function revokeToken(id: string): Promise<void> {
	await request(`/api/panel/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
