/**
 * The permissions page's grouping and labels without a DOM. Permissions the
 * server lists but no group names end up under "Other"; a group whose
 * permissions the server does not know is left out.
 */

import type { RoleOverride } from '#lib/api/roles.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

export const CATEGORIES: readonly { id: string; permissions: readonly string[] }[] = [
	{
		id: 'device',
		permissions: [
			'device.view',
			'device.connect',
			'guest.create',
			'device.edit',
			'device.delete',
			'device.ban',
			'device.change_id',
			'device.connection_mode'
		]
	},
	{
		id: 'remote_target',
		permissions: [
			'remote_target.view',
			'remote_target.connect',
			'remote_target.edit',
			'remote_target.delete',
			'remote_target.test'
		]
	},
	{ id: 'user', permissions: ['user.view', 'user.create', 'user.edit', 'user.delete'] },
	{
		id: 'org',
		permissions: ['org.create', 'org.edit', 'org.delete', 'org.manage_users', 'org.manage_devices']
	},
	{ id: 'enrollment', permissions: ['enrollment.manage', 'enrollment.approve'] },
	{ id: 'chat', permissions: ['chat.access'] },
	{ id: 'audit', permissions: ['audit.view', 'metrics.view', 'blocklist.edit'] },
	{ id: 'server', permissions: ['server.config', 'server.keys', 'server.attestation'] },
	{ id: 'branding', permissions: ['branding.edit'] },
	{ id: 'billing', permissions: ['billing.view', 'billing.manage', 'billing.reports', 'billing.export'] },
	{ id: 'cdap', permissions: ['cdap.view', 'cdap.command', 'cdap.terminal', 'cdap.files'] },
	{ id: 'mesh', permissions: ['mesh.terminal', 'mesh.files', 'mesh.power'] }
];

/** The groups to show for the permissions the server knows (all of them when it lists none) */
export function permissionGroups(all: readonly string[]): { id: string; permissions: string[] }[] {
	const known = new Set(all);
	const listed = new Set<string>();
	const groups = CATEGORIES.map((c) => {
		const permissions = c.permissions.filter((p) => !known.size || known.has(p));
		permissions.forEach((p) => listed.add(p));
		return { id: c.id, permissions };
	}).filter((g) => g.permissions.length);
	const rest = all.filter((p) => !listed.has(p));
	if (rest.length) groups.push({ id: 'other', permissions: rest });
	return groups;
}

function translated(t: T, key: string, fallback: string): string {
	const v = t(key);
	return v === key ? fallback : v;
}

export function permLabel(perm: string, t: T): string {
	return translated(t, `permissions.perm_${perm.replace(/\./g, '_')}`, perm);
}

export function categoryLabel(id: string, t: T): string {
	return translated(t, `permissions.cat_${id}`, id.charAt(0).toUpperCase() + id.slice(1));
}

/** The role's overrides as permission → granted */
export function overrideMap(overrides: readonly RoleOverride[], role: string): Map<string, boolean> {
	return new Map(overrides.filter((o) => o.role === role).map((o) => [o.permission, o.granted]));
}

/** ?role= when it names a role, else the first role that can be changed, else the first */
export function pickRole<R extends { name: string; is_super_admin: boolean }>(
	roles: readonly R[],
	wanted: string | null
): string {
	return (
		(roles.find((r) => r.name === wanted) ?? roles.find((r) => !r.is_super_admin) ?? roles[0])?.name ?? ''
	);
}
