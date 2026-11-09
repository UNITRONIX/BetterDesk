/**
 * CSRF on /api/bd: device agents authenticate with bearer tokens and skip
 * the check, but admin routes that are also mounted there (automation,
 * file transfer, dataguard, inventory, activity, ...) must not become a
 * way around CSRF for a signed-in browser.
 */

'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { csrfTokenProvider, csrfGate } = require('../middleware/csrf');

function app({ signedIn }) {
    const a = express();
    a.use(express.json());
    a.use(cookieParser());
    a.use(session({ secret: 'test-csrf-secret-key-32chars!!', resave: false, saveUninitialized: true, cookie: { secure: false } }));
    a.use((req, _res, next) => {
        if (signedIn) { req.session.userId = 1; req.session.user = { id: 1, username: 'a', role: 'admin' }; }
        next();
    });
    a.use(csrfTokenProvider);
    a.use(csrfGate);
    a.get('/token', (req, res) => res.json({ token: res.locals.csrfToken }));
    a.post('/api/bd/commands', (req, res) => res.json({ queued: true }));
    a.post('/api/devices/1/ban', (req, res) => res.json({ ok: true }));
    a.use((err, _req, res, _next) => res.status(403).json({ success: false, error: 'Invalid CSRF token' }));
    return a;
}

describe('CSRF gate', () => {
    test('a signed-in browser cannot post to an /api/bd admin route without the token', async () => {
        const res = await request(app({ signedIn: true })).post('/api/bd/commands').send({ device_id: 'x', command: 'id' });
        expect(res.status).toBe(403);
    });

    test('with the token it goes through', async () => {
        const agent = request.agent(app({ signedIn: true }));
        const { body } = await agent.get('/token');
        const res = await agent.post('/api/bd/commands').set('X-CSRF-Token', body.token).send({});
        expect(res.status).toBe(200);
        expect(res.body.queued).toBe(true);
    });

    test('device agents without a session still skip the check', async () => {
        const res = await request(app({ signedIn: false })).post('/api/bd/commands')
            .set('Authorization', 'Bearer device-token').send({});
        expect(res.status).toBe(200);
    });

    test('other API routes always need the token', async () => {
        expect((await request(app({ signedIn: false })).post('/api/devices/1/ban').send({})).status).toBe(403);
        expect((await request(app({ signedIn: true })).post('/api/devices/1/ban').send({})).status).toBe(403);
    });
});
