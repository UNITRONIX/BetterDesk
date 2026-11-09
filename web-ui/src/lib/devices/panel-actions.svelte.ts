/**
 * Actions only the device panel has. The ones the list shares (connect,
 * ban, delete, tags, notes, groups, access policy, MeshAgent tools ...)
 * are in actions.svelte.ts; the panel calls those.
 *
 *   saveEdit(d, before, after)   the edit form in one save, sending only what changed
 *                                (device.edit; also the user field, which saveDetails lacks)
 *   refreshHardware(d)           ask the device to send its hardware details again (device.edit)
 *   controlService(d, name, action)   start or stop a service through the agent (device.edit)
 *   endProcess(d, process)       ends a process after a confirm (device.edit)
 *   downloadFile(d, path)        up to 1 MiB of a file from the agent (device.edit)
 *
 * Like actions.svelte.ts, every action checks its permission first and
 * resolves true when it was done. Results go in the panel's status line
 * (say), errors too; nothing throws out except saveEdit, whose form shows
 * the reason next to its buttons.
 */

import { ApiError } from '#lib/api/client.ts';
import * as agentApi from '#lib/api/device-agent.ts';
import * as devicesApi from '#lib/api/devices.ts';
import { t, tf } from '#lib/i18n/i18n.svelte.ts';
import { can } from '#lib/state/session.svelte.ts';
import { confirm } from '#lib/ui/dialogs.svelte.ts';
import { toast } from '#lib/ui/toasts.svelte.ts';
import { ICONS } from '#lib/util/display.ts';
import { devicesChanged } from './actions.svelte.ts';
import { say } from './panel.svelte.ts';
import {
	baseName,
	editChanges,
	hasChanges,
	type EditValues,
	type PanelDevice,
	type Process
} from './panel-logic.ts';

function failed(err: unknown, fallbackKey = 'errors.server_error'): false {
	say(err instanceof Error && err.message ? err.message : t(fallbackKey), 'error');
	return false;
}

const mayEdit = (d: PanelDevice) => !d.soft_deleted && can('device.edit');

/**
 * Save the edit form. Only what differs from `before` is sent: the changed
 * text fields in one PATCH, the tags when they changed, the folder when it
 * changed. Resolves false when nothing changed. Throws on a refused save.
 */
export async function saveEdit(d: PanelDevice, before: EditValues, after: EditValues): Promise<boolean> {
	if (!mayEdit(d) || d.remote_target) throw new ApiError(t('errors.no_permission'), 403);
	const changes = editChanges(before, after);
	if (!hasChanges(changes)) return false;
	try {
		if (Object.keys(changes.fields).length) await devicesApi.updateDevice(d.id, changes.fields);
		if (changes.tags) await devicesApi.setDeviceTags(d.id, changes.tags);
		if (changes.folderId !== undefined) await devicesApi.setDeviceFolder(d.id, changes.folderId);
	} finally {
		// A part that went through before a later one failed is saved: reload either way
		devicesChanged(d.id);
	}
	const name = (changes.fields.display_name ?? after.display_name).trim() || d.hostname || d.id;
	toast.success(t('common.saved'), name);
	return true;
}

export async function refreshHardware(d: PanelDevice): Promise<boolean> {
	if (!mayEdit(d)) return false;
	try {
		await agentApi.refreshTelemetry(d.id);
		say(t('device_detail.hardware_refresh_requested'));
		return true;
	} catch (err) {
		return failed(err);
	}
}

export async function controlService(
	d: PanelDevice,
	name: string,
	action: 'start' | 'stop'
): Promise<boolean> {
	if (!mayEdit(d) || !name) return false;
	try {
		const queued = await agentApi.sendAgentCommand(d.id, {
			command: 'service.control',
			args: { name, action }
		});
		say(queued ? t('device_detail.command_queued') : t('device_detail.service_command_done'));
		return true;
	} catch (err) {
		return failed(err);
	}
}

export async function endProcess(d: PanelDevice, p: Pick<Process, 'pid' | 'name'>): Promise<boolean> {
	if (!mayEdit(d) || p.pid === null) return false;
	const ok = await confirm({
		title: t('device_detail.process_end_title'),
		message: t('device_detail.process_end_confirm', { name: p.name || '-', pid: p.pid }),
		confirmLabel: t('device_detail.process_end'),
		confirmIcon: ICONS.stop,
		danger: true
	});
	if (!ok) return false;
	try {
		await agentApi.sendAgentCommand(d.id, { command: 'process.terminate', args: { pid: p.pid } });
		say(t('device_detail.command_sent'));
		return true;
	} catch (err) {
		return failed(err);
	}
}

/** Saves the file through a download link; the agent sends at most 1 MiB */
export async function downloadFile(d: PanelDevice, path: string): Promise<boolean> {
	if (!mayEdit(d) || !path) return false;
	try {
		const reply = await agentApi.readFile(d.id, path);
		if (reply.pending) {
			say(t('device_detail.download_requested'), 'neutral');
			return false;
		}
		const data =
			reply.data && typeof reply.data === 'object' ? (reply.data as { data?: unknown }).data : null;
		if (typeof data !== 'string' || !data) throw new Error(t('device_detail.file_empty'));
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = baseName(path);
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 0);
		say(tf('device_detail.file_downloaded', 'Downloaded {name}.', { name: baseName(path) }));
		return true;
	} catch (err) {
		return failed(err);
	}
}
