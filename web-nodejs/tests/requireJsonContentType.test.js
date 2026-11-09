'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');

// The middleware routes/index.js uses
const { requireJsonContentType } = require('../lib/requireJsonContentType');

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
        app.post('/api/generator/module/install-local', (req, res) => {
            res.json({ success: true, reached: 'install-local' });
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

    it('allows the multipart module archive upload (A3)', async () => {
        const res = await request(app)
            .post('/api/generator/module/install-local')
            .attach('archive', Buffer.from('PK'), 'module.zip');
        expect(res.status).toBe(200);
        expect(res.body.reached).toBe('install-local');
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
