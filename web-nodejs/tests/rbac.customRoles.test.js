/**
 * BetterDesk Console - Permission overrides, custom roles and user visibility
 */

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockApiClient = jest.fn();
mockApiClient.get = jest.fn();

jest.mock('../services/betterdeskApi', () => ({
    apiClient: mockApiClient,
    setRolePermission: jest.fn().mockResolvedValue({ success: true, data: { status: 'ok' } }),
    deleteRolePermission: jest.fn().mockResolvedValue({ success: true, data: { status: 'ok' } }),
}));

jest.mock('../services/userSync', () => ({
    resolveGoUserId: jest.fn(),
}));

const rolePermissionStore = require('../services/rolePermissionStore');
const { roleHasPermission } = require('../middleware/auth');
const organizationsRoutes = require('../routes/organizations.routes');
const permissionsRoutes = require('../routes/permissions.routes');

const ORG_USERS = [
    { id: 'ou-1', username: 'owner1', role: 'owner' },
    { id: 'ou-2', username: 'op1', role: 'operator' },
    { id: 'ou-3', username: 'member1', role: 'user' },
];

function orgApp(user) {
    const app = createTestApp();
    withAuth(app, user);
    app.use(organizationsRoutes);
    return app;
}

function mockGoOrgs() {
    mockApiClient.mockImplementation(async ({ url }) => {
        if (url === '/org') {
            return { status: 200, data: { organizations: [{ id: 'org-1', name: 'Acme' }, { id: 'org-2', name: 'Other' }] } };
        }
        if (url === '/org/org-1/users') return { status: 200, data: { users: ORG_USERS } };
        if (url === '/org/org-2/users') return { status: 200, data: { users: [] } };
        if (url === '/org/org-1') return { status: 200, data: { id: 'org-1', name: 'Acme' } };
        if (url === '/org/org-2') return { status: 200, data: { id: 'org-2', name: 'Other' } };
        throw Object.assign(new Error('unexpected'), { response: { status: 404, data: { error: url } } });
    });
}

describe('Role permission overrides and custom roles', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rolePermissionStore.reset();
    });

    it('applies Permissions-page overrides to built-in roles', () => {
        expect(roleHasPermission('operator', 'user.view')).toBe(true);
        rolePermissionStore.setState({
            overrides: [
                { role: 'operator', permission: 'user.view', granted: false },
                { role: 'viewer', permission: 'device.connect', granted: true },
            ],
        });
        expect(roleHasPermission('operator', 'user.view')).toBe(false);
        expect(roleHasPermission('viewer', 'device.connect')).toBe(true);
        expect(roleHasPermission('super_admin', 'user.view')).toBe(true);
    });

    it('never lets an override give pro accounts device access', () => {
        rolePermissionStore.setState({ overrides: [{ role: 'pro', permission: 'device.view', granted: true }] });
        expect(roleHasPermission('pro', 'device.view')).toBe(false);
    });

    it('gives custom roles only the permissions granted to them', () => {
        rolePermissionStore.setState({
            roles: [{ name: 'helpdesk', is_custom: true }],
            overrides: [{ role: 'helpdesk', permission: 'device.view', granted: true }],
        });
        expect(rolePermissionStore.isCustomRole('helpdesk')).toBe(true);
        expect(roleHasPermission('helpdesk', 'device.view')).toBe(true);
        expect(roleHasPermission('helpdesk', 'user.view')).toBe(false);
        expect(roleHasPermission('unknown_role', 'device.view')).toBe(false);
    });

    it('hides the Users API when user.view is revoked from a role', async () => {
        rolePermissionStore.setState({ overrides: [{ role: 'operator', permission: 'user.view', granted: false }] });
        const { requirePermission } = require('../middleware/auth');
        const app = createTestApp();
        withAuth(app, { id: 5, username: 'op1', role: 'operator' });
        app.get('/api/users', requirePermission('user.view'), (_req, res) => res.json({ ok: true }));

        const res = await request(app).get('/api/users');
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('Permission denied: user.view');
    });
});

describe('Organization scoping for proxied requests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rolePermissionStore.reset();
        mockGoOrgs();
    });

    it('lists only member organizations for users without org permissions', async () => {
        const res = await request(orgApp({ id: 7, username: 'member1', role: 'viewer' })).get('/api/panel/org');
        expect(res.status).toBe(200);
        expect(res.body.organizations.map(o => o.id)).toEqual(['org-1']);
    });

    it('lists every organization for org administrators', async () => {
        const res = await request(orgApp({ id: 1, username: 'admin', role: 'global_admin' })).get('/api/panel/org');
        expect(res.status).toBe(200);
        expect(res.body.organizations).toHaveLength(2);
    });

    it('rejects organization detail for non-members', async () => {
        const res = await request(orgApp({ id: 7, username: 'member1', role: 'viewer' })).get('/api/panel/org/org-2');
        expect(res.status).toBe(403);
    });

    it('shows a plain org member only themselves', async () => {
        const res = await request(orgApp({ id: 7, username: 'member1', role: 'viewer' })).get('/api/panel/org/org-1/users');
        expect(res.status).toBe(200);
        expect(res.body.users.map(u => u.username)).toEqual(['member1']);
    });

    it('shows org owners all members even without user.view', async () => {
        const res = await request(orgApp({ id: 8, username: 'owner1', role: 'viewer' })).get('/api/panel/org/org-1/users');
        expect(res.status).toBe(200);
        expect(res.body.users).toHaveLength(3);
    });

    it('hides org members once user.view is revoked from the server role', async () => {
        const app = orgApp({ id: 9, username: 'op1', role: 'operator' });
        let res = await request(app).get('/api/panel/org/org-1/users');
        expect(res.body.users).toHaveLength(3);

        rolePermissionStore.setState({ overrides: [{ role: 'operator', permission: 'user.view', granted: false }] });
        res = await request(app).get('/api/panel/org/org-1/users');
        expect(res.status).toBe(200);
        expect(res.body.users.map(u => u.username)).toEqual(['op1']);
    });

    it('lets a custom role with user.view see all members', async () => {
        rolePermissionStore.setState({
            roles: [{ name: 'helpdesk', is_custom: true }],
            overrides: [{ role: 'helpdesk', permission: 'user.view', granted: true }],
        });
        const res = await request(orgApp({ id: 10, username: 'member1', role: 'helpdesk' })).get('/api/panel/org/org-1/users');
        expect(res.body.users).toHaveLength(3);
    });
});

describe('Custom role management routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        rolePermissionStore.reset();
        mockApiClient.get.mockImplementation(async (url) => {
            if (url === '/roles') return { data: { roles: [{ name: 'helpdesk', is_custom: true }] } };
            return { data: { overrides: [{ role: 'helpdesk', permission: 'device.view', granted: true }] } };
        });
    });

    function adminApp(role = 'super_admin') {
        const app = createTestApp();
        withAuth(app, { id: 1, username: 'admin', role });
        app.use(permissionsRoutes);
        return app;
    }

    it('creates a custom role through the Go API and refreshes the cache', async () => {
        mockApiClient.mockResolvedValue({ status: 201, data: { name: 'helpdesk', is_custom: true } });

        const res = await request(adminApp())
            .post('/api/panel/roles')
            .send({ name: 'helpdesk', description: 'Front line', copy_from: 'viewer' });

        expect(res.status).toBe(201);
        expect(mockApiClient).toHaveBeenCalledWith({
            method: 'post',
            url: '/roles',
            data: { name: 'helpdesk', description: 'Front line', copy_from: 'viewer' },
        });
        expect(rolePermissionStore.isCustomRole('helpdesk')).toBe(true);
        expect(roleHasPermission('helpdesk', 'device.view')).toBe(true);
    });

    it('rejects invalid role names before calling the Go API', async () => {
        const res = await request(adminApp()).post('/api/panel/roles').send({ name: 'Bad Name' });
        expect(res.status).toBe(400);
        expect(mockApiClient).not.toHaveBeenCalled();
    });

    it('forwards Go conflicts when deleting a role that is still assigned', async () => {
        mockApiClient.mockRejectedValue({
            response: { status: 409, data: { error: 'Role is still assigned to users; reassign them first' } },
        });
        const res = await request(adminApp()).delete('/api/panel/roles/helpdesk');
        expect(res.status).toBe(409);
        expect(res.body.error).toMatch(/still assigned/);
    });

    it('requires server.config to manage roles', async () => {
        const res = await request(adminApp('operator')).post('/api/panel/roles').send({ name: 'helpdesk' });
        expect(res.status).toBe(403);
    });
});
