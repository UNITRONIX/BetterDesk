/**
 * Server pieces the new console's clients and enrollment pages need:
 * - GET /api/panel/pairing/host gives the pairing page its suggested
 *   server address (the old page had it rendered into the HTML), with the
 *   page's own permission (enrollment.approve).
 * - GET /registrations sends a signed-out visitor to the sign-in page like
 *   every other page (BUGS.md R8: it had no requireAuth and skipped
 *   ?expired=1).
 */

'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/rustDeskPublicEndpointsService', () => ({
    getPublicEndpoints: jest.fn(() => ({ serverId: 'rd.example.org', apiUrl: 'https://rd.example.org:21121' }))
}));
jest.mock('../services/betterdeskApi', () => ({
    listPairingCodes: jest.fn().mockResolvedValue({ success: true, data: { codes: [] } }),
    getEnrollmentPending: jest.fn().mockResolvedValue({ success: true, data: [], count: 0 })
}));
jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getPendingRegistrationCount: jest.fn().mockResolvedValue(0)
}));
jest.mock('../services/deviceGroupService', () => ({}));
jest.mock('../services/serverBackend', () => ({}));

const endpoints = require('../services/rustDeskPublicEndpointsService');
const pairingRoutes = require('../routes/pairing.routes');
const registrationRoutes = require('../routes/registration.routes');

function app(role) {
    const a = createTestApp();
    if (role) {
        a.use((req, _res, next) => {
            req.session.userId = 7;
            req.session.user = { id: 7, username: 'u', role };
            next();
        });
    }
    a.use(pairingRoutes);
    a.use(registrationRoutes);
    return a;
}

describe('GET /api/panel/pairing/host', () => {
    beforeEach(() => endpoints.getPublicEndpoints.mockClear());

    test.each(['admin', 'super_admin', 'global_admin'])('%s gets the suggested address', async (role) => {
        const res = await request(app(role)).get('/api/panel/pairing/host');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, host: 'rd.example.org' });
    });

    test('falls back to the API address, then to nothing', async () => {
        endpoints.getPublicEndpoints.mockReturnValueOnce({ serverId: '', apiUrl: 'https://api.example.org' });
        expect((await request(app('admin')).get('/api/panel/pairing/host')).body.host).toBe('https://api.example.org');
        endpoints.getPublicEndpoints.mockImplementationOnce(() => {
            throw new Error('not configured');
        });
        expect((await request(app('admin')).get('/api/panel/pairing/host')).body).toEqual({ success: true, host: '' });
    });

    test.each(['viewer', 'operator', 'server_admin'])('%s (no enrollment.approve) gets 403', async (role) => {
        const res = await request(app(role)).get('/api/panel/pairing/host');
        expect(res.status).toBe(403);
        expect(res.body.host).toBeUndefined();
    });

    test('nobody signed in gets 401', async () => {
        const res = await request(app(null)).get('/api/panel/pairing/host');
        expect(res.status).toBe(401);
    });
});

describe('GET /registrations signed out (R8)', () => {
    test('goes to the sign-in page with ?expired=1, like the other pages', async () => {
        const res = await request(app(null)).get('/registrations');
        expect(res.status).toBe(302);
        expect(res.headers.location).toBe('/login?expired=1');
    });
});
