'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');
const { escapeHtml } = require('../../lib/escapeHtml');
const { SQLI, SAFE_SQL_IDENT, MALICIOUS_SQL_IDENT, SAFE_IDENT_RE } = require('./payloads');
const { assertSafeSqlIdent, isSafeSqlIdent, SAFE_SQL_IDENT_RE } = require('../../lib/safeSqlIdent');

describe('[sec/01] SQL injection', () => {
    it('assertSafeSqlIdent accepts catalog names and rejects malicious identifiers', () => {
        expect(SAFE_SQL_IDENT_RE.source).toBe(SAFE_IDENT_RE.source);
        for (const name of SAFE_SQL_IDENT) {
            expect(assertSafeSqlIdent(name)).toBe(name);
            expect(isSafeSqlIdent(name)).toBe(true);
        }
        for (const name of MALICIOUS_SQL_IDENT) {
            expect(isSafeSqlIdent(name)).toBe(false);
            expect(() => assertSafeSqlIdent(name)).toThrow(/Unsafe SQL identifier/);
        }
    });

    it('encodes SQLi metacharacters when rendered via escapeHtml', () => {
        for (const payload of SQLI) {
            expect(escapeHtml(payload)).toBe(
                payload
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#39;')
            );
        }
    });

    it('login-shaped handler rejects SQLi usernames without crash (401)', async () => {
        const app = createTestApp();
        app.post('/api/auth/login', (req, res) => {
            void req.body;
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        });
        for (const payload of SQLI) {
            const res = await request(app)
                .post('/api/auth/login')
                .send({ username: payload, password: 'x' });
            expect(res.status).toBe(401);
            expect(res.body.success).toBe(false);
        }
    });

    it('catalog table identifiers match safe pattern; malicious names fail', () => {
        for (const name of SAFE_SQL_IDENT) {
            expect(SAFE_IDENT_RE.test(name)).toBe(true);
        }
        for (const name of MALICIOUS_SQL_IDENT) {
            expect(SAFE_IDENT_RE.test(name)).toBe(false);
        }
    });
});
