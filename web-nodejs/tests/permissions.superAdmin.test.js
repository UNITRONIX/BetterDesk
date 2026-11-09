/**
 * Only super admins change role overrides. server_admin has server.config,
 * which used to be enough to grant its own role any permission.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

jest.mock('../services/betterdeskApi', () => ({
    setRolePermission: jest.fn().mockResolvedValue({ success: true }),
    deleteRolePermission: jest.fn().mockResolvedValue({ success: true }),
    listRolePermissionOverrides: jest.fn().mockResolvedValue({ success: true, data: [] })
}));
jest.mock('../services/rolePermissionService', () => ({
    invalidateRole: jest.fn(),
    getEffectivePermissions: jest.fn(),
    loadEffectivePermissions: (_req, _res, next) => next()
}));

const betterdeskApi = require('../services/betterdeskApi');
const permissionsRoutes = require('../routes/permissions.routes');

function app(role) {
    const a = createTestApp();
    a.use((req, _res, next) => {
        req.session.userId = 5;
        req.session.user = { id: 5, username: 'u', role };
        next();
    });
    a.use(permissionsRoutes);
    return a;
}

describe('role permission overrides', () => {
    beforeEach(() => jest.clearAllMocks());

    test.each(['server_admin', 'global_admin', 'operator'])('%s cannot grant permissions', async (role) => {
        const res = await request(app(role)).post('/api/panel/role-permissions')
            .send({ role: 'server_admin', permission: 'user.delete', granted: true });
        expect(res.status).toBe(403);
        expect(betterdeskApi.setRolePermission).not.toHaveBeenCalled();
        const del = await request(app(role)).delete('/api/panel/role-permissions/operator/device.view');
        expect(del.status).toBe(403);
        expect(betterdeskApi.deleteRolePermission).not.toHaveBeenCalled();
    });

    test.each(['super_admin', 'admin'])('%s can', async (role) => {
        const res = await request(app(role)).post('/api/panel/role-permissions')
            .send({ role: 'operator', permission: 'device.delete', granted: true });
        expect(res.status).toBe(200);
        expect(betterdeskApi.setRolePermission).toHaveBeenCalledWith('operator', 'device.delete', true);
    });
});
