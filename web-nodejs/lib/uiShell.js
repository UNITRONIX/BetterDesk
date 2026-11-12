/**
 * BetterDesk Console — UI shell resolution (UX 3.5 default, UX 3.6 beta).
 *
 * The shell choice is a per-browser preference. It is resolved in exactly one
 * place so SSR markup, CSS/JS includes and `window.BetterDesk.uiShell` cannot
 * disagree, and every unknown or malformed value falls back to `ux35`.
 *
 * UX 3.5 remains the safe default; UX 3.6 is opt-in beta.
 */

'use strict';

const SHELL_UX35 = 'ux35';
const SHELL_UX36 = 'ux36';

const SUPPORTED_SHELLS = Object.freeze([SHELL_UX35, SHELL_UX36]);
const DEFAULT_SHELL = SHELL_UX35;

/** Cookie name — same key used by the legacy bridge so stale values stay valid. */
const SHELL_COOKIE = 'bd_ui_shell';
const SHELL_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function normalizeShell(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SUPPORTED_SHELLS.includes(raw) ? raw : null;
}

function isBetaShell(shell) {
    return normalizeShell(shell) === SHELL_UX36;
}

/**
 * Resolve the shell for a request.
 *
 * Priority: explicit `?ui=` query (operator deep link / support), then the
 * browser cookie, then the default. Unknown values are ignored rather than
 * throwing, so old `?ui=classic` links keep working — they simply land on the
 * default shell.
 */
function resolveShell(req) {
    const fromQuery = normalizeShell(req?.query?.ui);
    if (fromQuery) return fromQuery;
    const fromCookie = normalizeShell(req?.cookies?.[SHELL_COOKIE]);
    if (fromCookie) return fromCookie;
    return DEFAULT_SHELL;
}

/** Cookie attributes matching the panel session cookie hardening. */
function shellCookieOptions(httpsEnabled) {
    return {
        httpOnly: false, // the client shell bridge reads it; value is not a secret
        sameSite: 'lax',
        secure: !!httpsEnabled,
        maxAge: SHELL_COOKIE_MAX_AGE_MS,
        path: '/',
    };
}

module.exports = {
    SHELL_UX35,
    SHELL_UX36,
    SUPPORTED_SHELLS,
    DEFAULT_SHELL,
    SHELL_COOKIE,
    SHELL_COOKIE_MAX_AGE_MS,
    normalizeShell,
    isBetaShell,
    resolveShell,
    shellCookieOptions,
};
