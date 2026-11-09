/**
 * The sign-in page's server side (routes/auth.routes.js):
 * - R3: after sign-in (password, two-factor) the way back is the ?return=
 *   path when it is a console path;
 * - GET /api/auth/login-page: what the new sign-in page shows before
 *   anyone is signed in (no user data, so no list of accounts either: S4).
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getUserById: jest.fn().mockResolvedValue(null),
    getUserByUsername: jest.fn().mockResolvedValue(null),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
    getAllUsersForBackup: jest.fn().mockResolvedValue([
        { username: 'alice-the-admin', role: 'super_admin', password_hash: 'x' },
        { username: 'bob-operator', role: 'operator', password_hash: 'y' }
    ])
}));

jest.mock('../services/authService', () => ({
    authenticate: jest.fn().mockResolvedValue(null),
    isAuthFailure: jest.fn(() => false),
    recordAttempt: jest.fn(),
    verifyTotpViaGo: jest.fn().mockResolvedValue(null),
    verifyTotpCode: jest.fn().mockResolvedValue(true),
    verifyRecoveryCode: jest.fn().mockResolvedValue(false)
}));

jest.mock('../middleware/rateLimiter', () => ({
    loginLimiter: (_req, _res, next) => next(),
    passwordChangeLimiter: (_req, _res, next) => next()
}));

jest.mock('../services/betterdeskApi', () => ({
    getOIDCStatus: jest.fn().mockResolvedValue({ success: true, data: { enabled: false } }),
    startOIDCAuthorize: jest.fn().mockResolvedValue({ success: true, data: { auth_url: 'https://idp.example/auth' } })
}));

jest.mock('../services/panelSessionService', () => ({
    clientMetaFromRequest: jest.fn(() => ({ ip: '127.0.0.1', userAgent: 'jest', clientFingerprint: '' })),
    establishAuthenticatedSession: jest.fn(async (req, user) => {
        req.session.userId = user.id;
        req.session.user = user;
        return { replaced: [] };
    }),
    getPolicy: jest.fn(() => ({ idleTimeoutMs: 1800000, maxAgeMs: 43200000, warnBeforeMs: 60000 })),
    endCurrentSession: jest.fn().mockResolvedValue(undefined)
}));

const authService = require('../services/authService');
const betterdeskApi = require('../services/betterdeskApi');
const authRoutes = require('../routes/auth.routes');

/** The app with res.render answering JSON, so views need no template locals */
function app(user) {
    const a = createTestApp();
    a.use((req, res, next) => {
        req.cookies = {};
        res.locals.csrfToken = 'csrf-token-for-test';
        res.render = (view, locals) => res.json({ view, locals });
        if (user) { req.session.userId = user.id; req.session.user = user; }
        next();
    });
    a.use('/', authRoutes);
    return a;
}

describe('POST /api/auth/login and /api/auth/totp/verify', () => {
    beforeEach(() => jest.clearAllMocks());

    test('a password sign-in answers the way back (R3)', async () => {
        authService.authenticate.mockResolvedValueOnce({ id: 3, username: 'op', role: 'operator' });
        const res = await request(app(null)).post('/api/auth/login')
            .send({ username: 'op', password: 'pw', return: '/help-requests?id=4' });
        expect(res.status).toBe(200);
        expect(res.body.redirect).toBe('/help-requests?id=4');
    });

    test('an unsafe return path becomes the start page', async () => {
        authService.authenticate.mockResolvedValueOnce({ id: 3, username: 'op', role: 'operator' });
        const res = await request(app(null)).post('/api/auth/login')
            .send({ username: 'op', password: 'pw', return: 'https://evil.example/' });
        expect(res.body.redirect).toBe('/');
    });

    test('the two-factor step answers the way back too', async () => {
        authService.authenticate.mockResolvedValueOnce({ id: 3, username: 'op', role: 'operator', totpRequired: true });
        const agent = request.agent(app(null));
        const first = await agent.post('/api/auth/login').send({ username: 'op', password: 'pw', return: '/tickets' });
        expect(first.body.totpRequired).toBe(true);
        expect(first.body.redirect).toBeUndefined();
        const second = await agent.post('/api/auth/totp/verify').send({ code: '123456', return: '/tickets' });
        expect(second.status).toBe(200);
        expect(second.body.redirect).toBe('/tickets');
    });
});

describe('GET /api/auth/login-page', () => {
    test('answers what the sign-in page shows, without a session', async () => {
        const res = await request(app(null)).get('/api/auth/login-page');
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body.success).toBe(true);
        expect(res.body.csrfToken).toBe('csrf-token-for-test');
        expect(typeof res.body.appName).toBe('string');
        expect(Array.isArray(res.body.languages)).toBe(true);
        expect(res.body.branding).toEqual(expect.objectContaining({
            loginPromoMode: expect.any(String),
            loginSlides: expect.any(Array),
            showPoweredBy: expect.any(Boolean)
        }));
        expect(res.body.desktopMode).toBe(false);
        expect(res.body.signedIn).toBe(false);
        // Nothing about accounts
        expect(JSON.stringify(res.body)).not.toMatch(/alice-the-admin|bob-operator/);
    });

    test('the old desktop-mode cookie is reported so the page can use the compact layout', async () => {
        const a = createTestApp();
        a.use((req, res, next) => { req.cookies = { betterdesk_desktop_mode: 'true' }; next(); });
        a.use('/', authRoutes);
        const res = await request(a).get('/api/auth/login-page');
        expect(res.body.desktopMode).toBe(true);
    });
});

describe('GET /api/auth/login-page signed in', () => {
    test('says so (error pages keep the console shell), but not for a pro account', async () => {
        expect((await request(app({ id: 1, username: 'a', role: 'admin' })).get('/api/auth/login-page')).body.signedIn).toBe(true);
        expect((await request(app({ id: 9, username: 'p', role: 'pro' })).get('/api/auth/login-page')).body.signedIn).toBe(false);
    });
});

describe('GET /api/auth/oidc/authorize', () => {
    test('passes a console return path on and drops anything else', async () => {
        await request(app(null)).get('/api/auth/oidc/authorize?return_url=%2Fdevices');
        expect(betterdeskApi.startOIDCAuthorize).toHaveBeenLastCalledWith('/devices');
        await request(app(null)).get('/api/auth/oidc/authorize?return_url=%2F..%2F%2Fevil.example');
        expect(betterdeskApi.startOIDCAuthorize).toHaveBeenLastCalledWith('/');
    });
});
