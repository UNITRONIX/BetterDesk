import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { RoleInfo, RoleOverride } from '../../../src/lib/api/roles.ts';
import {
	categoryLabel,
	overrideMap,
	permissionGroups,
	permLabel,
	pickRole
} from '../../../src/lib/people/permissions.ts';

describe('permission groups', () => {
	test('only the permissions the server knows; unknown ones under Other; empty groups left out', () => {
		const groups = permissionGroups(['device.view', 'user.view', 'user.delete', 'future.thing']);
		expect(groups.map((g) => g.id)).toEqual(['device', 'user', 'other']);
		expect(groups[0]?.permissions).toEqual(['device.view']);
		expect(groups[1]?.permissions).toEqual(['user.view', 'user.delete']);
		expect(groups[2]?.permissions).toEqual(['future.thing']);
	});

	test('a server that lists nothing gets every known group', () => {
		const groups = permissionGroups([]);
		expect(groups.map((g) => g.id)).toContain('mesh');
		expect(groups.find((g) => g.id === 'other')).toBeUndefined();
	});

	test('labels: the translation, else the code or the capitalised group id', () => {
		const t = (k: string) => ({ 'permissions.perm_device_view': 'View devices' })[k] ?? k;
		expect(permLabel('device.view', t)).toBe('View devices');
		expect(permLabel('device.ban', t)).toBe('device.ban');
		expect(categoryLabel('billing', t)).toBe('Billing');
	});
});

describe('roles and overrides', () => {
	const roles = [
		{ name: 'super_admin', level: 5, is_super_admin: true },
		{ name: 'operator', level: 2 },
		{ name: 'viewer', level: 1 }
	].map((r) => v.parse(RoleInfo, r));

	test('?role= picks that role, else the first that can be changed', () => {
		expect(pickRole(roles, 'viewer')).toBe('viewer');
		expect(pickRole(roles, 'nobody')).toBe('operator');
		expect(pickRole(roles, null)).toBe('operator');
		expect(pickRole([roles[0]!], null)).toBe('super_admin');
		expect(pickRole([], null)).toBe('');
	});

	test("one role's overrides as permission and granted; SQLite 0/1 reads as booleans", () => {
		const list = [
			{ role: 'operator', permission: 'device.ban', granted: 1 },
			{ role: 'operator', permission: 'chat.access', granted: false },
			{ role: 'viewer', permission: 'device.edit', granted: true }
		].map((o) => v.parse(RoleOverride, o));
		const map = overrideMap(list, 'operator');
		expect([...map]).toEqual([
			['device.ban', true],
			['chat.access', false]
		]);
		expect(overrideMap(list, 'pro').size).toBe(0);
	});

	test('a role without a level or a defaults list still parses', () => {
		expect(v.parse(RoleInfo, { name: 'pro', permissions: null })).toMatchObject({
			level: 0,
			is_super_admin: false,
			permissions: []
		});
	});
});
