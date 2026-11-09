/**
 * Device identity without a DOM: each record's status group, tone and
 * label, the order of the list (problems first, then devices waiting, then
 * verified ones) and the counts for the share bar.
 */

import type { AttestationRecord } from '#lib/api/attestation.ts';
import type { Tone } from '#lib/util/display.ts';

export type AttGroup = 'verified' | 'pending' | 'failed';

export interface AttStatus {
	group: AttGroup;
	tone: Tone;
	/** Key under attestation.* */
	labelKey: string;
}

export function attStatus(raw: string): AttStatus {
	const s = (raw || 'pending').toLowerCase();
	if (s === 'verified' || s === 'trusted')
		return { group: 'verified', tone: 'good', labelKey: 'attestation.verified' };
	if (s === 'mismatch') return { group: 'failed', tone: 'danger', labelKey: 'attestation.status_mismatch' };
	if (s === 'revoked') return { group: 'failed', tone: 'neutral', labelKey: 'attestation.status_revoked' };
	if (s === 'failed') return { group: 'failed', tone: 'danger', labelKey: 'attestation.failed' };
	return { group: 'pending', tone: 'waiting', labelKey: 'attestation.pending' };
}

const ORDER: Record<AttGroup, number> = { failed: 0, pending: 1, verified: 2 };

/** Problems first, then devices still waiting, then verified ones (stable within a group) */
export function sortRecords(list: readonly AttestationRecord[]): AttestationRecord[] {
	return list
		.map((r, i) => ({ r, i }))
		.sort((a, b) => ORDER[attStatus(a.r.status).group] - ORDER[attStatus(b.r.status).group] || a.i - b.i)
		.map((x) => x.r);
}

export function countGroups(list: readonly AttestationRecord[]): Record<AttGroup, number> {
	const n = { verified: 0, pending: 0, failed: 0 };
	for (const r of list) n[attStatus(r.status).group]++;
	return n;
}

export const fingerprintOf = (r: AttestationRecord) => r.fingerprint || r.device_fingerprint;
export const canVerify = (r: AttestationRecord) => !!r.device_id && attStatus(r.status).group !== 'verified';
export const canRevoke = (r: AttestationRecord) => !!r.device_id && r.status.toLowerCase() !== 'revoked';
