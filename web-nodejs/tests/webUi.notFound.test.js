/**
 * Addresses the new console has no page for (lib/webUi.js): the build lists
 * its pages in routes.json (web-ui/vite-plugins/routes.ts), and a GET that
 * matches none of them gets the app page with status 404, so the app shows
 * its not-found page and the status says what happened. A build without the
 * list answers 200 for every address, as before.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');

// Patterns as SvelteKit writes them into routes.json
const ROUTES = [
    { id: '/(console)', pattern: '^\\/$' },
    { id: '/(console)/devices', pattern: '^\\/devices\\/?$' },
    { id: '/(console)/policies/[[orgId]]', pattern: '^\\/policies(?:\\/([^/]+))?\\/?$' },
    { id: '/(console)/organizations/[id]', pattern: '^\\/organizations\\/([^/]+?)\\/?$' },
    { id: '/(public)/login', pattern: '^\\/login\\/?$' },
    { id: '/(remote)/remote/[deviceId]', pattern: '^\\/remote\\/([^/]+?)\\/?$' }
];

const dirs = [];
function build(routes) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-404-'));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, 'index.html'),
        '<!doctype html><html><head><meta http-equiv="content-security-policy" content="default-src &#39;self&#39;"></head><body>app</body></html>');
    if (routes !== undefined) fs.writeFileSync(path.join(dir, 'routes.json'), typeof routes === 'string' ? routes : JSON.stringify(routes));
    return dir;
}
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function app(dir, user) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        if (user) { req.session.userId = user.id; req.session.user = user; }
        next();
    });
    a.use(createWebUi({ base: '', dir, ported: [] }));
    a.use((req, res) => res.status(404).send('server 404'));
    return a;
}

const admin = { id: 1, role: 'admin' };

describe('addresses the console has no page for', () => {
    test('get the app page with status 404 and the app policy', async () => {
        const dir = build(ROUTES);
        for (const p of ['/no-such-page', '/devices/7', '/policies/7/x', '/organizations', '/remote/a/b']) {
            const res = await request(app(dir, admin)).get(p);
            expect([p, res.status]).toEqual([p, 404]);
            expect(res.text).toContain('<body>app</body>');
            expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
            expect(res.headers['cache-control']).toBe('no-store');
        }
    });

    test('pages, with parameters and optional parts, answer 200', async () => {
        const dir = build(ROUTES);
        for (const p of ['/', '/devices', '/devices?open=7', '/policies', '/policies/7', '/organizations/7', '/organizations/a%20b']) {
            const res = await request(app(dir, admin)).get(p);
            expect([p, res.status]).toEqual([p, 200]);
        }
    });

    test('signed out, an unknown address is still a 404, not the sign-in page', async () => {
        const dir = build(ROUTES);
        const res = await request(app(dir, null)).get('/no-such-page');
        expect(res.status).toBe(404);
        expect(res.text).toContain('<body>app</body>');
        // A known page still sends people to sign in
        expect((await request(app(dir, null)).get('/devices')).status).toBe(302);
        expect((await request(app(dir, null)).get('/login')).status).toBe(200);
    });

    test('a path that does not decode is a bad request, not a page', async () => {
        const dir = build(ROUTES);
        expect((await request(app(dir, admin)).get('/organizations/%E0%A4%A')).status).toBe(400);
    });

    test('missing files are left to the server', async () => {
        const dir = build(ROUTES);
        const res = await request(app(dir, admin)).get('/no-such-file.js');
        expect(res.text).toBe('server 404');
    });

    test('without routes.json, or with one that cannot be read, every address is a page', async () => {
        for (const dir of [build(), build('{not json'), build([])]) {
            const res = await request(app(dir, admin)).get('/no-such-page');
            expect(res.status).toBe(200);
            expect(res.text).toContain('<body>app</body>');
        }
    });
});
