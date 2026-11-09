/**
 * Endpoints for the Svelte console: bootstrap, strings, pre-paint script.
 */

const request = require('supertest');
const vm = require('vm');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getBrandingConfig: jest.fn().mockResolvedValue([]),
    getBrandingConfigRevision: jest.fn().mockResolvedValue('rev-1')
}));

const { manager } = require('../services/i18nService');
const consoleRoutes = require('../routes/console.routes');

function appWith(user, extra = {}) {
    const app = createTestApp();
    app.use((req, res, next) => {
        req.lang = req.query.lang || 'en';
        res.locals._ = (k) => manager.translate(req.lang, k);
        res.locals.csrfToken = 'csrf-test-token';
        if (user) {
            req.session.userId = user.id;
            req.session.user = user;
        }
        Object.assign(req, extra);
        next();
    });
    app.use(consoleRoutes);
    return app;
}

beforeAll(() => manager.init());

describe('GET /api/console/bootstrap', () => {
    test('needs a session', async () => {
        const res = await request(appWith(null)).get('/api/console/bootstrap');
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('session_required');
    });

    test('returns user, permissions, nav, language and the CSRF token in one response', async () => {
        const res = await request(appWith({ id: 7, username: 'demo_op', role: 'operator' })).get('/api/console/bootstrap');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.user).toMatchObject({ id: 7, username: 'demo_op', role: 'operator' });
        expect(res.body.csrfToken).toBe('csrf-test-token');
        expect(res.body.lang.code).toBe('en');
        expect(res.body.lang.available.length).toBeGreaterThan(20);
        // Operators connect and edit devices but can't change server config
        expect(res.body.permissions).toEqual(expect.arrayContaining(['device.view', 'device.connect', 'device.edit']));
        expect(res.body.permissions).not.toContain('server.config');
        expect(res.body.permissions).not.toContain('device.delete');
        expect(res.body.isSuperAdmin).toBe(false);
        const pages = res.body.nav.flatMap((s) => s.pages.map((p) => p.href));
        expect(pages).toContain('/devices');
        expect(pages).not.toContain('/permissions');
        expect(pages).not.toContain('/settings?tab=backup');
    });

    test('viewer sees fewer pages than a super admin', async () => {
        const viewer = await request(appWith({ id: 2, username: 'v', role: 'viewer' })).get('/api/console/bootstrap');
        const admin = await request(appWith({ id: 1, username: 'a', role: 'super_admin' })).get('/api/console/bootstrap');
        const count = (r) => r.body.nav.reduce((n, s) => n + s.pages.length, 0);
        expect(count(viewer)).toBeLessThan(count(admin));
        expect(admin.body.isSuperAdmin).toBe(true);
        expect(admin.body.permissions).toEqual([...consoleRoutes.UI_PERMISSIONS]);
        expect(viewer.body.permissions).not.toContain('device.connect');
    });

    test('uses the effective permissions the request loaded (custom roles)', async () => {
        const app = appWith({ id: 3, username: 'c', role: 'viewer' }, {
            effectivePermissions: new Set(['device.view', 'device.delete']),
            permissionContextLoaded: true
        });
        const res = await request(app).get('/api/console/bootstrap');
        expect(res.body.permissions).toEqual(['device.view', 'device.delete']);
    });
});

describe('GET /api/console/strings/:code', () => {
    test('returns merged strings and caches them for a year under the current revision', async () => {
        const app = appWith(null);
        const boot = consoleRoutes.publicBoot({ lang: 'de' });
        const v = new URL(boot.stringsUrl, 'http://x').searchParams.get('v');
        const res = await request(app).get(`/api/console/strings/de?v=${v}`);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('immutable');
        expect(res.body.meta.lang).toBe('de');
        // English fills keys German lacks, so no raw key shows
        expect(typeof res.body.common.cancel).toBe('string');
        const stale = await request(app).get('/api/console/strings/de?v=old');
        expect(stale.headers['cache-control']).toBe('no-cache');
        const again = await request(app).get(`/api/console/strings/de?v=${v}`).set('If-None-Match', res.headers.etag);
        expect(again.status).toBe(304);
    });

    test('sends the strings compressed when the browser accepts it', async () => {
        const zlib = require('zlib');
        const app = appWith(null);
        const raw = await request(app).get('/api/console/strings/en').set('Accept-Encoding', 'identity');
        const br = await request(app).get('/api/console/strings/en').set('Accept-Encoding', 'gzip, br')
            .buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
        expect(raw.headers['content-encoding']).toBeUndefined();
        expect(br.headers['content-encoding']).toBe('br');
        expect(br.headers.vary).toContain('Accept-Encoding');
        const bytes = Buffer.isBuffer(br.body) ? br.body : Buffer.from(br.text || '');
        const decoded = (() => { try { return zlib.brotliDecompressSync(bytes).toString(); } catch { return bytes.toString(); } })();
        expect(JSON.parse(decoded).common.cancel).toBe(raw.body.common.cancel);
        expect(Number(br.headers['content-length'] || bytes.length)).toBeLessThan(raw.text.length / 3);
    });

    test('rejects unknown and malformed codes', async () => {
        const app = appWith(null);
        expect((await request(app).get('/api/console/strings/xx')).status).toBe(404);
        expect((await request(app).get('/api/console/strings/..%2Fconfig')).status).toBe(404);
        expect((await request(app).get('/api/console/strings/__proto__')).status).toBe(404);
    });
});

describe('GET /console-boot.js', () => {
    function run(src, storage = {}, darkSystem = false, pathname = '/app/devices') {
        const attrs = {};
        const props = {};
        const dataset = {};
        const fetched = [];
        const root = {
            setAttribute: (k, v) => { attrs[k] = String(v); },
            getAttribute: (k) => attrs[k] ?? null,
            style: { setProperty: (k, v) => { props[k] = v; } },
            dataset
        };
        const window = {
            matchMedia: () => ({ matches: darkSystem }),
        };
        const sandbox = {
            window,
            document: { documentElement: root },
            location: { pathname },
            localStorage: { getItem: (k) => (k in storage ? storage[k] : null) },
            fetch: (url) => { fetched.push(url); return Promise.resolve(); },
            JSON, Math, Number, String, parseInt, isFinite
        };
        vm.runInNewContext(src, sandbox);
        return { attrs, props, dataset, root, fetched, boot: window.__BD_BOOT__ };
    }

    test('is public, holds no user data and starts both requests', async () => {
        const res = await request(appWith({ id: 1, username: 'secret_admin', role: 'admin' })).get('/console-boot.js');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('javascript');
        expect(res.text).not.toContain('secret_admin');
        expect(res.text).not.toContain('csrf-test-token');
        const out = run(res.text);
        expect(out.root.lang).toBe('en');
        expect(out.root.dir).toBe('ltr');
        expect(out.fetched).toEqual([expect.stringMatching(/^\/api\/console\/strings\/en\?v=/), '/api/console/bootstrap']);
    });

    test('public pages skip the session request', async () => {
        const res = await request(appWith(null)).get('/console-boot.js');
        expect(run(res.text, {}, false, '/login').fetched).toHaveLength(1);
        expect(run(res.text, {}, false, '/app/login').fetched).toHaveLength(1);
        expect(run(res.text, {}, false, '/app/d/abc').fetched).toHaveLength(1);
        expect(run(res.text, {}, false, '/app/loginx').fetched).toHaveLength(2);
        expect(run(res.text, {}, false, '/app').fetched).toHaveLength(2);
    });

    test('applies the per-browser theme, RTL and accessibility settings before paint', async () => {
        const res = await request(appWith(null)).get('/console-boot.js?lang=ar');
        const out = run(res.text, {
            'bd-theme-choice': 'dark',
            betterdesk_accessibility_v1: JSON.stringify({ contrast: 'yellow-black', fontScale: 130, underlineLinks: true, colorFilter: 'evil' }),
            bd_ux35_sidebar_width: '300'
        });
        expect(out.root.dir).toBe('rtl');
        expect(out.attrs['data-theme']).toBe('dark');
        expect(out.dataset.a11yContrast).toBe('yellow-black');
        expect(out.dataset.a11yFontScaled).toBe('true');
        expect(out.props['--bd-a11y-font-scale']).toBe('1.3');
        expect(out.dataset.a11yUnderlineLinks).toBe('true');
        expect(out.dataset.a11yFiltered).toBe('false');
        expect(out.props['--sidebar-w']).toBe('300px');
    });

    test('follows the system theme in system mode and survives blocked storage', async () => {
        const res = await request(appWith(null)).get('/console-boot.js');
        const src = res.text;
        const out = run(src, {}, true);
        expect(out.attrs['data-theme']).toBe('dark');
        const blocked = () => { throw new Error('denied'); };
        const sandbox = {
            window: { matchMedia: () => ({ matches: false }) },
            document: { documentElement: { setAttribute() {}, getAttribute() { return null; }, style: { setProperty() {} }, dataset: {} } },
            localStorage: { getItem: blocked },
            location: { pathname: '/' },
            fetch: () => Promise.resolve(), JSON, Math, Number, String, parseInt, isFinite
        };
        expect(() => vm.runInNewContext(src, sandbox)).not.toThrow();
    });

    test('cannot be broken out of with a closing script tag in data', async () => {
        const res = await request(appWith(null)).get('/console-boot.js');
        const payload = res.text.slice(res.text.lastIndexOf('})(') + 3);
        expect(payload).not.toMatch(/<\//);
    });
});
