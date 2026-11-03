/**
 * RustDesk / BetterDesk Client API surface (port 21121 style routes).
 * Local in-process Express only — no remote hosts.
 */
'use strict';

const request = require('supertest');
const { createTestApp } = require('./helpers');
const { SQLI, XSS } = require('./payloads');

jest.mock('../../services/database', () => ({
    getDevice: jest.fn(),
    getPeerSysinfo: jest.fn(),
    insertPeerMetric: jest.fn(),
    updatePeerOnlineStatus: jest.fn(),
    getAddressBook: jest.fn(),
    saveAddressBook: jest.fn(),
    getAllDevices: jest.fn().mockResolvedValue([]),
    getAllFolderAssignments: jest.fn().mockResolvedValue({}),
    getAllFolders: jest.fn().mockResolvedValue([]),
    getAllPeerSysinfo: jest.fn().mockResolvedValue([]),
    getAddressBookTags: jest.fn().mockResolvedValue([]),
    getAllDeviceGroups: jest.fn().mockResolvedValue([]),
    getDeviceGroupByGuid: jest.fn().mockResolvedValue(null),
    getDeviceGroupMembers: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../services/authService', () => ({
    validateAccessToken: jest.fn(),
    authenticate: jest.fn(),
}));

jest.mock('../../services/serverBackend', () => ({
    getAllDevices: jest.fn().mockResolvedValue([]),
    setPeerTags: jest.fn(),
}));

jest.mock('../../services/keyService', () => ({
    resolvePublicKey: jest.fn().mockResolvedValue('dGVzdC1wdWJrZXktYmFzZTY0'),
}));

const db = require('../../services/database');
const authService = require('../../services/authService');
const rustdeskApiRoutes = require('../../routes/rustdesk-api.routes');

describe('[sec/06] RustDesk Client API', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        app = createTestApp();
        app.use('/', rustdeskApiRoutes);
        authService.validateAccessToken.mockResolvedValue(null);
        db.getDevice.mockResolvedValue(null);
    });

    describe('unauthorized session / data leak', () => {
        it('GET /api/currentUser without Bearer → 401', async () => {
            const res = await request(app).get('/api/currentUser');
            expect(res.status).toBe(401);
            expect(res.body.name).toBeUndefined();
        });

        it('GET /api/currentUser with invalid Bearer → 401', async () => {
            const res = await request(app)
                .get('/api/currentUser')
                .set('Authorization', 'Bearer forged-token');
            expect(res.status).toBe(401);
        });

        it('GET /api/ab without Bearer → 401 (no address book leak)', async () => {
            const res = await request(app).get('/api/ab');
            expect(res.status).toBe(401);
            expect(res.body.data).toBeUndefined();
        });

        it('POST /api/ab without Bearer → 401', async () => {
            const res = await request(app)
                .post('/api/ab')
                .send({ data: JSON.stringify({ peers: [] }) });
            expect(res.status).toBe(401);
        });

        it('GET /api/peers/list without Bearer → 401', async () => {
            const res = await request(app).get('/api/peers/list');
            expect(res.status).toBe(401);
        });
    });

    describe('heartbeat / sysinfo spoofing', () => {
        it('heartbeat for unknown device does not insert metrics', async () => {
            db.getDevice.mockResolvedValue(null);
            const res = await request(app)
                .post('/api/heartbeat')
                .send({ id: 'PHANTOM-DEVICE-01', cpu: 99 });
            expect(res.status).toBe(200);
            expect(db.insertPeerMetric).not.toHaveBeenCalled();
        });

        it('heartbeat from banned device returns BANNED and skips metrics', async () => {
            db.getDevice.mockResolvedValue({ id: 'BANNED1', banned: true });
            const res = await request(app)
                .post('/api/heartbeat')
                .send({ id: 'BANNED1', cpu: 50 });
            expect(res.body.error).toBe('BANNED');
            expect(db.insertPeerMetric).not.toHaveBeenCalled();
        });

        it('sysinfo for unknown device returns ID_NOT_FOUND', async () => {
            db.getDevice.mockResolvedValue(null);
            const res = await request(app)
                .post('/api/sysinfo')
                .send({ id: 'PHANTOM-02', cpu: 'x' });
            expect(res.text).toBe('ID_NOT_FOUND');
        });

        it('rejects invalid / injection-shaped device ids on heartbeat', async () => {
            for (const id of [...SQLI.slice(0, 3), XSS[0], '']) {
                db.getDevice.mockClear();
                const res = await request(app).post('/api/heartbeat').send({ id, cpu: 1 });
                expect(res.status).toBe(200);
                expect(db.insertPeerMetric).not.toHaveBeenCalled();
            }
        });
    });

    describe('server key (public by design)', () => {
        it('GET /api/server-key returns public key only (no private material)', async () => {
            const res = await request(app).get('/api/server-key');
            expect(res.status).toBe(200);
            expect(res.body.key).toBeTruthy();
            expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/private|secret|sk_/);
        });

        it('GET /api/server-key/fingerprint returns SHA-256 style fingerprint', async () => {
            const res = await request(app).get('/api/server-key/fingerprint');
            expect(res.status).toBe(200);
            expect(res.body.algorithm).toBe('SHA-256');
            expect(res.body.fingerprint).toMatch(/^[0-9A-F:]+$/);
        });
    });

    describe('authenticated happy path does not escalate', () => {
        it('viewer token cannot see empty elevation fields on currentUser', async () => {
            authService.validateAccessToken.mockResolvedValue({
                id: 2,
                username: 'viewer1',
                role: 'viewer',
            });
            const res = await request(app)
                .get('/api/currentUser')
                .set('Authorization', 'Bearer viewer-token');
            expect(res.status).toBe(200);
            expect(res.body.is_admin).toBe(false);
            expect(res.body.name).toBe('viewer1');
        });
    });
});
