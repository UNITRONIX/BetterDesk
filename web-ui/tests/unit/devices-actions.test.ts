/**
 * Device actions (lib/devices/actions.svelte.ts): each one is gated by the
 * permission the old page checked (no dialog, no request without it), and
 * with it calls the API with the right arguments and tells the list.
 * The API, the dialogs and the device dialogs are mocked.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('#lib/api/devices.ts', () => ({
	updateDevice: vi.fn(async () => ({})),
	banDevice: vi.fn(async () => ({})),
	unbanDevice: vi.fn(async () => ({})),
	deleteDevice: vi.fn(async () => ({})),
	restoreDevice: vi.fn(async () => ({})),
	bulkDelete: vi.fn(async () => ({})),
	changeDeviceId: vi.fn(async () => ({})),
	setDeviceTags: vi.fn(async (_id: string, tags: string[]) => ({ tags })),
	setDeviceFolder: vi.fn(async () => ({})),
	moveToFolder: vi.fn(async () => ({})),
	listFolders: vi.fn(async () => [{ id: 3, name: 'Lab', color: '#000' }]),
	getDeviceMemberships: vi.fn(async () => ({
		groups: [
			{ guid: 'm1', name: 'Manual', source_type: 'manual' },
			{ guid: 't1', name: 'Tag', source_type: 'tag', tag_filter: 'x' }
		],
		memberships: [{ guid: 't1' }]
	})),
	setDeviceGroups: vi.fn(async () => ({})),
	getAccessPolicy: vi.fn(async () => ({})),
	saveAccessPolicy: vi.fn(async () => undefined),
	setConnectionMode: vi.fn(async () => ({}))
}));
vi.mock('#lib/api/remoteTargets.ts', () => ({
	createRemoteTarget: vi.fn(async () => ({ id: 'rt_new' })),
	updateRemoteTarget: vi.fn(async () => ({})),
	deleteRemoteTarget: vi.fn(async () => ({})),
	saveRemoteTargetPassword: vi.fn(async () => ({})),
	deleteRemoteTargetPassword: vi.fn(async () => ({})),
	testRemoteTarget: vi.fn(async () => ({}))
}));
vi.mock('#lib/api/mesh.ts', () => ({
	meshExec: vi.fn(async () => ({})),
	meshPower: vi.fn(async () => ({})),
	meshShareLink: vi.fn(async () => 'http://x/share'),
	linkMeshPeer: vi.fn(async () => ({}))
}));
vi.mock('#lib/api/guest.ts', () => ({
	createGuestLink: vi.fn(async () => ({ url: 'http://x/g', expiresAt: '' }))
}));
vi.mock('#lib/ui/dialogs.svelte.ts', () => ({
	confirm: vi.fn(async () => true),
	prompt: vi.fn(async () => 'NEWID123')
}));
/** What each device dialog answers; forms run their save with these values first */
const answers: Record<string, unknown> = {};
const defaults: Record<string, unknown> = {
	ban: '',
	delete: { hard: false, revoke: false },
	tags: { add: ['new'], remove: [] },
	'move-folder': 3
};
vi.mock('../../src/lib/devices/ask.svelte.ts', () => ({
	ask: vi.fn(async (kind: string, props: Record<string, (...a: unknown[]) => Promise<unknown>>) => {
		if (kind === 'memberships') await props.save!(['m1']);
		if (kind === 'access-policy')
			await props.save!({ password: 'secret', clear_password: true, unattended_enabled: true });
		if (kind === 'remote-target')
			await props.save!(
				{
					name: 'Box',
					protocol: 'rdp',
					host: '10.0.0.5',
					port: 3389,
					credential_mode: 'saved',
					username: 'u'
				},
				'pw'
			);
		if (kind === 'guest-link')
			await props.create!({ peer_ids: ['a'], ttl_minutes: 60, view_only: true, label: '' });
		if (kind === 'mesh-command') await props.run!('whoami', true);
		if (kind in answers) return answers[kind];
		return defaults[kind] ?? true;
	})
}));

import * as devicesApi from '#lib/api/devices.ts';
import * as targetsApi from '#lib/api/remoteTargets.ts';
import * as meshApi from '#lib/api/mesh.ts';
import * as guestApi from '#lib/api/guest.ts';
import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
import { session } from '../../src/lib/state/session.svelte.ts';
import { devicePanel, openDevice } from '../../src/lib/state/devicePanel.svelte.ts';
import { ask } from '../../src/lib/devices/ask.svelte.ts';
import * as act from '../../src/lib/devices/actions.svelte.ts';

const as = (...perms: string[]) => {
	session.isSuperAdmin = false;
	session.permissions = perms;
};

const dev = (over: Partial<act.DeviceLike> = {}): act.DeviceLike => ({
	id: '900100001',
	hostname: 'reception',
	display_name: '',
	tags: ['office'],
	online: false,
	banned: false,
	soft_deleted: false,
	device_type: 'rustdesk',
	folder_id: null,
	...over
});

beforeEach(() => {
	vi.clearAllMocks();
	for (const k of Object.keys(answers)) Reflect.deleteProperty(answers, k);
	as();
	devicePanel.id = null;
});

describe('permission gates: nothing is asked or sent without the permission', () => {
	const cases: [string, string, () => Promise<unknown> | unknown, () => unknown][] = [
		['rename', 'device.edit', () => act.rename(dev()), () => devicesApi.updateDevice],
		['saveNote', 'device.edit', () => act.saveNote(dev(), 'x'), () => devicesApi.updateDevice],
		['setTags', 'device.edit', () => act.setTags(dev(), ['a']), () => devicesApi.setDeviceTags],
		['tagDevices', 'device.edit', () => act.tagDevices([dev()]), () => devicesApi.setDeviceTags],
		['moveToFolder', 'device.edit', () => act.moveToFolder([dev()], 3), () => devicesApi.setDeviceFolder],
		['manageGroups', 'device.edit', () => act.manageGroups(dev()), () => devicesApi.setDeviceGroups],
		['editAccessPolicy', 'device.edit', () => act.editAccessPolicy(dev()), () => devicesApi.saveAccessPolicy],
		['ban', 'device.ban', () => act.ban(dev()), () => devicesApi.banDevice],
		['unban', 'device.ban', () => act.unban(dev({ banned: true })), () => devicesApi.unbanDevice],
		['deleteDevice', 'device.delete', () => act.deleteDevice(dev()), () => devicesApi.deleteDevice],
		[
			'deleteDevices',
			'device.delete',
			() => act.deleteDevices([dev(), dev({ id: '2' })]),
			() => devicesApi.bulkDelete
		],
		[
			'restoreDevice',
			'device.delete',
			() => act.restoreDevice(dev({ soft_deleted: true })),
			() => devicesApi.restoreDevice
		],
		['permanentDelete', 'device.delete', () => act.permanentDelete(dev()), () => devicesApi.deleteDevice],
		['changeId', 'device.change_id', () => act.changeId(dev()), () => devicesApi.changeDeviceId],
		[
			'setConnectionMode',
			'device.connection_mode',
			() => act.setConnectionMode(dev(), 'incoming-only', 'test'),
			() => devicesApi.setConnectionMode
		],
		[
			'addRemoteTarget',
			'remote_target.edit',
			() => act.addRemoteTarget(),
			() => targetsApi.createRemoteTarget
		],
		[
			'deleteRemoteTarget',
			'remote_target.delete',
			() => act.deleteRemoteTarget(dev({ id: 'rt_1', remote_target: true })),
			() => targetsApi.deleteRemoteTarget
		],
		['createGuestLink', 'guest.create', () => act.createGuestLink([dev()]), () => guestApi.createGuestLink],
		[
			'meshPower',
			'mesh.power',
			() => act.meshPower(dev({ device_type: 'mesh_agent', online: true }), 'reset'),
			() => meshApi.meshPower
		],
		[
			'runMeshCommand',
			'device.connect',
			() => act.runMeshCommand(dev({ device_type: 'mesh_agent', online: true })),
			() => meshApi.meshExec
		]
	];

	test.each(cases)('%s needs %s', async (_name, perm, run, api) => {
		as();
		expect(await run()).toBeFalsy();
		expect(api()).not.toHaveBeenCalled();
		expect(confirm).not.toHaveBeenCalled();
		expect(prompt).not.toHaveBeenCalled();
		expect(ask).not.toHaveBeenCalled();

		as(perm);
		expect(await run()).toBeTruthy();
		expect(api()).toHaveBeenCalled();
	});

	test('super admins may do everything', async () => {
		session.isSuperAdmin = true;
		session.permissions = [];
		expect(await act.ban(dev())).toBe(true);
	});

	test('deleted devices offer no changes, only restore and delete', async () => {
		as('device.edit', 'device.ban', 'device.change_id', 'device.delete');
		expect(await act.rename(dev({ soft_deleted: true }))).toBe(false);
		expect(await act.ban(dev({ soft_deleted: true }))).toBe(false);
		expect(await act.changeId(dev({ soft_deleted: true }))).toBeNull();
		const ids = act
			.deviceMenu(dev({ soft_deleted: true }))
			.flat()
			.map((i) => i.id);
		expect(ids).toEqual(['details', 'restore', 'permanent-delete']);
	});
});

describe('what the actions send', () => {
	test('the snapshot viewer opens the viewer with the agent transport, not the old alias', () => {
		as('device.connect');
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		expect(act.openSnapshotViewer(dev())).toBe(true);
		expect(open).toHaveBeenCalledWith('/remote/900100001?transport=cdap', '_blank');
	});

	test('ban sends the reason from the dialog; cancelling sends nothing', async () => {
		as('device.ban');
		answers.ban = '  stolen  ';
		expect(await act.ban(dev())).toBe(true);
		expect(devicesApi.banDevice).toHaveBeenCalledWith('900100001', 'stolen');
		answers.ban = null;
		vi.mocked(devicesApi.banDevice).mockClear();
		expect(await act.ban(dev())).toBe(false);
		expect(devicesApi.banDevice).not.toHaveBeenCalled();
	});

	test('delete sends the options from the dialog; a deleted device is deleted for good', async () => {
		as('device.delete');
		answers.delete = { hard: false, revoke: true };
		await act.deleteDevice(dev());
		expect(devicesApi.deleteDevice).toHaveBeenCalledWith('900100001', { hard: false, revoke: true });
		vi.mocked(devicesApi.deleteDevice).mockClear();
		await act.deleteDevice(dev({ soft_deleted: true }));
		expect(ask).toHaveBeenCalledTimes(1);
		expect(devicesApi.deleteDevice).toHaveBeenCalledWith('900100001', { hard: true });
	});

	test('deleting closes the panel that shows the device', async () => {
		as('device.delete');
		openDevice('900100001');
		answers.delete = { hard: false, revoke: false };
		await act.deleteDevice(dev());
		expect(devicePanel.id).toBeNull();
	});

	test('change ID checks the new ID before sending it', async () => {
		as('device.change_id');
		vi.mocked(prompt).mockResolvedValueOnce('bad id!');
		expect(await act.changeId(dev())).toBeNull();
		expect(devicesApi.changeDeviceId).not.toHaveBeenCalled();
		vi.mocked(prompt).mockResolvedValueOnce('NEWID123');
		expect(await act.changeId(dev({ online: true }))).toBe('NEWID123');
		expect(confirm).toHaveBeenCalled();
		expect(devicesApi.changeDeviceId).toHaveBeenCalledWith('900100001', 'NEWID123');
	});

	test('tags: added without duplicates, removed case-insensitively, unchanged devices skipped', async () => {
		as('device.edit');
		expect(act.changedTags(['Office', 'lab'], ['office', 'new'], ['LAB'])).toEqual(['Office', 'new']);
		answers.tags = { add: ['vip'], remove: ['office'] };
		await act.tagDevices([dev({ id: 'a', tags: ['office'] }), dev({ id: 'b', tags: ['vip'] })]);
		expect(devicesApi.setDeviceTags).toHaveBeenCalledTimes(1);
		expect(devicesApi.setDeviceTags).toHaveBeenCalledWith('a', ['vip']);
	});

	test('one device moves with its own call, several in one request, no folder is 0', async () => {
		as('device.edit');
		await act.moveToFolder([dev()], null);
		expect(devicesApi.setDeviceFolder).toHaveBeenCalledWith('900100001', null);
		await act.moveToFolder([dev({ id: 'a' }), dev({ id: 'b' })], null);
		expect(devicesApi.moveToFolder).toHaveBeenCalledWith(0, ['a', 'b']);
		answers['move-folder'] = 3;
		await act.chooseFolder([dev()]);
		expect(devicesApi.setDeviceFolder).toHaveBeenLastCalledWith('900100001', 3);
	});

	test('manual groups only; the access policy drops a password typed before Clear', async () => {
		as('device.edit');
		await act.manageGroups(dev());
		expect(devicesApi.setDeviceGroups).toHaveBeenCalledWith('900100001', ['m1']);
		await act.editAccessPolicy(dev());
		expect(devicesApi.saveAccessPolicy).toHaveBeenCalledWith(
			'900100001',
			expect.objectContaining({ password: '', clear_password: true })
		);
	});

	test('a new RDP target is created, then its password saved', async () => {
		as('remote_target.edit');
		await act.addRemoteTarget();
		expect(targetsApi.createRemoteTarget).toHaveBeenCalledWith(expect.objectContaining({ host: '10.0.0.5' }));
		expect(targetsApi.saveRemoteTargetPassword).toHaveBeenCalledWith('rt_new', 'u', 'pw');
	});

	test('several devices are deleted in one request after one confirm', async () => {
		as('device.delete');
		await act.deleteDevices([dev({ id: 'a' }), dev({ id: 'b' }), dev({ id: 'c', soft_deleted: true })]);
		expect(confirm).toHaveBeenCalledTimes(1);
		expect(devicesApi.bulkDelete).toHaveBeenCalledWith(['a', 'b']);
	});

	test('every change tells the list', async () => {
		as('device.edit');
		const before = act.deviceChanges.revision;
		await act.setTags(dev(), ['x']);
		expect(act.deviceChanges.revision).toBe(before + 1);
	});

	test('a refused request is a toast, not an exception', async () => {
		as('device.ban');
		vi.mocked(devicesApi.banDevice).mockRejectedValueOnce(new Error('Device not found'));
		answers.ban = '';
		await expect(act.ban(dev())).resolves.toBe(false);
	});
});

describe('row menu', () => {
	const ids = (d: act.DeviceLike) =>
		act
			.deviceMenu(d)
			.flat()
			.map((i) => i.id);

	test('viewer: details only', () => {
		as('device.view');
		expect(ids(dev())).toEqual(['details']);
	});

	test('operator: connect, guest link, viewers, changes; no ban, ID or delete', () => {
		as('device.view', 'device.connect', 'device.edit', 'guest.create', 'device.connection_mode');
		expect(ids(dev())).toEqual([
			'web-remote',
			'guest-access',
			'cdap-viewer',
			'connect-desktop',
			'details',
			'edit',
			'manage-tags',
			'groups',
			'move-folder',
			'access-policy'
		]);
	});

	test('admin: ban or unban by state, change ID and delete', () => {
		session.isSuperAdmin = true;
		expect(ids(dev())).toContain('toggle-ban');
		expect(
			act
				.deviceMenu(dev({ banned: true }))
				.flat()
				.find((i) => i.id === 'toggle-ban')?.icon
		).toBe('lock_open');
		expect(ids(dev()).slice(-1)).toEqual(['delete']);
	});

	test('MeshAgent online: its tools; offline: only Wake', () => {
		session.isSuperAdmin = true;
		expect(ids(dev({ device_type: 'mesh_agent', online: true }))).toEqual(
			expect.arrayContaining(['mesh-terminal', 'mesh-files', 'mesh-port-udp', 'mesh-power-off'])
		);
		const offline = ids(dev({ device_type: 'mesh_agent' }));
		expect(offline).toContain('mesh-power-wake');
		expect(offline).not.toContain('mesh-terminal');
	});

	test('RDP/VNC target: connect, details, edit, tags, groups, delete with the target permissions', () => {
		as('device.view', 'remote_target.connect', 'remote_target.edit', 'remote_target.delete', 'device.edit');
		expect(ids(dev({ id: 'rt_1', remote_target: true }))).toEqual([
			'web-remote',
			'details',
			'edit',
			'manage-tags',
			'groups',
			'delete'
		]);
	});
});
