/**
 * BetterDesk Console — UI shell resolution.
 *
 * UX 3.5 is the only console shell. UX 3.6 beta assets remain in the tree for
 * reference / possible future reuse, but are not selectable: cookies, `?ui=`
 * deep links and the preference API all resolve to `ux35`.
 */

'use strict';

const SHELL_UX35 = 'ux35';
/** Retired console beta — kept as a named constant for tests/docs only. */
const SHELL_UX36 = 'ux36';

const SUPPORTED_SHELLS = Object.freeze([SHELL_UX35]);
const DEFAULT_SHELL = SHELL_UX35;

/** Cookie name — same key as before so stale `ux36` values can be cleared. */
const SHELL_COOKIE = 'bd_ui_shell';
const SHELL_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

function normalizeShell(value) {
    const raw = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return SUPPORTED_SHELLS.includes(raw) ? raw : null;
}

function isBetaShell(_shell) {
    return false;
}

/**
 * Resolve the shell for a request. Always UX 3.5 — query/cookie values other
 * than `ux35` (including retired `ux36` / `classic`) are ignored.
 */
function resolveShell(req) {
    void req;
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
