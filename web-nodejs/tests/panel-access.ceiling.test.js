'use strict';

/**
 * Panel access policy must not exceed the role ceiling (audit H7, 2026-11-13).
 *
 * A `global_admin` has `user.edit` but not `server.config`. Storing
 * `settings: write` for itself used to map onto `server.config` through the
 * panel catalog, so the role gained a permission it never held.
 */

const {
    requestHasPermission,
} = require('../middleware/auth');

function reqFor({ role, section, sectionAccess, permissions }) {
    return {
        session: { user: { id: 1, username: 'u', role }, userId: 1 },
        panelAccessSection: section,
        panelAccessPolicy: sectionAccess ? { sections: { [section]: { access: sectionAccess } } } : null,
        effectivePermissions: permissions ? new Set(permissions) : undefined,
        permissionContextLoaded: Boolean(permissions),
    };
}

describe('requestHasPermission (audit H7)', () => {
    it('denies server.config to global_admin even with a write section override', () => {
        const req = reqFor({
            role: 'global_admin',
            section: 'settings',
            sectionAccess: 'write',
            permissions: ['user.view', 'user.edit', 'user.create'],
        });
        expect(requestHasPermission(req, 'server.config')).toBe(false);
    });

    it('still allows a permission the role genuinely holds', () => {
        const req = reqFor({
            role: 'global_admin',
            section: 'users',
            sectionAccess: 'write',
            permissions: ['user.view', 'user.edit'],
        });
        expect(requestHasPermission(req, 'user.edit')).toBe(true);
    });

    it('lets the section policy narrow access the role would allow', () => {
        const req = reqFor({
            role: 'operator',
            section: 'devices',
            sectionAccess: 'read',
            permissions: ['device.view', 'device.edit'],
        });
        expect(requestHasPermission(req, 'device.edit')).toBe(false);
        expect(requestHasPermission(req, 'device.view')).toBe(true);
    });

    it('super admins keep full access regardless of section policy', () => {
        const req = reqFor({
            role: 'super_admin',
            section: 'settings',
            sectionAccess: 'none',
            permissions: [],
        });
        expect(requestHasPermission(req, 'server.config')).toBe(true);
    });

    it('falls back to the static role map when no permission context is loaded', () => {
        const req = reqFor({ role: 'viewer', section: null, sectionAccess: null, permissions: null });
        expect(requestHasPermission(req, 'device.view')).toBe(true);
        expect(requestHasPermission(req, 'server.config')).toBe(false);
    });
});

describe('panel access policy clamping', () => {
    let policyService;

    beforeEach(() => {
        jest.resetModules();
        jest.doMock('../services/database', () => ({
            getUserById: jest.fn().mockResolvedValue({ id: 5, username: 'ga', role: 'global_admin' }),
            getUserGroupMembers: jest.fn().mockResolvedValue([]),
            getPanelAccessPolicies: jest.fn().mockResolvedValue([]),
            getClientFeaturePolicies: jest.fn().mockResolvedValue([]),
            getUserGroupsForUser: jest.fn().mockResolvedValue([]),
            setPanelAccessPolicies: jest.fn().mockResolvedValue(undefined),
            setClientFeaturePolicies: jest.fn().mockResolvedValue(undefined),
        }));
        jest.doMock('../services/rolePermissionService', () => ({
            getEffectivePermissions: jest.fn(async (role) => new Set(
                role === 'global_admin' ? ['user.view', 'user.edit', 'device.view'] : []
            )),
        }));
        policyService = require('../services/panelAccessPolicyService');
    });

    afterEach(() => {
        jest.dontMock('../services/database');
        jest.dontMock('../services/rolePermissionService');
    });

    it('persists a clamped level when a global_admin grants itself settings:write', async () => {
        const db = require('../services/database');
        const saved = await policyService.savePolicy('user', '5', {
            sections: [{ resource_key: 'settings', access_level: 'write' }],
        });

        const settingsRow = saved.sections.find((row) => row.resource_key === 'settings');
        expect(settingsRow).toBeDefined();
        expect(settingsRow.access_level).not.toBe('write');
        const persisted = db.setPanelAccessPolicies.mock.calls[0][2];
        expect(persisted.find((row) => row.resource_key === 'settings').access_level).not.toBe('write');
    });

    it('clamps resolved sections to the role ceiling', async () => {
        const db = require('../services/database');
        db.getPanelAccessPolicies.mockResolvedValue([
            { resource_key: 'settings', access_level: 'write' },
            { resource_key: 'users', access_level: 'write' },
        ]);

        const resolved = await policyService.resolveForUser({ id: 5, role: 'global_admin' });
        expect(resolved.sections.settings.access).not.toBe('write');
        expect(resolved.sections.settings.role_ceiling).toBe('none');
        expect(resolved.sections.users.access).toBe('write');
    });
});
