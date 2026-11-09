/**
 * The auth guards answer API requests with JSON and page requests with a
 * redirect or an error page. They used to decide by req.path, which inside
 * a router mounted at a prefix (app.use('/api/files', router)) lacks the
 * prefix: a missing session got a 302 to /login (fetch then saw the login
 * page with 200) and a missing permission got the HTML 403 page.
 * BUGS.md A1 and R14.
 */

const express = require('express');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { requireAuth, requirePermission, requireAdmin, requireRole } = require('../middleware/auth');

function app(role) {
    const a = createTestApp();
    if (role) {
        a.use((req, _res, next) => {
            req.session.userId = 5;
            req.session.user = { id: 5, username: 'u', role };
            next();
        });
    }
    const r = express.Router();
    r.get('/open', requireAuth, (_req, res) => res.json({ ok: true }));
    r.get('/config', requireAuth, requirePermission('server.config'), (_req, res) => res.json({ ok: true }));
    r.get('/admin', requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }));
    r.get('/operator', requireAuth, requireRole('operator'), (_req, res) => res.json({ ok: true }));
    a.use('/api/thing', r);
    a.use('/pages', r);
    return a;
}

describe('guards in a router mounted under /api', () => {
    test('no session: 401 JSON, not a redirect', async () => {
        const res = await request(app(null)).get('/api/thing/open');
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ success: false, code: 'session_required' });
    });

    test('missing permission: 403 JSON naming the permission', async () => {
        const res = await request(app('viewer')).get('/api/thing/config');
        expect(res.status).toBe(403);
        expect(res.headers['content-type']).toMatch(/json/);
        expect(res.body.error).toBe('Permission denied: server.config');
    });

    test('requireAdmin and requireRole answer JSON too', async () => {
        const admin = await request(app('viewer')).get('/api/thing/admin');
        expect(admin.status).toBe(403);
        expect(admin.headers['content-type']).toMatch(/json/);
        const op = await request(app('viewer')).get('/api/thing/operator');
        expect(op.status).toBe(403);
        expect(op.headers['content-type']).toMatch(/json/);
    });

    test('pages mounted elsewhere still redirect', async () => {
        const res = await request(app(null)).get('/pages/open');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?return=%2Fpages%2Fopen');
    });

    test('allowed requests pass', async () => {
        expect((await request(app('server_admin')).get('/api/thing/config')).body).toEqual({ ok: true });
    });
});
