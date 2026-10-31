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
        delete process.env.CSP_RELAX_REMOTE;
        const securityMiddleware = require('../middleware/security');
        const app = createTestApp();
        app.use(securityMiddleware);
        return app;
    }

    it('sets nonce-based CSP on standard pages without unsafe-eval or unsafe-inline scripts', async () => {
        const app = createSecureApp();
        app.get('/dashboard', (_req, res) => {
            res.send('<html><body>ok</body></html>');
        });

        const res = await request(app).get('/dashboard');
        const scriptSrc = getScriptSrcDirective(res.headers['content-security-policy']);
        const scriptSrcAttr = getScriptSrcAttr(res.headers['content-security-policy']);

        expect(res.status).toBe(200);
        expect(scriptSrc).toMatch(/'self' 'nonce-[^']+'/);
        expect(scriptSrc).not.toContain("'unsafe-inline'");
        expect(scriptSrc).not.toContain("'unsafe-eval'");
        expect(scriptSrcAttr).toContain("'none'");
    });

    it('does not allow unsafe-eval on remote viewer by default (static protobuf)', async () => {
        const app = createSecureApp();
        app.get('/remote/device-123', (_req, res) => {
            res.send('<html><body>remote</body></html>');
        });

        const res = await request(app).get('/remote/device-123');
        const scriptSrc = getScriptSrcDirective(res.headers['content-security-policy']);

        expect(res.status).toBe(200);
        expect(scriptSrc).toMatch(/'self' 'nonce-[^']+'/);
        expect(scriptSrc).not.toContain("'unsafe-eval'");
        expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('ships a protobuf runtime without dynamic code generation', () => {
        const vendor = fs.readFileSync(
            path.join(__dirname, '..', 'public/js/vendor/protobuf.min.js'),
            'utf8'
        );

        expect(vendor).not.toMatch(/\beval\s*\(/);
        expect(vendor).not.toMatch(/\bFunction\s*\(/);
    });

    it('allows unsafe-eval on /remote only when CSP_RELAX_REMOTE=true (rollback)', async () => {
        process.env.CSP_RELAX_REMOTE = 'true';
        jest.resetModules();
        const securityMw = require('../middleware/security');
        const app = createTestApp();
        app.use(securityMw);
        app.get('/remote/device-123', (_req, res) => res.send('remote'));

        const res = await request(app).get('/remote/device-123');
        const scriptSrc = getScriptSrcDirective(res.headers['content-security-policy']);
        expect(scriptSrc).toContain("'unsafe-eval'");

        delete process.env.CSP_RELAX_REMOTE;
        jest.resetModules();
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
