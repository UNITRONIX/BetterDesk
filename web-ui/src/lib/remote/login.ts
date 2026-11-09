/**
 * The remote client's sign-in (/remote/login): where to go afterwards. Only
 * paths under /remote (not /remote/login itself), as the server's
 * normalizeRdClientReturnUrl allows; in a build for another base, a return
 * path under the base stays there.
 */

export function splitBase(returnParam: string, base: string): { path: string; underBase: boolean } {
	if (
		base &&
		(returnParam === base + '/remote' ||
			returnParam.startsWith(base + '/remote/') ||
			returnParam.startsWith(base + '/remote?'))
	)
		return { path: returnParam.slice(base.length), underBase: true };
	return { path: returnParam, underBase: false };
}

/** The same rule as middleware/auth.js normalizeRdClientReturnUrl, for the address the page goes to */
export function safeRemoteReturn(u: string | null | undefined): string | null {
	if (typeof u !== 'string' || !u) return null;
	if (/[\r\n\0\\]/.test(u) || /%(?:00|0a|0d|5c)/i.test(u)) return null;
	if (!u.startsWith('/') || u.startsWith('//')) return null;
	let parsed: URL;
	try {
		parsed = new URL(u, 'https://betterdesk.local');
	} catch {
		return null;
	}
	if (parsed.origin !== 'https://betterdesk.local') return null;
	if (parsed.pathname !== '/remote' && !parsed.pathname.startsWith('/remote/')) return null;
	if (parsed.pathname === '/remote/login' || parsed.pathname.startsWith('/remote/login/')) return null;
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Six digits: the code field submits on its own once they are in */
export function totpDigits(raw: string): string {
	return raw.replace(/\D/g, '').slice(0, 6);
}
