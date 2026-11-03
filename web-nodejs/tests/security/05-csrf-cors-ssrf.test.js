'use strict';

const express = require('express');
const request = require('supertest');
const { createCsrfApp } = require('./helpers');
const {
    assertSafeHostname,
    assertSafeHttpUrl,
    SsrfBlockedError,
} = require('../../lib/ssrfGuard');
const { EVIL_ORIGINS } = require('./payloads');

describe('[sec/05] CSRF / CORS / SSRF', () => {
    it('rejects mutating POST without CSRF token', async () => {
        const app = createCsrfApp((a) => {
            a.post('/api/settings/branding', (_req, res) => res.json({ success: true }));
        });
        const res = await request(app).post('/api/settings/branding').send({ name: 'x' });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/CSRF/i);
    });

    it('rejects mutating PUT without CSRF token', async () => {
        const app = createCsrfApp((a) => {
            a.put('/api/users/1', (_req, res) => res.json({ success: true }));
        });
        const res = await request(app).put('/api/users/1').send({ role: 'admin' });
        expect(res.status).toBe(403);
    });

    it('CORS does not reflect arbitrary Origin (Tauri allowlist only)', async () => {
        const app = express();
        app.use('/api/', (req, res, next) => {
            const origin = req.headers.origin || '';
            const allowed = [
                'http://localhost:1420',
                'tauri://localhost',
                'https://tauri.localhost',
            ];
            if (allowed.includes(origin)) {
                res.setHeader('Access-Control-Allow-Origin', origin);
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }
            next();
        });
        app.get('/api/ping', (_req, res) => res.json({ ok: true }));

        for (const origin of EVIL_ORIGINS) {
            const evil = await request(app).get('/api/ping').set('Origin', origin);
            expect(evil.headers['access-control-allow-origin']).toBeUndefined();
        }
        const tauri = await request(app).get('/api/ping').set('Origin', 'tauri://localhost');
        expect(tauri.headers['access-control-allow-origin']).toBe('tauri://localhost');
    });

    it('ssrfGuard blocks localhost, link-local metadata, and file URLs', async () => {
        expect(() => assertSafeHostname('localhost')).toThrow(SsrfBlockedError);
        expect(() => assertSafeHostname('127.0.0.1')).toThrow(SsrfBlockedError);
        expect(() => assertSafeHostname('169.254.169.254')).toThrow(SsrfBlockedError);
        await expect(assertSafeHttpUrl('http://127.0.0.1/')).rejects.toThrow(SsrfBlockedError);
        await expect(assertSafeHttpUrl('file:///etc/passwd')).rejects.toThrow(SsrfBlockedError);
    });
});
