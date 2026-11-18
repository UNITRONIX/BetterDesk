'use strict';

/**
 * Anonymous account enumeration (audit H6, 2026-11-13).
 *
 * `/login?desktop=1` used to render every account name and role into the page
 * for unauthenticated visitors. It now renders an empty selector and the client
 * asks `/login/lookup`, which only returns a short, rate-limited prefix match.
 */

const fs = require('fs');
const path = require('path');

const AUTH_ROUTES = path.join(__dirname, '..', 'routes', 'auth.routes.js');
const DESKTOP_LOGIN_HBS = path.join(__dirname, '..', 'views', 'desktop-login.ejs');
const DESKTOP_LOGIN_JS = path.join(__dirname, '..', 'public', 'js', 'desktop-login.js');

describe('desktop login does not pre-render the account list', () => {
    const source = fs.readFileSync(AUTH_ROUTES, 'utf8');

    it('renders an empty loginUsers array for the anonymous desktop login', () => {
        const desktopBlock = source.slice(
            source.indexOf("if (useDesktop) {"),
            source.indexOf("res.render('login'")
        );
        expect(desktopBlock).toContain('loginUsers: []');
        expect(desktopBlock).not.toContain('getAllUsersForBackup');
    });

    it('serves account matches only through a rate-limited lookup endpoint', () => {
        expect(source).toMatch(/router\.get\('\/login\/lookup',\s*loginLimiter/);
    });

    it('requires a two-character prefix and caps the result set', () => {
        const lookup = source.slice(
            source.indexOf("router.get('/login/lookup'"),
            source.indexOf("router.post('/api/auth/login'")
        );
        expect(lookup).toContain('query.length < 2');
        expect(lookup).toContain('.slice(0, 8)');
    });

    it('the lookup never returns password material', () => {
        const lookup = source.slice(source.indexOf("router.get('/login/lookup'"));
        const body = lookup.slice(0, lookup.indexOf('/**'));
        expect(body).not.toMatch(/password/i);
        expect(body).not.toMatch(/totp/i);
    });
});

describe('desktop login client fills the selector on demand', () => {
    const js = fs.readFileSync(DESKTOP_LOGIN_JS, 'utf8');

    it('calls the lookup endpoint instead of trusting the SSR payload', () => {
        expect(js).toContain("'/login/lookup?q='");
        expect(js).toContain('wireUserLookup()');
    });

    it('escapes every interpolated value', () => {
        expect(js).toContain('_esc(user.username)');
        expect(js).toContain('_esc(user.role');
    });

    it('the template still ships an empty users array', () => {
        const ejs = fs.readFileSync(DESKTOP_LOGIN_HBS, 'utf8');
        // The array is serialised through the escaping helper (audit M11).
        expect(ejs).toMatch(/(?:safeJsonScript|bdJson)\(loginUsers \|\| \[\]\)/);
    });
});
