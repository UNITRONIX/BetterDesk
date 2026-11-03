'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');

/**
 * Mirrors routes/index.js requireJsonContentType — keep in sync when exemptions change.
 */
function requireJsonContentType(req, res, next) {
    if (['GET', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method)) {
        return next();
    }
    if (!req.path.startsWith('/api/')) {
        return next();
    }
    if (req.path.includes('/upload') || req.path.includes('/import')) {
        return next();
    }
    // Disaster-recovery restore uploads multipart/form-data (field "backup").
    // Do not exempt /api/settings/updates/restore — that endpoint is JSON-only.
    if (req.path === '/api/settings/restore') {
        return next();
    }
    if (!req.is('application/json')) {
        return res.status(415).json({
            success: false,
            error: 'Content-Type must be application/json',
        });
    }
    next();
}

describe('requireJsonContentType (#473)', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
        app.use(requireJsonContentType);
        app.post('/api/settings/restore', (req, res) => {
            res.json({ success: true, reached: 'restore' });
        });
        app.post('/api/settings/updates/restore', (req, res) => {
            res.json({ success: true, reached: 'updates-restore' });
        });
        app.post('/api/settings/email/smtp/test', (req, res) => {
            res.json({ success: true, reached: 'smtp' });
        });
    });

    it('allows multipart POST to /api/settings/restore', async () => {
        const res = await request(app)
            .post('/api/settings/restore')
            .attach('backup', Buffer.from('{"_format":"betterdesk-backup"}'), 'backup.json');
        expect(res.status).toBe(200);
        expect(res.body.reached).toBe('restore');
    });

    it('still requires JSON for /api/settings/updates/restore', async () => {
        const res = await request(app)
            .post('/api/settings/updates/restore')
            .attach('backup', Buffer.from('x'), 'backup.json');
        expect(res.status).toBe(415);
        expect(res.body.error).toBe('Content-Type must be application/json');
    });

    it('still requires JSON for unrelated API POST', async () => {
        const res = await request(app).post('/api/settings/email/smtp/test');
        expect(res.status).toBe(415);
        expect(res.body.error).toBe('Content-Type must be application/json');
    });

    it('allows JSON POST to /api/settings/updates/restore', async () => {
        const res = await request(app)
            .post('/api/settings/updates/restore')
            .set('Content-Type', 'application/json')
            .send({ backupName: 'pre-update-test' });
        expect(res.status).toBe(200);
        expect(res.body.reached).toBe('updates-restore');
    });
});
