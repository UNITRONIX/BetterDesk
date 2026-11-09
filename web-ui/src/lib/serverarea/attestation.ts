/**
 * The capacity test (/server-attestation) without a DOM: how far a run is,
 * what the progress line says, tier names and the report's file name.
 * Tests: tests/unit/server/attestation.test.ts.
 */

import type { Progress, Result } from '#lib/api/serverAttestation.ts';

/** How far the run is, in percent, from its phase (as the old page estimated it) */
export function progressPercent(p: Pick<Progress, 'phase' | 'connections'> | null | undefined): number {
	if (!p) return 10;
	if (p.phase === 'baseline') return 15;
	if (p.phase === 'ramp-up') return 20 + Math.min(60, (p.connections || 0) / 5);
	if (p.phase === 'stabilize') return 85;
	if (p.phase === 'done') return 100;
	return 10;
}

/** The progress line: a key with its English fallback, or the server's own words */
export function phaseText(p: Pick<Progress, 'phase' | 'connections' | 'message'>): {
	key: string | null;
	fallback: string;
	params?: Record<string, number>;
} {
	switch (p.phase) {
		case 'starting':
			return { key: 'server_attestation.starting', fallback: 'Starting…' };
		case 'baseline':
			return { key: 'server_attestation.phase_baseline', fallback: 'Measuring the server at rest…' };
		case 'probe':
			return { key: 'server_attestation.phase_probe', fallback: 'Checking that the test can connect…' };
		case 'ramp-up':
			return {
				key: 'server_attestation.phase_ramp',
				fallback: 'Testing {count} connections…',
				params: { count: p.connections || 0 }
			};
		case 'stabilize':
			return { key: 'server_attestation.phase_stabilize', fallback: 'Letting the server settle…' };
		case 'done':
			return { key: 'server_attestation.complete', fallback: 'Capacity test finished.' };
		default:
			return { key: null, fallback: p.message || p.phase || '' };
	}
}

/** What the end of a run says: stopped, finished with a tier, or without one */
export function outcome(r: Pick<Result, 'aborted' | 'valid'>): 'stopped' | 'complete' | 'incomplete' {
	if (r.aborted) return 'stopped';
	return r.valid ? 'complete' : 'incomplete';
}

/** A tier's name: the admin's own name for it, else the translated one */
export function tierName(
	tier: string | null | undefined,
	labels: Record<string, string>,
	translate: (key: string) => string
): string {
	if (!tier) return translate('server_attestation.tier_none');
	const own = labels[tier]?.trim();
	if (own) return own;
	const key = 'server_attestation.tier_' + tier;
	const v = translate(key);
	return v === key ? tier : v;
}

export function reportFileName(r: Pick<Result, 'testedAt'>, now = Date.now()): string {
	return `betterdesk-server-attestation-${r.testedAt || now}.json`;
}
