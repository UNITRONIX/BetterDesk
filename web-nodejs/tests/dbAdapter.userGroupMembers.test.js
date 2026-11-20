'use strict';

/**
 * Regression coverage for the user-group member lookup that
 * panelAccessPolicyService.resolveCeilingForSubject() depends on.
 *
 * The bug this guards against (#512) shipped because the only existing test
 * mocked db.getUserGroupMembers, so no test ever reached the real adapter and
 * `PUT/DELETE /api/panel/access/groups/:guid` failed with
 * "db.getUserGroupMembers is not a function" on SQLite and PostgreSQL.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// The role->permission map lives behind the Go API. Only that lookup is
// stubbed: the adapter, the group member query and the policy clamp below all
// run for real, which is what #512 broke.
jest.mock('../services/rolePermissionService', () => ({
    getEffectivePermissions: jest.fn(async () => new Set([
        'device.view',
        'device.connect',
    ])),
}));

describe('dbAdapter.getUserGroupMembers (real SQLite adapter)', () => {
    let tempDir;
    let adapter;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-group-members-'));
        process.env.DATA_DIR = path.join(tempDir, 'data');
        process.env.DB_PATH = path.join(tempDir, 'db_v2.sqlite3');
        process.env.DB_TYPE = 'sqlite';
        jest.resetModules();
    });

    afterEach(async () => {
        if (adapter) await adapter.close();
        adapter = null;
        delete process.env.DATA_DIR;
        delete process.env.DB_PATH;
        delete process.env.DB_TYPE;
        jest.resetModules();
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    async function createAdapter() {
        const { getAdapter } = require('../services/dbAdapter');
        adapter = getAdapter();
        await adapter.init();
        return adapter;
    }

    test('is exposed by the database facade', () => {
        const db = require('../services/database');
        expect(typeof db.getUserGroupMembers).toBe('function');
    });

    test('returns id, username and role for every member of the group', async () => {
        await createAdapter();
        const group = await adapter.createUserGroup({ name: 'Operators' });
        const alice = await adapter.createUser('alice', 'hash-a', 'operator');
        const bob = await adapter.createUser('bob', 'hash-b', 'viewer');
        await adapter.setUserGroupMemberships(alice.id, [group.guid]);
        await adapter.setUserGroupMemberships(bob.id, [group.guid]);

        const members = await adapter.getUserGroupMembers(group.guid);

        expect(members.map((m) => m.username)).toEqual(['alice', 'bob']);
        expect(members).toEqual([
            { id: alice.id, username: 'alice', role: 'operator' },
            { id: bob.id, username: 'bob', role: 'viewer' },
        ]);
    });

    test('returns an empty list for a group without members and for unknown guids', async () => {
        await createAdapter();
        const group = await adapter.createUserGroup({ name: 'Empty' });

        await expect(adapter.getUserGroupMembers(group.guid)).resolves.toEqual([]);
        await expect(adapter.getUserGroupMembers('does-not-exist')).resolves.toEqual([]);
        await expect(adapter.getUserGroupMembers(null)).resolves.toEqual([]);
    });

    test('does not leak members of a different group', async () => {
        await createAdapter();
        const first = await adapter.createUserGroup({ name: 'First' });
        const second = await adapter.createUserGroup({ name: 'Second' });
        const carol = await adapter.createUser('carol', 'hash-c', 'operator');
        await adapter.setUserGroupMemberships(carol.id, [second.guid]);

        await expect(adapter.getUserGroupMembers(first.guid)).resolves.toEqual([]);
        await expect(adapter.getUserGroupMembers(second.guid)).resolves.toHaveLength(1);
    });

    test('dropping a member from the group removes it from the result', async () => {
        await createAdapter();
        const group = await adapter.createUserGroup({ name: 'Rotating' });
        const dave = await adapter.createUser('dave', 'hash-d', 'operator');
        await adapter.setUserGroupMemberships(dave.id, [group.guid]);
        expect(await adapter.getUserGroupMembers(group.guid)).toHaveLength(1);

        await adapter.setUserGroupMemberships(dave.id, []);
        expect(await adapter.getUserGroupMembers(group.guid)).toEqual([]);
    });

    test('group policy save and delete no longer throw on the missing function', async () => {
        await createAdapter();
        const group = await adapter.createUserGroup({ name: 'Policied' });
        const erin = await adapter.createUser('erin', 'hash-e', 'operator');
        await adapter.setUserGroupMemberships(erin.id, [group.guid]);

        const policyService = require('../services/panelAccessPolicyService');

        // savePolicy clamps against the group's role ceiling, which is exactly
        // the call that used to fail with a TypeError.
        await expect(policyService.savePolicy('group', group.guid, {
            sections: [{ resource_key: 'devices', access_level: 'read' }],
        })).resolves.toBeTruthy();

        await expect(adapter.deleteUserGroup(group.guid)).resolves.toBeUndefined();
    });
});
