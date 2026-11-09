/**
 * Server fixes for the system settings tabs (Svelte rewrite, Settings B):
 *
 * - BUGS.md A6: GET /api/settings/info sent `backend: {}` because the
 *   async getActiveBackend() was not awaited; the backup stats and the
 *   JSON settings snapshot had the same slip.
 * - The Time zones tab saves the billing time zone and the clock settings
 *   with server.config, but reading them needed billing.view, which
 *   server_admin does not have: the tab showed defaults and a save
 *   overwrote the real values. Reading now takes either permission.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/serverBackend', () => ({
    getActiveBackend: jest.fn(async () => 'betterdesk'),
    getHealth: jest.fn(async () => ({ status: 'running' })),
    isBetterDesk: jest.fn(() => false)
}));
jest.mock('../services/keyService', () => ({
    getServerConfig: jest.fn(() => ({})),
    getApiKey: jest.fn(() => 'k')
}));
jest.mock('../services/database', () => ({
    getStats: jest.fn(async () => ({ total: 1 })),
    getBackupStats: jest.fn(async () => ({ users: 2 })),
    getAllSettings: jest.fn(async () => []),
    getAllUsersForBackup: jest.fn(async () => []),
    getAllFolders: jest.fn(async () => []),
    getAllUserGroups: jest.fn(async () => []),
    getAllDeviceGroups: jest.fn(async () => []),
    getAllStrategies: jest.fn(async () => []),
    getAllAddressBooks: jest.fn(async () => []),
    logAction: jest.fn(async () => undefined)
}));
jest.mock('../services/brandingService', () => ({ getBranding: jest.fn(() => ({})) }));
jest.mock('../services/billingClockConfigService', () => ({
    getRuntimeClockSettings: jest.fn(async () => ({ ntp_servers: 'pool.ntp.org', billing_timezone: 'Europe/Berlin' })),
    isDockerSplitDeployment: jest.fn(() => false),
    detectOsTimezone: jest.fn(() => 'Europe/Berlin'),
    COMMON_TIMEZONES: ['UTC']
}));
jest.mock('../lib/goApiProxy', () => ({
    proxyToGo: jest.fn((_client, _req, res) => res.json({ synced: true })),
    proxyBinaryToGo: jest.fn(),
    safeSegment: (value) => value
}));

const settingsRoutes = require('../routes/settings.routes');
const commercializationRoutes = require('../routes/commercialization.routes');
const backupService = require('../services/backupService');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 7;
        req.session.user = { id: 7, username: 'u', role };
        next();
    });
    a.use(settingsRoutes);
    a.use(commercializationRoutes);
    return a;
}

describe('A6: the backend name is awaited', () => {
    test('GET /api/settings/info names the backend', async () => {
        const res = await request(app('admin')).get('/api/settings/info');
        expect(res.status).toBe(200);
        expect(res.body.data.backend).toBe('betterdesk');
    });

    test('backup stats and the JSON settings snapshot name the backend', async () => {
        expect((await backupService.getBackupStats()).backend).toBe('betterdesk');
        expect((await backupService.createBackup())._backend).toBe('betterdesk');
    });
});

describe('clock settings: read with billing.view or server.config', () => {
    const READS = [
        '/api/panel/billing/clock/settings',
        '/api/panel/billing/clock/detect-timezone',
        '/api/panel/billing/timesync/status'
    ];

    test.each(READS)('server_admin (server.config, no billing.view) reads %s', async (path) => {
        const res = await request(app('server_admin')).get(path);
        expect(res.status).toBe(200);
    });

    test.each(['operator', 'global_admin', 'admin'])('%s still reads them', async (role) => {
        for (const path of READS) {
            const res = await request(app(role)).get(path);
            expect(res.status).toBe(200);
        }
    });

    test.each(['viewer', 'guest_issuer'])('%s still gets 403', async (role) => {
        for (const path of READS) {
            const res = await request(app(role)).get(path);
            expect(res.status).toBe(403);
        }
    });

    test('the saved values come back for server_admin', async () => {
        const res = await request(app('server_admin')).get('/api/panel/billing/clock/settings');
        expect(res.body.settings.billing_timezone).toBe('Europe/Berlin');
    });

    test('writes keep their permission: operator may not save', async () => {
        const res = await request(app('operator')).put('/api/panel/billing/clock/settings').send({});
        expect(res.status).toBe(403);
    });
});
