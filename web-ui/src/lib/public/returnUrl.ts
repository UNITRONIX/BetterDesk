/**
 * Where the sign-in page goes afterwards (BUGS.md R3). The same rules as
 * the server's web-nodejs/lib/returnUrl.js, checked again in the page: a
 * path on this console, after the browser's own normalisation still one
 * leading "/", no backslash or control character (typed or encoded), and
 * not the sign-in pages, sign-out, the API or a socket.
 */

const MAX_LENGTH = 2048;
const ORIGIN = 'http://console.invalid';
const BLOCKED = /^\/(?:api|ws|socket)(?:\/|$)|^\/(?:app\/)?(?:remote\/)?(?:login|logout)(?:\/|$)/i;
// eslint-disable-next-line no-control-regex -- control characters are what this refuses
const CONTROL = /[\u0000-\u001f\u007f\\]/;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i;

/** The path with its query and hash, or null when it may not be followed */
export function safeReturnPath(raw: unknown): string | null {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
	if (CONTROL.test(raw) || ENCODED_CONTROL.test(raw)) return null;
	if (!raw.startsWith('/') || raw.startsWith('//')) return null;
	let url: URL;
	try {
		url = new URL(raw, ORIGIN);
	} catch {
		return null;
	}
	if (url.origin !== ORIGIN || url.pathname.startsWith('//')) return null;
	if (BLOCKED.test(url.pathname)) return null;
	return url.pathname + url.search + url.hash;
}
