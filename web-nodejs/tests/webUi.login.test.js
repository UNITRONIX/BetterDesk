/**
 * The new console's sign-in page (lib/webUi.js): open without a session
 * (the Docker healthcheck and install.sh probe /login), the way back after
 * sign-in (R3), no "session expired" on a first visit (R4).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createTestApp } = require('./helpers');
const { createWebUi } = require('../lib/webUi');

let dir;
beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webui-login-'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head></head><body>app</body></html>');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function app(user) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        if (user) { req.session.userId = user.id; req.session.user = user; }
        next();
    });
    a.use(createWebUi({ base: '', dir }));
    a.use((req, res) => res.status(404).send('server 404'));
    return a;
}

describe('sign-in page in the new console', () => {
    test('answers 200 without a session, the desktop sign-in too', async () => {
        expect((await request(app(null)).get('/login')).status).toBe(200);
        expect((await request(app(null)).get('/login?desktop=1')).status).toBe(200);
        expect((await request(app(null)).get('/login?autoLaunch=0')).status).toBe(200);
    });

    test('someone signed in goes to the return path, or to the start', async () => {
        const admin = { id: 1, role: 'admin' };
        const back = await request(app(admin)).get('/login?return=%2Fdevices%3Fopen%3D7');
        expect(back.status).toBe(302);
        expect(back.headers.location).toBe('/devices?open=7');
        for (const bad of ['//evil.example', 'https://evil.example', '/%5Cevil', '/login']) {
            const res = await request(app(admin)).get('/login?return=' + encodeURIComponent(bad));
            expect(res.status).toBe(302);
            expect(res.headers.location).toBe('/');
        }
    });

    test('a pro account (no console) still gets the sign-in page', async () => {
        expect((await request(app({ id: 9, role: 'pro' })).get('/login')).status).toBe(200);
    });

    test('console pages: the way back, and "expired" only after a session ended', async () => {
        const first = await request(app(null)).get('/devices?open=1');
        expect(first.headers.location).toBe('/login?return=%2Fdevices%3Fopen%3D1');
        const ended = await request(app(null)).get('/devices').set('Cookie', 'bd.sid=s%3Agone.sig');
        expect(ended.headers.location).toBe('/login?expired=1&return=%2Fdevices');
    });
});
