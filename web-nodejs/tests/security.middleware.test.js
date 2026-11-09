const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createTestApp } = require('./helpers');

function getScriptSrcDirective(cspHeader) {
    const match = String(cspHeader || '').match(/script-src ([^;]+)/);
    return match ? match[1] : '';
}

function getScriptSrcAttr(cspHeader) {
    const match = String(cspHeader || '').match(/script-src-attr ([^;]+)/);
    return match ? match[1] : '';
}

describe('Security Middleware', () => {
    function createSecureApp() {
        jest.resetModules();
        const securityMiddleware = require('../middleware/security');
        const app = createTestApp();
        app.use(securityMiddleware);
        return app;
    }

    it('sets a strict policy on what the server answers: own scripts only, no frames', async () => {
        const app = createSecureApp();
        app.get('/api/x', (_req, res) => res.json({ ok: true }));
        app.get('/remote/device-123', (_req, res) => res.send('remote'));

        for (const p of ['/api/x', '/remote/device-123']) {
            const res = await request(app).get(p);
            const csp = res.headers['content-security-policy'];
            expect(res.status).toBe(200);
            expect(getScriptSrcDirective(csp)).toBe("'self'");
            expect(getScriptSrcAttr(csp)).toBe("'none'");
            expect(csp).not.toMatch(/nonce-|unsafe-eval|jsdelivr|googleapis|gstatic/);
            expect(csp).toContain("frame-ancestors 'none'");
            expect(csp).toContain("object-src 'none'");
            expect(res.headers['x-frame-options']).toBe('DENY');
        }
    });

    it('ships a protobuf runtime without dynamic code generation', () => {
        const vendor = fs.readFileSync(
            path.join(__dirname, '..', '../web-ui/static/rdclient/vendor/protobuf.min.js'),
            'utf8'
        );

        expect(vendor).not.toMatch(/\beval\s*\(/);
        expect(vendor).not.toMatch(/\bFunction\s*\(/);
    });

    it('omits HSTS when HTTPS with self-signed certs (ALLOW_SELF_SIGNED_CERTS=true)', async () => {
        const originalHttps = process.env.HTTPS_ENABLED;
        const originalAllow = process.env.ALLOW_SELF_SIGNED_CERTS;
        const originalHsts = process.env.HSTS_ENABLED;
        process.env.HTTPS_ENABLED = 'true';
        process.env.ALLOW_SELF_SIGNED_CERTS = 'true';
        delete process.env.HSTS_ENABLED;

        jest.resetModules();
        const securityMw = require('../middleware/security');
        const app = createTestApp();
        app.use(securityMw);
        app.get('/hsts-check', (_req, res) => res.send('ok'));

        const res = await request(app).get('/hsts-check');
        expect(res.status).toBe(200);
        expect(res.headers['strict-transport-security']).toBeUndefined();

        process.env.HTTPS_ENABLED = originalHttps;
        process.env.ALLOW_SELF_SIGNED_CERTS = originalAllow;
        if (originalHsts !== undefined) process.env.HSTS_ENABLED = originalHsts;
        else delete process.env.HSTS_ENABLED;
        jest.resetModules();
    });
});
