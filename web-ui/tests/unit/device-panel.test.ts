import { describe, expect, test } from 'vitest';
import {
	activityOf,
	availabilityStrip,
	connectionModeOf,
	editChanges,
	editValuesOf,
	filesOf,
	footerSlots,
	hasChanges,
	inventoryView,
	liveViews,
	panelActions,
	panelStatus,
	panelTabs,
	processesOf,
	shiftDay,
	sysinfoOf,
	usageChart,
	type EditValues,
	type PanelDevice
} from '../../src/lib/devices/panel-logic.ts';

/* The permissions each demo role gets from /api/console/bootstrap */
const ROLES = {
	admin: null, // super admin: everything
	operator: [
		'device.edit',
		'device.view',
		'device.connect',
		'device.connection_mode',
		'remote_target.view',
		'remote_target.connect',
		'remote_target.test',
		'guest.create',
		'cdap.view',
		'cdap.command',
		'mesh.power'
	],
	viewer: ['device.view', 'remote_target.view', 'cdap.view']
} as const;

const canFor = (role: keyof typeof ROLES) => (p: string) => {
	const perms = ROLES[role];
	return perms === null || (perms as readonly string[]).includes(p);
};

const device = (over: Partial<PanelDevice> = {}): PanelDevice => ({
	id: '900100001',
	hostname: 'demo-reception-01',
	display_name: '',
	username: 'demo.front',
	note: '',
	online: true,
	banned: false,
	soft_deleted: false,
	tags: ['office', 'ground-floor'],
	folder_id: 1,
	device_type: 'rustdesk',
	...over
});

describe('permission gates per role', () => {
	test('viewer: read-only tabs, no Actions, no Edit or Connect, no Files', () => {
		const can = canFor('viewer');
		expect(panelTabs(device(), can)).toEqual(['overview', 'hardware', 'metrics', 'live', 'tags']);
		expect(liveViews(device(), can)).not.toContain('files');
		expect(footerSlots(device(), can)).toEqual({ edit: false, editTarget: false, connect: false });
	});

	test('operator: edit and connect, but no change ID, ban or delete', () => {
		const can = canFor('operator');
		expect(panelTabs(device(), can)).toContain('actions');
		expect(liveViews(device(), can)).toContain('files');
		expect(footerSlots(device(), can)).toEqual({ edit: true, editTarget: false, connect: true });
		const a = panelActions(device(), can);
		expect(a.connect).toEqual(['connect-web', 'connect-desktop', 'cdap-viewer', 'guest-access']);
		expect(a.manage).toEqual(['edit', 'groups', 'access-policy']);
		expect(a.danger).toEqual([]);
	});

	test('admin: every action, ban turns into unban on a banned device', () => {
		const can = canFor('admin');
		const a = panelActions(device(), can);
		expect(a.manage).toEqual(['edit', 'groups', 'access-policy', 'change-id', 'ban']);
		expect(a.danger).toEqual(['delete']);
		expect(panelActions(device({ banned: true }), can).manage).toContain('unban');
	});

	test('a deleted device: no footer actions, only restore and delete for good (device.delete)', () => {
		const d = device({ soft_deleted: true });
		expect(footerSlots(d, canFor('admin'))).toEqual({ edit: false, editTarget: false, connect: false });
		expect(panelActions(d, canFor('admin')).deleted).toEqual(['restore', 'permanent-delete']);
		expect(panelTabs(d, canFor('operator'))).not.toContain('actions');
		// The server no longer answers agent requests for it
		expect(panelTabs(d, canFor('admin'))).not.toContain('live');
	});

	test('RDP/VNC target: no hardware, metrics or live data; its own edit and connect permissions', () => {
		const d = device({ id: 'rt_1', remote_target: true, device_type: 'rdp' });
		expect(panelTabs(d, canFor('admin'))).toEqual(['overview', 'tags', 'actions']);
		expect(footerSlots(d, canFor('admin'))).toEqual({ edit: false, editTarget: true, connect: true });
		expect(footerSlots(d, canFor('operator'))).toEqual({ edit: false, editTarget: false, connect: true });
		expect(panelActions(d, canFor('admin'))).toMatchObject({
			connect: ['connect-web'],
			manage: ['edit-target', 'groups'],
			danger: ['delete-target']
		});
	});

	test('support agent: no live data, no editing, its limits instead of management', () => {
		const d = device({
			telemetry: { snapshots: { identity: { data: { product_sku: 'betterdesk-support' } } } }
		} as Partial<PanelDevice>);
		const can = canFor('admin');
		expect(liveViews(d, can)).toEqual([]);
		expect(panelTabs(d, can)).not.toContain('live');
		expect(footerSlots(d, can).edit).toBe(false);
		const a = panelActions(d, can);
		expect(a.support).toBe(true);
		expect(a.manage).toEqual([]);
		expect(a.danger).toEqual([]);
	});

	test('MeshAgent: tools only while online, wake also offline (mesh.power)', () => {
		const online = device({ device_type: 'mesh_agent', mesh_connected: true });
		const offline = device({ device_type: 'mesh_agent', online: false, mesh_connected: false });
		expect(panelActions(online, canFor('admin')).mesh).toEqual([
			'mesh-terminal',
			'mesh-files',
			'mesh-run-command',
			'mesh-link-peer',
			'mesh-share',
			'mesh-port-tcp',
			'mesh-port-udp',
			'mesh-power-wake',
			'mesh-power-sleep',
			'mesh-power-reset',
			'mesh-power-off'
		]);
		// operator has no mesh.terminal or mesh.files
		expect(panelActions(online, canFor('operator')).mesh).not.toContain('mesh-terminal');
		expect(panelActions(offline, canFor('operator')).mesh).toEqual(['mesh-power-wake']);
		expect(panelActions(offline, canFor('viewer')).mesh).toEqual([]);
	});

	test('connection mode: shown only where it can switch; the form needs device.connection_mode', () => {
		const plain = device({ connection_mode: { controllable: false, can_change: true } });
		expect(connectionModeOf(plain, canFor('admin')).shown).toBe(false);
		const ctl = device({ connection_mode: { controllable: true, can_change: true } });
		expect(connectionModeOf(ctl, canFor('operator')).canChange).toBe(true);
		expect(connectionModeOf(ctl, canFor('viewer')).canChange).toBe(false);
		expect(connectionModeOf({ ...ctl, banned: true }, canFor('admin')).canChange).toBe(false);
	});
});

describe('status', () => {
	test('deleted and banned win; online shows the tier', () => {
		expect(panelStatus(device({ soft_deleted: true, banned: true })).key).toBe('devices.deleted_badge');
		expect(panelStatus(device({ banned: true })).tone).toBe('danger');
		expect(panelStatus(device({ status_tier: 'DEGRADED' })).tone).toBe('warning');
		expect(panelStatus(device({ online: false, no_signal: true })).titleKey).toBe(
			'devices.no_signal_tooltip'
		);
		expect(panelStatus(device({ online: false })).key).toBe('status.offline');
	});
});

describe('edit: only what changed is sent', () => {
	const before: EditValues = editValuesOf(device({ display_name: 'Front desk', note: 'n', folder_id: 1 }));

	test('nothing changed: no call at all', () => {
		const c = editChanges(before, { ...before, display_name: ' Front desk ' });
		expect(hasChanges(c)).toBe(false);
	});

	test('one text field: only that field', () => {
		const c = editChanges(before, { ...before, user: 'someone' });
		expect(c.fields).toEqual({ user: 'someone' });
		expect(c.tags).toBeNull();
		expect(c.folderId).toBeUndefined();
	});

	test('tags: a reorder is no change; a typed tag counts as added unless it is there already', () => {
		expect(editChanges(before, { ...before, tags: ['ground-floor', 'office'] }).tags).toBeNull();
		expect(editChanges(before, { ...before, tagInput: ' lab ' }).tags).toEqual([
			'office',
			'ground-floor',
			'lab'
		]);
		expect(editChanges(before, { ...before, tagInput: 'OFFICE' }).tags).toBeNull();
	});

	test('folder: to none is null, unchanged is left out', () => {
		expect(editChanges(before, { ...before, folder: '' }).folderId).toBeNull();
		expect(editChanges(before, { ...before, folder: '3' }).folderId).toBe(3);
		expect('folderId' in editChanges(before, before)).toBe(false);
	});
});

describe('device data', () => {
	test('display sizes from the client are numbers or nothing', () => {
		const s = sysinfoOf(
			device({
				sysinfo: { displays_json: JSON.stringify([{ name: 'A', width: '<b>1920</b>', height: 1080 }]) }
			} as Partial<PanelDevice>)
		);
		expect(s?.displays[0]).toEqual({ name: 'A', width: null, height: 1080 });
	});

	test('inventory report: sizes, cores and programs sorted by name', () => {
		const r = inventoryView({
			hardware: {
				cpu: { brand: 'i5', logical_cores: 8, physical_cores: 4 },
				disks: [{ mount_point: 'C:\\', device: 'C:', total_gb: 100, used_gb: 50 }],
				memory: { total_bytes: 1024, used_bytes: 512 }
			},
			software: { apps: [{ name: 'Zed' }, { name: 'Atom', version: '1' }] }
		});
		expect(r.cores).toBe(8);
		expect(r.physicalCores).toBe(4);
		expect(r.disks[0]).toMatchObject({
			name: 'C:\\',
			device: 'C:',
			total: 100 * 1024 ** 3,
			used: 50 * 1024 ** 3
		});
		expect(r.apps.map((a) => a.name)).toEqual(['Atom', 'Zed']);
	});

	test('processes busiest first, activity shares of the busiest', () => {
		expect(
			processesOf({
				processes: [
					{ pid: 1, cpu: 1 },
					{ pid: 2, cpu: 9 }
				]
			}).map((p) => p.pid)
		).toEqual([2, 1]);
		expect(
			activityOf([
				{ name: 'a', seconds: 50 },
				{ name: 'b', seconds: 100 }
			]).map((a) => a.share)
		).toEqual([100, 50]);
		expect(filesOf({ entries: [{ name: 'x', is_dir: true }] }, '/').entries[0]?.dir).toBe(true);
	});

	test('availability: before the first change the device was in its "from" state', () => {
		const day = '2026-11-09';
		const start = new Date(2026, 10, 9).getTime();
		const at = new Date(2026, 10, 9, 6).toISOString();
		const strip = availabilityStrip(
			day,
			[{ from_status: 'OFFLINE', to_status: 'ONLINE', source: '', created_at: at }],
			start + 12 * 3600e3,
			'ONLINE'
		);
		expect(strip?.spans.map((s) => s.status)).toEqual(['OFFLINE', 'ONLINE']);
		expect(strip?.totals.OFFLINE).toBe(6 * 3600e3);
		expect(strip?.totals.ONLINE).toBe(6 * 3600e3);
		expect(availabilityStrip(shiftDay(day, 1), [], start, 'ONLINE')).toBeNull();
	});

	test('usage: a long pause breaks the lines', () => {
		const t0 = Date.UTC(2026, 10, 9, 0);
		const c = usageChart([0, 1, 2, 30].map((m) => ({ t: t0 + m * 60_000, cpu: 1, memory: 2, disk: 3 })));
		expect(c.times.filter((x) => x === null)).toHaveLength(1);
		expect(c.cpu).toHaveLength(5);
	});
});
