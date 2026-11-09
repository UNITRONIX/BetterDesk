/**
 * Pairing codes (routes/pairing.routes.js): short one-time codes a
 * BetterDesk client redeems with the server address. Every call needs
 * enrollment.approve. The code itself is only in the create answer.
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

export const PairingCode = v.object({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	label: Text,
	created_at: Text,
	expires_at: Text,
	created_by: Text
});
export type PairingCode = v.InferOutput<typeof PairingCode>;

export async function listCodes(signal?: AbortSignal): Promise<PairingCode[]> {
	const out = await api(
		v.object({ codes: v.optional(v.nullable(v.array(PairingCode))) }),
		'/api/panel/pairing/codes',
		{
			signal
		}
	);
	return out.codes ?? [];
}

export const NewCode = v.object({
	code: Text,
	id: Text,
	host: Text,
	label: Text,
	expires_at: Text,
	expires_in: v.optional(v.nullable(v.number()))
});
export type NewCode = v.InferOutput<typeof NewCode>;

export function createCode(label: string): Promise<NewCode> {
	return api(NewCode, '/api/panel/pairing/codes', { method: 'POST', body: { label } });
}

export async function revokeCode(id: string): Promise<void> {
	await request(`/api/panel/pairing/codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** The address to suggest in the form (the public client endpoint), or '' */
export async function getSuggestedHost(signal?: AbortSignal): Promise<string> {
	return (await api(v.object({ host: Text }), '/api/panel/pairing/host', { signal })).host;
}
