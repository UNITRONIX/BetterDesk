/**
 * Where the sign-in page sends someone afterwards (BUGS.md R3, R4).
 *
 * Pages that need a session redirect to /login?return=<the page>, and the
 * sign-in page, the login API and the OIDC start follow that path only when
 * it is a path on this console:
 *
 * - it starts with one "/" and, after the browser's own normalisation
 *   (dot segments), still does: no scheme, no host, no "//";
 * - no backslash and no control character, typed or percent-encoded
 *   (browsers drop tabs and newlines, so "/\t/evil.example" would become
 *   "//evil.example");
 * - not the sign-in pages, sign-out, the API or a socket.
 *
 * "?expired=1" (the "session expired" notice) is added only when the
 * browser still sent a session cookie: a first visit was never signed in.
 *
 * web-ui/src/lib/public/returnUrl.ts checks the same rules in the page.
 */

'use strict';

const MAX_LENGTH = 2048;
const ORIGIN = 'http://console.invalid';
const BLOCKED = /^\/(?:api|ws|socket)(?:\/|$)|^\/(?:app\/)?(?:remote\/)?(?:login|logout)(?:\/|$)/i;
const SESSION_COOKIES = ['bd.sid', 'betterdesk.sid'];

/**
 * @param {unknown} raw
 * @returns {string|null} the path (with query and hash) or null
 */
function safeReturnPath(raw) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH) return null;
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f\\]/.test(raw) || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(raw)) return null;
    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    let url;
    try {
        url = new URL(raw, ORIGIN);
    } catch (_) {
        return null;
    }
    if (url.origin !== ORIGIN || url.pathname.startsWith('//')) return null;
    if (BLOCKED.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
}

/** Whether the request carried a session cookie (the session it named is gone) */
function hadSessionCookie(req) {
    const header = String((req.headers && req.headers.cookie) || '');
    return header.split(';').some((part) => {
        const name = part.split('=', 1)[0].trim();
        return SESSION_COOKIES.includes(name);
    });
}

/**
 * The sign-in page for a request that needs a session: the way back to the
 * page (GET only) and the "expired" notice only when a session ended.
 * @param {import('express').Request} req
 * @param {{ returnTo?: string }} [opts]
 */
function loginRedirectUrl(req, opts = {}) {
    const params = [];
    if (hadSessionCookie(req)) params.push('expired=1');
    const wanted = opts.returnTo !== undefined
        ? opts.returnTo
        : (req.method === 'GET' || req.method === 'HEAD') ? req.originalUrl : null;
    const back = safeReturnPath(wanted);
    if (back) params.push('return=' + encodeURIComponent(back));
    return '/login' + (params.length ? '?' + params.join('&') : '');
}

module.exports = { safeReturnPath, hadSessionCookie, loginRedirectUrl };
