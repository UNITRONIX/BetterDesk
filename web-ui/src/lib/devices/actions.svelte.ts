/**
 * Device actions, shared by the device list and the device panel.
 *
 * One function per action. Each one checks the permission the old console
 * checked (an action the role can't do returns false without asking or
 * calling anything), asks what it has to ask (confirm/prompt, or a device
 * dialog through ask()), calls the API, says what happened (toast, or the
 * sheet's status line while a sheet is open), and tells the list and the
 * open panel to reload (deviceChanges.revision, refreshDevice). Every action
 * resolves true when it was done and false when it was cancelled, not
 * allowed or failed. Errors never throw out of an action.
 *
 * Pass a device from the list or the panel (anything with `id`; the other
 * fields decide what applies: soft_deleted, banned, online, remote_target,
 * device_type, mesh_connected, linked_peer_id, tags, folder_id).
 *
 * Opening and connecting
 *   connectInBrowser(d)          web viewer: reuses an open viewer tab, asks first on a phone
 *                                (device.connect; RDP/VNC targets remote_target.connect)
 *   connectInApp(d)              rustdesk://<id> (device.connect)
 *   openSnapshotViewer(d)        CDAP snapshot viewer in a new tab (device.connect)
 *   createGuestLink(devices)     time-limited link without sign-in (guest.create)
 *   showDetails(d)               opens the device panel
 *   editDevice(d)                opens the device panel in edit mode (device.edit)
 *
 * Changing a device (device.edit)
 *   rename(d)                    prompt for the display name
 *   editNote(d)                  prompt for the note;  saveNote(d, note) without a dialog
 *   (the panel's edit form saves with saveEdit in panel-actions.svelte.ts)
 *   setTags(d, tags)             replace the tags;  addTag(d, tag), removeTag(d, tag)
 *   tagDevices(devices)          dialog: add tags to and take tags off one or more devices
 *   moveToFolder(devices, id)    folder id, or null/0 for no folder (no dialog)
 *   chooseFolder(devices)        dialog to pick the folder, then moveToFolder
 *   manageGroups(d)              dialog: the device's manual groups
 *   editAccessPolicy(d)          sheet: unattended access, password, schedule, operators
 *   setConnectionMode(d, mode, reason)   (device.connection_mode)
 *
 * Ban, delete, ID
 *   ban(d), unban(d), toggleBan(d)       (device.ban) ban asks for a reason
 *   deleteDevice(d)              dialog with a 3 s countdown, release-ID and revoke options;
 *                                a deleted device is deleted for good instead (device.delete)
 *   deleteDevices(devices)       several at once, soft delete (device.delete)
 *   restoreDevice(d), permanentDelete(d) (device.delete)
 *   changeId(d)                  warns when online, then asks for the new ID (device.change_id);
 *                                resolves the new ID, or null
 *
 * RDP/VNC targets
 *   addRemoteTarget(), editRemoteTarget(d)   sheet (remote_target.edit, test: remote_target.test)
 *   deleteRemoteTarget(d)        (remote_target.delete)
 *
 * MeshAgent devices
 *   openMeshTerminal(d)          wide sheet with a shell (mesh.terminal)
 *   openMeshFiles(d)             file browser in the viewer (mesh.files and device.connect)
 *   runMeshCommand(d)            (device.connect)    linkMeshPeer(d) (cdap.command)
 *   meshShareLink(d)             view-only desktop link (device.connect)
 *   openPortRelay(d, udp)        TCP or UDP relay sheet (device.connect)
 *   meshPower(d, action)         wake, sleep, reset, off (mesh.power)
 *
 * The row menu
 *   deviceMenu(d)                the menu items this user gets for this device, in groups,
 *                                each { id, label, icon, danger?, run }; the list's row menu
 *                                and right-click menu render it.
 *
 * Also: may.<action>(d) (the permission checks on their own, for showing a
 * button), devicesChanged(...ids) and deviceChanges.revision (what an
 * action calls after a change; the list reloads on it).
 */

import * as devicesApi from '#lib/api/devices.ts';
import * as targetsApi from '#lib/api/remoteTargets.ts';
import * as meshApi from '#lib/api/mesh.ts';
import * as guestApi from '#lib/api/guest.ts';
import type { RemoteTargetInput } from '#lib/api/remoteTargets.ts';
import { t, tf } from '#lib/i18n/i18n.svelte.ts';
import { can } from '#lib/state/session.svelte.ts';
import { closeDevice, devicePanel, openDevice, refreshDevice } from '#lib/state/devicePanel.svelte.ts';
import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
import { toast } from '#lib/ui/toasts.svelte.ts';
import { ICONS } from '#lib/util/display.ts';
import { ask } from './ask.svelte.ts';
import { deviceLabel, deviceName, isMesh, type DeviceLike } from './model.ts';

export type { DeviceLike } from './model.ts';

/* ── Telling the list and the panel ── */

class DeviceChanges {
	/** Bumped after every change; the device list reloads when it changes */
	revision = $state(0);
}

export const deviceChanges = new DeviceChanges();

/** Something changed: the list reloads, and the panel if it shows one of these devices */
export function devicesChanged(...ids: string[]): void {
	deviceChanges.revision++;
	if (ids.length === 0) refreshDevice();
	for (const id of ids) refreshDevice(id);
}

function fail(err: unknown, fallbackKey: string): false {
	const msg = err instanceof Error && err.message ? err.message : t(fallbackKey);
	toast.error(msg);
	return false;
}

/** The panel shows a device that is gone now: close it */
function closeIfOpen(id: string) {
	if (devicePanel.id === id) closeDevice();
}

const ids = (devices: readonly DeviceLike[]) => devices.map((d) => d.id);

/* ── Who may do what (the same checks as the old page) ── */

export const may = {
	connect: (d: DeviceLike) =>
		!d.soft_deleted && (d.remote_target ? can('remote_target.connect') : can('device.connect')),
	connectApp: (d: DeviceLike) => !d.soft_deleted && !d.remote_target && can('device.connect'),
	guestLink: (d: DeviceLike) => !d.soft_deleted && !d.remote_target && can('guest.create'),
	edit: (d: DeviceLike) => !d.soft_deleted && can('device.edit'),
	editTarget: (d: DeviceLike) => !!d.remote_target && can('remote_target.edit'),
	deleteTarget: (d: DeviceLike) => !!d.remote_target && can('remote_target.delete'),
	ban: (d: DeviceLike) => !d.soft_deleted && !d.remote_target && can('device.ban'),
	delete: (d: DeviceLike) => !d.remote_target && can('device.delete'),
	changeId: (d: DeviceLike) => !d.soft_deleted && !d.remote_target && can('device.change_id'),
	connectionMode: (d: DeviceLike) => !d.soft_deleted && !d.banned && can('device.connection_mode')
};

/* ── Opening and connecting ── */

function isPhone(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	if (window.innerWidth > 767) return false;
	return !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function openViewer(id: string) {
	window.open(`/remote/${encodeURIComponent(id)}`, '_blank');
}

/**
 * The web viewer. An RDClient tab that is already open gets the device as a
 * new session (BroadcastChannel 'betterdesk-remote', 300 ms to answer);
 * otherwise a new tab opens. A phone asks first: the viewer needs a wider
 * screen, so it offers the RustDesk app instead.
 */
export async function connectInBrowser(d: DeviceLike): Promise<boolean> {
	if (!may.connect(d)) return false;
	if (isPhone()) {
		const choice = await ask('connect-choice', { device: d, app: !d.remote_target });
		if (choice === 'app') window.location.href = 'rustdesk://' + encodeURIComponent(d.id);
		else if (choice === 'web') openViewer(d.id);
		return choice !== null;
	}
	if (typeof BroadcastChannel === 'undefined') {
		openViewer(d.id);
		return true;
	}
	const bc = new BroadcastChannel('betterdesk-remote');
	let handled = false;
	bc.onmessage = (ev: MessageEvent) => {
		const type = (ev.data as { type?: string } | null)?.type;
		if (type === 'pong') {
			handled = true;
			bc.postMessage({ type: 'add-session', deviceId: d.id, deviceName: deviceName(d) });
			bc.close();
		} else if (type === 'session-added') {
			handled = true;
			bc.close();
		}
	};
	bc.postMessage({ type: 'ping' });
	setTimeout(() => {
		if (handled) return;
		bc.close();
		openViewer(d.id);
	}, 300);
	return true;
}

/** Hand the ID to the RustDesk desktop app */
export function connectInApp(d: DeviceLike): boolean {
	if (!may.connectApp(d)) return false;
	window.open('rustdesk://' + encodeURIComponent(d.id), '_blank');
	return true;
}

/** The CDAP snapshot viewer (screenshots instead of a stream) */
export function openSnapshotViewer(d: DeviceLike): boolean {
	if (!may.connectApp(d)) return false;
	window.open(`/remote/${encodeURIComponent(d.id)}?transport=cdap`, '_blank');
	return true;
}

/** A link to the web viewer for these devices that works without a console account, for a limited time */
export async function createGuestLink(devices: readonly DeviceLike[]): Promise<boolean> {
	const list = devices.filter(may.guestLink);
	if (!list.length) return false;
	const done = await ask('guest-link', {
		ids: ids(list),
		create: async (input) => {
			const out = await guestApi.createGuestLink(input);
			toast.success(tf('guest_access.created', 'Guest link created'));
			return out;
		}
	});
	return done === true;
}

export function showDetails(d: DeviceLike): void {
	openDevice(d.id);
}

/** The device panel in edit mode (name, note, folder, tags) */
export function editDevice(d: DeviceLike): boolean {
	if (!may.edit(d) || d.remote_target) return false;
	openDevice(d.id, { mode: 'edit' });
	return true;
}

/* ── Changing a device ── */

export async function rename(d: DeviceLike): Promise<boolean> {
	if (!may.edit(d)) return false;
	const name = await prompt({
		title: t('devices.display_name'),
		label: t('devices.display_name'),
		hint: t('devices.display_name_hint'),
		value: d.display_name ?? '',
		confirmLabel: t('actions.save')
	});
	if (name === null) return false;
	try {
		await devicesApi.updateDevice(d.id, { display_name: name.trim() });
		toast.success(t('common.saved'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
}

export async function saveNote(d: DeviceLike, note: string): Promise<boolean> {
	if (!may.edit(d)) return false;
	try {
		await devicesApi.updateDevice(d.id, { note: note.trim() });
		toast.success(t('common.saved'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
}

export async function editNote(d: DeviceLike): Promise<boolean> {
	if (!may.edit(d)) return false;
	const note = await prompt({
		title: t('devices.note'),
		label: t('devices.note'),
		value: d.note ?? '',
		confirmLabel: t('actions.save')
	});
	if (note === null) return false;
	return saveNote(d, note);
}

export async function setTags(d: DeviceLike, tags: string[]): Promise<boolean> {
	if (!may.edit(d)) return false;
	try {
		await devicesApi.setDeviceTags(d.id, tags);
		toast.success(t('common.saved'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
}

export function addTag(d: DeviceLike, tag: string): Promise<boolean> {
	const clean = tag.trim();
	const have = d.tags ?? [];
	if (!clean) return Promise.resolve(false);
	if (have.some((x) => x.toLowerCase() === clean.toLowerCase())) {
		toast.warning(t('device_detail.tag_exists'));
		return Promise.resolve(false);
	}
	return setTags(d, [...have, clean]);
}

export function removeTag(d: DeviceLike, tag: string): Promise<boolean> {
	return setTags(
		d,
		(d.tags ?? []).filter((x) => x !== tag)
	);
}

/** Tags with the added ones (no duplicates, case-insensitive) and without the removed ones */
export function changedTags(
	have: readonly string[],
	add: readonly string[],
	remove: readonly string[]
): string[] {
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup, not state
	const gone = new Set(remove.map((x) => x.toLowerCase()));
	const out = have.filter((x) => !gone.has(x.toLowerCase()));
	for (const tag of add) {
		const clean = tag.trim();
		if (clean && !out.some((x) => x.toLowerCase() === clean.toLowerCase())) out.push(clean);
	}
	return out;
}

/** Add tags to and take tags off one or more devices (one request per device that changes) */
export async function tagDevices(
	devices: readonly DeviceLike[],
	known: readonly string[] = []
): Promise<boolean> {
	const list = devices.filter(may.edit);
	if (!list.length) return false;
	const answer = await ask('tags', { devices: list, known: [...known] });
	if (!answer) return false;
	const changes = list
		.map((d) => ({ d, next: changedTags(d.tags ?? [], answer.add, answer.remove) }))
		.filter(({ d, next }) => next.join('\n') !== (d.tags ?? []).join('\n'));
	if (!changes.length) return false;
	const results = await Promise.allSettled(
		changes.map(({ d, next }) => devicesApi.setDeviceTags(d.id, next))
	);
	const failed = results.filter((r) => r.status === 'rejected');
	devicesChanged(...changes.map((c) => c.d.id));
	if (failed.length) {
		const first = failed[0] as PromiseRejectedResult;
		return fail(first.reason, 'errors.server_error');
	}
	toast.success(
		changes.length === 1
			? t('common.saved')
			: tf('devices.bulk_tags_saved', 'Tags changed on {count} devices.', { count: changes.length })
	);
	return true;
}

/** Folder id, or null/0 for no folder. One device uses its own call (it checks the device exists). */
export async function moveToFolder(
	devices: readonly DeviceLike[],
	folderId: number | null
): Promise<boolean> {
	const list = devices.filter(may.edit);
	if (!list.length) return false;
	const target = folderId ? Number(folderId) : null;
	try {
		if (list.length === 1) {
			await devicesApi.setDeviceFolder((list[0] as DeviceLike).id, target);
			toast.success(t('folders.device_assigned'));
		} else {
			await devicesApi.moveToFolder(target ?? 0, ids(list));
			toast.success(t('folders.devices_moved'));
		}
		devicesChanged(...ids(list));
		return true;
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
}

/** Ask which folder, then move */
export async function chooseFolder(devices: readonly DeviceLike[]): Promise<boolean> {
	const list = devices.filter(may.edit);
	if (!list.length) return false;
	let folders: devicesApi.Folder[];
	try {
		folders = await devicesApi.listFolders();
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
	const first = list[0] as DeviceLike;
	const current = list.every((d) => (d.folder_id ?? null) === (first.folder_id ?? null))
		? (first.folder_id ?? null)
		: null;
	const picked = await ask('move-folder', { count: list.length, folders, current });
	if (picked === null) return false;
	return moveToFolder(list, picked || null);
}

/** The device's manual groups (a device is in at most one; tag groups only show) */
export async function manageGroups(d: DeviceLike): Promise<boolean> {
	if (!may.edit(d) && !(d.remote_target && can('device.edit'))) return false;
	const done = await ask('memberships', {
		device: d,
		load: async () => {
			const r = await devicesApi.getDeviceMemberships(d.id);
			// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local lookup, not state
			const member = new Set(r.memberships.map((g) => g.guid ?? ''));
			const isTag = (g: devicesApi.DeviceGroup) => (g.source_type || 'manual') === 'tag';
			const groups = r.groups.filter((g) => !!g.guid);
			return {
				manual: groups.filter((g) => !isTag(g)),
				dynamic: groups.filter((g) => isTag(g) && member.has(g.guid ?? '')),
				selected: groups.filter((g) => !isTag(g) && member.has(g.guid ?? '')).map((g) => g.guid ?? '')
			};
		},
		save: async (guids) => {
			await devicesApi.setDeviceGroups(d.id, guids);
			toast.success(t('devices.groups_saved'));
			devicesChanged(d.id);
		}
	});
	return done === true;
}

export async function editAccessPolicy(d: DeviceLike): Promise<boolean> {
	if (!may.edit(d) || d.remote_target) return false;
	const done = await ask('access-policy', {
		device: d,
		load: () => devicesApi.getAccessPolicy(d.id),
		save: async (input) => {
			// A password typed before "Clear password" was ticked is not sent
			await devicesApi.saveAccessPolicy(d.id, input.clear_password ? { ...input, password: '' } : input);
			toast.success(t('devices.access_policy_saved'));
			devicesChanged(d.id);
		}
	});
	return done === true;
}

/** Normal or incoming-only; the reason is required (it goes into the audit log) */
export async function setConnectionMode(
	d: DeviceLike,
	mode: devicesApi.ConnectionMode,
	reason: string
): Promise<boolean> {
	if (!may.connectionMode(d)) return false;
	if (!reason.trim()) {
		toast.error(t('device_detail.connection_mode_reason'));
		return false;
	}
	try {
		await devicesApi.setConnectionMode(d.id, mode, reason.trim());
		toast.success(t('device_detail.connection_mode_saved'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'device_detail.connection_mode_failed');
	}
}

/* ── Ban, delete, ID ── */

export async function ban(d: DeviceLike): Promise<boolean> {
	if (!may.ban(d) || d.banned) return false;
	const reason = await ask('ban', { device: d });
	if (reason === null) return false;
	try {
		await devicesApi.banDevice(d.id, reason.trim());
		toast.success(t('devices.ban_success'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.ban_failed');
	}
}

export async function unban(d: DeviceLike): Promise<boolean> {
	if (!may.ban(d) || !d.banned) return false;
	const ok = await confirm({
		title: t('devices.unban_title'),
		message: t('devices.unban_effect', { device: deviceLabel(d) }),
		confirmLabel: t('actions.unban'),
		confirmIcon: ICONS.unban
	});
	if (!ok) return false;
	try {
		await devicesApi.unbanDevice(d.id);
		toast.success(t('devices.unban_success'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.unban_failed');
	}
}

export function toggleBan(d: DeviceLike): Promise<boolean> {
	return d.banned ? unban(d) : ban(d);
}

/**
 * Delete one device. A device that is already deleted is deleted for good
 * (it only shows with Show deleted on). The dialog unlocks Delete after
 * 3 seconds and offers releasing the ID (hard) and revoking the device.
 */
export async function deleteDevice(d: DeviceLike): Promise<boolean> {
	if (!may.delete(d)) return false;
	if (d.soft_deleted) return permanentDelete(d);
	const choice = await ask('delete', { device: d });
	if (!choice) return false;
	try {
		await devicesApi.deleteDevice(d.id, { hard: choice.hard, revoke: choice.revoke });
		toast.success(
			choice.hard
				? t('devices.permanent_delete_success')
				: choice.revoke
					? t('devices.revoke_success')
					: t('devices.delete_soft_success_hint')
		);
		closeIfOpen(d.id);
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.delete_failed');
	}
}

/** Soft-delete several devices (they can be restored with Show deleted on) */
export async function deleteDevices(devices: readonly DeviceLike[]): Promise<boolean> {
	const list = devices.filter((d) => may.delete(d) && !d.soft_deleted);
	if (!list.length) return false;
	if (list.length === 1) return deleteDevice(list[0] as DeviceLike);
	const count = list.length;
	const ok = await confirm({
		title: t('devices.bulk_delete_title'),
		message: t('devices.bulk_delete_confirm', { count }),
		confirmLabel: t('actions.delete'),
		confirmIcon: ICONS.delete,
		danger: true
	});
	if (!ok) return false;
	try {
		await devicesApi.bulkDelete(ids(list));
		toast.success(t('devices.bulk_delete_success', { count }));
		for (const d of list) closeIfOpen(d.id);
		devicesChanged(...ids(list));
		return true;
	} catch (err) {
		return fail(err, 'errors.bulk_delete_failed');
	}
}

export async function restoreDevice(d: DeviceLike): Promise<boolean> {
	if (!may.delete(d) || !d.soft_deleted) return false;
	const ok = await confirm({
		title: t('devices.restore_title'),
		message: t('devices.restore_confirm', { id: d.id }),
		confirmLabel: t('devices.restore_action'),
		confirmIcon: ICONS.restore
	});
	if (!ok) return false;
	try {
		await devicesApi.restoreDevice(d.id);
		toast.success(t('devices.restore_success'));
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'devices.restore_failed');
	}
}

export async function permanentDelete(d: DeviceLike): Promise<boolean> {
	if (!may.delete(d)) return false;
	const ok = await confirm({
		title: t('devices.permanent_delete_title'),
		message: t('devices.permanent_delete_confirm', { id: d.id }),
		confirmLabel: t('actions.delete'),
		confirmIcon: ICONS.delete_forever,
		danger: true
	});
	if (!ok) return false;
	try {
		await devicesApi.deleteDevice(d.id, { hard: true });
		toast.success(t('devices.permanent_delete_success'));
		closeIfOpen(d.id);
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.delete_failed');
	}
}

/** 6 to 16 letters, digits, - or _ */
export function idProblem(newId: string): string | null {
	if (newId.length < 6 || newId.length > 16) return t('devices.id_length_error');
	if (!/^[A-Z0-9_-]+$/i.test(newId)) return t('devices.id_format_error');
	return null;
}

export async function changeId(d: DeviceLike): Promise<string | null> {
	if (!may.changeId(d)) return null;
	if (d.online) {
		const proceed = await confirm({
			title: t('devices.change_id_title'),
			message: t('devices.change_id_online_warn'),
			confirmLabel: t('devices.change_id')
		});
		if (!proceed) return null;
	}
	const answer = await prompt({
		title: t('devices.change_id_title'),
		label: t('devices.new_id'),
		placeholder: 'NEWID123',
		hint: t('devices.change_id_hint'),
		confirmLabel: t('devices.change_id')
	});
	const newId = (answer ?? '').trim();
	if (!newId) return null;
	const problem = idProblem(newId);
	if (problem) {
		toast.error(problem);
		return null;
	}
	try {
		await devicesApi.changeDeviceId(d.id, newId);
		toast.success(t('devices.change_id_success'));
		closeIfOpen(d.id);
		devicesChanged(d.id);
		return newId;
	} catch (err) {
		fail(err, 'errors.change_id_failed');
		return null;
	}
}

/* ── RDP/VNC targets ── */

function remoteTargetSheet(d: DeviceLike | null): Promise<boolean> {
	// A target created by an attempt whose password step failed is updated, not created twice
	let createdId = '';
	return ask('remote-target', {
		device: d,
		canTest: can('remote_target.test'),
		save: async (input: RemoteTargetInput, password: string) => {
			const before = d?.id || createdId;
			let id = before;
			if (before) await targetsApi.updateRemoteTarget(before, input);
			else {
				const out = await targetsApi.createRemoteTarget(input);
				id = out.id;
				createdId = id;
			}
			try {
				if (input.credential_mode === 'saved' && password) {
					await targetsApi.saveRemoteTargetPassword(id, input.username, password);
				} else if (input.credential_mode !== 'saved' && d?.credential_mode === 'saved') {
					await targetsApi.deleteRemoteTargetPassword(id);
				}
			} catch (err) {
				// The target itself is saved: show it in the list, keep the sheet open to try again
				devicesChanged();
				throw new Error(
					tf('devices.remote_password_not_saved', 'The target is saved, but the password is not: {error}', {
						error: err instanceof Error ? err.message : t('errors.server_error')
					}),
					{ cause: err }
				);
			}
			toast.success(tf('devices.remote_saved', 'RDP/VNC target saved.'));
			devicesChanged(...(id ? [id] : []));
		},
		test: async (input) => {
			const where = { host: input.host, port: input.port };
			try {
				await targetsApi.testRemoteTarget(input.name ? input : { ...input, name: input.host });
				return tf('devices.remote_test_success', 'Reached {host} on port {port}.', where);
			} catch (err) {
				const message = err instanceof Error ? err.message : '';
				if (/not allowed/i.test(message))
					throw new Error(
						tf('devices.remote_test_not_allowed', 'This server is not allowed to connect to that address.'),
						{ cause: err }
					);
				if (!message || /unreachable|timeout/i.test(message))
					throw new Error(tf('devices.remote_test_failed', 'Could not reach {host} on port {port}.', where), {
						cause: err
					});
				throw err;
			}
		}
	}).then((r) => r === true);
}

export function addRemoteTarget(): Promise<boolean> {
	if (!can('remote_target.edit')) return Promise.resolve(false);
	return remoteTargetSheet(null);
}

export function editRemoteTarget(d: DeviceLike): Promise<boolean> {
	if (!may.editTarget(d)) return Promise.resolve(false);
	return remoteTargetSheet(d);
}

export async function deleteRemoteTarget(d: DeviceLike): Promise<boolean> {
	if (!may.deleteTarget(d)) return false;
	const ok = await confirm({
		title: tf('devices.remote_delete_title', 'Delete remote target'),
		message: tf('devices.remote_delete_confirm', 'Delete this RDP/VNC target?'),
		confirmLabel: t('actions.delete'),
		confirmIcon: ICONS.delete,
		danger: true
	});
	if (!ok) return false;
	try {
		await targetsApi.deleteRemoteTarget(d.id);
		toast.success(t('devices.delete_success'));
		closeIfOpen(d.id);
		devicesChanged(d.id);
		return true;
	} catch (err) {
		return fail(err, 'errors.delete_failed');
	}
}

/* ── MeshAgent devices ── */

export function meshOnline(d: DeviceLike): boolean {
	return isMesh(d) && !!(d.mesh_connected || d.online);
}

export async function openMeshTerminal(d: DeviceLike): Promise<boolean> {
	if (!meshOnline(d) || !can('mesh.terminal')) return false;
	await ask('mesh-terminal', { device: d });
	return true;
}

export function openMeshFiles(d: DeviceLike): boolean {
	if (!meshOnline(d) || !can('mesh.files') || !can('device.connect')) return false;
	window.open(`/remote/${encodeURIComponent(d.id)}?transport=mesh&panel=files`, '_blank');
	return true;
}

export async function runMeshCommand(d: DeviceLike): Promise<boolean> {
	if (!meshOnline(d) || !can('device.connect')) return false;
	const done = await ask('mesh-command', {
		device: d,
		run: async (command, shell) => {
			await meshApi.meshExec(d.id, command.trim(), shell);
			toast.success(tf('mesh.command_sent', 'Command sent'));
		}
	});
	return done === true;
}

export async function linkMeshPeer(d: DeviceLike): Promise<boolean> {
	if (!meshOnline(d) || !can('cdap.command')) return false;
	const done = await ask('link-peer', {
		device: d,
		save: async (peerId) => {
			await meshApi.linkMeshPeer(d.id, peerId.trim());
			toast.success(tf('mesh.link_saved', 'Link updated'));
			devicesChanged(d.id);
		}
	});
	return done === true;
}

export async function meshShareLink(d: DeviceLike): Promise<boolean> {
	if (!meshOnline(d) || !can('device.connect')) return false;
	const done = await ask('mesh-share', {
		device: d,
		create: async (ttl) => {
			const url = await meshApi.meshShareLink(d.id, ttl);
			toast.success(tf('mesh.share_created', 'Link created'));
			return url;
		}
	});
	return done === true;
}

export async function openPortRelay(d: DeviceLike, udp: boolean): Promise<boolean> {
	if (!meshOnline(d) || !can('device.connect')) return false;
	await ask('port-relay', { device: d, udp });
	return true;
}

const POWER_KEYS: Record<meshApi.MeshPowerAction, [string, string]> = {
	wake: ['mesh.power_wake', 'Wake'],
	sleep: ['mesh.power_sleep', 'Sleep'],
	reset: ['mesh.power_reset', 'Reset'],
	off: ['mesh.power_off', 'Power off']
};
const POWER_ICONS: Record<meshApi.MeshPowerAction, string> = {
	wake: ICONS.power_on,
	sleep: ICONS.sleep,
	reset: ICONS.restart,
	off: ICONS.power_off
};

/** Wake works while the agent is offline (it wakes the computer); the others need it online */
export async function meshPower(d: DeviceLike, action: meshApi.MeshPowerAction): Promise<boolean> {
	if (!isMesh(d) || !can('mesh.power') || (action !== 'wake' && !meshOnline(d))) return false;
	const label = tf(...POWER_KEYS[action]);
	const ok = await confirm({
		title: `${tf('mesh.power_confirm', 'Send power action')}: ${label}?`,
		message: tf(
			'mesh.power_confirm_message',
			'The device {id} gets the command "{action}" through its MeshAgent.',
			{
				id: d.id,
				action: label
			}
		),
		confirmLabel: label,
		confirmIcon: POWER_ICONS[action],
		danger: action !== 'wake'
	});
	if (!ok) return false;
	try {
		await meshApi.meshPower(d.id, action);
		toast.success(tf('mesh.power_sent', 'Power command sent'));
		return true;
	} catch (err) {
		return fail(err, 'errors.server_error');
	}
}

/* ── The row menu ── */

export interface MenuEntry {
	/** Stable id (tests and CSS hooks); the old page's data-action */
	id: string;
	label: string;
	/** Material Symbols name (from ICONS) */
	icon: string;
	danger?: boolean;
	run: () => unknown;
}

/**
 * The row menu for one device, in groups (a divider between groups, empty
 * groups left out). Same items, order and checks as the old page: connect
 * and mesh items, the viewers, then details and changes, then delete.
 * Move to folder is new here (device.edit); the old list had only dragging.
 */
export function deviceMenu(d: DeviceLike, opts: { knownTags?: readonly string[] } = {}): MenuEntry[][] {
	const item = (id: string, label: string, icon: string, run: () => unknown, danger = false): MenuEntry => ({
		id,
		label,
		icon,
		run,
		danger
	});
	const details = item('details', t('actions.details'), ICONS.details, () => showDetails(d));
	const tagsItem = item('manage-tags', t('devices.manage_device_tags'), ICONS.tags, () =>
		tagDevices([d], opts.knownTags)
	);
	const groupsItem = item('groups', t('devices.manage_groups'), ICONS.groups, () => manageGroups(d));

	if (d.remote_target) {
		const connect = may.connect(d)
			? [item('web-remote', t('actions.web_remote'), ICONS.connect, () => connectInBrowser(d))]
			: [];
		const manage = [details];
		if (may.editTarget(d))
			manage.push(item('edit', t('actions.edit'), ICONS.edit, () => editRemoteTarget(d)));
		if (can('device.edit')) manage.push(tagsItem, groupsItem);
		const danger = may.deleteTarget(d)
			? [item('delete', t('actions.delete'), ICONS.delete, () => deleteRemoteTarget(d), true)]
			: [];
		return [connect, manage, danger].filter((g) => g.length);
	}

	if (d.soft_deleted) {
		const restore = can('device.delete')
			? [
					item('restore', t('devices.restore_action'), ICONS.restore, () => restoreDevice(d)),
					item(
						'permanent-delete',
						t('devices.permanent_delete_title'),
						ICONS.delete_forever,
						() => permanentDelete(d),
						true
					)
				]
			: [];
		return [[details], restore].filter((g) => g.length);
	}

	const canConnect = can('device.connect');
	const mesh: MenuEntry[] = [];
	if (meshOnline(d)) {
		if (can('mesh.terminal'))
			mesh.push(
				item('mesh-terminal', tf('mesh.terminal', 'Terminal'), ICONS.terminal, () => openMeshTerminal(d))
			);
		if (can('mesh.files') && canConnect)
			mesh.push(item('mesh-files', tf('mesh.files', 'File browser'), ICONS.files, () => openMeshFiles(d)));
		if (canConnect)
			mesh.push(
				item('mesh-run-command', tf('mesh.run_command', 'Run command'), ICONS.run, () => runMeshCommand(d))
			);
		if (can('cdap.command'))
			mesh.push(item('mesh-link-peer', tf('mesh.link_peer', 'Link peer'), ICONS.link, () => linkMeshPeer(d)));
		if (canConnect) {
			mesh.push(
				item('mesh-share', tf('mesh.share_link', 'Guest desktop link'), ICONS.guest_link, () =>
					meshShareLink(d)
				)
			);
			mesh.push(
				item('mesh-port-tcp', tf('mesh.port_tcp', 'TCP port relay'), ICONS.network_port, () =>
					openPortRelay(d, false)
				)
			);
			mesh.push(
				item('mesh-port-udp', tf('mesh.port_udp', 'UDP port relay'), ICONS.network_port, () =>
					openPortRelay(d, true)
				)
			);
		}
		if (can('mesh.power')) {
			for (const a of ['wake', 'sleep', 'reset', 'off'] as const)
				mesh.push(item(`mesh-power-${a}`, tf(...POWER_KEYS[a]), POWER_ICONS[a], () => meshPower(d, a)));
		}
	} else if (isMesh(d) && can('mesh.power')) {
		mesh.push(item('mesh-power-wake', tf(...POWER_KEYS.wake), POWER_ICONS.wake, () => meshPower(d, 'wake')));
	}

	const connect: MenuEntry[] = [];
	if (canConnect)
		connect.push(item('web-remote', t('actions.web_remote'), ICONS.connect, () => connectInBrowser(d)));
	if (can('guest.create'))
		connect.push(item('guest-access', t('guest_access.menu'), ICONS.guest_link, () => createGuestLink([d])));
	const viewers: MenuEntry[] = [];
	if (canConnect) {
		viewers.push(item('cdap-viewer', t('actions.cdap_viewer'), ICONS.snapshot, () => openSnapshotViewer(d)));
		viewers.push(
			item('connect-desktop', t('actions.connect_desktop'), ICONS.connect_app, () => connectInApp(d))
		);
	}

	const manage: MenuEntry[] = [details];
	if (can('device.edit')) {
		manage.push(item('edit', t('actions.edit'), ICONS.edit, () => editDevice(d)));
		manage.push(tagsItem, groupsItem);
		manage.push(
			item('move-folder', tf('devices.move_to_folder', 'Move to folder'), ICONS.folder, () =>
				chooseFolder([d])
			)
		);
		manage.push(
			item('access-policy', t('devices.access_policy'), ICONS.access_policy, () => editAccessPolicy(d))
		);
	}
	if (can('device.change_id'))
		manage.push(item('change-id', t('devices.change_id'), ICONS.rename, () => changeId(d)));
	if (can('device.ban')) {
		manage.push(
			d.banned
				? item('toggle-ban', t('actions.unban'), ICONS.unban, () => unban(d))
				: item('toggle-ban', t('actions.ban'), ICONS.ban, () => ban(d))
		);
	}
	const danger = can('device.delete')
		? [item('delete', t('actions.delete'), ICONS.delete, () => deleteDevice(d), true)]
		: [];
	const open = mesh.length ? [[...connect, ...mesh], viewers] : [[...connect, ...viewers]];
	return [...open, manage, danger].filter((g) => g.length);
}
