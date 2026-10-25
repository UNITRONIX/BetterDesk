'use strict';

const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { withAuth } = require('./helpers');

const mockProxyToGo = jest.fn((_c, _req, res) => res.status(200).json({ allowed: true, package_name: 'Test' }));

jest.mock('../services/database', () => ({
    getSetting: jest.fn(),
    setSetting: jest.fn().mockResolvedValue(undefined),
    logAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/betterdeskApi', () => ({ apiClient: jest.fn() }));
jest.mock('../lib/goApiProxy', () => ({
    proxyToGo: (...args) => mockProxyToGo(...args),
    proxyBinaryToGo: jest.fn(),
    safeSegment: (v) => encodeURIComponent(v),
}));
jest.mock('../services/billingClockConfigService', () => ({
    getClockSettings: () => ({ ntp_servers: 'pool.ntp.org', max_skew_ms: 2000 }),
    saveClockSettings: jest.fn().mockResolvedValue({ settings: {}, restart: {} }),
}));
jest.mock('../lib/smtpSettingsHandlers', () => ({
    getSmtpSettings: (_req, res) => res.json({ configured: true }),
}));

const commercializationRoutes = require('../routes/commercialization.routes');

function createApp() {
    const app = express();
    app.use(express.json());
    app.use(session({
        secret: 'test-billing-check-secret-32chars!',
        resave: false,
        saveUninitialized: true,
        cookie: { secure: false },
    }));
    app.use((req, _res, next) => {
        req.t = (key) => key;
        next();
    });
    withAuth(app, { id: 1, username: 'admin', role: 'global_admin' });
    app.use(commercializationRoutes);
    return app;
}

describe('GET /api/panel/billing/check', () => {
    beforeEach(() => {
        mockProxyToGo.mockClear();
        mockProxyToGo.mockImplementation((_c, _req, res) => {
            res.status(200).json({ allowed: true, package_name: 'Test' });
        });
    });

    it('proxies to Go /billing/check instead of 404', async () => {
        const res = await request(createApp())
            .get('/api/panel/billing/check')
            .query({ device_id: '459549344' });

        expect(res.status).toBe(200);
        expect(res.body.allowed).toBe(true);
        expect(mockProxyToGo).toHaveBeenCalled();
        const pathBuilder = mockProxyToGo.mock.calls[0][4];
        expect(typeof pathBuilder).toBe('function');
        expect(pathBuilder()).toBe('/billing/check?device_id=459549344');
    });
});
