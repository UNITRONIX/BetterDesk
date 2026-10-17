'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');
const { escapeHtml } = require('../../lib/escapeHtml');
const { XSS } = require('./payloads');

describe('[sec/02] XSS', () => {
    it('escapeHtml neutralizes script / event-handler markup', () => {
        for (const payload of XSS) {
            const out = escapeHtml(payload);
            expect(out).not.toContain('<script');
            expect(out).not.toContain('<svg');
            expect(out).not.toContain('<img');
            if (payload.includes('<')) {
                expect(out).toContain('&lt;');
            }
        }
    });

    it('JSON API reflections stay application/json (not HTML document)', async () => {
        const app = createTestApp();
        app.get('/api/echo', (req, res) => {
            res.json({ q: String(req.query.q || '') });
        });
        const payload = XSS[0];
        const res = await request(app).get('/api/echo').query({ q: payload });
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/application\/json/);
        expect(res.body.q).toBe(payload);
        expect(res.text).not.toMatch(/^<html/i);
    });
});
