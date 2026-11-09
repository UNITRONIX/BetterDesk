/**
 * Guest access links (routes/guest.routes.js): time-limited links to the
 * web viewer for some devices, without a console account. The Go server
 * answers without the { success } envelope.
 */

import * as v from 'valibot';
import { api } from './client.ts';

export interface GuestLinkInput {
	peer_ids: string[];
	ttl_minutes: number;
	view_only: boolean;
	label: string;
}

const Created = v.pipe(
	v.looseObject({
		path: v.optional(v.string()),
		expires_at: v.optional(v.nullable(v.string())),
		data: v.optional(
			v.looseObject({ path: v.optional(v.string()), expires_at: v.optional(v.nullable(v.string())) })
		)
	}),
	v.transform((o) => ({
		path: o.data?.path ?? o.path ?? '',
		expires_at: o.data?.expires_at ?? o.expires_at ?? ''
	}))
);

/** Create a link; returns the full URL to share */
export async function createGuestLink(input: GuestLinkInput): Promise<{ url: string; expiresAt: string }> {
	const out = await api(Created, '/api/guest/access-links', { method: 'POST', body: input });
	return { url: location.origin + out.path, expiresAt: out.expires_at ?? '' };
}
