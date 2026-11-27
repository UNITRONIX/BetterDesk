'use strict';

/**
 * Console shell preference API — UX 3.5 only (UX 3.6 beta retired).
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

describe('UX 3.5 shell preference API', () => {
    it('rejects unauthenticated callers', async () => {
        const res = await request(appWithSession(null))
            .post('/api/ui-shell')
            .send({ shell: 'ux35' });
        assert.ok(res.status === 401 || res.status === 403, `status ${res.status}`);
        assert.notStrictEqual(res.body.success, true);
    });

    it('rejects unsupported and retired shell values without setting a cookie', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        for (const value of ['classic', 'ux36', 'ux99', '', null, 'UX36<script>']) {
            const res = await agent.post('/api/ui-shell').send({ shell: value });
            assert.strictEqual(res.status, 400, `${value} -> ${res.status}`);
            assert.strictEqual(res.body.success, false);
            assert.ok(!res.headers['set-cookie'], 'cookie set on rejection');
        }
    });

    it('persists UX 3.5 and reports only that shell as supported', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        const set = await agent.post('/api/ui-shell').send({ shell: 'ux35' });
        assert.strictEqual(set.status, 200);
        assert.strictEqual(set.body.data.shell, 'ux35');
        const cookie = (set.headers['set-cookie'] || []).join(';');
        assert.match(cookie, /bd_ui_shell=ux35/);
        assert.doesNotMatch(cookie, /HttpOnly/i, 'the client bridge must read it');

        const read = await agent.get('/api/ui-shell');
        assert.strictEqual(read.body.data.shell, 'ux35');
        assert.deepStrictEqual(read.body.data.supported, ['ux35']);
    });

    it('clears a stale UX 3.6 cookie on GET', async () => {
        const agent = request.agent(appWithSession({ username: 'admin', role: 'admin' }));
        const read = await agent
            .get('/api/ui-shell')
            .set('Cookie', 'bd_ui_shell=ux36');
        assert.strictEqual(read.body.data.shell, 'ux35');
        const cookie = (read.headers['set-cookie'] || []).join(';');
        assert.match(cookie, /bd_ui_shell=ux35/);
    });
});

describe('Console shell resolution from a real request', () => {
    it('ignores a retired UX 3.6 cookie', async () => {
        const app = express();
        app.use(cookieParser());
        app.get('/probe', (req, res) => {
            res.json({ shell: uiShell.resolveShell(req) });
        });
        const res = await request(app).get('/probe').set('Cookie', 'bd_ui_shell=ux36');
        assert.strictEqual(res.body.shell, 'ux35');
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
