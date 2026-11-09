/**
 * Pairing codes without a DOM: how long a new code still works and the
 * status of a listed one. Tested in tests/unit/clients/pairing.test.ts.
 */

import { parseDate } from '#lib/i18n/format.ts';

/** A code lives 10 minutes unless the server says otherwise */
export const DEFAULT_TTL_S = 600;

export type Remaining = { kind: 'expired' } | { kind: 'under_minute' } | { kind: 'minutes'; count: number };

/** "10 more minutes", counted down in whole minutes */
export function remaining(seconds: number): Remaining {
	if (seconds <= 0) return { kind: 'expired' };
	if (seconds < 60) return { kind: 'under_minute' };
	return { kind: 'minutes', count: Math.ceil(seconds / 60) };
}

/** When a new code stops working, from the create answer's expires_in */
export function endsAt(expiresIn: number | null | undefined, now: number = Date.now()): number {
	const s = Number(expiresIn);
	return now + (Number.isFinite(s) && s > 0 ? s : DEFAULT_TTL_S) * 1000;
}

/** A listed code waits for its device until it runs out (the list may be older than that) */
export function codeExpired(expiresAt: string, now: number = Date.now()): boolean {
	const d = parseDate(expiresAt);
	return !!d && d.getTime() <= now;
}
