/**
 * Client app branding (routes/client-branding.routes.js, Go /api/branding):
 * the name, contact details, accent colour and logo BetterDesk clients and
 * support agents show. Needs branding.edit.
 */

import * as v from 'valibot';
import { api } from './client.ts';

const Text = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

export const BrandingLogo = v.object({
	mime: Text,
	data_base64: Text,
	url: Text
});
export type BrandingLogo = v.InferOutput<typeof BrandingLogo>;

export const ClientBranding = v.object({
	company_name: Text,
	phone: Text,
	email: Text,
	website: Text,
	support_contact: Text,
	accent_color: Text,
	revision: Text,
	logo: v.optional(v.nullable(BrandingLogo), null)
});
export type ClientBranding = v.InferOutput<typeof ClientBranding>;

export async function getClientBranding(signal?: AbortSignal): Promise<ClientBranding> {
	return (
		(
			await api(v.object({ data: v.optional(v.nullable(ClientBranding)) }), '/api/client-branding', {
				signal
			})
		).data ?? v.parse(ClientBranding, {})
	);
}

export interface BrandingInput {
	company_name: string;
	phone: string;
	email: string;
	website: string;
	support_contact: string;
	accent_color: string;
	logo?: { mime: string; data_base64?: string; url?: string };
	clear_logo?: true;
}

/** Saves and resolves what the server keeps (its revision is the save time) */
export async function saveClientBranding(body: BrandingInput): Promise<ClientBranding> {
	const out = await api(
		v.object({
			data: v.optional(v.nullable(v.union([v.object({ branding: ClientBranding }), ClientBranding])), null),
			revision: v.optional(v.nullable(v.union([v.string(), v.number()])))
		}),
		'/api/client-branding',
		{ method: 'POST', body }
	);
	const data = out.data && 'branding' in out.data ? out.data.branding : out.data;
	const saved = data ?? v.parse(ClientBranding, {});
	// The saved data's own revision wins over the one next to it
	if (!saved.revision && out.revision !== undefined && out.revision !== null)
		return { ...saved, revision: String(out.revision) };
	return saved;
}
