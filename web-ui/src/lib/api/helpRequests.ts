/**
 * Help requests (routes/registration.routes.js): someone pressed the help
 * button in the desktop app. The list and both actions need chat.access.
 * The list is the newest 200, normalised by the console (Go's
 * "acknowledged" arrives as "accepted", times in ms). Accept and resolve
 * answer Go's raw result, which the page doesn't read.
 */

import * as v from 'valibot';
import { api, Ok, Text } from './client.ts';

/** What GET /api/help/requests returns at most */
export const HELP_LIST_LIMIT = 200;

const Millis = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()]))),
	v.transform((n) => {
		if (n === null || n === undefined || n === '') return null;
		const num = typeof n === 'number' ? n : Number(n);
		if (Number.isFinite(num)) return num;
		const parsed = Date.parse(String(n));
		return Number.isFinite(parsed) ? parsed : null;
	})
);

export interface HelpRequest {
	id: string;
	device_id: string;
	hostname: string;
	message: string;
	/** pending, accepted or resolved */
	status: string;
	accepted_by: string;
	resolved_by: string;
	/** ms, or null when unknown */
	created_at: number | null;
	/** When it last changed (ms); undefined when the console doesn't send it */
	updated_at?: number | null;
}

export const HelpRequest = v.pipe(
	v.looseObject({
		id: v.union([v.string(), v.number()]),
		device_id: Text,
		hostname: Text,
		message: Text,
		status: Text,
		accepted_by: Text,
		resolved_by: Text,
		created_at: Millis,
		updated_at: Millis
	}),
	v.transform((o): HelpRequest => {
		const r: HelpRequest = {
			id: String(o.id),
			device_id: o.device_id ?? '',
			hostname: o.hostname ?? '',
			message: o.message ?? '',
			// Go says acknowledged; the console normalises it, older ones may not
			status: o.status === 'acknowledged' ? 'accepted' : (o.status ?? ''),
			accepted_by: o.accepted_by ?? '',
			resolved_by: o.resolved_by ?? '',
			created_at: o.created_at ?? null
		};
		if ('updated_at' in o && o.updated_at !== undefined) r.updated_at = o.updated_at;
		return r;
	})
);

const List = v.pipe(
	v.looseObject({ success: v.optional(v.boolean()), requests: v.array(HelpRequest) }),
	v.transform((o) => o.requests)
);

export function listHelpRequests(signal?: AbortSignal): Promise<HelpRequest[]> {
	return api(List, '/api/help/requests', { signal });
}

export async function acceptHelpRequest(id: string): Promise<void> {
	await api(Ok, `/api/help/requests/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

export async function resolveHelpRequest(id: string): Promise<void> {
	await api(Ok, `/api/help/requests/${encodeURIComponent(id)}/resolve`, { method: 'POST' });
}
