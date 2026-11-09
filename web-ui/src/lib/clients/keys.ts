/**
 * Client setup (/keys) without a DOM: host checks for the warnings, host
 * and port for the connection diagram, which next steps apply in which
 * enrollment mode. Tested in tests/unit/clients/keys.test.ts.
 */

import type { EnrollmentMode } from '#lib/api/enrollment.ts';

/** Same key as the overview: its client address override, per browser tab (#368) */
export const CLIENT_HOST_KEY = 'bd_client_config_host';

/** The overview's override for this tab, or '' */
export function storedClientHost(): string {
	try {
		return (sessionStorage.getItem(CLIENT_HOST_KEY) ?? '').trim();
	} catch {
		return '';
	}
}

/** localhost, loopback or "any": other computers and phones can't reach it */
export function isLocalHost(host: string | null | undefined): boolean {
	const h = String(host ?? '')
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, '');
	return h === 'localhost' || h === '::1' || h.startsWith('127.') || h === '0.0.0.0';
}

/** "host:port" or "[v6]:port" into its parts; a bare host keeps the default port */
export function splitHostPort(
	value: string | null | undefined,
	defaultPort: number
): { host: string; port: number } {
	const v = String(value ?? '').trim();
	const m = /^\[([^\]]+)\](?::(\d+))?$/.exec(v) ?? /^([^:]+):(\d+)$/.exec(v);
	if (m) return { host: m[1] ?? '', port: m[2] ? Number(m[2]) : defaultPort };
	return { host: v, port: defaultPort };
}

/**
 * Two warnings say "phones can't reach this address"; show one. The values
 * warning wins: it covers computers too.
 */
export function warnings(host: string, phoneUnreachable: boolean): { local: boolean; qr: boolean } {
	const local = isLocalHost(host);
	return { local, qr: phoneUnreachable && !local };
}

export type NextStep = 'registrations' | 'tokens' | 'pairing' | 'devices';

/**
 * The links under "After the client is set up". Enrollment requests only
 * matter in Managed mode (or when the mode is unknown); each link needs
 * the permission its page needs.
 */
export function nextSteps(
	mode: EnrollmentMode | null,
	can: { approve: boolean; manage: boolean }
): NextStep[] {
	const out: NextStep[] = [];
	if (can.approve && (mode === null || mode === 'managed')) out.push('registrations');
	if (can.manage) out.push('tokens');
	if (can.approve) out.push('pairing');
	out.push('devices');
	return out;
}
