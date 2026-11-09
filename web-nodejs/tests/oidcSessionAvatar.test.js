'use strict';

/**
 * OIDC sign-in stores, refreshes and clears the profile picture from the
 * exchange response's "picture" field (routes/auth.routes.js →
 * services/avatarService.js). The Go exchange is mocked; the database is
 * an in-memory stand-in for the users and user_avatars tables.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

const mockUsers = new Map();
const mockAvatars = new Map();

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getUserByUsername: jest.fn(async (name) => [...mockUsers.values()].find((u) => u.username === name) || null),
    getUserById: jest.fn(async (id) => mockUsers.get(id) || null),
    createUser: jest.fn(async (username, hash, role, provider) => {
        const id = mockUsers.size + 1;
        mockUsers.set(id, { id, username, role, auth_provider: provider });
        return { id, username, role };
    }),
    syncUserFromGo: jest.fn().mockResolvedValue(undefined),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
    getUserAvatar: jest.fn(async (id) => mockAvatars.get(id) || null),
    setUserAvatar: jest.fn(async (id, a) => {
        mockAvatars.set(id, { user_id: id, mime_type: a.mimeType, data: a.data, version: a.version, source: a.source, source_url: a.sourceUrl });
    }),
    deleteUserAvatar: jest.fn(async (id, source) => {
        const row = mockAvatars.get(id);
        if (!row || (source && row.source !== source)) return 0;
        mockAvatars.delete(id);
        return 1;
    }),
    listUserAvatarVersions: jest.fn(async () => [...mockAvatars.values()].map((a) => ({
        user_id: a.user_id, username: mockUsers.get(a.user_id)?.username, version: a.version,
    }))),
}));

jest.mock('../services/betterdeskApi', () => ({
    exchangeOIDCCode: jest.fn(),
    getOIDCStatus: jest.fn().mockResolvedValue({ success: true, data: { enabled: false } }),
    startOIDCAuthorize: jest.fn(),
    proxyOIDCCallback: jest.fn(),
}));

jest.mock('../services/panelSessionService', () => ({
    clientMetaFromRequest: () => ({ ip: '203.0.113.5', userAgent: 'jest' }),
    establishAuthenticatedSession: jest.fn(async (req, user) => {
        req.session.userId = user.id;
        req.session.user = user;
        return { replaced: [] };
    }),
}));

jest.mock('../middleware/rateLimiter', () => ({
    loginLimiter: (_req, _res, next) => next(),
    passwordChangeLimiter: (_req, _res, next) => next(),
    apiLimiter: (_req, _res, next) => next(),
}));

const betterdeskApi = require('../services/betterdeskApi');
const avatarService = require('../services/avatarService');
const authRoutes = require('../routes/auth.routes');

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
const PNG_URL = `data:image/png;base64,${PNG_B64}`;

function exchange(extra) {
    betterdeskApi.exchangeOIDCCode.mockResolvedValue({
        success: true,
        data: { token: 'jwt', username: 'alice', role: 'operator', return_url: '/devices', ...extra },
    });
}

async function signIn(app) {
    const res = await request(app).get('/api/auth/oidc/session?code=one-time');
    const user = [...mockUsers.values()].find((u) => u.username === 'alice');
    if (user) await avatarService.waitForSync(user.id);
    return { res, user };
}

describe('OIDC sign-in and the profile picture', () => {
    let app;

    beforeEach(() => {
        mockUsers.clear();
        mockAvatars.clear();
        avatarService.resetCache();
        app = createTestApp();
        app.use('/', authRoutes);
    });

    it('stores an inline picture on first sign-in', async () => {
        exchange({ picture: PNG_URL });
        const { res, user } = await signIn(app);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/devices');
        const row = mockAvatars.get(user.id);
        expect(row).toBeTruthy();
        expect(row.mime_type).toBe('image/png');
        expect(row.source).toBe('oidc');
        expect(row.data.equals(Buffer.from(PNG_B64, 'base64'))).toBe(true);
        expect(await avatarService.getAvatarVersion(user.id)).toBe(row.version);
    });

    it('clears the picture when the claim is gone on the next sign-in', async () => {
        exchange({ picture: PNG_URL });
        const first = await signIn(app);
        expect(mockAvatars.has(first.user.id)).toBe(true);

        exchange({ picture: '' });
        const second = await signIn(app);
        expect(second.res.status).toBe(302);
        expect(mockAvatars.has(first.user.id)).toBe(false);
        expect(await avatarService.getAvatarVersion(first.user.id)).toBeNull();
    });

    it('leaves the picture alone when an older server sends no picture field', async () => {
        exchange({ picture: PNG_URL });
        const first = await signIn(app);
        exchange({});
        await signIn(app);
        expect(mockAvatars.has(first.user.id)).toBe(true);
    });

    it('signs in even when the picture is refused, and keeps the old one', async () => {
        exchange({ picture: PNG_URL });
        const first = await signIn(app);
        const before = mockAvatars.get(first.user.id).version;

        exchange({ picture: 'data:image/png;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64') });
        const second = await signIn(app);
        expect(second.res.status).toBe(302);
        expect(second.res.headers.location).toBe('/devices');
        expect(mockAvatars.get(first.user.id).version).toBe(before);
    });

    it('signs in even when fetching a picture URL fails', async () => {
        exchange({ picture: 'http://127.0.0.1:9/a.png' });
        const { res, user } = await signIn(app);
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/devices');
        expect(mockAvatars.has(user.id)).toBe(false);
    });
});
