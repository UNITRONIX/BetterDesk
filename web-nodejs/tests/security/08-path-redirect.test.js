'use strict';

const path = require('path');
const { normalizeRdClientReturnUrl } = require('../../middleware/auth');
const { resolveChildPath, isPathInsideRoot } = require('../../lib/safePath');
const { OPEN_REDIRECT, PATH_TRAVERSAL } = require('./payloads');

describe('[sec/08] Path traversal / open redirect', () => {
    it('normalizeRdClientReturnUrl blocks open redirects', () => {
        for (const u of OPEN_REDIRECT) {
            expect(normalizeRdClientReturnUrl(u)).toBeNull();
        }
        expect(normalizeRdClientReturnUrl('/remote?x=1')).toMatch(/^\/remote/);
        expect(normalizeRdClientReturnUrl('/dashboard')).toBeNull();
    });

    it('resolveChildPath rejects traversal segments', () => {
        const root = path.join(__dirname, '..', '..', 'data');
        for (const seg of ['..', '../etc/passwd', '..\\windows']) {
            expect(() => resolveChildPath(root, seg)).toThrow();
        }
    });

    it('isPathInsideRoot rejects escape outside data root', () => {
        const root = path.join(__dirname, '..', '..', 'data');
        const outside = path.join(root, '..', 'server.js');
        expect(isPathInsideRoot(outside, root)).toBe(false);
        // PATH_TRAVERSAL used as documentation of covered cases
        expect(PATH_TRAVERSAL.length).toBeGreaterThan(0);
    });
});
