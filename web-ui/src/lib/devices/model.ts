/**
 * What the device list shows and filters by, without a DOM: the status of a
 * device, its type label, the text the search looks through, the filters
 * and the counts beside folders and groups. Same rules as the old page
 * (public/js/devices.js); unit tested in tests/unit/devices-model.test.ts.
 */

import type { Device, DeviceGroup, Folder } from '#lib/api/devices.ts';
import { parseDate } from '#lib/i18n/format.ts';

/** The fields these helpers read; the list and the panel both have them */
export type DeviceLike = Pick<Device, 'id'> & Partial<Device>;

/* ── Status, name, type ── */

export type DeviceState = 'deleted' | 'banned' | 'online' | 'no_signal' | 'offline';

/** A device's state as the list shows it: deleted and banned win over online */
export function deviceState(d: DeviceLike): DeviceState {
	if (d.soft_deleted) return 'deleted';
	if (d.banned) return 'banned';
	if (d.online) return 'online';
	if (d.no_signal) return 'no_signal';
	return 'offline';
}

/** Status tone word for Status (statusTone maps it) */
export function stateTone(state: DeviceState): string {
	return state === 'deleted' ? 'neutral' : state;
}

/** String key of the state's label */
export function stateLabelKey(state: DeviceState): string {
	return state === 'deleted' ? 'devices.deleted_badge' : `status.${state}`;
}

/** The name the list shows: display name, else host name, else the note */
export function deviceName(d: DeviceLike): string {
	return String(d.display_name || d.hostname || d.note || '').trim();
}

/** For dialogs: "name (ID)", or the ID alone */
export function deviceLabel(d: DeviceLike): string {
	const name = String(d.display_name || d.hostname || '').trim();
	return name ? `${name} (${d.id})` : d.id;
}

const TYPE_LABELS: Record<string, string> = {
	betterdesk: 'BetterDesk',
	'betterdesk-support': 'BetterDesk Support',
	rustdesk: 'RustDesk',
	rdp: 'RDP',
	vnc: 'VNC',
	scada: 'SCADA',
	iot: 'IoT'
};
const TYPE_KEYS: Record<string, string> = {
	mobile: 'devices.type_mobile',
	desktop: 'devices.filter_type_desktop',
	os_agent: 'devices.filter_type_agent',
	mesh_agent: 'devices.type_mesh_agent'
};

/** Label of a device type: product names as they are, the rest translated, unknown types capitalised */
export function typeLabel(type: string | null | undefined, t: (key: string) => string): string {
	const k = String(type ?? '')
		.trim()
		.toLowerCase();
	if (!k) return '';
	if (TYPE_LABELS[k]) return TYPE_LABELS[k];
	if (TYPE_KEYS[k]) return t(TYPE_KEYS[k]);
	const words = k.replace(/[_-]+/g, ' ').trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isMesh(d: DeviceLike): boolean {
	return String(d.device_type ?? '').toLowerCase() === 'mesh_agent';
}

/* ── Search ── */

/** Text the search box looks through: ID, names, user, platform, type, tags, note, IP, linked peer */
export function searchText(d: DeviceLike): string {
	return [
		d.id,
		d.display_name,
		d.hostname,
		d.username,
		d.platform || d.os,
		d.device_type || 'rustdesk',
		(d.tags ?? []).join(' '),
		d.note,
		d.ip,
		d.linked_peer_id
	]
		.filter(Boolean)
		.join(' ')
		.toLowerCase();
}

/** The search words: every one must appear somewhere, in any order */
export function searchWords(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/* ── Filters ── */

export type StatusFilter = 'all' | 'online' | 'offline' | 'mesh_agent' | 'banned';
export const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'online', 'offline', 'mesh_agent', 'banned'];

export function isStatusFilter(v: string | null | undefined): v is StatusFilter {
	return STATUS_FILTERS.includes(v as StatusFilter);
}

/** Folders and groups are one choice: picking a group shows all folders and the other way round */
export type Scope =
	{ kind: 'all' } | { kind: 'unassigned' } | { kind: 'folder'; id: number } | { kind: 'group'; guid: string };

export interface Filters {
	query: string;
	status: StatusFilter;
	scope: Scope;
	/** Every ticked tag must be on the device (case does not matter) */
	tags: readonly string[];
	showDeleted: boolean;
}

export const NO_FILTERS: Filters = {
	query: '',
	status: 'all',
	scope: { kind: 'all' },
	tags: [],
	showDeleted: false
};

/** A device group as the filters read it (the server may leave text fields out) */
export type GroupLike = Partial<Pick<DeviceGroup, 'guid' | 'source_type' | 'tag_filter'>>;

/** Tag groups hold every device with their tag; manual groups their members */
export function inGroup(d: DeviceLike, group: GroupLike): boolean {
	if ((group.source_type || 'manual') === 'tag') {
		const tag = String(group.tag_filter ?? '').toLowerCase();
		return !!tag && (d.tags ?? []).some((x) => x.toLowerCase() === tag);
	}
	return !!group.guid && (d.groups ?? []).some((g) => g.guid === group.guid);
}

export function inFolder(d: DeviceLike, folderId: number): boolean {
	return d.folder_id !== null && d.folder_id !== undefined && Number(d.folder_id) === folderId;
}

export function isUnassigned(d: DeviceLike): boolean {
	return !d.folder_id;
}

/**
 * The devices the filters let through, in their original order (the table
 * sorts). `text` gives each device's search text; pass a cached one for long
 * lists so typing doesn't rebuild 5,000 strings per key.
 */
export function filterDevices<D extends DeviceLike>(
	devices: readonly D[],
	f: Filters,
	groups: readonly GroupLike[],
	text: (d: D) => string = searchText
): D[] {
	const words = searchWords(f.query);
	const tags = f.tags.map((x) => x.toLowerCase());
	const group =
		f.scope.kind === 'group'
			? (groups.find((g) => g.guid === (f.scope as { guid: string }).guid) ?? null)
			: null;
	const out: D[] = [];
	for (const d of devices) {
		if (!f.showDeleted && d.soft_deleted) continue;
		const s = f.scope;
		if (s.kind === 'unassigned' && !isUnassigned(d)) continue;
		if (s.kind === 'folder' && !inFolder(d, s.id)) continue;
		if (s.kind === 'group' && (!group || !inGroup(d, group))) continue;
		if (tags.length) {
			const have = (d.tags ?? []).map((x) => x.toLowerCase());
			if (!tags.every((x) => have.includes(x))) continue;
		}
		if (f.status === 'online' && !d.online) continue;
		if (f.status === 'offline' && (d.online || d.banned)) continue;
		if (f.status === 'banned' && !d.banned) continue;
		if (f.status === 'mesh_agent' && !isMesh(d)) continue;
		if (words.length) {
			const hay = text(d);
			if (!words.every((w) => hay.includes(w))) continue;
		}
		out.push(d);
	}
	return out;
}

/** Any filter narrower than "everything" (Show deleted widens, so it doesn't count) */
export function isFiltered(f: Filters): boolean {
	return !!f.query.trim() || f.status !== 'all' || f.scope.kind !== 'all' || f.tags.length > 0;
}

/* ── Counts beside folders and groups ── */

export interface Counts {
	all: number;
	unassigned: number;
	online: number;
	folders: Map<number, number>;
	groups: Map<string, number>;
}

/** One pass over the list. Deleted devices count only while Show deleted is on (they are in the list then). */
export function countDevices(
	devices: readonly DeviceLike[],
	folders: readonly Pick<Folder, 'id'>[],
	groups: readonly GroupLike[]
): Counts {
	const c: Counts = { all: 0, unassigned: 0, online: 0, folders: new Map(), groups: new Map() };
	for (const f of folders) c.folders.set(f.id, 0);
	for (const g of groups) if (g.guid) c.groups.set(g.guid, 0);
	const tagGroups = groups.filter((g) => (g.source_type || 'manual') === 'tag');
	for (const d of devices) {
		c.all++;
		if (d.online && !d.soft_deleted) c.online++;
		if (isUnassigned(d)) c.unassigned++;
		else {
			const id = Number(d.folder_id);
			if (c.folders.has(id)) c.folders.set(id, (c.folders.get(id) ?? 0) + 1);
		}
		for (const m of d.groups ?? []) {
			const guid = m.guid ?? '';
			if (c.groups.has(guid) && (m.source_type || 'manual') !== 'tag')
				c.groups.set(guid, (c.groups.get(guid) ?? 0) + 1);
		}
		if (tagGroups.length && d.tags?.length) {
			for (const g of tagGroups) {
				const guid = g.guid ?? '';
				if (c.groups.has(guid) && inGroup(d, g)) c.groups.set(guid, (c.groups.get(guid) ?? 0) + 1);
			}
		}
	}
	return c;
}

/* ── Sorting ── */

/** Last seen as a number for sorting (never seen: empty, sorts last); same reading as Time */
export function lastSeenValue(d: DeviceLike): number | null {
	return parseDate(d.last_online)?.getTime() ?? null;
}
