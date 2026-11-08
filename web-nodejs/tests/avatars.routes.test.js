'use strict';

/**
 * GET /api/users/:id/avatar and GET /api/users/avatars against a real
 * SQLite database (user_avatars table, services/dbAdapter.js).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');

jest.mock('../middleware/rateLimiter', () => {
    const actual = jest.requireActual('../middleware/rateLimiter');
    return { ...actual, panelReadLimiter: (_req, _res, next) => next() };
});

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC', 'base64');

describe('profile picture routes', () => {
    let tempDir;
    let db;
    let avatarService;
    let app;
    let anon;
    let alice;
    let bob;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-avatars-'));
        process.env.DATA_DIR = path.join(tempDir, 'panel-data');
        process.env.DB_PATH = path.join(tempDir, 'db_v2.sqlite3');
        process.env.DB_TYPE = 'sqlite';
        jest.resetModules();
        db = require('../services/database');
        await db.init();
        avatarService = require('../services/avatarService');
        const { createTestApp } = require('./helpers');
        const routes = require('../routes/avatars.routes');

        alice = await db.createUser('alice', 'x', 'operator');
        bob = await db.createUser('bob', 'x', 'viewer');

        anon = createTestApp();
        anon.use('/', routes);
        // Signed in as bob, a viewer: may still see alice's picture
        app = createTestApp();
        app.use((req, _res, next) => { req.session.userId = bob.id; req.session.user = bob; next(); });
        app.use('/', routes);
    });

    afterAll(async () => {
        await db.close();
        delete process.env.DATA_DIR;
        delete process.env.DB_PATH;
        delete process.env.DB_TYPE;
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    beforeEach(async () => {
        await db.deleteUserAvatar(alice.id);
        avatarService.resetCache();
    });

    it('needs a signed-in user', async () => {
        await avatarService.syncOidcPicture(alice.id, { picture: `data:image/png;base64,${PNG.toString('base64')}` });
        const res = await request(anon).get(`/api/users/${alice.id}/avatar`);
        expect(res.status).toBe(401);
        expect(res.body).toEqual(expect.objectContaining({ success: false }));
        expect((await request(anon).get('/api/users/avatars')).status).toBe(401);
    });

    it('answers 404 when the user has no picture', async () => {
        expect((await request(app).get(`/api/users/${alice.id}/avatar`)).status).toBe(404);
        expect((await request(app).get('/api/users/99999/avatar')).status).toBe(404);
        expect((await request(app).get('/api/users/abc/avatar')).status).toBe(404);
    });

    it('serves the stored picture with safe headers', async () => {
        await avatarService.syncOidcPicture(alice.id, { picture: `data:image/png;base64,${PNG.toString('base64')}` });
        const version = await avatarService.getAvatarVersion(alice.id);
        expect(version).toMatch(/^[0-9a-f]{16}$/);

        const res = await request(app).get(`/api/users/${alice.id}/avatar`).buffer(true).parse((r, cb) => {
            const chunks = [];
            r.on('data', (c) => chunks.push(c));
            r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toBe('image/png');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['content-security-policy']).toBe("default-src 'none'");
        expect(res.headers['cache-control']).toBe('private, no-cache');
        expect(res.headers.etag).toBe(`"${version}"`);
        expect(Buffer.compare(res.body, PNG)).toBe(0);

        const versioned = await request(app).get(`/api/users/${alice.id}/avatar?v=${version}`);
        expect(versioned.headers['cache-control']).toBe('private, max-age=86400');

        const again = await request(app).get(`/api/users/${alice.id}/avatar`).set('If-None-Match', `"${version}"`);
        expect(again.status).toBe(304);
    });

    it('lists who has a picture', async () => {
        await avatarService.syncOidcPicture(alice.id, { picture: `data:image/png;base64,${PNG.toString('base64')}` });
        const res = await request(app).get('/api/users/avatars');
        expect(res.status).toBe(200);
        expect(res.body.data.users).toEqual([
            { id: alice.id, username: 'alice', avatar_version: await avatarService.getAvatarVersion(alice.id) },
        ]);
    });

    it('fetches and stores an http(s) avatar URL saved in the profile instead of hotlinking it', async () => {
        const os2 = require('os');
        const lan = Object.values(os2.networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal);
        if (!lan) return; // no LAN address to serve from (outside Docker)
        const http = require('http');
        const server = http.createServer((req, res) => {
            if (req.url === '/me.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
            res.writeHead(404); res.end();
        });
        await new Promise((r) => server.listen(0, '0.0.0.0', r));
        const url = `http://${lan.address}:${server.address().port}/me.png`;
        try {
            const profileRoutes = require('../routes/phase4_5.routes');
            const express = require('express');
            const papp = express();
            papp.use(express.json());
            papp.use((req, _res, next) => { req.session = { userId: alice.id, user: alice }; next(); });
            papp.use('/', profileRoutes);

            const saved = await request(papp).put('/api/users/me/profile').send({ first_name: 'Alice', avatar_url: url });
            expect(saved.status).toBe(200);
            expect(saved.body).toEqual(expect.objectContaining({ success: true, avatar: 'stored' }));
            const row = await db.getUserAvatar(alice.id);
            expect(row.source).toBe('profile');
            expect(row.source_url).toBe(url);
            expect(Buffer.compare(Buffer.from(row.data), PNG)).toBe(0);

            const bad = await request(papp).put('/api/users/me/profile').send({ avatar_url: 'http://127.0.0.1/x.png' });
            expect(bad.status).toBe(200);
            expect(bad.body).toEqual(expect.objectContaining({ success: true, avatar: 'failed', avatar_error: 'address_refused' }));

            const cleared = await request(papp).put('/api/users/me/profile').send({ avatar_url: '' });
            expect(cleared.body.avatar).toBe('cleared');
            expect(await db.getUserAvatar(alice.id)).toBeNull();
        } finally {
            await new Promise((r) => server.close(r));
        }
    });

    it('keeps an OIDC picture when a profile picture is cleared, and removes it with the user', async () => {
        await avatarService.syncOidcPicture(alice.id, { picture: `data:image/png;base64,${PNG.toString('base64')}` });
        await avatarService.syncProfileAvatarUrl(alice.id, '');
        expect((await request(app).get(`/api/users/${alice.id}/avatar`)).status).toBe(200);

        const carol = await db.createUser('carol', 'x', 'viewer');
        await avatarService.syncOidcPicture(carol.id, { picture: `data:image/png;base64,${PNG.toString('base64')}` });
        expect(await db.getUserAvatar(carol.id)).toBeTruthy();
        await db.deleteUser(carol.id);
        expect(await db.getUserAvatar(carol.id)).toBeNull();
    });
});
