/**
 * The address the new console lives under comes from its build: SvelteKit
 * writes it into index.html (base: "..."), and the asset URLs in the build
 * depend on it. The server used to have its own copy ('/app' in server.js),
 * so a build made for another base answered with pages whose files 404.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi, readBase } = require('../lib/webUi');

function build(base) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-base-'));
    fs.mkdirSync(path.join(dir, '_ui', 'immutable'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'),
        '<!doctype html><html><head><meta http-equiv="content-security-policy" content="default-src &#39;self&#39;"></head>'
        + `<body><div><script>{ __sveltekit_x1 = { base: "${base}", version: "1", assets: "${base}" }; }</script></div></body></html>`);
    fs.writeFileSync(path.join(dir, '_ui', 'immutable', 'start.js'), 'export {}');
    return dir;
}

function app(dir, opts = {}) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 1;
        req.session.user = { id: 1, username: 'a', role: 'admin' };
        next();
    });
    a.use(createWebUi({ dir, ...opts }));
    a.use((req, res) => res.status(404).send('server 404'));
    return a;
}

describe('the base comes from the build', () => {
    const dirs = [];
    afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

    test('readBase finds the base SvelteKit wrote, and only a path or ""', () => {
        expect(readBase('{ __sveltekit_x = { base: "/console", assets: "/console" } }')).toBe('/console');
        expect(readBase('{ __sveltekit_x = { base: "", assets: "" } }')).toBe('');
        expect(readBase('{ __sveltekit_x = { base: "https://evil.example" } }')).toBeNull();
        expect(readBase('<html>no init script</html>')).toBeNull();
    });

    test('a build made for /console is served under /console', async () => {
        const dir = build('/console');
        dirs.push(dir);
        const a = app(dir);
        expect((await request(a).get('/console/devices')).status).toBe(200);
        expect((await request(a).get('/console/_ui/immutable/start.js')).status).toBe(200);
        expect((await request(a).get('/devices')).text).toBe('server 404');
        // The move from /app to the root only applies to a build for the root
        expect((await request(a).get('/app/devices')).text).toBe('server 404');
    });

    test('a build for the root is served there, and old /app addresses move to it', async () => {
        const dir = build('');
        dirs.push(dir);
        const a = app(dir);
        expect((await request(a).get('/devices')).status).toBe(200);
        expect((await request(a).get('/_ui/immutable/start.js')).status).toBe(200);
        const old = await request(a).get('/app/devices?open=1');
        expect(old.status).toBe(301);
        expect(old.headers.location).toBe('/devices?open=1');
    });

    test('without a base in the build, the console is at the root', async () => {
        const dir = build('/app');
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body>no base</body></html>');
        expect((await request(app(dir)).get('/devices')).status).toBe(200);
    });
});
