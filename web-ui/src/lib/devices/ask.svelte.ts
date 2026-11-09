/**
 * The device dialogs and sheets the actions open (ban with a reason, delete
 * with its options, the RDP/VNC target sheet, ...). Like confirm()/prompt()
 * in ui/dialogs.svelte.ts, but with device-specific content:
 *
 *   const reason = await ask('ban', { device });   // null when cancelled
 *
 * Forms that save while they are open (a sheet with a status line) get the
 * save function in their props: the action owns the API call, the dialog
 * shows a refused save in its status line and stays open; it settles with
 * true once the save went through.
 *
 * DeviceDialogs.svelte renders the requests. It mounts itself on the first
 * ask(), so the actions work on any page without the shell knowing them.
 */

import { mount } from 'svelte';
import type { AccessPolicy, AccessPolicyInput, DeviceGroup, Folder } from '#lib/api/devices.ts';
import type { RemoteTargetInput } from '#lib/api/remoteTargets.ts';
import type { GuestLinkInput } from '#lib/api/guest.ts';
import type { DeviceLike } from './model.ts';

export interface Memberships {
	/** Groups people add devices to themselves */
	manual: DeviceGroup[];
	/** Tag groups this device is in (shown, not changeable here) */
	dynamic: DeviceGroup[];
	/** GUIDs of the manual groups it is in */
	selected: string[];
}

export interface AskMap {
	/** Ban: the reason (may be empty) */
	ban: { props: { device: DeviceLike }; result: string };
	/** Delete one device: which kind of delete */
	delete: { props: { device: DeviceLike }; result: { hard: boolean; revoke: boolean } };
	/** Phone: open the web viewer anyway, or hand the ID to the RustDesk app */
	'connect-choice': { props: { device: DeviceLike; app: boolean }; result: 'web' | 'app' };
	'guest-link': {
		props: { ids: string[]; create: (input: GuestLinkInput) => Promise<{ url: string; expiresAt: string }> };
		result: true;
	};
	'mesh-share': {
		props: { device: DeviceLike; create: (ttlMinutes: number) => Promise<string> };
		result: true;
	};
	'mesh-command': {
		props: { device: DeviceLike; run: (command: string, shell: boolean) => Promise<void> };
		result: true;
	};
	'link-peer': { props: { device: DeviceLike; save: (peerId: string) => Promise<void> }; result: true };
	memberships: {
		props: { device: DeviceLike; load: () => Promise<Memberships>; save: (guids: string[]) => Promise<void> };
		result: true;
	};
	'access-policy': {
		props: {
			device: DeviceLike;
			load: () => Promise<AccessPolicy>;
			save: (input: AccessPolicyInput) => Promise<void>;
		};
		result: true;
	};
	'remote-target': {
		props: {
			/** null: a new target */
			device: DeviceLike | null;
			save: (input: RemoteTargetInput, password: string) => Promise<void>;
			test: (input: RemoteTargetInput) => Promise<string>;
			canTest: boolean;
		};
		result: true;
	};
	'mesh-terminal': { props: { device: DeviceLike }; result: true };
	'port-relay': { props: { device: DeviceLike; udp: boolean }; result: true };
	/** Pick a folder: its id, or 0 for no folder */
	'move-folder': { props: { count: number; folders: Folder[]; current: number | null }; result: number };
	/** Tags for one or more devices: what to add and what to take off */
	tags: { props: { devices: DeviceLike[]; known: string[] }; result: { add: string[]; remove: string[] } };
}

export type AskKind = keyof AskMap;

export type AskRequest = {
	[K in AskKind]: {
		id: number;
		kind: K;
		props: AskMap[K]['props'];
		settle: (answer: AskMap[K]['result'] | null) => void;
	};
}[AskKind];

class AskRequests {
	items = $state.raw<AskRequest[]>([]);
}

/** What DeviceDialogs renders, the newest last */
export const askRequests = new AskRequests();

let nextId = 1;
let hosted = false;

let loading: Promise<typeof import('./DeviceDialogs.svelte')> | null = null;

/** Fetch the dialogs' code ahead of the first use (the device list does this once it shows) */
export function preloadDialogs(): void {
	if (typeof document !== 'undefined') loading ??= import('./DeviceDialogs.svelte');
}

async function ensureHost(): Promise<void> {
	if (hosted || typeof document === 'undefined') return;
	preloadDialogs();
	const { default: DeviceDialogs } = await (loading as Promise<typeof import('./DeviceDialogs.svelte')>);
	if (hosted) return;
	hosted = true;
	mount(DeviceDialogs, { target: document.body });
}

/** Open a device dialog; resolves with its answer, or null when it was closed without one */
export async function ask<K extends AskKind>(
	kind: K,
	props: AskMap[K]['props']
): Promise<AskMap[K]['result'] | null> {
	await ensureHost();
	return new Promise((resolve) => {
		const id = nextId++;
		let done = false;
		const settle = (answer: AskMap[K]['result'] | null) => {
			if (done) return;
			done = true;
			askRequests.items = askRequests.items.filter((r) => r.id !== id);
			resolve(answer);
		};
		// A new device dialog replaces an open one (one popup at a time); the old one answers null
		for (const r of askRequests.items) r.settle(null);
		askRequests.items = [...askRequests.items, { id, kind, props, settle } as AskRequest];
	});
}

/** Close every device dialog as cancelled (leaving the page) */
export function closeAsks(): void {
	for (const r of askRequests.items) r.settle(null);
}
