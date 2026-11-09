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
    a.use((req, res) => res.status(404).send('old console'));
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
        expect((await request(a).get('/app/devices')).text).toBe('old console');
    });

    test('without a build, or without a base in it, the console stays under /app', async () => {
        const dir = build('/app');
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, 'index.html'), '<html><head></head><body>no base</body></html>');
        expect((await request(app(dir)).get('/app/devices')).status).toBe(200);
    });
});
