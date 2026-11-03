'use strict';

jest.mock('../services/betterdeskApi', () => ({
    getRolePermissions: jest.fn(),
}));

const betterdeskApi = require('../services/betterdeskApi');
const {
    getEffectivePermissions,
    invalidateRole,
    clearCache,
    loadEffectivePermissions,
} = require('../services/rolePermissionService');

describe('rolePermissionService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearCache();
    });

    it('loads effective permissions from the Go API and caches briefly', async () => {
        betterdeskApi.getRolePermissions.mockResolvedValue({
            success: true,
            data: {
                role: 'operator',
                permissions: ['device.view', 'user.view'],
            },
        });

        const first = await getEffectivePermissions('operator');
        const second = await getEffectivePermissions('operator');

        expect(first).toEqual(new Set(['device.view', 'user.view']));
        expect(second).toEqual(new Set(['device.view', 'user.view']));
        expect(betterdeskApi.getRolePermissions).toHaveBeenCalledTimes(1);
    });

    it('invalidates a role after its override changes', async () => {
        betterdeskApi.getRolePermissions
            .mockResolvedValueOnce({
                success: true,
                data: { role: 'operator', permissions: ['user.view'] },
            })
            .mockResolvedValueOnce({
                success: true,
                data: { role: 'operator', permissions: [] },
            });

        await getEffectivePermissions('operator');
        invalidateRole('operator');
        const permissions = await getEffectivePermissions('operator');

        expect(permissions.has('user.view')).toBe(false);
        expect(betterdeskApi.getRolePermissions).toHaveBeenCalledTimes(2);
    });

    it('marks permission resolution failures so callers fail closed', async () => {
        const error = new Error('Go API unavailable');
        betterdeskApi.getRolePermissions.mockRejectedValue(error);
        const req = {
            session: { userId: 12, user: { role: 'operator' } },
        };
        const next = jest.fn();

        await new Promise((resolve) => {
            loadEffectivePermissions(req, {}, () => {
                next();
                resolve();
            });
        });

        expect(next).toHaveBeenCalledTimes(1);
        expect(req.permissionContextLoaded).toBe(true);
        expect(req.effectivePermissions).toBeUndefined();
        expect(req.permissionLoadError).toBeInstanceOf(Error);
    });
});
