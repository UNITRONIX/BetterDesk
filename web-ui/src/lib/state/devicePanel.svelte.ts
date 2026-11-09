/**
 * The device panel: one panel for a device, opened from anywhere (device
 * list, inventory, registrations, help requests, tickets, chat, fleet).
 * The shell mounts it once. Pages call openDevice(id); the panel loads the
 * device itself.
 *
 * On /devices the open device is also in the URL (?open=<id>), so a link
 * or a bookmark opens it and Back closes it; elsewhere the URL stays.
 */

export type PanelMode = 'view' | 'edit';

class DevicePanel {
	/** The open device's ID, or null */
	id = $state<string | null>(null);
	mode = $state<PanelMode>('view');
	/** Bumped when something outside changed the device (e.g. a list action), so the panel reloads */
	revision = $state(0);
	/** Element to give focus back to when the panel closes */
	opener: HTMLElement | null = null;
}

export const devicePanel = new DevicePanel();

export function openDevice(id: string, opts: { mode?: PanelMode; opener?: HTMLElement | null } = {}): void {
	devicePanel.opener =
		opts.opener ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
	devicePanel.mode = opts.mode ?? 'view';
	devicePanel.id = id;
}

export function closeDevice(): void {
	devicePanel.id = null;
	devicePanel.mode = 'view';
	const el = devicePanel.opener;
	devicePanel.opener = null;
	if (el?.isConnected) el.focus();
}

/** Tell an open panel to reload (after a change made elsewhere) */
export function refreshDevice(id?: string): void {
	if (!id || devicePanel.id === id) devicePanel.revision++;
}
