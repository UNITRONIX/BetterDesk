/**
 * Errors the server decides on (lib/mountRoutes.js, middleware/auth.js) show
 * the console's error page at the same address, with the server's status
 * (lib/webUi.js res.sendErrorPage). Without a console build the answer is
 * plain text; the API and sockets always get JSON.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');
const { mountRoutes } = require('../lib/mountRoutes');
const { requireRole, requireAdmin, requirePermission, requireRdClientAuth } = require('../middleware/auth');

let dir;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-errors-'));
    fs.writeFileSync(path.join(dir, 'index.html'),
        '<!doctype html><html><head><meta http-equiv="content-security-policy" content="default-src &#39;self&#39;"></head><body>console app</body></html>');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function routes() {
    const r = express.Router();
    r.post(['/form', '/api/form'], (_req, _res, next) => {
        const err = new Error('invalid csrf token');
        err.code = 'EBADCSRFTOKEN';
        next(err);
    });
    r.get(['/boom', '/api/boom'], (_req, _res, next) => next(new Error('kaput')));
    r.get('/role', requireRole('admin'), (_req, res) => res.send('ok'));
    r.get('/admin', requireAdmin, (_req, res) => res.send('ok'));
    r.get('/perm', requirePermission('server.config'), (_req, res) => res.send('ok'));
    r.get('/rd', requireRdClientAuth('device.connect'), (_req, res) => res.send('ok'));
    return r;
}

function app({ build = true, user = { id: 2, username: 'view', role: 'viewer' }, permissionError = false } = {}) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        if (user) { req.session.userId = user.id; req.session.user = user; }
        if (permissionError) { req.permissionContextLoaded = true; req.permissionLoadError = new Error('down'); }
        next();
    });
    const webUi = createWebUi({ base: '', dir: build ? dir : path.join(dir, 'missing') });
    a.use(webUi.errorPages);
    mountRoutes(a, { routes: routes(), webUi });
    return a;
}

const HTML = 'text/html,application/xhtml+xml';
const marked = (res) => (/<meta name="bd-error" content="(\d+)"/.exec(res.text || '') || [])[1];

describe('error pages', () => {
    test('a refused form post shows the 403 page with the reason', async () => {
        const res = await request(app()).post('/form').set('Accept', HTML).type('form').send('a=1');
        expect(res.status).toBe(403);
        expect(marked(res)).toBe('403');
        expect(res.text).toMatch(/data-message="Invalid or missing CSRF token/);
        expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
        const api = await request(app()).post('/api/form').set('Accept', HTML).send({});
        expect(api.status).toBe(403);
        expect(api.body.success).toBe(false);
    });

    test('a failure shows the 500 page; the API gets JSON', async () => {
        const res = await request(app()).get('/boom').set('Accept', HTML);
        expect(res.status).toBe(500);
        expect(marked(res)).toBe('500');
        const api = await request(app()).get('/api/boom').set('Accept', HTML);
        expect(api.status).toBe(500);
        expect(api.body.success).toBe(false);
    });

    test('what no route and no page answered: the 404 page, JSON for the API', async () => {
        const res = await request(app()).delete('/devices').set('Accept', HTML);
        expect(res.status).toBe(404);
        expect(marked(res)).toBe('404');
        const api = await request(app()).get('/api/nothing').set('Accept', HTML);
        expect(api.status).toBe(404);
        expect(api.body).toEqual({ success: false, error: 'Not Found' });
        expect(marked(api)).toBeUndefined();
    });

    test('a page someone may not open shows the 403 page', async () => {
        for (const p of ['/role', '/admin', '/perm', '/rd']) {
            const res = await request(app()).get(p).set('Accept', HTML);
            expect([p, res.status, marked(res)]).toEqual([p, 403, '403']);
        }
        const down = await request(app({ permissionError: true })).get('/perm').set('Accept', HTML);
        expect(down.status).toBe(503);
        expect(marked(down)).toBe('500');
    });

    test('without a console build: plain text with the same status', async () => {
        const noBuild = { build: false };
        const csrf = await request(app(noBuild)).post('/form').set('Accept', HTML).type('form').send('a=1');
        expect([csrf.status, csrf.headers['content-type']]).toEqual([403, expect.stringContaining('text/plain')]);
        expect(csrf.text).toMatch(/CSRF token/);
        const missing = await request(app(noBuild)).delete('/devices').set('Accept', HTML);
        expect([missing.status, missing.text]).toEqual([404, 'Not Found']);
        const boom = await request(app(noBuild)).get('/boom').set('Accept', HTML);
        expect(boom.status).toBe(500);
        expect(boom.headers['content-type']).toContain('text/plain');
        const role = await request(app(noBuild)).get('/role').set('Accept', HTML);
        expect([role.status, role.headers['content-type']]).toEqual([403, expect.stringContaining('text/plain')]);
        const down = await request(app({ ...noBuild, permissionError: true })).get('/perm').set('Accept', HTML);
        expect([down.status, down.text]).toEqual([503, 'Permission service unavailable']);
    });
});
