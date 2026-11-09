/**
 * BetterDesk Console - CSRF Protection Middleware
 * Uses csrf-csrf (double-submit cookie pattern) for stateless CSRF protection.
 * 
 * Token flow:
 *   1. Server generates token, sets it as a cookie + passes to EJS views
 *   2. Client JS reads window.BetterDesk.csrfToken and sends it in X-CSRF-Token header
 *   3. Middleware validates header matches cookie on state-changing requests (POST/PUT/DELETE/PATCH)
 */

const { doubleCsrf } = require('csrf-csrf');
const config = require('../config/config');

// Use a different cookie name in HTTP mode to avoid collision with stale
// Secure cookies left over from a previous HTTPS configuration.  Browsers
// refuse to send Secure cookies over HTTP and also refuse to let HTTP
// overwrite an existing Secure cookie of the same name (RFC 6265bis §5.4.6).
let csrfCookieSecure = config.httpsEnabled;
const CSRF_COOKIE = config.httpsEnabled ? '__csrf' : '__csrf_h';

const {
    generateToken,
    doubleCsrfProtection
} = doubleCsrf({
    getSecret: () => config.sessionSecret,
    cookieName: CSRF_COOKIE,
    cookieOptions: {
        httpOnly: true,
        sameSite: 'lax',
        get secure() { return csrfCookieSecure; },
        path: '/'
    },
    getTokenFromRequest: (req) => {
        // Read token from X-CSRF-Token header (set by public/js/utils.js)
        return req.headers['x-csrf-token'] || req.body?._csrf || '';
    }
});

/** Safe HTTP methods that render views and need a fresh CSRF token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Middleware that generates a CSRF token and makes it available to views.
 * Must be applied AFTER cookie-parser and session middleware.
 *
 * IMPORTANT: Token generation runs ONLY on safe methods (GET/HEAD/OPTIONS).
 * On state-changing methods (POST/PUT/DELETE/PATCH) we skip generation
 * entirely so that we never interfere with doubleCsrfProtection's
 * validation of req.cookies — calling generateToken on POST with an
 * invalid cookie would delete req.cookies['__csrf'] in the catch block
 * before the validation middleware could read it, causing spurious 403s.
 *
 * If the existing __csrf cookie is malformed (e.g. leftover from an older
 * installation with a different secret), we clear it and regenerate so
 * the next page load works.
 */
function csrfTokenProvider(req, res, next) {
    // State-changing methods: let doubleCsrfProtection handle everything
    if (!SAFE_METHODS.has(req.method)) {
        return next();
    }

    try {
        const token = generateToken(req, res);
        res.locals.csrfToken = token;
        return next();
    } catch (_err) {
        // Cookie exists but is invalid (e.g. secret changed after reinstall).
        // Clear the corrupt cookie so the browser forgets it, then generate
        // a fresh token+cookie pair.
        if (req.cookies) delete req.cookies[CSRF_COOKIE];
        res.clearCookie(CSRF_COOKIE, {
            httpOnly: true,
            sameSite: 'lax',
            secure: csrfCookieSecure,
            path: '/'
        });
        try {
            const token = generateToken(req, res);
            res.locals.csrfToken = token;
        } catch (_e) {
            // Give views a harmless empty token so rendering never breaks
            res.locals.csrfToken = '';
        }
        return next();
    }
}

/**
 * Wrapper around doubleCsrfProtection that tolerates corrupt cookies on
 * safe HTTP methods (GET / HEAD / OPTIONS).  On those methods the library
 * should never block — but a malformed __csrf cookie can still make it
 * throw.  We catch that, wipe the cookie and let the request through.
 */
function safeCsrfProtection(req, res, next) {
    doubleCsrfProtection(req, res, (err) => {
        if (err && SAFE_METHODS.has(req.method)) {
            // Corrupt cookie on a safe method — clear and continue.
            // clearCookie must use identical options for the browser to match.
            res.clearCookie(CSRF_COOKIE, {
                httpOnly: true,
                sameSite: 'lax',
                secure: csrfCookieSecure,
                path: '/'
            });
            if (req.cookies) delete req.cookies[CSRF_COOKIE];
            return next();
        }
        // For state-changing methods (POST/PUT/DELETE/PATCH) propagate normally
        return next(err);
    });
}

/**
 * The app-wide CSRF check. Device agents call /api/bd/* with bearer tokens
 * and no session, so they skip it. Several admin routers are also mounted
 * under /api/bd (automation, file transfer, dataguard, inventory, activity,
 * registration, policies, fleet, scaling, resource control); a request
 * there that carries a signed-in session is a browser and gets the check.
 */
function csrfGate(req, res, next) {
    if (req.path.startsWith('/api/bd/') && !(req.session && req.session.userId)) {
        return next();
    }
    return safeCsrfProtection(req, res, next);
}

module.exports = {
    csrfTokenProvider,
    csrfGate,
    doubleCsrfProtection: safeCsrfProtection,
    /**
     * BD-2026-082: Downgrade CSRF cookie Secure flag to false.
     * Called from server.js when HTTPS is enabled in config but SSL
     * certificates fail to load, forcing a fallback to HTTP.
     */
    downgradeToHttp() {
        csrfCookieSecure = false;
    }
};
