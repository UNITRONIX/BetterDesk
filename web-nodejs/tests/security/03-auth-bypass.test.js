'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');
const { requireAuth, requirePermission, roleHasPermission } = require('../../middleware/auth');

describe('[sec/03] Authorization bypass', () => {
    const protectedPaths = [
        ['/api/system/info', 'metrics.view'],
        ['/api/users', 'user.view'],
        ['/api/settings/info', 'server.config'],
        ['/api/database/stats', 'metrics.view'],
    ];

    for (const [path, permission] of protectedPaths) {
        it(`rejects unauthenticated GET ${path}`, async () => {
            const app = createTestApp();
            app.get(path, requireAuth, requirePermission(permission), (_req, res) => {
                res.json({ success: true, leaked: true });
            });
            const res = await request(app).get(path);
            expect(res.status).toBe(401);
            expect(res.body.leaked).toBeUndefined();
        });
    }

    it('viewer cannot POST server.config endpoints', async () => {
        const app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 9;
            req.session.user = { id: 9, username: 'viewer1', role: 'viewer' };
            next();
        });
        app.post('/api/system/exec', requireAuth, requirePermission('server.config'), (_req, res) => {
            res.json({ success: true, executed: true });
        });
        const res = await request(app).post('/api/system/exec').send({ cmd: 'id' });
        expect(res.status).toBe(403);
        expect(res.body.executed).toBeUndefined();
    });

    it('role map blocks pro/viewer from privileged actions', () => {
        expect(roleHasPermission('pro', 'device.connect')).toBe(false);
        expect(roleHasPermission('viewer', 'server.config')).toBe(false);
        expect(roleHasPermission('operator', 'user.delete')).toBe(false);
        expect(roleHasPermission('admin', 'server.config')).toBe(true);
    });

    it('enforces the request effective permission snapshot over role defaults', async () => {
        const app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 9;
            req.session.user = { id: 9, username: 'operator1', role: 'operator' };
            req.permissionContextLoaded = true;
            req.effectivePermissions = new Set(['device.view']);
            next();
        });
        app.get('/api/users', requireAuth, requirePermission('user.view'), (_req, res) => {
            res.json({ success: true, leaked: true });
        });

        const res = await request(app).get('/api/users');
        expect(res.status).toBe(403);
        expect(res.body.leaked).toBeUndefined();
    });

    it('HTML unauthenticated access redirects to login with expired flag', async () => {
        const app = createTestApp();
        app.get('/dashboard', requireAuth, (_req, res) => res.send('ok'));
        const res = await request(app).get('/dashboard');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?expired=1');
    });
});
