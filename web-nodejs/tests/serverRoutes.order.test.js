/**
 * The console lives at the root, so its page handler would answer any GET.
 * server.js mounts it after the server's routes (lib/mountRoutes.js); this
 * goes through the same order with the real routes and a console build at
 * base "": the server's own addresses still answer, console pages get the
 * app, unknown addresses a 404, and old /app addresses a 301.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');
const { mountRoutes } = require('../lib/mountRoutes');
const securityMiddleware = require('../middleware/security');

jest.setTimeout(60000);

let dir;
let routes;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-order-'));
    fs.mkdirSync(path.join(dir, '_ui', 'immutable'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'),
        '<!doctype html><html><head><meta http-equiv="content-security-policy" content="default-src &#39;self&#39;; script-src &#39;self&#39; &#39;sha256-boot=&#39;"></head>'
        + '<body>console app<script>{ __sveltekit_t = { base: "", assets: "" }; }</script></body></html>');
    fs.writeFileSync(path.join(dir, '_ui', 'immutable', 'start.js'), 'export {}');
    fs.writeFileSync(path.join(dir, 'routes.json'), JSON.stringify([
        { id: '/(console)', pattern: '^\\/$' },
        { id: '/(console)/devices', pattern: '^\\/devices\\/?$' },
        { id: '/(public)/login', pattern: '^\\/login\\/?$' },
        { id: '/(remote)/remote', pattern: '^\\/remote\\/?$' },
        { id: '/(remote)/remote/[deviceId]', pattern: '^\\/remote\\/([^/]+?)\\/?$' }
    ]));
    routes = require('../routes');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function app(user) {
    const a = createTestApp();
    a.use(securityMiddleware);
    a.use((req, _res, next) => {
        if (user) { req.session.userId = user.id; req.session.user = user; }
        next();
    });
    const webUi = createWebUi({ dir });
    a.use(webUi.errorPages);
    mountRoutes(a, { routes, webUi });
    return a;
}

const admin = { id: 1, username: 'admin', role: 'admin' };
const isApp = (res) => /console app/.test(res.text || '');

describe('server routes before the console at the root', () => {
    test('the server answers its own addresses, not the app', async () => {
        const health = await request(app(null)).get('/health');
        expect(health.status).toBe(200);
        expect(health.body.status).toBe('ok');

        const boot = await request(app(null)).get('/console-boot.js');
        expect(boot.headers['content-type']).toContain('javascript');

        const branding = await request(app(null)).get('/css/branding.css');
        expect(branding.headers['content-type']).toContain('text/css');

        const status = await request(app(null)).get('/register-status');
        expect(status.status).toBe(400);
        expect(status.body.success).toBe(false);

        const logout = await request(app(admin)).get('/logout');
        expect(logout.status).toBe(302);
        expect(isApp(logout)).toBe(false);

        const download = await request(app(null)).get('/downloads/generic-agent/v1/agent.exe');
        expect(isApp(download)).toBe(false);
    });

    test('old addresses that redirect still do', async () => {
        expect((await request(app(admin)).get('/remote-dashboard')).headers.location).toBe('/remote');
        expect((await request(app(admin)).get('/tenants')).headers.location).toBe('/organizations');
        expect((await request(app(admin)).get('/generator')).headers.location).toBe('/agents');
        expect((await request(app(admin)).get('/remote-desktop/900100001')).headers.location).toBe('/remote/900100001');
        expect((await request(app(admin)).get('/remote-cdap/900100001')).headers.location).toBe('/remote/900100001?transport=cdap');
    });

    test('the API and sockets never get the app page', async () => {
        for (const p of ['/api/no-such-endpoint', '/api', '/ws/nothing']) {
            const res = await request(app(admin)).get(p).set('Accept', 'application/json');
            expect([p, res.status]).toEqual([p, 404]);
            expect(isApp(res)).toBe(false);
        }
    });

    test('console pages get the app; signed out, the sign-in page', async () => {
        const res = await request(app(admin)).get('/devices?open=7');
        expect(res.status).toBe(200);
        expect(isApp(res)).toBe(true);
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        expect((await request(app(admin)).get('/')).status).toBe(200);
        const out = await request(app(null)).get('/devices');
        expect(out.status).toBe(302);
        expect(out.headers.location).toBe('/login?return=%2Fdevices');
        expect(isApp(await request(app(null)).get('/login'))).toBe(true);
        expect((await request(app(null)).get('/_ui/immutable/start.js')).status).toBe(200);
    });

    test('console pages carry the policy of their build; server answers keep the strict one', async () => {
        const page = await request(app(admin)).get('/devices');
        expect(page.headers['content-security-policy']).toContain("script-src 'self' 'sha256-boot='");
        for (const p of ['/health', '/console-boot.js', '/api/no-such-endpoint']) {
            const res = await request(app(admin)).get(p);
            const csp = res.headers['content-security-policy'];
            expect([p, /script-src 'self';/.test(csp), /sha256|nonce-/.test(csp)]).toEqual([p, true, false]);
            expect(csp).toContain("frame-ancestors 'none'");
        }
    });

    test('an address no page has gets the app with status 404', async () => {
        const res = await request(app(admin)).get('/no-such-page');
        expect(res.status).toBe(404);
        expect(isApp(res)).toBe(true);
    });

    test('old /app addresses move to the same address at the root', async () => {
        const cases = [
            ['/app', '/'],
            ['/app/', '/'],
            ['/app?activateAgent=1', '/?activateAgent=1'],
            ['/app/devices?open=900100001', '/devices?open=900100001'],
            ['/app/_ui/immutable/start.js', '/_ui/immutable/start.js'],
            ['/app//evil.example/x', '/evil.example/x']
        ];
        for (const [from, to] of cases) {
            const res = await request(app(null)).get(from);
            expect([from, res.status, res.headers.location]).toEqual([from, 301, to]);
        }
        // Only /app itself and what is under it
        expect((await request(app(admin)).get('/application')).status).toBe(404);
    });

    test('writes to an address no route has are not pages', async () => {
        const res = await request(app(admin)).post('/devices').set('Accept', 'application/json').send({});
        expect(res.status).toBe(404);
        expect(isApp(res)).toBe(false);
    });
});
