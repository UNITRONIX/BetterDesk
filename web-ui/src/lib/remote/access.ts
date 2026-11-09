/**
 * Who may open which session in the viewer, and over which transport.
 * The server decides (GET /api/remote/viewer/:id); this only keeps the
 * page from offering what a guest link or a mesh share does not allow.
 */

import type { Transport } from './states.ts';

export interface ViewerCapabilities {
	transport: string;
	os_agent?: boolean;
	cdap_connected?: boolean;
	mesh_connected?: boolean;
	device_type?: string;
	mesh_share?: boolean;
	mesh_view_only?: boolean;
	remote_target?: boolean;
	remote_protocol?: string;
	remote_target_config?: Record<string, unknown> | null;
	guest_access?: boolean;
	guest_view_only?: boolean;
	guest_peer_ids?: string[];
}

/** Device IDs the server accepts in /remote/<id> */
export const DEVICE_ID = /^[A-Za-z0-9_-]{3,64}$/;

export function isDeviceId(id: unknown): id is string {
	return typeof id === 'string' && DEVICE_ID.test(id);
}

export function transportOf(caps: ViewerCapabilities | null | undefined): Transport {
	const t = String(caps?.transport ?? 'rd').toLowerCase();
	if (t === 'mesh' || t === 'cdap' || t === 'rdp' || t === 'vnc') return t;
	return 'rd';
}

/** A guest link or a mesh share: no console session behind the viewer */
export function isGuestMode(caps: ViewerCapabilities | null | undefined): boolean {
	return !!(caps?.guest_access || caps?.mesh_share);
}

export function isViewOnlyGuest(caps: ViewerCapabilities | null | undefined): boolean {
	return !!(caps?.guest_view_only || caps?.mesh_view_only);
}

export function guestAllowedIds(caps: ViewerCapabilities | null | undefined, initialId: string): string[] {
	if (Array.isArray(caps?.guest_peer_ids) && caps.guest_peer_ids.length)
		return caps.guest_peer_ids.map(String);
	if (caps?.mesh_share && initialId) return [initialId];
	return [];
}

/** Outside guest mode every ID may be tried (the server checks); a guest only the link's devices */
export function peerAllowed(
	caps: ViewerCapabilities | null | undefined,
	initialId: string,
	id: string
): boolean {
	if (!isGuestMode(caps)) return true;
	return guestAllowedIds(caps, initialId).includes(String(id));
}

/** `#add=<id>`: open a second session tab from the link */
export function addFromHash(hash: string): string | null {
	const m = /add=([A-Za-z0-9_-]+)/.exec(hash || '');
	return m?.[1] ?? null;
}

export function isRemoteTargetId(id: string): boolean {
	return String(id).startsWith('rt_');
}

/** The guest link's token from the page address (?guest= or ?t=) */
export function guestTokenFromSearch(search: string): string {
	const q = new URLSearchParams(search);
	return q.get('guest') || q.get('t') || '';
}
