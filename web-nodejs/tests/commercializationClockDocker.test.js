'use strict';

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockGetRuntimeClockSettings = jest.fn().mockResolvedValue({
    ntp_servers: 'pool.ntp.org',
    max_skew_ms: 2000,
    require_synced_clock: true,
    trust_os_ntp: true,
});
const mockSaveClockSettings = jest.fn().mockResolvedValue({
    settings: {
        ntp_servers: 'time.example.com',
        max_skew_ms: 3500,
        require_synced_clock: false,
        trust_os_ntp: false,
    },
    status: { synced: true },
    restart: null,
    dockerMode: true,
});
const mockRegisterChange = jest.fn();
const mockDismissFailed = jest.fn();

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/betterdeskApi', () => ({
    apiClient: {},
}));
jest.mock('../services/billingClockConfigService', () => ({
    getRuntimeClockSettings: mockGetRuntimeClockSettings,
    saveClockSettings: mockSaveClockSettings,
    isDockerSplitDeployment: jest.fn(() => true),
}));
jest.mock('../services/restartCoordinator', () => ({
    registerChange: mockRegisterChange,
    dismissFailed: mockDismissFailed,
}));
jest.mock('../lib/goApiProxy', () => ({
    proxyToGo: jest.fn(),
    proxyBinaryToGo: jest.fn(),
    safeSegment: (value) => value,
}));
jest.mock('../services/helpRequestEmailService', () => ({
    parseCommercializationEmailConfig: () => ({}),
    CONFIG_KEY: 'commercialization_email_config',
}));
jest.mock('../lib/smtpSettingsHandlers', () => ({
    getSmtpSettings: jest.fn(),
}));

const commercializationRoutes = require('../routes/commercialization.routes');

describe('commercialization Docker clock settings', () => {
    beforeEach(() => {
        mockGetRuntimeClockSettings.mockClear();
        mockSaveClockSettings.mockClear();
        mockRegisterChange.mockClear();
        mockDismissFailed.mockClear();
    });

    test('saves through the Go runtime path without registering a native restart', async () => {
        const app = createTestApp();
        withAuth(app, { role: 'server_admin' });
        app.use(commercializationRoutes);

        const response = await request(app)
            .put('/api/panel/billing/clock/settings')
            .send({
                ntp_servers: 'time.example.com',
                max_skew_ms: 3500,
                require_synced_clock: false,
                trust_os_ntp: false,
            });

        expect(response.status).toBe(200);
        expect(response.body.dockerMode).toBe(true);
        expect(response.body.restartRequired).toBeNull();
        expect(mockRegisterChange).not.toHaveBeenCalled();
    });

    test('reports Docker mode before the UI save action', async () => {
        const app = createTestApp();
        withAuth(app, { role: 'global_admin' });
        app.use(commercializationRoutes);

        const response = await request(app)
            .get('/api/panel/billing/clock/settings');

        expect(response.status).toBe(200);
        expect(response.body.dockerMode).toBe(true);
        expect(response.body.settings.ntp_servers).toBe('pool.ntp.org');
    });

    test('UI guards the native restart prompt behind Docker mode', () => {
        const source = fs.readFileSync(
            path.join(__dirname, '../public/js/commercialization.js'),
            'utf8'
        );

        expect(source).toContain('let clockDockerMode = false;');
        expect(source).toContain('if (!clockDockerMode)');
        expect(source).toContain('commercialization.clock.saved_hot_reload');
    });
});
