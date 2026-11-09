'use strict';

/**
 * A guest link from start to finish: an operator creates it, and the guest
 * page's data (GET /api/remote/guest-info, which the new console's
 * /remote/guest asks for) answers for the link's token, with or without a
 * console session, and keeps the token in the guest cookie.
 */

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

function buildApp({ signedIn = true } = {}) {
    const app = express();
    app.use((req, res, next) => {
        req.session = signedIn
            ? { userId: 7, user: { username: 'issuer', role: 'guest_issuer' } }
            : {};
        req.t = (_key, fallback) => fallback || _key;
        next();
    });
    app.use(express.json());
    app.use(remoteRoutes);
    app.use(guestRoutes);
    return app;
}

function validLink(devices) {
    betterdeskApi.apiClient.get.mockResolvedValueOnce({
        status: 200,
        data: {
            valid: true,
            view_only: true,
            expires_at: new Date(Date.now() + 60000).toISOString(),
            devices,
        },
    });
}

describe('Guest Access Link integration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('answers a valid token with its devices and keeps it in the guest cookie', async () => {
        validLink([{ id: 'TARGET01', online: true }]);

        const response = await request(buildApp()).get('/api/remote/guest-info?t=guest-token');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.guest).toMatchObject({ view_only: true, devices: [{ id: 'TARGET01' }] });
        expect(response.headers['set-cookie'][0]).toContain('guest-token');
        expect(betterdeskApi.apiClient.get).toHaveBeenCalledWith(
            '/guest/access-links/peers',
            { params: { token: 'guest-token' } }
        );
    });

    test('answers a visitor without a console session', async () => {
        validLink([{ id: 'TARGET01', online: false }]);

        const response = await request(buildApp({ signedIn: false })).get('/api/remote/guest-info?t=guest-token');

        expect(response.status).toBe(200);
        expect(response.body.guest.devices).toEqual([{ id: 'TARGET01', online: false }]);
    });

    test('answers 403 with the reason for an expired or invalid token', async () => {
        betterdeskApi.apiClient.get.mockResolvedValueOnce({
            status: 403,
            data: { valid: false, error: 'guest link expired' },
        });

        const response = await request(buildApp()).get('/api/remote/guest-info?t=expired-token');

        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ success: false, code: 'invalid', error: 'guest link expired' });
        expect(response.headers['set-cookie']).toBeUndefined();
    });

    test('creates an allowlisted link whose token the guest page accepts', async () => {
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

        // The link's page asks guest-info with the link's own query
        validLink([{ id: 'TARGET01', online: true }]);
        const query = create.body.path.slice(create.body.path.indexOf('?'));
        const page = await request(buildApp({ signedIn: false })).get('/api/remote/guest-info' + query);
        expect(page.status).toBe(200);
        expect(page.body.token).toBe('created-token');
        expect(page.body.guest.devices).toEqual([{ id: 'TARGET01', online: true }]);
    });
});
