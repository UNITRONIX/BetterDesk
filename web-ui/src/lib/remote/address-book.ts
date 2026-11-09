/**
 * The remote client's address book (the /remote dashboard and the viewer's
 * New connection dialog): devices filtered by folder, group or tag, status
 * and search, online first. Port of public/js/remote-address-book.js
 * without its DOM code.
 */

import { tf } from '#lib/i18n/i18n.svelte.ts';
import type { Tone } from '#lib/util/display.ts';
import { DEVICE_ID } from './access.ts';

export interface BookDevice {
	id: string;
	hostname?: string | null;
	display_name?: string | null;
	note?: string | null;
	platform?: string | null;
	os?: string | null;
	online?: boolean;
	banned?: boolean;
	no_signal?: boolean;
	last_online?: string | number | null;
	folder_id?: number | string | null;
	tags?: unknown;
	groups?: { guid?: string }[] | null;
}

export interface BookFolder {
	id: number | string;
	name: string;
	device_count?: number;
}

export interface BookGroup {
	guid: string;
	name: string;
	source_type?: string | null;
	tag_filter?: string | null;
	member_count?: number;
}

export type StatusFilter = 'all' | 'online' | 'offline';

/** One of: a folder ('all', 'unassigned' or an id), a group, a tag */
export type Scope =
	{ kind: 'folder'; id: string } | { kind: 'group'; id: string } | { kind: 'tag'; id: string };

export const ALL: Scope = { kind: 'folder', id: 'all' };

export function normalizeTags(value: unknown): string[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean);
	if (typeof value === 'string') {
		try {
			const parsed: unknown = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed.map((x) => String(x).trim()).filter(Boolean);
		} catch {
			/* a comma list */
		}
		return value
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean);
	}
	return [];
}

const unassigned = (v: unknown) => v === null || v === undefined || v === '' || Number(v) === 0;

export function folderIdsEqual(a: unknown, b: unknown): boolean {
	if (unassigned(a)) return unassigned(b);
	return Number(a) === Number(b);
}

export function deviceMatchesGroup(d: BookDevice, g: BookGroup): boolean {
	if ((g.source_type || 'manual') === 'tag') {
		const tag = String(g.tag_filter || '').toLowerCase();
		return !!tag && normalizeTags(d.tags).some((x) => x.toLowerCase() === tag);
	}
	return (Array.isArray(d.groups) ? d.groups : []).some((x) => x.guid === g.guid);
}

export function displayName(d: BookDevice): string {
	return d.display_name || d.hostname || d.note || d.id || '—';
}

export function deviceStatus(d: BookDevice): { tone: Tone; label: string } {
	if (d.banned) return { tone: 'danger', label: tf('status.banned', 'Banned') };
	if (d.online) return { tone: 'good', label: tf('status.online', 'Online') };
	if (d.no_signal) return { tone: 'warning', label: tf('status.no_signal', 'No signal') };
	return { tone: 'neutral', label: tf('status.offline', 'Offline') };
}

function time(v: unknown): number {
	const n = v ? new Date(v as string).getTime() : 0;
	return Number.isFinite(n) ? n : 0;
}

export function filterDevices(
	devices: readonly BookDevice[],
	opts: { scope: Scope; status: StatusFilter; query: string; groups: readonly BookGroup[] }
): BookDevice[] {
	const q = opts.query.trim().toLowerCase();
	const { scope } = opts;
	const group = scope.kind === 'group' ? opts.groups.find((g) => g.guid === scope.id) : null;
	const tag = scope.kind === 'tag' ? scope.id.toLowerCase() : null;
	return devices
		.filter((d) => {
			if (scope.kind === 'folder') {
				if (scope.id === 'unassigned' && d.folder_id) return false;
				if (scope.id !== 'all' && scope.id !== 'unassigned' && !folderIdsEqual(d.folder_id, scope.id))
					return false;
			}
			if (scope.kind === 'group' && (!group || !deviceMatchesGroup(d, group))) return false;
			if (tag && !normalizeTags(d.tags).some((x) => x.toLowerCase() === tag)) return false;
			if (opts.status === 'online' && !d.online) return false;
			if (opts.status === 'offline' && (d.online || d.banned)) return false;
			if (q) {
				const hay = [d.id, d.hostname, d.note, d.platform, d.os, d.display_name]
					.filter(Boolean)
					.join(' ')
					.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		})
		.sort((a, b) => {
			if (!!a.online !== !!b.online) return a.online ? -1 : 1;
			return time(b.last_online) - time(a.last_online);
		});
}

export interface Counts {
	all: number;
	unassigned: number;
	folders: Map<string, number>;
	groups: Map<string, number>;
	tags: Map<string, number>;
}

export function countDevices(
	devices: readonly BookDevice[],
	folders: readonly BookFolder[],
	groups: readonly BookGroup[],
	tags: readonly string[]
): Counts {
	const tagCount = (tag: string) => {
		const lower = tag.toLowerCase();
		return devices.filter((d) => normalizeTags(d.tags).some((x) => x.toLowerCase() === lower)).length;
	};
	return {
		all: devices.length,
		unassigned: devices.filter((d) => !d.folder_id).length,
		folders: new Map(
			folders.map((f) => [String(f.id), devices.filter((d) => folderIdsEqual(d.folder_id, f.id)).length])
		),
		groups: new Map(groups.map((g) => [g.guid, devices.filter((d) => deviceMatchesGroup(d, g)).length])),
		tags: new Map(tags.map((t) => [t, tagCount(t)]))
	};
}

/** The heading over the list: the chosen folder, group or tag */
export function scopeTitle(
	scope: Scope,
	folders: readonly BookFolder[],
	groups: readonly BookGroup[]
): string {
	if (scope.kind === 'tag') return scope.id;
	if (scope.kind === 'group')
		return groups.find((g) => g.guid === scope.id)?.name ?? tf('remote_dashboard.nav_groups', 'Groups');
	if (scope.id === 'unassigned') return tf('remote_dashboard.unassigned', 'Unassigned');
	if (scope.id !== 'all')
		return (
			folders.find((f) => folderIdsEqual(f.id, scope.id))?.name ??
			tf('remote_dashboard.nav_folders', 'Folders')
		);
	return tf('remote_dashboard.all_devices', 'All devices');
}

/** A tag chosen again goes back to all devices */
export function chooseScope(current: Scope, next: Scope): Scope {
	if (next.kind === 'tag' && current.kind === 'tag' && current.id === next.id) return ALL;
	return next;
}

/** The ID typed into a quick-connect field, or '' when it is not a device ID */
export function readQuickId(raw: string): string {
	const id = raw.trim().replace(/\s/g, '');
	return DEVICE_ID.test(id) ? id : '';
}

export function sameScope(a: Scope, b: Scope): boolean {
	return a.kind === b.kind && a.id === b.id;
}
