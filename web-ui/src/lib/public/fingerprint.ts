/**
 * The browser fingerprint the sign-in requests send (public/js/login.js
 * buildClientFingerprint): an FNV-1a hash of user agent, language, screen
 * size, time zone offset, CPU count and platform, as 16 hex characters. The
 * server writes it into the sign-in audit entry; it identifies nothing on
 * its own.
 */

export interface FingerprintParts {
	userAgent: string;
	language: string;
	screen: string;
	timezoneOffset: number;
	cpus: number | string;
	platform: string;
}

export function fingerprintOf(p: FingerprintParts): string {
	const parts = [
		p.userAgent,
		p.language,
		p.screen,
		String(p.timezoneOffset),
		String(p.cpus),
		p.platform
	].join('|');
	let hash = 2166136261;
	for (let i = 0; i < parts.length; i++) {
		hash ^= parts.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const hex = (n: number) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
	return hex(hash) + hex(hash ^ parts.length);
}

/** This browser's fingerprint ('' when the browser hides the values) */
export function clientFingerprint(): string {
	try {
		const nav = navigator as Navigator & { platform?: string };
		return fingerprintOf({
			userAgent: nav.userAgent || '',
			language: nav.language || '',
			screen: String(screen.width || '') + 'x' + String(screen.height || ''),
			timezoneOffset: new Date().getTimezoneOffset(),
			cpus: nav.hardwareConcurrency || '',
			platform: nav.platform || ''
		});
	} catch {
		return '';
	}
}
