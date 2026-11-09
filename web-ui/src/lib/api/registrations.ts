/**
 * Enrollment requests (routes/registration.routes.js). Two queues share the
 * page:
 * - BetterDesk clients that found the server on the local network and ask
 *   for its settings: the console's own table (/api/registrations, numeric ids)
 * - RustDesk clients that asked to join while enrollment needed approval:
 *   the Go server's queue (/api/enrollment/*, device ids)
 *
 * Every call needs enrollment.approve, except deleting a LAN record
 * (enrollment.manage). The Go proxies answer HTTP 200 with
 * `{ success: false }` when the Go server fails; those calls throw here.
 */

import * as v from 'valibot';
import { ApiError, api, clientMessages, request } from './client.ts';

/** Text the server may leave out, send as null or as a number; always a string here */
const Text = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);
const Bool = v.optional(
	v.pipe(
		v.nullable(v.union([v.boolean(), v.number(), v.string()])),
		v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
	),
	false
);

/* The stored row also carries the device's access token and key; the schema
   keeps only what the page shows, so they never reach the page's state */
export const LanRegistration = v.object({
	id: v.union([v.number(), v.string()]),
	device_id: Text,
	hostname: Text,
	platform: Text,
	version: Text,
	ip_address: Text,
	ip: Text,
	status: Text,
	approved_by: Text,
	approved_at: Text,
	rejected_reason: Text,
	created_at: Text,
	updated_at: Text
});
export type LanRegistration = v.InferOutput<typeof LanRegistration>;

export const PendingEnrollment = v.object({
	device_id: Text,
	hostname: Text,
	platform: Text,
	version: Text,
	ip: Text,
	ip_address: Text,
	created_at: Text
});
export type PendingEnrollment = v.InferOutput<typeof PendingEnrollment>;

export const EnrollmentDecision = v.object({
	device_id: Text,
	hostname: Text,
	platform: Text,
	version: Text,
	ip: Text,
	ip_address: Text,
	status: Text,
	banned: Bool,
	decided_at: Text,
	created_at: Text,
	actor: Text
});
export type EnrollmentDecision = v.InferOutput<typeof EnrollmentDecision>;

const ListOf = <S extends v.GenericSchema>(item: S) =>
	v.looseObject({
		success: v.optional(v.boolean()),
		error: v.optional(v.unknown()),
		data: v.optional(v.nullable(v.array(item)), [])
	});

/** A Go proxy answered 200 with success: false */
function upstream<T extends { success?: boolean; error?: unknown }>(out: T): T {
	if (out.success === false) {
		const msg =
			typeof out.error === 'string' && out.error
				? out.error
				: clientMessages.failed.replace('{status}', '502');
		throw new ApiError(msg, 502, { code: 'upstream_error', data: out });
	}
	return out;
}

export async function listLanRegistrations(signal?: AbortSignal): Promise<LanRegistration[]> {
	const out = await api(ListOf(LanRegistration), '/api/registrations', { signal });
	return upstream(out).data ?? [];
}

export async function listPendingEnrollments(signal?: AbortSignal): Promise<PendingEnrollment[]> {
	const out = await api(ListOf(PendingEnrollment), '/api/enrollment/pending', { signal });
	return upstream(out).data ?? [];
}

export async function listEnrollmentHistory(signal?: AbortSignal): Promise<EnrollmentDecision[]> {
	const out = await api(ListOf(EnrollmentDecision), '/api/enrollment/history', { signal });
	return upstream(out).data ?? [];
}

export const EnrollmentUi = v.object({
	mode: v.optional(v.string(), 'managed'),
	rich_approve: v.optional(v.boolean(), true),
	tag_picker: v.optional(v.boolean(), true)
});
export type EnrollmentUi = v.InferOutput<typeof EnrollmentUi>;

/** The enrollment mode and which approve fields the server wants (any approver may read it) */
export async function getEnrollmentUi(signal?: AbortSignal): Promise<EnrollmentUi> {
	const out = await api(
		v.looseObject({ success: v.optional(v.boolean()), data: EnrollmentUi }),
		'/api/registrations/enrollment-ui',
		{
			signal
		}
	);
	return out.data;
}

export type SyncMode = 'standard' | 'silent' | 'turbo';

export interface ApproveInput {
	display_name: string;
	tags: string;
	folder_id: number;
	group_guids: string[];
	/** RustDesk clients only */
	sync_mode?: SyncMode;
}

const Result = v.looseObject({ success: v.optional(v.boolean()), error: v.optional(v.unknown()) });

export async function approveLan(id: string, body: ApproveInput): Promise<void> {
	await request(`/api/registrations/${encodeURIComponent(id)}/approve`, { method: 'PUT', body });
}

export async function approveEnrollment(deviceId: string, body: ApproveInput): Promise<void> {
	upstream(
		await api(Result, `/api/enrollment/approve/${encodeURIComponent(deviceId)}`, { method: 'POST', body })
	);
}

export async function rejectLan(id: string, reason: string): Promise<void> {
	await request(`/api/registrations/${encodeURIComponent(id)}/reject`, { method: 'PUT', body: { reason } });
}

export async function rejectEnrollment(deviceId: string, ban: boolean): Promise<void> {
	upstream(
		await api(Result, `/api/enrollment/reject/${encodeURIComponent(deviceId)}`, {
			method: 'POST',
			body: { ban }
		})
	);
}

export async function clearRejection(deviceId: string): Promise<void> {
	upstream(
		await api(Result, `/api/enrollment/clear-rejection/${encodeURIComponent(deviceId)}`, { method: 'POST' })
	);
}

/** Needs enrollment.manage */
export async function deleteLanRegistration(id: string): Promise<void> {
	await request(`/api/registrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
