'use strict';

jest.mock('../services/database', () => ({
    getPanelAccessPolicies: jest.fn(),
    getClientFeaturePolicies: jest.fn(),
    getUserGroupsForUser: jest.fn(),
    setPanelAccessPolicies: jest.fn(),
    setClientFeaturePolicies: jest.fn(),
}));

jest.mock('../services/rolePermissionService', () => ({
    getEffectivePermissions: jest.fn(async () => new Set([
        'device.view',
        'device.edit',
        'remote_target.view',
        'remote_target.connect',
    ])),
}));

const db = require('../services/database');
const { resolveForUser } = require('../services/panelAccessPolicyService');

describe('panel access policy inheritance', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        db.getPanelAccessPolicies.mockImplementation(async (type, id) => {
            if (type === 'user' && id === '7') {
                return [{ resource_key: 'devices', access_level: 'none' }];
            }
            if (type === 'group' && id === 'ops') {
                return [{ resource_key: 'remote', access_level: 'read' }];
            }
            return [];
        });
        db.getClientFeaturePolicies.mockImplementation(async (type, id) => {
            if (type === 'user' && id === '7') {
                return [{ feature_key: 'clipboard', enabled: true }];
            }
            if (type === 'group' && id === 'ops') {
                return [{ feature_key: 'clipboard', enabled: false }];
            }
            return [];
        });
        db.getUserGroupsForUser.mockResolvedValue([{ guid: 'ops', name: 'Operators' }]);
    });

    test('applies user overrides over group and role defaults', async () => {
        const policy = await resolveForUser({ id: 7, role: 'operator' });

        expect(policy.sections.devices.access).toBe('none');
        expect(policy.sections.remote.access).toBe('read');
        expect(policy.features.clipboard.enabled).toBe(true);
        expect(policy.features.client_actions.enabled).toBe(false);
    });
});
