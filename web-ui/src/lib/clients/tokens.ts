/**
 * Device tokens without a DOM: one status per token, the filter, the count
 * line's numbers and the checks of the two forms. Tested in
 * tests/unit/clients/tokens.test.ts.
 */

import type { DeviceToken } from '#lib/api/tokens.ts';

export type TokenStatusKey = 'pending' | 'active' | 'expired' | 'revoked';
export type TokenTone = 'waiting' | 'good' | 'neutral';

export interface TokenStatus {
	/** The filter group */
	key: TokenStatusKey;
	tone: TokenTone;
	/** tokens.status_* */
	label: 'status_pending' | 'status_used' | 'status_used_up' | 'status_expired' | 'status_revoked';
}

function expiredByDate(t: DeviceToken, now: number): boolean {
	if (t.status !== 'pending' || !t.expires_at) return false;
	const at = Date.parse(t.expires_at);
	return Number.isFinite(at) && at < now;
}

/**
 * Not used yet waits for a device; used still lets devices join; used up,
 * expired and revoked have ended (GUIDE "Data display").
 */
export function tokenStatus(t: DeviceToken, now: number = Date.now()): TokenStatus {
	if (t.status === 'revoked') return { key: 'revoked', tone: 'neutral', label: 'status_revoked' };
	if (t.status === 'expired' || expiredByDate(t, now))
		return { key: 'expired', tone: 'neutral', label: 'status_expired' };
	if (t.status === 'active' && t.max_uses > 0 && t.use_count >= t.max_uses)
		return { key: 'active', tone: 'neutral', label: 'status_used_up' };
	if (t.status === 'active') return { key: 'active', tone: 'good', label: 'status_used' };
	return { key: 'pending', tone: 'waiting', label: 'status_pending' };
}

export type TokenFilter = 'all' | 'pending' | 'active' | 'revoked';

/** Expired tokens were never used, so they sit with "not used yet" */
export function filterTokens(
	list: readonly DeviceToken[],
	filter: TokenFilter,
	search: string,
	now: number = Date.now()
): DeviceToken[] {
	const q = search.trim().toLowerCase();
	return list.filter((t) => {
		if (filter !== 'all') {
			const key = tokenStatus(t, now).key;
			if (filter === 'pending' ? key !== 'pending' && key !== 'expired' : key !== filter) return false;
		}
		if (!q) return true;
		return [t.name, t.token_prefix, t.peer_id, t.note].some((v) => v.toLowerCase().includes(q));
	});
}

export function countTokens(
	list: readonly DeviceToken[],
	now: number = Date.now()
): Record<TokenStatusKey, number> {
	const out: Record<TokenStatusKey, number> = { pending: 0, active: 0, expired: 0, revoked: 0 };
	for (const t of list) out[tokenStatus(t, now).key]++;
	return out;
}

/** Edit and revoke only while the token can still be revoked */
export function tokenMenu(t: DeviceToken): boolean {
	return t.status !== 'revoked';
}

/** The expiry choices, in seconds (0: never) */
export const EXPIRY_CHOICES = [0, 3600, 86400, 604800, 2592000] as const;
export const EXPIRY_LABELS: Record<number, string> = {
	0: 'no_expiration',
	3600: 'expires_1h',
	86400: 'expires_24h',
	604800: 'expires_7d',
	2592000: 'expires_30d'
};

/** "Uses allowed": 0 means no limit; only an empty or invalid field falls back to 1 */
export function usesValue(raw: string | number | null | undefined): number {
	const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
	if (!Number.isFinite(n) || n < 0) return 1;
	return Math.floor(n);
}

/** Bulk "Uses allowed": at least 1 */
export function bulkUsesValue(raw: string | number | null | undefined): number {
	const n = usesValue(raw);
	return n > 0 ? n : 1;
}

/** Bulk: between 1 and 100 tokens */
export function bulkCountOk(raw: string | number): boolean {
	const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
	return Number.isInteger(n) && n >= 1 && n <= 100;
}

/** "Copy all": one name and token per line, separated by a tab */
export function copyAllText(list: readonly { name: string; token: string }[]): string {
	return list.map((t) => `${t.name}\t${t.token}`).join('\n');
}
