/**
 * Device identity (routes/policies.routes.js): the hardware fingerprints
 * devices report. The list needs one of the four admin roles.
 *
 * The Go server has no attestation endpoints yet (BUGS.md P5): the list
 * route answers { records: [] } when Go says 404, and there is no Node
 * route for PUT /api/panel/attestation/:deviceId, so marking a device
 * verified or revoked fails until both exist. No record can exist before
 * then, so the page never offers it.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';
import { listIn, Str } from './lists.ts';

const enc = encodeURIComponent;

export const AttestationRecord = v.looseObject({
	device_id: Str,
	hostname: Str,
	fingerprint: Str,
	device_fingerprint: Str,
	status: Str,
	last_check: Str
});
export type AttestationRecord = v.InferOutput<typeof AttestationRecord>;

export async function listAttestation(signal?: AbortSignal): Promise<AttestationRecord[]> {
	return api(listIn(AttestationRecord, 'records', 'data'), '/api/panel/attestation', { signal });
}

/** Mark a device verified or revoked */
export async function setAttestationStatus(deviceId: string, status: 'verified' | 'revoked'): Promise<void> {
	await request(`/api/panel/attestation/${enc(deviceId)}`, { method: 'PUT', body: { status } });
}
