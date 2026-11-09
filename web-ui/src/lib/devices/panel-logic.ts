/**
 * The device panel's rules without a DOM: which tabs, views, actions and
 * footer buttons a person gets for a device, what an edit changes, and how
 * the panel reads the loose data devices send (system info, the agent's
 * inventory report, live views, availability). Same rules as the old panel
 * (public/js/deviceDetail.js); unit tested in tests/unit/device-panel.test.ts.
 */

import type { DeviceDetail } from '#lib/api/devices.ts';
import type { AvailabilityEvent } from '#lib/api/device-agent.ts';
import { parseDate } from '#lib/i18n/format.ts';
import { deviceState, isMesh, type DeviceLike } from './model.ts';

type Can = (permission: string) => boolean;
type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
};

/** The panel's view of a device: the detail record, or a list row while it loads */
export type PanelDevice = DeviceLike & Partial<DeviceDetail>;

/* ── Telemetry snapshots ── */

export interface Snapshot {
	status: string;
	collectedAt: string;
	data: Obj;
}

export function snapshot(d: PanelDevice, kind: string): Snapshot | null {
	const snaps = obj(obj(d.telemetry).snapshots);
	const s = snaps[kind];
	if (!s || typeof s !== 'object') return null;
	const o = s as Obj;
	return { status: str(o.status), collectedAt: str(o.collected_at), data: obj(o.data) };
}

export function identityOf(d: PanelDevice): Obj {
	return snapshot(d, 'identity')?.data ?? {};
}

/** The support agent: incoming connections only, no administration */
export function isSupportAgent(identity: Obj): boolean {
	if (identity.product_sku === 'betterdesk-support') return true;
	if (identity.product_sku === 'betterdesk-desktop') return false;
	return identity.conn_mode === 'incoming-only';
}

/* ── Status ── */

export interface PanelStatus {
	tone: string;
	/** String key of the word */
	key: string;
	/** String key of the explanation on hover */
	titleKey?: string;
}

/** Deleted and banned win; an online device shows its tier (degraded, critical) */
export function panelStatus(d: PanelDevice): PanelStatus {
	const state = deviceState(d);
	if (state === 'deleted') return { tone: 'neutral', key: 'devices.deleted_badge' };
	if (state === 'banned') return { tone: 'danger', key: 'status.banned' };
	if (state === 'online') {
		const tier = String(d.status_tier || 'online').toLowerCase();
		if (tier === 'degraded') return { tone: 'warning', key: 'device_detail.availability_status_degraded' };
		if (tier === 'critical') return { tone: 'danger', key: 'device_detail.availability_status_critical' };
		return { tone: 'good', key: 'status.online' };
	}
	if (state === 'no_signal')
		return { tone: 'warning', key: 'status.no_signal', titleKey: 'devices.no_signal_tooltip' };
	return { tone: 'neutral', key: 'status.offline' };
}

/** "This device is banned": the string key, who banned it and when (either may be unknown) */
export function banLine(d: PanelDevice): { key: string; user: string; at: Date | null } {
	const at = parseDate(d.banned_at);
	const user = String(d.banned_by ?? '').trim();
	const key =
		at && user
			? 'device_detail.banned_on_by'
			: at
				? 'device_detail.banned_on'
				: user
					? 'device_detail.banned_by'
					: 'device_detail.banned_unknown';
	return { key, user, at };
}

/* ── Tabs and views ── */

export type PanelTab = 'overview' | 'hardware' | 'metrics' | 'live' | 'tags' | 'actions';
export type LiveView = 'services' | 'processes' | 'events' | 'activity' | 'files';

/**
 * The agent's views. None for the support agent, RDP/VNC targets (no
 * agent) and deleted devices (the server no longer answers for them);
 * Files needs device.edit (its route does).
 */
export function liveViews(d: PanelDevice, can: Can): LiveView[] {
	if (d.remote_target || d.soft_deleted || isSupportAgent(identityOf(d))) return [];
	const views: LiveView[] = ['services', 'processes', 'events', 'activity'];
	if (can('device.edit')) views.push('files');
	return views;
}

/**
 * Tabs in order. RDP/VNC targets have no client to report hardware, usage
 * or live data, so they get Overview, Tags and notes, and Actions.
 */
export function panelTabs(d: PanelDevice, can: Can): PanelTab[] {
	const tabs: PanelTab[] = ['overview'];
	if (!d.remote_target) tabs.push('hardware', 'metrics');
	if (liveViews(d, can).length) tabs.push('live');
	tabs.push('tags');
	if (actionCount(panelActions(d, can)) > 0) tabs.push('actions');
	return tabs;
}

/* ── Actions ── */

export type ActionId =
	| 'connect-web'
	| 'connect-desktop'
	| 'cdap-viewer'
	| 'guest-access'
	| 'mesh-terminal'
	| 'mesh-files'
	| 'mesh-run-command'
	| 'mesh-link-peer'
	| 'mesh-share'
	| 'mesh-port-tcp'
	| 'mesh-port-udp'
	| 'mesh-power-wake'
	| 'mesh-power-sleep'
	| 'mesh-power-reset'
	| 'mesh-power-off'
	| 'edit'
	| 'edit-target'
	| 'groups'
	| 'access-policy'
	| 'change-id'
	| 'ban'
	| 'unban'
	| 'delete'
	| 'delete-target'
	| 'restore'
	| 'permanent-delete';

export interface PanelActions {
	connect: ActionId[];
	mesh: ActionId[];
	/** The support agent's limits are shown instead of management actions */
	support: boolean;
	manage: ActionId[];
	danger: ActionId[];
	/** A deleted device: restore or delete for good */
	deleted: ActionId[];
}

export function meshOnline(d: PanelDevice): boolean {
	return isMesh(d) && !!(d.mesh_connected || d.online);
}

/**
 * The Actions tab: the old panel's actions plus the ones the list's row
 * menu had (viewers, guest link, MeshAgent tools, groups, access policy),
 * so every page with the panel offers them. Same checks as actions.svelte.ts.
 */
export function panelActions(d: PanelDevice, can: Can): PanelActions {
	const out: PanelActions = { connect: [], mesh: [], support: false, manage: [], danger: [], deleted: [] };
	if (d.soft_deleted) {
		if (!d.remote_target && can('device.delete')) out.deleted.push('restore', 'permanent-delete');
		return out;
	}
	if (d.remote_target) {
		if (can('remote_target.connect')) out.connect.push('connect-web');
		if (can('remote_target.edit')) out.manage.push('edit-target');
		if (can('device.edit')) out.manage.push('groups');
		if (can('remote_target.delete')) out.danger.push('delete-target');
		return out;
	}
	const connect = can('device.connect');
	if (connect) out.connect.push('connect-web', 'connect-desktop', 'cdap-viewer');
	if (can('guest.create')) out.connect.push('guest-access');

	if (isSupportAgent(identityOf(d))) {
		out.support = true;
		return out;
	}

	if (meshOnline(d)) {
		if (can('mesh.terminal')) out.mesh.push('mesh-terminal');
		if (can('mesh.files') && connect) out.mesh.push('mesh-files');
		if (connect) out.mesh.push('mesh-run-command');
		if (can('cdap.command')) out.mesh.push('mesh-link-peer');
		if (connect) out.mesh.push('mesh-share', 'mesh-port-tcp', 'mesh-port-udp');
		if (can('mesh.power'))
			out.mesh.push('mesh-power-wake', 'mesh-power-sleep', 'mesh-power-reset', 'mesh-power-off');
	} else if (isMesh(d) && can('mesh.power')) {
		out.mesh.push('mesh-power-wake');
	}

	if (can('device.edit')) out.manage.push('edit', 'groups', 'access-policy');
	if (can('device.change_id')) out.manage.push('change-id');
	if (can('device.ban')) out.manage.push(d.banned ? 'unban' : 'ban');
	if (can('device.delete')) out.danger.push('delete');
	return out;
}

export function actionCount(a: PanelActions): number {
	return (
		a.connect.length +
		a.mesh.length +
		a.manage.length +
		a.danger.length +
		a.deleted.length +
		(a.support ? 1 : 0)
	);
}

/* ── Footer ── */

/**
 * The footer has three slots that keep their place and size in both modes:
 *   start:  Edit   → Cancel      (Edit opens the RDP/VNC sheet for a target)
 *   second: Connect → (empty, keeps its width)
 *   end:    Close  → Save
 * A slot is as wide as the wider of its two buttons, so nothing moves when
 * the mode changes. `edit` false leaves the first slot out, `connect` false
 * the second; Close/Save is always there.
 */
export interface FooterSlots {
	/** In-place editing (display name, user, note, folder, tags) */
	edit: boolean;
	/** Edit opens the RDP/VNC target sheet instead */
	editTarget: boolean;
	connect: boolean;
}

export function footerSlots(d: PanelDevice, can: Can): FooterSlots {
	const deleted = !!d.soft_deleted;
	const target = !!d.remote_target;
	return {
		edit: !deleted && !target && !isSupportAgent(identityOf(d)) && can('device.edit'),
		editTarget: !deleted && target && can('remote_target.edit'),
		connect: !deleted && (target ? can('remote_target.connect') : can('device.connect'))
	};
}

/* ── Edit mode ── */

export interface EditValues {
	display_name: string;
	user: string;
	note: string;
	/** Folder id as text, '' for none (a select's value) */
	folder: string;
	tags: string[];
	/** A tag typed but not added yet: saved too */
	tagInput: string;
}

export function editValuesOf(d: PanelDevice): EditValues {
	return {
		display_name: d.display_name ?? '',
		user: d.username ?? '',
		note: d.note ?? '',
		folder: d.folder_id ? String(d.folder_id) : '',
		tags: [...(d.tags ?? [])],
		tagInput: ''
	};
}

export const TAG_MAX = 50;

/** True when the tag is on the list already (case does not matter) */
export function hasTag(tags: readonly string[], tag: string): boolean {
	const t = tag.trim().toLowerCase();
	return tags.some((x) => x.toLowerCase() === t);
}

export interface EditChanges {
	/** PATCH /api/devices/:id with only the fields that changed (empty: no call) */
	fields: { display_name?: string; user?: string; note?: string };
	/** PUT /api/devices/:id/tags when the tags changed, else null */
	tags: string[] | null;
	/** PATCH /api/devices/:id/folder when the folder changed (null: no folder), else undefined */
	folderId?: number | null;
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * What a save sends: only what differs from the device as loaded. Text is
 * trimmed (the server trims too), a typed tag counts as added, and the
 * folder compares as a number (none = no folder).
 */
export function editChanges(before: EditValues, after: EditValues): EditChanges {
	const out: EditChanges = { fields: {}, tags: null };
	for (const key of ['display_name', 'user', 'note'] as const) {
		const next = after[key].trim();
		if (next !== before[key].trim()) out.fields[key] = next;
	}
	const typed = after.tagInput.trim();
	const tags = typed && !hasTag(after.tags, typed) ? [...after.tags, typed] : [...after.tags];
	if (!sameSet(tags, before.tags)) out.tags = tags;
	const from = Number(before.folder) || null;
	const to = Number(after.folder) || null;
	if (from !== to) out.folderId = to;
	return out;
}

export function hasChanges(c: EditChanges): boolean {
	return Object.keys(c.fields).length > 0 || c.tags !== null || c.folderId !== undefined;
}

/* ── System info (Hardware tab) ── */

function parseJsonList(v: unknown): unknown[] {
	if (Array.isArray(v)) return v;
	if (typeof v !== 'string' || !v) return [];
	try {
		const parsed: unknown = JSON.parse(v);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export interface SysInfo {
	hostname: string;
	username: string;
	osFull: string;
	platform: string;
	version: string;
	vendor: string;
	domain: string;
	cpu: string;
	memory: string;
	cpuName: string;
	cpuCores: number | null;
	cpuGhz: number | null;
	memoryGb: number | null;
	displays: { name: string; width: number | null; height: number | null }[];
	encoders: string[];
	/** The hardware snapshot's read result when it isn't "ok" */
	readStatus: string;
}

/** The client's system info, or the hardware snapshot when there is none; null when neither */
export function sysinfoOf(d: PanelDevice): SysInfo | null {
	const hw = snapshot(d, 'hardware');
	const raw = d.sysinfo ? obj(d.sysinfo) : hw ? hw.data : null;
	if (!raw) return null;
	const displays = parseJsonList(raw.displays_json ?? raw.displays).map((x, i) => {
		const o = obj(x);
		// Width and height come from the remote client: numbers only
		const width = num(o.width ?? o.w);
		const height = num(o.height ?? o.h);
		return { name: str(o.name) || `#${i + 1}`, width, height };
	});
	const encoders = parseJsonList(raw.encoding_json ?? raw.encoding)
		.map((e) => (typeof e === 'string' ? e : str(obj(e).name) || str(obj(e).codec) || JSON.stringify(e)))
		.filter(Boolean);
	return {
		hostname: str(raw.hostname),
		username: str(raw.username),
		osFull: str(raw.os_full),
		platform: str(raw.platform),
		version: str(raw.version),
		vendor: str(raw.vendor),
		domain: str(raw.domain),
		cpu: str(raw.cpu),
		memory: str(raw.memory),
		cpuName: str(raw.cpu_name),
		cpuCores: num(raw.cpu_cores),
		cpuGhz: num(raw.cpu_freq_ghz),
		memoryGb: num(raw.memory_gb),
		displays,
		encoders,
		readStatus: hw && hw.status && hw.status !== 'ok' ? hw.status : ''
	};
}

/* ── The agent's inventory report ── */

export interface InventoryDisk {
	name: string;
	device: string;
	removable: boolean;
	fs: string;
	total: number;
	used: number | null;
}

export interface InventoryApp {
	name: string;
	version: string;
	publisher: string;
	installed: string;
	/** Lower-case text the program search looks through */
	search: string;
}

export interface InventoryView {
	cpuBrand: string;
	cores: number | null;
	physicalCores: number | null;
	cpuLoad: number | null;
	memoryTotal: number;
	memoryUsed: number;
	architecture: string;
	disks: InventoryDisk[];
	nics: { name: string; mac: string; ips: string[] }[];
	osName: string;
	osVersion: string;
	kernel: string;
	uptimeSeconds: number | null;
	collectedAt: string;
	receivedAt: string;
	apps: InventoryApp[];
}

const GB = 1024 ** 3;

function diskSizes(disk: Obj): { total: number; used: number | null } {
	const total = disk.total_bytes != null ? Number(disk.total_bytes) || 0 : (Number(disk.total_gb) || 0) * GB;
	let used: number | null =
		disk.used_bytes != null
			? Number(disk.used_bytes)
			: disk.used_gb != null
				? (Number(disk.used_gb) || 0) * GB
				: null;
	if (used === null && disk.available_bytes != null && total) used = total - Number(disk.available_bytes);
	if (used === null && disk.free_bytes != null && total) used = total - Number(disk.free_bytes);
	return { total, used: used === null || !Number.isFinite(used) ? null : used };
}

/** The report's facts, disks, adapters and programs, whatever agent version sent it */
export function inventoryView(data: Obj): InventoryView {
	const hw = data.hardware && typeof data.hardware === 'object' ? obj(data.hardware) : data;
	const sw = obj(data.software);
	const tel = obj(data.telemetry);
	const cpu = hw.cpu && typeof hw.cpu === 'object' ? obj(hw.cpu) : { brand: hw.cpu ?? data.cpu };
	const mem = obj(hw.memory);

	const cpuLoad =
		typeof tel.cpu_usage_percent === 'number' && tel.received_at
			? tel.cpu_usage_percent
			: typeof cpu.usage_percent === 'number'
				? cpu.usage_percent
				: null;
	const telTotal = Number(tel.memory_total_bytes) || 0;
	const memoryTotal =
		telTotal ||
		Number(mem.total_bytes) ||
		(data.memory_total_mb ? Number(data.memory_total_mb) * 1048576 : 0);
	const memoryUsed = telTotal
		? Number(tel.memory_used_bytes) || 0
		: Number(mem.used_bytes) || (data.memory_used_mb ? Number(data.memory_used_mb) * 1048576 : 0);

	const disks = arr(hw.disks).map((x) => {
		const disk = obj(x);
		const { total, used } = diskSizes(disk);
		const name = str(disk.mount_point) || str(disk.device) || str(disk.name) || '?';
		const device = str(disk.device);
		return {
			name,
			device: device && device !== name ? device : '',
			removable: !!disk.removable,
			fs: str(disk.filesystem) || str(disk.fs_type),
			total,
			used
		};
	});
	const nics = arr(hw.network_interfaces).map((x) => {
		const n = obj(x);
		return { name: str(n.name) || '?', mac: str(n.mac), ips: arr(n.ip_addresses).map(str).filter(Boolean) };
	});
	const apps = arr(sw.apps)
		.map((x) => {
			const a = obj(x);
			const name = str(a.name);
			const version = str(a.version);
			const publisher = str(a.publisher);
			return {
				name: name || '?',
				version,
				publisher,
				installed: str(a.installed_at) || str(a.install_date),
				search: [name, version, publisher].join(' ').toLowerCase()
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
	return {
		cpuBrand: str(cpu.brand),
		cores: num(cpu.logical_cores ?? cpu.cores ?? data.cpu_cores),
		physicalCores: num(cpu.physical_cores),
		cpuLoad,
		memoryTotal,
		memoryUsed,
		architecture: str(hw.architecture),
		disks,
		nics,
		osName: str(hw.os_name) || str(data.os),
		osVersion: str(hw.os_version),
		kernel: str(hw.kernel),
		uptimeSeconds: num(tel.uptime_secs ?? hw.uptime_secs ?? hw.uptime ?? data.uptime),
		collectedAt: str(data.collected_at),
		receivedAt: str(data.received_at),
		apps
	};
}

/** Programs whose name, version or publisher contain the query */
export function filterApps(apps: readonly InventoryApp[], query: string): InventoryApp[] {
	const q = query.trim().toLowerCase();
	return q ? apps.filter((a) => a.search.includes(q)) : [...apps];
}

/* ── Live views ── */

const listOf = (data: unknown, key: string): unknown[] => (Array.isArray(data) ? data : arr(obj(data)[key]));

export interface Service {
	name: string;
	displayName: string;
	status: string;
	startType: string;
}

export function servicesOf(data: unknown): Service[] {
	return listOf(data, 'services')
		.slice(0, 500)
		.map((x) => {
			const s = obj(x);
			const name = str(s.name);
			return {
				name,
				displayName: str(s.display_name) || name,
				status: str(s.status),
				startType: str(s.start_type)
			};
		});
}

export interface Process {
	pid: number | null;
	name: string;
	user: string;
	cpu: number;
	memoryMb: number;
}

/** Busiest first, at most 200 */
export function processesOf(data: unknown): Process[] {
	return listOf(data, 'processes')
		.map((x) => {
			const p = obj(x);
			return {
				pid: num(p.pid),
				name: str(p.name),
				user: str(p.user),
				cpu: num(p.cpu) ?? 0,
				memoryMb: num(p.memory_mb) ?? 0
			};
		})
		.sort((a, b) => b.cpu - a.cpu)
		.slice(0, 200);
}

export interface AgentEvent {
	time: string;
	source: string;
	message: string;
	level: 'error' | 'warning' | 'info';
	/** The whole record, for the details */
	detail: string;
}

export function eventsOf(data: unknown): AgentEvent[] {
	return listOf(data, 'events')
		.slice(0, 500)
		.map((x) => {
			const e = obj(x);
			const level = str(e.level).toLowerCase();
			return {
				time: str(e.time),
				source: str(e.source) || str(e.facility),
				message: str(e.message),
				level:
					level === 'error' || level === 'critical'
						? 'error'
						: level === 'warning' || level === 'warn'
							? 'warning'
							: 'info',
				detail: JSON.stringify(e, null, 2)
			};
		});
}

export interface ActivityItem {
	name: string;
	seconds: number;
	/** Share of the busiest program, 0..100 */
	share: number;
}

/** Longest used first, at most 50 */
export function activityOf(data: unknown): ActivityItem[] {
	const items = listOf(data, 'apps')
		.map((x) => {
			const a = obj(x);
			return { name: str(a.name) || str(a.app), seconds: num(a.seconds) ?? 0 };
		})
		.sort((a, b) => b.seconds - a.seconds)
		.slice(0, 50);
	const max = Math.max(1, items[0]?.seconds ?? 1);
	return items.map((a) => ({ ...a, share: Math.min(100, (a.seconds / max) * 100) }));
}

export interface FileEntry {
	name: string;
	path: string;
	dir: boolean;
	size: number;
}

export interface Folder {
	path: string;
	parent: string;
	entries: FileEntry[];
}

export function filesOf(data: unknown, fallbackPath: string): Folder {
	const o = obj(data);
	return {
		path: str(o.path) || fallbackPath,
		parent: str(o.parent),
		entries: listOf(data, 'entries')
			.slice(0, 1000)
			.map((x) => {
				const e = obj(x);
				return { name: str(e.name), path: str(e.path), dir: !!e.is_dir, size: num(e.size) ?? 0 };
			})
	};
}

/** The file name at the end of a path (either slash) */
export function baseName(path: string): string {
	return path.split(/[\\/]/).pop() || 'download';
}

/* ── Availability history ── */

/** YYYY-MM-DD in the browser's time zone */
export function localDay(date: Date = new Date()): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function dayDate(day: string, hour = 0): Date {
	const [y = 1970, m = 1, d = 1] = day.split('-').map(Number);
	return new Date(y, m - 1, d, hour);
}

export function shiftDay(day: string, delta: number): string {
	const d = dayDate(day);
	d.setDate(d.getDate() + delta);
	return localDay(d);
}

export const AVAIL_STATES = ['ONLINE', 'DEGRADED', 'CRITICAL', 'OFFLINE'] as const;
export type AvailState = (typeof AVAIL_STATES)[number];

export interface AvailSpan {
	from: number;
	to: number;
	status: string;
}

export interface AvailStrip {
	start: number;
	end: number;
	/** min(end, now): the day is drawn up to here */
	until: number;
	spans: AvailSpan[];
	/** Milliseconds per known state, for the legend */
	totals: Partial<Record<AvailState, number>>;
}

/**
 * One day as spans of state. Before the first change the device was in that
 * change's "from" state; with no change at all, its current state held since
 * midnight. Null for a day that hasn't started.
 */
export function availabilityStrip(
	day: string,
	events: readonly AvailabilityEvent[],
	now: number,
	current: string
): AvailStrip | null {
	const start = dayDate(day).getTime();
	const end = dayDate(shiftDay(day, 1)).getTime();
	const until = Math.min(end, now);
	if (!(until > start)) return null;
	const changes = events
		.map((ev) => {
			const at = parseDate(ev.created_at);
			return at
				? {
						t: at.getTime(),
						from: (ev.from_status ?? '').toUpperCase(),
						to: (ev.to_status ?? '').toUpperCase()
					}
				: null;
		})
		.filter((c): c is { t: number; from: string; to: string } => c !== null)
		.sort((a, b) => a.t - b.t);
	let state = changes[0]?.from ?? current.toUpperCase();
	const spans: AvailSpan[] = [];
	let t = start;
	for (const c of changes) {
		const at = Math.min(Math.max(c.t, start), until);
		if (at > t) spans.push({ from: t, to: at, status: state });
		t = Math.max(t, at);
		state = c.to;
	}
	if (until > t) spans.push({ from: t, to: until, status: state });
	const totals: AvailStrip['totals'] = {};
	for (const s of spans) {
		if ((AVAIL_STATES as readonly string[]).includes(s.status)) {
			const k = s.status as AvailState;
			totals[k] = (totals[k] ?? 0) + (s.to - s.from);
		}
	}
	return { start, end, until, spans, totals };
}

/** The device's state for a day without changes */
export function currentAvailState(d: PanelDevice): string {
	return d.online ? String(d.status_tier || 'ONLINE').toUpperCase() : 'OFFLINE';
}

/* ── Usage history (heartbeat samples) ── */

export interface UsageSample {
	t: number;
	cpu: number | null;
	memory: number | null;
	disk: number | null;
}

export function usageSamples(history: unknown): UsageSample[] {
	return arr(history)
		.map((x) => {
			const s = obj(x);
			const at = parseDate(s.time);
			return at ? { t: at.getTime(), cpu: num(s.cpu), memory: num(s.memory), disk: num(s.disk) } : null;
		})
		.filter((s): s is UsageSample => s !== null)
		.sort((a, b) => a.t - b.t);
}

export interface UsageChart {
	/** Sample times; null where a gap breaks the lines */
	times: (number | null)[];
	cpu: (number | null)[];
	memory: (number | null)[];
	disk: (number | null)[];
	range: { cpu: [number, number] | null; memory: [number, number] | null; disk: [number, number] | null };
	crossesDay: boolean;
}

function range(values: (number | null)[]): [number, number] | null {
	const v = values.filter((x): x is number => x !== null);
	return v.length ? [Math.min(...v), Math.max(...v)] : null;
}

/** A sample much later than the usual interval starts a new line: one empty position breaks it */
export function usageChart(samples: readonly UsageSample[]): UsageChart {
	const diffs: number[] = [];
	for (let i = 1; i < samples.length; i++) diffs.push((samples[i]?.t ?? 0) - (samples[i - 1]?.t ?? 0));
	const usual = [...diffs].sort((a, b) => a - b)[Math.floor(diffs.length / 2)] ?? 0;
	const out: UsageChart = {
		times: [],
		cpu: [],
		memory: [],
		disk: [],
		range: { cpu: null, memory: null, disk: null },
		crossesDay: false
	};
	samples.forEach((s, i) => {
		if (i > 0 && usual > 0 && (diffs[i - 1] ?? 0) > usual * 3) {
			out.times.push(null);
			out.cpu.push(null);
			out.memory.push(null);
			out.disk.push(null);
		}
		out.times.push(s.t);
		out.cpu.push(s.cpu);
		out.memory.push(s.memory);
		out.disk.push(s.disk);
	});
	out.range = { cpu: range(out.cpu), memory: range(out.memory), disk: range(out.disk) };
	const first = samples[0];
	const last = samples.at(-1);
	out.crossesDay = !!first && !!last && new Date(first.t).toDateString() !== new Date(last.t).toDateString();
	return out;
}

/* ── Current load (Overview) ── */

export interface Load {
	cpu: number | null;
	memory: number | null;
	disk: number | null;
	updatedAt: string;
}

/** The latest heartbeat values, or the metrics snapshot; null when there are none */
export function currentLoad(d: PanelDevice): Load | null {
	const m = obj(d.metrics);
	if (d.metrics && Object.keys(m).length) {
		return {
			cpu: num(m.cpu_usage),
			memory: num(m.memory_usage),
			disk: num(m.disk_usage),
			updatedAt: str(m.updated_at)
		};
	}
	const snap = snapshot(d, 'metrics');
	if (snap && Object.keys(snap.data).length) {
		return {
			cpu: num(snap.data.cpu_percent),
			memory: num(snap.data.memory_percent),
			disk: num(snap.data.disk_percent),
			updatedAt: snap.collectedAt
		};
	}
	return null;
}

/* ── Connection mode ── */

export interface ConnectionModeView {
	/** Show the section at all */
	shown: boolean;
	/** The support agent: one line that it stays incoming-only */
	locked: boolean;
	effective: string;
	desired: string;
	status: string;
	rejection: string;
	/** The form to switch modes */
	canChange: boolean;
}

/** Left out on clients that can't switch modes (they had only a sentence saying so) */
export function connectionModeOf(d: PanelDevice, can: Can): ConnectionModeView {
	const policy = obj(d.connection_mode);
	const command = obj(policy.command);
	const remembered = obj(policy.policy);
	const identity = identityOf(d);
	const locked = !!policy.support_agent || isSupportAgent(identity);
	const controllable = !!policy.controllable;
	return {
		shown: locked || controllable,
		locked,
		effective: str(remembered.effective_mode) || str(identity.conn_mode),
		desired: str(remembered.desired_mode),
		status: str(command.status),
		rejection: str(command.rejection_code),
		canChange:
			!locked &&
			controllable &&
			!!policy.can_change &&
			!d.banned &&
			!d.soft_deleted &&
			can('device.connection_mode')
	};
}

/** "Normal" / "Incoming only" mode summary for the Metrics tab (raw value as the server has it) */
export function effectiveMode(d: PanelDevice): string {
	const policy = obj(d.connection_mode);
	return str(policy.effective_mode) || str(policy.desired_mode) || str(obj(policy.policy).effective_mode);
}
