/**
 * Static host for the Svelte console build (lib/webUi.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi, headerPolicy } = require('../lib/webUi');

const META = "default-src 'self'; script-src 'self' 'sha256-abc='; style-src 'self' 'unsafe-inline'; object-src 'none'";

let dir;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-'));
    fs.mkdirSync(path.join(dir, '_ui', 'immutable', 'entry'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'),
        `<!doctype html><html><head><meta http-equiv="content-security-policy" content="${META.replace(/'/g, '&#39;')}"></head><body>app</body></html>`);
    const js = 'console.log("x".repeat(100))';
    fs.writeFileSync(path.join(dir, '_ui', 'immutable', 'entry', 'start.js'), js);
    fs.writeFileSync(path.join(dir, '_ui', 'immutable', 'entry', 'start.js.br'), zlib.brotliCompressSync(js));
    fs.writeFileSync(path.join(dir, '_ui', 'immutable', 'entry', 'start.js.gz'), zlib.gzipSync(js));
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function app(user) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        if (user) { req.session.userId = user.id; req.session.user = user; }
        next();
    });
    a.use(createWebUi({ base: '/app', dir }));
    a.use((req, res) => res.status(404).send('old console'));
    return a;
}

describe('web UI host', () => {
    test('sends signed-out people to the login page with a return path', async () => {
        const res = await request(app(null)).get('/app/devices?open=123');
        expect(res.status).toBe(302);
        // No "expired" on a first visit (tests/webUi.login.test.js)
        expect(res.headers.location).toBe('/login?return=%2Fapp%2Fdevices%3Fopen%3D123');
    });

    test('pro accounts get no console', async () => {
        const res = await request(app({ id: 9, role: 'pro' })).get('/app/devices');
        expect(res.status).toBe(302);
    });

    test('public pages open without a session', async () => {
        const res = await request(app(null)).get('/app/login');
        expect(res.status).toBe(200);
        expect(res.text).toContain('app');
    });

    test('the remote viewer opens without a session (guest links); its data endpoint checks access', async () => {
        for (const p of ['/app/remote/900100012', '/app/remote/900100012?guest=tok', '/app/remote/rt_abc?mesh_share=x']) {
            const res = await request(app(null)).get(p);
            expect(res.status).toBe(200);
            expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        }
    });

    test('other remote client pages send signed-out people to the remote sign-in', async () => {
        const dash = await request(app(null)).get('/app/remote');
        expect(dash.status).toBe(302);
        expect(dash.headers.location).toBe('/app/remote/login?return=%2Fapp%2Fremote');
        // Not a device id: no public page
        for (const p of ['/app/remote/a', '/app/remote/x/y', '/app/remote/%3Cb%3E']) {
            const res = await request(app(null)).get(p);
            expect(res.status).toBe(302);
        }
        expect((await request(app(null)).get('/app/remote/login')).status).toBe(200);
        expect((await request(app(null)).get('/app/remote/guest?t=x')).status).toBe(200);
        expect((await request(app({ id: 9, role: 'pro' })).get('/app/remote')).status).toBe(302);
    });

    test('serves the app page with a strict policy for every console path', async () => {
        const res = await request(app({ id: 1, role: 'admin' })).get('/app/settings?tab=auth');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const csp = res.headers['content-security-policy'];
        expect(csp).toContain("script-src 'self' 'sha256-abc='");
        expect(csp).toContain("frame-ancestors 'none'");
        const script = csp.split(';').find((d) => d.trim().startsWith('script-src'));
        expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
    });

    test('sends hashed assets precompressed and cached for a year', async () => {
        const res = await request(app(null)).get('/app/_ui/immutable/entry/start.js').set('Accept-Encoding', 'br, gzip');
        expect(res.status).toBe(200);
        expect(res.headers['content-encoding']).toBe('br');
        expect(res.headers['cache-control']).toContain('immutable');
        const gz = await request(app(null)).get('/app/_ui/immutable/entry/start.js').set('Accept-Encoding', 'gzip');
        expect(gz.headers['content-encoding']).toBe('gzip');
    });

    test('does not serve files outside the build', async () => {
        fs.writeFileSync(path.join(dir, '..', 'webui-secret.txt'), 'secret');
        for (const p of ['/app/_ui/immutable/..%2F..%2F..%2Fwebui-secret.txt', '/app/..%2Fwebui-secret.txt', '/app/_ui/../../webui-secret.txt']) {
            const res = await request(app({ id: 1, role: 'admin' })).get(p);
            expect(res.text).not.toContain('secret');
        }
        // The page itself is not a static file: signed out, it redirects
        const html = await request(app(null)).get('/app/_ui/immutable/..%2F..%2Findex.html');
        expect(html.status).toBe(302);
        const missing = await request(app({ id: 1, role: 'admin' })).get('/app/_ui/immutable/nope.js');
        expect(missing.text).toBe('old console');
    });

    test('leaves the old console alone when there is no build', async () => {
        const a = createTestApp();
        a.use(createWebUi({ base: '/app', dir: path.join(dir, 'missing') }));
        a.use((req, res) => res.status(404).send('old console'));
        const res = await request(a).get('/app/devices');
        expect(res.text).toBe('old console');
    });

    test('header policy drops directives a meta tag cannot carry and adds frame-ancestors', () => {
        const p = headerPolicy("default-src 'self'; frame-ancestors *; script-src 'self'");
        expect(p).not.toContain('frame-ancestors *');
        expect(p).toContain("frame-ancestors 'none'");
    });
});
