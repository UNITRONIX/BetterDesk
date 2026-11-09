/**
 * Ban and unban report what the server did (BUGS.md D4): they used to answer
 * success even when the Go server refused. Bulk delete answers an unknown
 * device with 404 instead of never answering (A5).
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/bdRelay', () => ({ requestFromDevice: jest.fn() }));
jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../services/serverBackend', () => ({
    getDeviceById: jest.fn(),
    setBanStatus: jest.fn(),
    deleteDevice: jest.fn(),
    isBetterDesk: jest.fn().mockResolvedValue(true)
}));
jest.mock('../services/betterdeskApi', () => ({}));
jest.mock('../services/deviceGroupService', () => ({ userCanAccessDevice: jest.fn().mockResolvedValue(true) }));

const serverBackend = require('../services/serverBackend');
const db = require('../services/database');
const devicesRoutes = require('../routes/devices.routes');

function app() {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 1;
        req.session.user = { id: 1, username: 'admin', role: 'super_admin' };
        next();
    });
    a.use('/', devicesRoutes);
    return a;
}

beforeEach(() => {
    jest.clearAllMocks();
    serverBackend.getDeviceById.mockImplementation(async (id) => (id.startsWith('KNOWN') ? { id } : null));
});

describe('ban and unban', () => {
    test.each(['ban', 'unban'])('%s passes on a refusal from the server and logs nothing', async (action) => {
        serverBackend.setBanStatus.mockResolvedValue({ success: false, error: 'database is locked' });
        const res = await request(app()).post(`/api/devices/KNOWN1/${action}`).send({});
        expect(res.status).toBe(502);
        expect(res.body.success).toBe(false);
        expect(db.logAction).not.toHaveBeenCalled();
    });

    test.each(['ban', 'unban'])('%s answers success when the server did it', async (action) => {
        serverBackend.setBanStatus.mockResolvedValue({ success: true, data: { status: action + 'ned' } });
        const res = await request(app()).post(`/api/devices/KNOWN1/${action}`).send({});
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(db.logAction).toHaveBeenCalled();
    });
});

describe('bulk delete', () => {
    test('an unknown device gets 404 naming it, and nothing is deleted', async () => {
        const res = await request(app()).post('/api/devices/bulk-delete').send({ ids: ['KNOWN1', 'GONE2'] }).timeout(2000);
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ success: false, id: 'GONE2' });
        expect(serverBackend.deleteDevice).not.toHaveBeenCalled();
    });

    test('known devices are deleted', async () => {
        serverBackend.deleteDevice.mockResolvedValue({ success: true });
        const res = await request(app()).post('/api/devices/bulk-delete').send({ ids: ['KNOWN1', 'KNOWN2'] });
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ deleted: 2 });
    });
});
