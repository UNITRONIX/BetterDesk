/**
 * Where the sign-in page may send someone afterwards (lib/returnUrl.js, R3).
 */

const { safeReturnPath, loginRedirectUrl, hadSessionCookie } = require('../lib/returnUrl');

describe('safeReturnPath', () => {
    test.each([
        ['/devices', '/devices'],
        ['/devices?open=12345', '/devices?open=12345'],
        ['/app/devices?open=1#x', '/app/devices?open=1#x'],
        ['/settings?tab=auth', '/settings?tab=auth'],
        ['/remote/123456789', '/remote/123456789'],
        ['/', '/']
    ])('keeps the console path %s', (input, expected) => {
        expect(safeReturnPath(input)).toBe(expected);
    });

    test.each([
        ['an absolute URL', 'https://evil.example/'],
        ['a protocol-relative URL', '//evil.example/x'],
        ['a backslash host', '/\\evil.example'],
        ['a backslash anywhere', '/devices\\..\\x'],
        ['a tab that browsers drop', '/\t/evil.example'],
        ['a newline', '/devices\r\nSet-Cookie: x=1'],
        ['an encoded backslash', '/%5Cevil.example'],
        ['an encoded newline', '/devices%0d%0aSet-Cookie:%20x=1'],
        ['dot segments that end as a host', '/..//evil.example'],
        ['encoded dot segments', '/.%2e//evil.example'],
        ['a scheme', 'javascript:alert(1)'],
        ['a relative path', 'devices'],
        ['the sign-in page', '/login?return=/devices'],
        ['the new sign-in page', '/app/login'],
        ['the remote sign-in page', '/remote/login'],
        ['sign-out', '/logout'],
        ['the API', '/api/auth/logout'],
        ['nothing', ''],
        ['not a string', { toString: () => '/devices' }],
        ['a very long path', '/' + 'a'.repeat(3000)]
    ])('refuses %s', (_name, input) => {
        expect(safeReturnPath(input)).toBeNull();
    });
});

describe('loginRedirectUrl', () => {
    const req = (over = {}) => ({ method: 'GET', originalUrl: '/devices?open=1', headers: {}, ...over });

    test('a first visit gets the way back but no "session expired" (R4)', () => {
        expect(loginRedirectUrl(req())).toBe('/login?return=%2Fdevices%3Fopen%3D1');
    });

    test('a browser that still sends a session cookie was signed out: expired=1', () => {
        const r = req({ headers: { cookie: 'theme=x; bd.sid=s%3Aabc.def' } });
        expect(hadSessionCookie(r)).toBe(true);
        expect(loginRedirectUrl(r)).toBe('/login?expired=1&return=%2Fdevices%3Fopen%3D1');
        expect(hadSessionCookie(req({ headers: { cookie: 'betterdesk.sid=s%3Aabc' } }))).toBe(true);
        expect(hadSessionCookie(req({ headers: { cookie: 'xbd.sid=1' } }))).toBe(false);
    });

    test('form posts and unsafe paths get no return', () => {
        expect(loginRedirectUrl(req({ method: 'POST' }))).toBe('/login');
        expect(loginRedirectUrl(req({ originalUrl: '//evil.example' }))).toBe('/login');
    });

    test('an explicit return path wins over the request URL', () => {
        expect(loginRedirectUrl(req(), { returnTo: '/app' })).toBe('/login?return=%2Fapp');
    });
});
