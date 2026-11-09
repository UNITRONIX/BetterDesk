/**
 * Real-time status for the device list (/ws/device-status). The socket
 * sends one message per change; the list collects them and applies them in
 * one go (applyStatuses), so a burst of changes is one re-render, and a
 * message for a device the list doesn't have, or that wouldn't change it,
 * leaves the list as it is (same array, nothing re-renders).
 */

import type { DeviceLike } from './model.ts';

export type LiveMessage =
	{ kind: 'status'; id: string; status: string } | { kind: 'id-changed'; oldId: string; newId: string };

/** The two messages the list reads; anything else is null */
export function parseLiveMessage(data: unknown): LiveMessage | null {
	if (!data || typeof data !== 'object') return null;
	const m = data as Record<string, unknown>;
	if (m.type === 'device_status' && (typeof m.device_id === 'string' || typeof m.device_id === 'number')) {
		return { kind: 'status', id: String(m.device_id), status: String(m.status ?? '') };
	}
	if (m.type === 'device_id_changed' && m.old_id !== undefined && m.new_id !== undefined) {
		return { kind: 'id-changed', oldId: String(m.old_id), newId: String(m.new_id) };
	}
	return null;
}

const KNOWN = new Set(['online', 'offline', 'no_signal', 'degraded', 'critical']);

/** The status word as the list reads it (unknown words are offline, as before) */
export function normaliseStatus(status: string): string {
	const s = String(status || '').toLowerCase();
	return KNOWN.has(s) ? s : 'offline';
}

/**
 * The list with the collected statuses applied. Banned and deleted devices
 * keep their state (a disconnect push must not relabel them). Returns the
 * same array when nothing changed.
 */
export function applyStatuses<D extends DeviceLike>(
	devices: readonly D[],
	updates: ReadonlyMap<string, string>
): readonly D[] {
	if (updates.size === 0) return devices;
	let out: D[] | null = null;
	for (let i = 0; i < devices.length; i++) {
		const d = devices[i] as D;
		const raw = updates.get(d.id);
		if (raw === undefined || d.banned || d.soft_deleted) continue;
		const s = normaliseStatus(raw);
		const online = s === 'online';
		const noSignal = s === 'no_signal';
		if (!!d.online === online && !!d.no_signal === noSignal) continue;
		out ??= devices.slice();
		out[i] = { ...d, online, no_signal: noSignal };
	}
	return out ?? devices;
}
