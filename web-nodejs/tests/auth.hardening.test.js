'use strict';

/**
 * Panel login hardening (audit H4, M1-M3, 2026-11-13).
 *
 * Before the fix the panel login only had a per-IP limiter and the shared
 * account-lockout tracker was never consulted, so rotating IPs gave unlimited
 * password guesses. Delegated 2FA also fell back to local verification when Go
 * was unreachable, and GET /logout tore the session down without CSRF.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
    getUserById: jest.fn().mockResolvedValue({ id: 1, username: 'admin', role: 'admin', password_hash: 'hash' }),
    getUserByUsername: jest.fn().mockResolvedValue(null),
    createUser: jest.fn().mockResolvedValue(undefined),
    syncUserFromGo: jest.fn().mockResolvedValue(undefined),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
    enableTotp: jest.fn().mockResolvedValue(undefined),
    disableTotp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/authService', () => ({
    authenticate: jest.fn().mockResolvedValue(null),
    isAuthFailure: jest.fn((result) => !!(result && result.__authFailure)),
    changePassword: jest.fn().mockResolvedValue({ success: true }),
    hashPassword: jest.fn().mockResolvedValue('hashed'),
    verifyPassword: jest.fn().mockResolvedValue(true),
    verifyAndEnableTotp: jest.fn().mockResolvedValue({ success: true, recoveryCodes: [] }),
    disableTotp: jest.fn().mockResolvedValue({ success: true }),
    isTotpEnabled: jest.fn().mockResolvedValue(false),
    generateTotpSetup: jest.fn().mockResolvedValue({ success: true }),
    generateRecoveryCodes: jest.fn().mockReturnValue([]),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
    checkBruteForce: jest.fn().mockResolvedValue({ blocked: false, reason: '', retryAfter: 0 }),
    verifyTotpViaGo: jest.fn().mockResolvedValue(null),
    verifyTotpCode: jest.fn().mockResolvedValue(false),
    verifyRecoveryCode: jest.fn().mockResolvedValue(false),
}));

jest.mock('../services/userSync', () => ({
    mirrorUpdate: jest.fn().mockResolvedValue(undefined),
    mirrorTotpEnable: jest.fn().mockResolvedValue(undefined),
    mirrorTotpDisable: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../middleware/rateLimiter', () => ({
    loginLimiter: (_req, _res, next) => next(),
    passwordChangeLimiter: (_req, _res, next) => next(),
    apiLimiter: (_req, _res, next) => next(),
}));

jest.mock('../services/betterdeskApi', () => ({
    exchangeOIDCCode: jest.fn(),
    getOIDCStatus: jest.fn().mockResolvedValue({ success: true, data: { enabled: false } }),
    startOIDCAuthorize: jest.fn(),
}));

jest.mock('../services/serverAttestation', () => ({
    getLastResult: jest.fn().mockResolvedValue(null),
    buildPublicSummary: () => ({ tier: null, maxConnections: null }),
    getBadgePresentation: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/panelSessionService', () => ({
    clientMetaFromRequest: () => ({ ip: '127.0.0.1', userAgent: 'jest', clientFingerprint: 'fp' }),
    establishAuthenticatedSession: jest.fn().mockResolvedValue({ replaced: [] }),
    endCurrentSession: jest.fn().mockResolvedValue(undefined),
    getPolicy: () => ({ idleTimeoutMs: 1000, maxAgeMs: 2000 }),
    touchActivity: () => ({ ok: true }),
    noteIpChange: () => {},
}));

jest.mock('../middleware/guestAccess', () => ({
    clearGuestCookie: jest.fn(),
}));

const authService = require('../services/authService');
const authRoutes = require('../routes/auth.routes');

describe('panel login lockout (audit H4)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        authService.checkBruteForce.mockResolvedValue({ blocked: false, reason: '', retryAfter: 0 });
        authService.authenticate.mockResolvedValue(null);
        app = createTestApp();
        app.use('/', authRoutes);
    });

    it('returns 429 with retry_after when the account is locked', async () => {
        authService.checkBruteForce.mockResolvedValue({ blocked: true, reason: 'account_locked', retryAfter: 540 });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'whatever' });

        expect(res.status).toBe(429);
        expect(res.body.code).toBe('account_locked');
        expect(res.body.retry_after).toBe(540);
        expect(res.headers['retry-after']).toBe('540');
        // Never reach password verification when the account is locked.
        expect(authService.authenticate).not.toHaveBeenCalled();
    });

    it('consults the lockout tracker before authenticating', async () => {
        await request(app)
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'whatever' });

        expect(authService.checkBruteForce).toHaveBeenCalledWith('admin', expect.anything());
    });
});

describe('delegated 2FA fails closed (audit M1)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createTestApp();
        // A half-authenticated session with a Go partial token, as left by the
        // password step when Go requires a second factor. The state must be
        // seeded BEFORE the router so the handler sees it.
        app.use((req, _res, next) => {
            req.session.pendingTotpUserId = 1;
            req.session.pendingTotpUser = { id: 1, username: 'admin', role: 'admin' };
            req.session.goPartialToken = 'partial-token';
            next();
        });
        app.use('/', authRoutes);
    });

    it('returns 503 instead of verifying locally when Go is unreachable', async () => {
        authService.verifyTotpViaGo.mockResolvedValue(null);

        const res = await request(app)
            .post('/api/auth/totp/verify')
            .send({ code: '123456' });

        expect(res.status).toBe(503);
        expect(res.body.code).toBe('totp_backend_unavailable');
        // Local verification must not run — Go owns the 2FA policy and limits.
        expect(authService.verifyTotpCode).not.toHaveBeenCalled();
        expect(authService.verifyRecoveryCode).not.toHaveBeenCalled();
    });

    it('still rejects a wrong code reported by Go', async () => {
        authService.verifyTotpViaGo.mockResolvedValue({ rejected: true });

        const res = await request(app)
            .post('/api/auth/totp/verify')
            .send({ code: '000000' });

        expect(res.status).toBe(401);
        expect(authService.verifyTotpCode).not.toHaveBeenCalled();
    });
});

describe('logout CSRF (audit M3)', () => {
    it('does not destroy the session on a bare GET', async () => {
        const app = createTestApp();
        app.use('/', authRoutes);

        const res = await request(app).get('/logout');

        // Unauthenticated GET keeps the old friendly redirect.
        expect([302, 405]).toContain(res.status);
        expect(res.headers.location || '').toMatch(/\/login/);
    });
});
