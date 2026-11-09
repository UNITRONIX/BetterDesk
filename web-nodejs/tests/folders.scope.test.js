/**
 * Folders and the device scope (BUGS.md D2, D3).
 * - Moving devices into a folder checks each device exists and is in the
 *   person's scope, like the other device writes. It used to move any id.
 * - Folder counts for a person limited to some devices count only those.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getFolderById: jest.fn(async (id) => (Number(id) === 3 ? { id: 3, name: 'Lab' } : null)),
    assignDevicesToFolder: jest.fn().mockResolvedValue(undefined),
    assignDeviceToFolder: jest.fn().mockResolvedValue(undefined),
    getAllFolders: jest.fn(async () => [{ id: 3, name: 'Lab' }]),
    getAllFolderAssignments: jest.fn(async () => ({ IN01: 3, OUT01: 3, OUT02: 3 }))
}));
jest.mock('../services/serverBackend', () => ({
    getDeviceById: jest.fn(async (id) => (['IN01', 'OUT01', 'OUT02'].includes(id) ? { id } : null)),
    getAllDevices: jest.fn(async () => [{ id: 'IN01' }, { id: 'OUT01' }, { id: 'OUT02' }])
}));
jest.mock('../services/deviceGroupService', () => ({
    // A person who may see IN01 only; admins see everything (null scope)
    getDeviceScopeForUser: jest.fn(async (_db, user) => (user.role === 'operator' ? new Set(['IN01']) : null)),
    userCanAccessDevice: jest.fn(async (_db, user, device) => user.role !== 'operator' || device.id === 'IN01')
}));

const db = require('../services/database');
const foldersRoutes = require('../routes/folders.routes');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 4;
        req.session.user = { id: 4, username: 'u', role };
        next();
    });
    a.use(foldersRoutes);
    return a;
}

beforeEach(() => jest.clearAllMocks());

describe('moving devices into a folder', () => {
    test('a device outside the scope is refused and nothing moves', async () => {
        const res = await request(app('operator')).post('/api/folders/3/devices').send({ deviceIds: ['IN01', 'OUT01'] });
        expect(res.status).toBe(403);
        expect(db.assignDevicesToFolder).not.toHaveBeenCalled();
    });

    test('an unknown device gets 404 and nothing moves', async () => {
        const res = await request(app('super_admin')).post('/api/folders/3/devices').send({ deviceIds: ['IN01', 'NOPE9'] });
        expect(res.status).toBe(404);
        expect(db.assignDevicesToFolder).not.toHaveBeenCalled();
    });

    test('devices in scope move', async () => {
        const res = await request(app('operator')).post('/api/folders/3/devices').send({ deviceIds: ['IN01'] });
        expect(res.status).toBe(200);
        expect(db.assignDevicesToFolder).toHaveBeenCalledWith(['IN01'], 3);
    });

    test('one device outside the scope is refused', async () => {
        const res = await request(app('operator')).patch('/api/devices/OUT01/folder').send({ folderId: 3 });
        expect(res.status).toBe(403);
        expect(db.assignDeviceToFolder).not.toHaveBeenCalled();
    });
});

describe('folder counts', () => {
    test('count only the devices the person can see', async () => {
        const res = await request(app('operator')).get('/api/folders');
        expect(res.body.data.folders[0].device_count).toBe(1);
    });

    test('count everything for an unlimited person', async () => {
        const res = await request(app('super_admin')).get('/api/folders');
        expect(res.body.data.folders[0].device_count).toBe(3);
    });
});
