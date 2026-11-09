/**
 * Rename, restore, change ID and tags check the device-group scope like the
 * other device handlers: a user limited to some groups can't change devices
 * outside them.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/bdRelay', () => ({ requestFromDevice: jest.fn() }));
jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    cascadePeerIdChange: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/serverBackend', () => ({
    getDeviceById: jest.fn(),
    updateDevice: jest.fn(),
    restoreDevice: jest.fn(),
    changePeerId: jest.fn(),
    setPeerTags: jest.fn(),
    isBetterDesk: jest.fn().mockResolvedValue(true)
}));
jest.mock('../services/betterdeskApi', () => ({}));
jest.mock('../services/deviceGroupService', () => ({ userCanAccessDevice: jest.fn() }));

const serverBackend = require('../services/serverBackend');
const deviceGroupService = require('../services/deviceGroupService');
const devicesRoutes = require('../routes/devices.routes');

function app() {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 8;
        req.session.user = { id: 8, username: 'scoped_admin', role: 'global_admin' };
        next();
    });
    a.use('/', devicesRoutes);
    return a;
}

const CASES = [
    ['rename', (r) => r.post('/api/devices/OUT01/rename').send({ display_name: 'x' }), 'updateDevice'],
    ['restore', (r) => r.post('/api/devices/OUT01/restore').send({}), 'restoreDevice'],
    ['change ID', (r) => r.post('/api/devices/OUT01/change-id').send({ newId: 'NEWID01' }), 'changePeerId'],
    ['tags', (r) => r.put('/api/devices/OUT01/tags').send({ tags: ['a'] }), 'setPeerTags']
];

describe('device scope on write routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        serverBackend.getDeviceById.mockImplementation(async (id) => (id === 'OUT01' ? { id: 'OUT01', soft_deleted: false } : null));
        serverBackend.updateDevice.mockResolvedValue({ changes: 1 });
        serverBackend.restoreDevice.mockResolvedValue({ success: true, data: {} });
        serverBackend.changePeerId.mockResolvedValue({ success: true });
        serverBackend.setPeerTags.mockResolvedValue({ success: true });
    });

    test.each(CASES)('%s is refused outside the user scope', async (_name, send, backendFn) => {
        deviceGroupService.userCanAccessDevice.mockResolvedValue(false);
        const res = await send(request(app()));
        expect(res.status).toBe(403);
        expect(serverBackend[backendFn]).not.toHaveBeenCalled();
    });

    test.each(CASES)('%s works inside the user scope', async (_name, send, backendFn) => {
        deviceGroupService.userCanAccessDevice.mockResolvedValue(true);
        const res = await send(request(app()));
        expect(res.status).toBe(200);
        expect(serverBackend[backendFn]).toHaveBeenCalled();
    });

    test('change ID of an unknown device is 404, not a call to the server', async () => {
        const res = await request(app()).post('/api/devices/NOPE99/change-id').send({ newId: 'NEWID01' });
        expect(res.status).toBe(404);
        expect(serverBackend.changePeerId).not.toHaveBeenCalled();
    });
});
