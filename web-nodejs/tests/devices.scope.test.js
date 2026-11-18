'use strict';

/**
 * Device scope guard (audit H9, 2026-11-13).
 *
 * The scope check used to be copied into individual handlers and several
 * mutations were missed — an operator with a restricted device scope could
 * rename, retag, re-id or restore devices outside their groups by guessing the
 * id. The guard is now mounted once for `/api/devices/:id`.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/betterdeskApi', () => ({
    getPeerTelemetry: jest.fn().mockResolvedValue({ success: false }),
    getConnectionMode: jest.fn().mockResolvedValue({ success: true, data: { controllable: false } }),
    setConnectionMode: jest.fn().mockResolvedValue({ success: true }),
    getPeer: jest.fn().mockResolvedValue(null),
    getPeerIncludingDeleted: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getPeerSysinfo: jest.fn().mockResolvedValue(null),
    getLatestPeerMetric: jest.fn().mockResolvedValue(null),
    getPeerMetrics: jest.fn().mockResolvedValue([]),
    getDeviceGroupsForPeer: jest.fn().mockResolvedValue([]),
    getUserGroupsForUser: jest.fn().mockResolvedValue([]),
    getAllDeviceGroups: jest.fn().mockResolvedValue([]),
    getDeviceGroupMembers: jest.fn().mockResolvedValue([]),
    getDeviceGroupByGuid: jest.fn().mockResolvedValue(null),
    getAllFolders: jest.fn().mockResolvedValue([]),
    getAllFolderAssignments: jest.fn().mockResolvedValue({}),
    getUserPeerGrants: jest.fn().mockResolvedValue([]),
    getSetting: jest.fn().mockResolvedValue(null),
    cascadePeerIdChange: jest.fn().mockResolvedValue(undefined),
    purgePanelPeerRecord: jest.fn().mockResolvedValue(undefined),
    cleanupDeletedPeerData: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/serverBackend', () => ({
    getAllDevices: jest.fn().mockResolvedValue([]),
    getDeviceById: jest.fn().mockResolvedValue(null),
    updateDevice: jest.fn().mockResolvedValue({ changes: 1 }),
    deleteDevice: jest.fn().mockResolvedValue({ success: true }),
    restoreDevice: jest.fn().mockResolvedValue({ success: true }),
    changePeerId: jest.fn().mockResolvedValue({ success: true }),
    setPeerTags: jest.fn().mockResolvedValue({ success: true }),
    isBetterDesk: jest.fn().mockResolvedValue(true),
}));

const db = require('../services/database');
const serverBackend = require('../services/serverBackend');
const deviceGroupService = require('../services/deviceGroupService');
const devicesRoutes = require('../routes/devices.routes');

/**
 * Operator "olga" may see only devices tagged `Volunteers`. Device IN1 is in
 * scope, OUT1 is not.
 */
function createScopedApp(role = 'operator') {
    const app = createTestApp();
    app.use((req, _res, next) => {
        req.session.userId = 7;
        req.session.user = { id: 7, username: 'olga', role };
        next();
    });
    app.use('/', devicesRoutes);
    return app;
}

function mockScope() {
    db.getUserGroupsForUser.mockResolvedValue([{ guid: 'volunteers', name: 'Volunteers' }]);
    db.getAllDeviceGroups.mockResolvedValue([{
        guid: 'vol-group',
        name: 'Volunteers',
        source_type: 'manual',
        tag_filter: '',
        allowed_users: ['olga'],
        allowed_groups: [],
        folder_id: null,
    }]);
    db.getDeviceGroupMembers.mockResolvedValue(['IN1']);
    // Deny-by-default scope: without this, a group ACL only *adds* visibility and
    // ungrouped devices stay visible (that is the documented "open" default).
    db.getSetting.mockResolvedValue('restricted');
    deviceGroupService.invalidateDeviceScopeDefaultCache();
    serverBackend.getDeviceById.mockImplementation(async (id) => {
        if (id === 'IN1') return { id: 'IN1', hostname: 'In scope', tags: [] };
        if (id === 'OUT1') return { id: 'OUT1', hostname: 'Out of scope', tags: [] };
        return null;
    });
}

describe('device scope guard (audit H9)', () => {
    let app;

    beforeEach(() => {
        jest.clearAllMocks();
        mockScope();
        app = createScopedApp();
    });

    it('allows a mutation for an in-scope device', async () => {
        const res = await request(app)
            .post('/api/devices/IN1/rename')
            .send({ display_name: 'Renamed' });

        expect(res.status).toBe(200);
        expect(serverBackend.updateDevice).toHaveBeenCalled();
    });

    it('rejects rename for an out-of-scope device', async () => {
        const res = await request(app)
            .post('/api/devices/OUT1/rename')
            .send({ display_name: 'Hijacked' });

        expect(res.status).toBe(403);
        expect(serverBackend.updateDevice).not.toHaveBeenCalled();
    });

    it('rejects tag replacement for an out-of-scope device', async () => {
        const res = await request(app)
            .put('/api/devices/OUT1/tags')
            .send({ tags: ['owned'] });

        expect(res.status).toBe(403);
        expect(serverBackend.setPeerTags).not.toHaveBeenCalled();
    });

    it('rejects a change-id for an out-of-scope device', async () => {
        const res = await request(app)
            .post('/api/devices/OUT1/change-id')
            .send({ newId: 'STOLEN01' });

        expect(res.status).toBe(403);
        expect(serverBackend.changePeerId).not.toHaveBeenCalled();
    });

    it('rejects a restore for an out-of-scope device', async () => {
        serverBackend.getDeviceById.mockImplementation(async (id) => {
            if (id === 'OUT1') return { id: 'OUT1', soft_deleted: true, tags: [] };
            return { id: 'IN1', hostname: 'In scope', tags: [] };
        });

        const res = await request(app).post('/api/devices/OUT1/restore').send({});

        expect(res.status).toBe(403);
        expect(serverBackend.restoreDevice).not.toHaveBeenCalled();
    });

    it('rejects deleting the access policy of an out-of-scope device', async () => {
        const res = await request(app).delete('/api/devices/OUT1/access-policy');

        expect(res.status).toBe(403);
    });

    it('lets an unrestricted admin through without the scope lookups', async () => {
        const adminApp = createScopedApp('admin');
        serverBackend.getDeviceById.mockResolvedValue({ id: 'OUT1', hostname: 'Any', tags: [] });

        const res = await request(adminApp)
            .post('/api/devices/OUT1/rename')
            .send({ display_name: 'Admin edit' });

        expect(res.status).toBe(200);
        expect(serverBackend.updateDevice).toHaveBeenCalled();
    });

    it('does not block anonymous callers before authentication runs', async () => {
        const anon = createTestApp();
        anon.use('/', devicesRoutes);

        const res = await request(anon).post('/api/devices/OUT1/rename').send({ display_name: 'x' });

        expect(res.status).toBe(401);
    });
});
