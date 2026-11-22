/**
 * authorizeUserDeviceAccess — shared RdClient / Mesh / WS scope gate.
 */

const deviceGroupService = require('../services/deviceGroupService');

describe('deviceGroupService.authorizeUserDeviceAccess', () => {
    const operator = { id: 7, username: 'olga', role: 'operator', user_groups: [] };
    const device = { id: 'DEVICE_B', hostname: 'lab-pc', folder_id: 1 };

    test('allows a device when scope is unrestricted', async () => {
        const db = {
            getPeerById: jest.fn().mockResolvedValue(device),
            getAllDeviceGroups: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };

        const result = await deviceGroupService.authorizeUserDeviceAccess(db, operator, 'DEVICE_B');

        expect(result.allowed).toBe(true);
        expect(result.device).toEqual(device);
    });

    test('returns 404 for out-of-scope devices', async () => {
        const db = {
            getPeerById: jest.fn().mockResolvedValue(device),
            getAllDeviceGroups: jest.fn().mockResolvedValue([
                {
                    guid: 'folder_1',
                    folder_id: 1,
                    allowed_users: ['someone_else'],
                    allowed_groups: [],
                    source_type: 'manual'
                }
            ]),
            getUserGroupsForUser: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };

        const result = await deviceGroupService.authorizeUserDeviceAccess(db, operator, 'DEVICE_B');

        expect(result).toEqual({
            allowed: false,
            statusCode: 404,
            reason: 'out-of-scope'
        });
    });

    test('returns 404 for unknown devices', async () => {
        const db = {
            getPeerById: jest.fn().mockResolvedValue(null),
            getAllDeviceGroups: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };

        const result = await deviceGroupService.authorizeUserDeviceAccess(db, operator, 'NOPE');

        expect(result.statusCode).toBe(404);
        expect(result.reason).toBe('unknown-device');
    });

    test('accepts a custom device resolver (remote targets)', async () => {
        const target = { id: 'rt_1', name: 'RDP lab' };
        const db = {
            getPeerById: jest.fn(),
            getAllDeviceGroups: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };

        const result = await deviceGroupService.authorizeUserDeviceAccess(db, operator, 'rt_1', {
            resolveDevice: async () => target
        });

        expect(result.allowed).toBe(true);
        expect(result.device).toEqual(target);
        expect(db.getPeerById).not.toHaveBeenCalled();
    });

    test('out-of-scope and missing devices are indistinguishable by status', async () => {
        const restrictedDb = {
            getPeerById: jest.fn().mockResolvedValue(device),
            getAllDeviceGroups: jest.fn().mockResolvedValue([
                {
                    guid: 'folder_1',
                    folder_id: 1,
                    allowed_users: ['someone_else'],
                    allowed_groups: [],
                    source_type: 'manual'
                }
            ]),
            getUserGroupsForUser: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };
        const missingDb = {
            getPeerById: jest.fn().mockResolvedValue(null),
            getAllDeviceGroups: jest.fn().mockResolvedValue([]),
            getUserPeerGrants: jest.fn().mockResolvedValue([])
        };

        const outOfScope = await deviceGroupService.authorizeUserDeviceAccess(restrictedDb, operator, 'DEVICE_B');
        const missing = await deviceGroupService.authorizeUserDeviceAccess(missingDb, operator, 'DEVICE_B');

        expect(outOfScope.statusCode).toBe(missing.statusCode);
    });
});
