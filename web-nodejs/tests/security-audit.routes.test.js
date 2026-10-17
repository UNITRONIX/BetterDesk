'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth', () => ({
    requireAuth: (_req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next(),
}));

jest.mock('../services/betterdeskApi', () => ({
    apiClient: {
        get: jest.fn(),
    },
}));

const { apiClient } = require('../services/betterdeskApi');
const securityAuditRoutes = require('../routes/security-audit.routes');

function buildApp() {
    const app = express();
    app.use('/', securityAuditRoutes);
    return app;
}

describe('security audit overview API', () => {
    beforeEach(() => jest.clearAllMocks());

    test('loads real health, key, audit, and blocklist data', async () => {
        const oldKeyDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
        apiClient.get.mockImplementation((path) => {
            if (path === '/health') return Promise.resolve({ data: { tls: true } });
            if (path === '/keys') return Promise.resolve({ data: { keys: [{ created_at: oldKeyDate }] } });
            if (path.startsWith('/audit/events')) {
                return Promise.resolve({
                    data: {
                        events: [{
                            action: 'auth_login_failed',
                            timestamp: new Date().toISOString(),
                        }],
                    },
                });
            }
            if (path === '/blocklist') return Promise.resolve({ data: { count: 2, entries: [] } });
            return Promise.reject(new Error(`unexpected path: ${path}`));
        });

        const response = await request(buildApp()).get('/api/panel/security-audit/overview');

        expect(response.status).toBe(200);
        expect(response.body.stats).toEqual(expect.objectContaining({
            failed_logins: 1,
            bans: 2,
            api_keys: 1,
            old_keys: 1,
        }));
        expect(response.body.tls).toEqual(expect.objectContaining({
            api: true,
            signal: null,
            relay: null,
        }));
        expect(response.body.checks).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'tls_api', pass: true }),
            expect.objectContaining({ id: 'no_bans', pass: false }),
        ]));
    });
});
