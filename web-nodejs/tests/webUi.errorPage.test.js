/**
 * Error pages in the new console (lib/webUi.js res.sendErrorPage): the
 * server still decides when a request gets 403, 404 or 500, and with which
 * status; it answers with the app page marked with the error, and the app
 * shows the error page at that address (web-ui src/hooks.ts). Outside the
 * app's base (a build for /app, say) it declines, and the caller answers in
 * plain text.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');

const META = "default-src 'self'; script-src 'self' 'sha256-abc='";
let dir;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-err-'));
    fs.writeFileSync(path.join(dir, 'index.html'),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="content-security-policy" content="${META.replace(/'/g, '&#39;')}"></head><body>app</body></html>`);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function app(base, route) {
    const a = createTestApp();
    a.use(createWebUi({ base, dir }));
    // Every GET under the base is an app page; these routes are form posts that fail
    a.post('/x/*', route);
    a.post('/app/x/*', route);
    return a;
}

describe('res.sendErrorPage', () => {
    test('answers the app page with the status the server chose and the error marked in it', async () => {
        const res = await request(app('/app', (req, res) => res.sendErrorPage(404) || res.status(404).send('old'))).post('/app/x/missing');
        expect(res.status).toBe(404);
        expect(res.headers['content-type']).toMatch(/text\/html/);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.headers['content-security-policy']).toContain("script-src 'self' 'sha256-abc='");
        expect(res.text).toContain('<meta name="bd-error" content="404">');
        expect(res.text).toContain('<body>app</body>');
    });

    test('a 403 keeps its own words, escaped; the status may differ from the kind (400 shows the 404 page)', async () => {
        const forbidden = await request(app('/app', (req, res) => res.sendErrorPage(403, {
            title: 'Link expired',
            message: 'The guest link "x" <b>ended</b> & is gone'
        }))).post('/app/x/guest');
        expect(forbidden.status).toBe(403);
        expect(forbidden.text).toContain('<meta name="bd-error" content="403" data-title="Link expired" data-message="The guest link &quot;x&quot; &lt;b&gt;ended&lt;/b&gt; &amp; is gone">');
        const bad = await request(app('/app', (req, res) => res.sendErrorPage(404, { status: 400 }))).post('/app/x/bad-id');
        expect(bad.status).toBe(400);
        expect(bad.text).toContain('content="404"');
        const down = await request(app('/app', (req, res) => res.sendErrorPage(500, { status: 503 }))).post('/app/x/y');
        expect(down.status).toBe(503);
        expect(down.text).toContain('content="500"');
    });

    test('outside the base it declines and the caller answers', async () => {
        const res = await request(app('/app', (req, res) => res.sendErrorPage(404) || res.status(404).send('old view'))).post('/x/old-page');
        expect(res.status).toBe(404);
        expect(res.text).toBe('old view');
    });

    test('with the base at the root every address gets the app page', async () => {
        const res = await request(app('', (req, res) => res.sendErrorPage(404) || res.status(404).send('old view'))).post('/x/anything');
        expect(res.status).toBe(404);
        expect(res.text).toContain('content="404"');
    });

    test('without a build it declines', async () => {
        const a = createTestApp();
        a.use(createWebUi({ base: '/app', dir: path.join(dir, 'missing') }));
        a.get('/app/x', (req, res) => res.sendErrorPage(404) || res.status(404).send('old view'));
        expect((await request(a).get('/app/x')).text).toBe('old view');
    });
});
