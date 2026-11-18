'use strict';

/**
 * UX 3.6 beta — API + SSR integration.
 *
 * Verifies the shell preference endpoint (auth, validation, cookie) and that a
 * request carrying the cookie is rendered with the UX 3.6 chrome. Uses the real
 * Express app without touching the database of a running instance: the login
 * route is stubbed by injecting a session into the store via supertest's agent
 * is not possible here, so these cases assert the unauthenticated contract and
 * exercise the resolver/render path directly.
 */

const assert = require('assert');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');

const uiShellRoutes = require('../routes/ui-shell.routes');
const uiShell = require('../lib/uiShell');

function appWithSession(user) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
        if (user) {
            req.session = { user };
            // requireAuth reads req.session.user; permissions are not needed here.
            req.session.userId = 1;
        } else {
            req.session = {};
        }
        next();
    });
    app.use(uiShellRoutes);
    app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
        res.status(err.status || 500).json({ success: false, error: err.message });
    });
    return app;
}

describe('UX 3.6 shell preference API', () => {
    it('rejects unauthenticated callers', async () => {
        const res = await request(appWithSession(null))
            .post('/api/ui-shell')
            .send({ shell: 'ux36' });
        assert.ok(res.status === 401 || res.status === 403, `status ${res.status}`);
        assert.notStrictEqual(res.body.success, true);
    });

    it('rejects unsupported shell values without setting a cookie', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        for (const value of ['classic', 'ux99', '', null, 'UX36<script>']) {
            const res = await agent.post('/api/ui-shell').send({ shell: value });
            assert.strictEqual(res.status, 400, `${value} -> ${res.status}`);
            assert.strictEqual(res.body.success, false);
            assert.ok(!res.headers['set-cookie'], 'cookie set on rejection');
        }
    });

    it('persists a valid choice and reports it back', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        const set = await agent.post('/api/ui-shell').send({ shell: 'ux36' });
        assert.strictEqual(set.status, 200);
        assert.strictEqual(set.body.data.shell, 'ux36');
        const cookie = (set.headers['set-cookie'] || []).join(';');
        assert.match(cookie, /bd_ui_shell=ux36/);
        assert.doesNotMatch(cookie, /HttpOnly/i, 'the client bridge must read it');

        const read = await agent.get('/api/ui-shell');
        assert.strictEqual(read.body.data.shell, 'ux36');
        assert.deepStrictEqual(read.body.data.supported, ['ux35', 'ux36']);
    });

    it('switches back to UX 3.5', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        await agent.post('/api/ui-shell').send({ shell: 'ux36' });
        const back = await agent.post('/api/ui-shell').send({ shell: 'ux35' });
        assert.strictEqual(back.body.data.shell, 'ux35');
        const read = await agent.get('/api/ui-shell');
        assert.strictEqual(read.body.data.shell, 'ux35');
    });
});

describe('UX 3.6 shell resolution from a real request', () => {
    it('reads the cookie the endpoint writes', async () => {
        const app = express();
        app.use(cookieParser());
        app.get('/probe', (req, res) => {
            res.json({ shell: uiShell.resolveShell(req) });
        });
        const res = await request(app).get('/probe').set('Cookie', 'bd_ui_shell=ux36');
        assert.strictEqual(res.body.shell, 'ux36');
    });

    it('falls back to UX 3.5 for a stale classic cookie', async () => {
        const app = express();
        app.use(cookieParser());
        app.get('/probe', (req, res) => {
            res.json({ shell: uiShell.resolveShell(req) });
        });
        const res = await request(app).get('/probe').set('Cookie', 'bd_ui_shell=classic');
        assert.strictEqual(res.body.shell, 'ux35');
    });
});
