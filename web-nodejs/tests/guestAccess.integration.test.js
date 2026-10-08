'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');

jest.mock('../services/betterdeskApi', () => ({
    apiClient: Object.assign(jest.fn(), {
        get: jest.fn(),
        post: jest.fn(),
    }),
}));
jest.mock('../services/deviceGroupService', () => ({
    getDeviceScopeForUser: jest.fn().mockResolvedValue(new Set(['TARGET01'])),
}));
jest.mock('../services/database', () => ({
    getDevice: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/keyService', () => ({
    resolvePublicKey: jest.fn().mockResolvedValue(''),
}));
jest.mock('../services/serverConnectionConfigService', () => ({
    getConnectionMode: jest.fn().mockResolvedValue({ mode: 'p2p_first', p2p_fallback_ms: 2000 }),
}));

const betterdeskApi = require('../services/betterdeskApi');
const remoteRoutes = require('../routes/remote.routes');
const guestRoutes = require('../routes/guest.routes');

function buildApp() {
    const app = express();
    app.set('views', path.join(__dirname, '../views'));
    app.set('view engine', 'ejs');
    Object.assign(app.locals, {
        appName: 'BetterDesk',
        cacheVersion: 'test',
        cspNonce: 'test-nonce',
        lang: 'en',
        translations: {},
        branding: {},
        availableLanguageList: [],
        user: null,
    });
    app.use((req, res, next) => {
        req.session = {
            userId: 7,
            user: { username: 'issuer', role: 'guest_issuer' },
        };
        req.t = (_key, fallback) => fallback || _key;
        res.locals._ = (_key, fallback) => fallback || _key;
        next();
    });
    app.use(express.json());
    app.use(remoteRoutes);
    app.use(guestRoutes);
    return app;
}

describe('Guest Access Link page integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('renders the guest page for a valid token', async () => {
        betterdeskApi.apiClient.get.mockResolvedValueOnce({
            status: 200,
            data: {
                valid: true,
                view_only: true,
                expires_at: new Date(Date.now() + 60000).toISOString(),
                devices: [{ id: 'TARGET01', online: true }],
            },
        });

        const response = await request(buildApp()).get('/remote/guest?t=guest-token');

        expect(response.status).toBe(200);
        expect(response.text).toContain('window.__guestAccess =');
        expect(response.headers['set-cookie'][0]).toContain('guest-token');
        expect(betterdeskApi.apiClient.get).toHaveBeenCalledWith(
            '/guest/access-links/peers',
            { params: { token: 'guest-token' } }
        );
    });

    test('returns 403 for an expired or invalid token instead of a 500 page', async () => {
        betterdeskApi.apiClient.get.mockResolvedValueOnce({
            status: 403,
            data: { valid: false, error: 'guest link expired' },
        });

        const response = await request(buildApp()).get('/remote/guest?t=expired-token');

        expect(response.status).toBe(403);
        expect(response.text).toContain('403 - Forbidden');
        expect(response.text).not.toContain('500 - Server Error');
    });

    test('creates an allowlisted link and reaches the guest page with its token', async () => {
        betterdeskApi.apiClient.mockResolvedValueOnce({
            status: 201,
            data: {
                path: '/remote/guest?t=created-token',
                token: 'created-token',
                peer_ids: ['TARGET01'],
            },
        });
        const create = await request(buildApp())
            .post('/api/guest/access-links')
            .send({ peer_ids: ['TARGET01'], ttl_minutes: 30, view_only: true });

        expect(create.status).toBe(201);
        expect(create.body.path).toBe('/remote/guest?t=created-token');
        expect(betterdeskApi.apiClient).toHaveBeenCalledWith(expect.objectContaining({
            method: 'POST',
            url: '/guest/access-links',
            data: expect.objectContaining({ peer_ids: ['TARGET01'] }),
        }));

        betterdeskApi.apiClient.get.mockResolvedValueOnce({
            status: 200,
            data: {
                valid: true,
                view_only: true,
                expires_at: new Date(Date.now() + 60000).toISOString(),
                devices: [{ id: 'TARGET01', online: true }],
            },
        });
        const page = await request(buildApp()).get(create.body.path);
        expect(page.status).toBe(200);
        expect(page.text).toContain('window.__guestAccess =');
    });
});
