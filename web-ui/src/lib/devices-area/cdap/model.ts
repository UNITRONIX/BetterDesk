/**
 * IoT device (CDAP) pages without a DOM: reading a device's manifest and
 * widget values, the list's search and type filter, the table widget's
 * search, sort and pages, the command cooldown and log, alerts, linked
 * devices and the file browser's paths.
 *
 * Manifests come from devices, and two spellings are in use: the one the old
 * console read (read_only, category, confirm as text, decimals, series key,
 * firmware_version) and the Go gateway's (readonly, group, confirm plus
 * confirm_message, precision, series id, firmware). Both are read. Every
 * value from a device is text to the page; nothing here builds markup.
 */

export const DEVICE_TYPES = ['iot', 'scada', 'os_agent', 'network', 'camera', 'custom'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Longest list the page draws per manifest (the gateway's own limit) */
export const MAX_WIDGETS = 200;

type Obj = Record<string, unknown>;

const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);

/** Text from a string or a number; anything else is empty */
export function str(x: unknown): string {
	if (typeof x === 'string') return x;
	if (typeof x === 'number' && Number.isFinite(x)) return String(x);
	return '';
}

function num(x: unknown, fallback: number): number {
	const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
	return Number.isFinite(n) ? n : fallback;
}

function optNum(x: unknown): number | null {
	const n = num(x, NaN);
	return Number.isFinite(n) ? n : null;
}

/* ── Manifest ── */

export interface WidgetOption {
	value: string;
	label: string;
}
export interface ChartSeries {
	key: string;
	label: string;
	min: number;
	max: number;
}
export type CellType = 'text' | 'badge' | 'datetime' | 'number' | 'action' | 'boolean';
export interface TableAction {
	label: string;
	action: string;
}
export interface TableColumn {
	id: string;
	label: string;
	type: CellType;
	decimals: number;
	suffix: string;
	actions: TableAction[];
}
export type WidgetSize = '' | 'sm' | 'md' | 'lg' | 'xl';

export interface Widget {
	id: string;
	type: string;
	label: string;
	unit: string;
	category: string;
	readOnly: boolean;
	min: number;
	max: number;
	step: number;
	/** Digits after the point; null: the widget type's default */
	decimals: number | null;
	/** null: no confirmation; '' confirm with the default question */
	confirm: string | null;
	size: WidgetSize;
	options: WidgetOption[];
	series: ChartSeries[];
	columns: TableColumn[];
	pageSize: number;
	sortable: boolean;
}

export interface Manifest {
	name: string;
	type: string;
	firmware: string;
	widgets: Widget[];
}

export const EMPTY_MANIFEST: Manifest = { name: '', type: '', firmware: '', widgets: [] };

/** Widgets that open their own connection (a button starts it) */
export const STREAM_TYPES = new Set(['terminal', 'desktop', 'video_stream', 'file_browser', 'audio']);
/** Widgets that send commands, so the page keeps a log of them */
export const COMMAND_TYPES = new Set(['toggle', 'button', 'slider', 'select', 'file_browser', 'table']);

function sizeOf(type: string, size: unknown): WidgetSize {
	if (size === 'large') return 'lg';
	if (size === 'small') return 'sm';
	switch (type) {
		case 'chart':
		case 'table':
		case 'terminal':
		case 'file_browser':
			return 'lg';
		case 'desktop':
		case 'video_stream':
			return 'xl';
		case 'audio':
			return 'md';
		case 'text':
		case 'led':
			return 'sm';
		default:
			return '';
	}
}

function cellType(t: unknown): CellType {
	switch (t) {
		case 'badge':
			return 'badge';
		case 'datetime':
		case 'date':
			return 'datetime';
		case 'number':
			return 'number';
		case 'action':
			return 'action';
		case 'boolean':
			return 'boolean';
		default:
			return 'text';
	}
}

function readColumn(c: unknown): TableColumn | null {
	if (!isObj(c)) return null;
	const id = str(c.id) || str(c.label);
	if (!id) return null;
	const label = str(c.label) || id;
	const actions = Array.isArray(c.actions)
		? c.actions
				.filter(isObj)
				.map((a) => ({ label: str(a.label) || label, action: str(a.action) || 'execute' }))
		: [{ label, action: str(c.action) || 'execute' }];
	return {
		id,
		label,
		type: cellType(c.type),
		decimals: Math.max(0, Math.min(10, Math.round(num(c.decimals, 0)))),
		suffix: str(c.suffix),
		actions
	};
}

function readWidget(w: unknown): Widget | null {
	if (!isObj(w)) return null;
	const id = str(w.id);
	const type = str(w.type);
	if (!id || !type) return null;
	let confirm: string | null = null;
	if (typeof w.confirm === 'string' && w.confirm.trim()) confirm = w.confirm;
	else if (w.confirm === true) confirm = str(w.confirm_message);
	const decimals = optNum(w.decimals) ?? optNum(w.precision);
	return {
		id,
		type,
		label: str(w.label) || id,
		unit: str(w.unit),
		category: str(w.category) || str(w.group),
		readOnly: w.read_only === true || w.readonly === true,
		min: num(w.min, 0),
		max: num(w.max, 100),
		step: num(w.step, 1) || 1,
		decimals: decimals === null ? null : Math.max(0, Math.min(10, Math.round(decimals))),
		confirm,
		size: sizeOf(type, w.size),
		options: Array.isArray(w.options)
			? w.options.map((o) =>
					isObj(o)
						? { value: str(o.value), label: str(o.label) || str(o.value) }
						: { value: str(o), label: str(o) }
				)
			: [],
		series: Array.isArray(w.series)
			? w.series.filter(isObj).map((s) => {
					const key = str(s.key) || str(s.id) || str(s.label);
					return { key, label: str(s.label) || key, min: num(s.min, 0), max: num(s.max, 100) };
				})
			: [],
		columns: Array.isArray(w.columns)
			? w.columns.map(readColumn).filter((c): c is TableColumn => c !== null)
			: [],
		pageSize: Math.max(1, Math.min(500, Math.round(num(w.page_size, 25)))),
		sortable: w.sortable === true
	};
}

/** A manifest as the device sent it (an object, or JSON text in the device list) */
export function readManifest(raw: unknown): Manifest {
	let m: unknown = raw;
	if (typeof m === 'string') {
		try {
			m = JSON.parse(m);
		} catch {
			return EMPTY_MANIFEST;
		}
	}
	if (!isObj(m)) return EMPTY_MANIFEST;
	const device = isObj(m.device) ? m.device : {};
	const seen = new Set<string>();
	const widgets: Widget[] = [];
	if (Array.isArray(m.widgets)) {
		for (const raw of m.widgets) {
			if (widgets.length >= MAX_WIDGETS) break;
			const w = readWidget(raw);
			// One widget per id: the page addresses widgets by it
			if (!w || seen.has(w.id)) continue;
			seen.add(w.id);
			widgets.push(w);
		}
	}
	return {
		name: str(device.name),
		type: str(device.type),
		firmware: str(device.firmware_version) || str(device.firmware),
		widgets
	};
}

export interface WidgetGroup {
	/** '' for widgets without a category (no heading) */
	category: string;
	widgets: Widget[];
}

/** Widgets by category, in the order the categories first appear */
export function groupWidgets(widgets: readonly Widget[]): WidgetGroup[] {
	const groups: WidgetGroup[] = [];
	const at = new Map<string, WidgetGroup>();
	for (const w of widgets) {
		let g = at.get(w.category);
		if (!g) {
			g = { category: w.category, widgets: [] };
			at.set(w.category, g);
			groups.push(g);
		}
		g.widgets.push(w);
	}
	return groups;
}

export function hasCommands(widgets: readonly Widget[]): boolean {
	return widgets.some((w) => COMMAND_TYPES.has(w.type));
}

/* ── Widget values ── */

export function isOn(v: unknown): boolean {
	return v === true || v === 1 || v === 'on' || v === 'true' || v === '1';
}

/** A number from a value, or null */
export function numberOf(v: unknown): number | null {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = parseFloat(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
}

/** Where a value sits between min and max, 0 to 100 */
export function percentOf(value: number, min: number, max: number): number {
	if (!(max > min)) return 0;
	return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/** A gauge turns warning above 70 % and danger above 90 % of its range */
export function gaugeTone(pct: number): 'normal' | 'warning' | 'danger' {
	if (pct > 90) return 'danger';
	if (pct > 70) return 'warning';
	return 'normal';
}

/** Text for a value the device reports as text */
export function textOf(v: unknown): string {
	if (v === null || v === undefined) return '';
	if (typeof v === 'string') return v;
	if (typeof v === 'number' || typeof v === 'boolean') return String(v);
	try {
		return JSON.stringify(v);
	} catch {
		return '';
	}
}

/** Lines a terminal widget reports through its state (not the live terminal) */
export const MAX_TERMINAL_LINES = 500;

export function terminalLines(previous: readonly string[], value: unknown, last: unknown): string[] {
	if (Array.isArray(value)) return value.map(textOf).slice(-MAX_TERMINAL_LINES);
	// A single line is the latest one; the same value on the next poll is not a new line
	if (typeof value === 'string' && value !== last) return [...previous, value].slice(-MAX_TERMINAL_LINES);
	return previous as string[];
}

/* ── Table widget ── */

export type Row = Record<string, unknown>;

export function cellValue(row: Row, col: TableColumn): unknown {
	return row[col.id] ?? row[col.label] ?? '';
}

export function tableRows(value: unknown): Row[] {
	return Array.isArray(value) ? value.filter(isObj) : [];
}

export function filterRows(rows: readonly Row[], columns: readonly TableColumn[], query: string): Row[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows as Row[];
	return rows.filter((r) => columns.some((c) => textOf(cellValue(r, c)).toLowerCase().includes(q)));
}

/** Ascending order of one column: numbers as numbers, text in the console language's order */
export function compareCells(col: TableColumn, locale?: string): (a: Row, b: Row) => number {
	const collator = new Intl.Collator(locale, { numeric: true });
	return (a, b) => {
		const x = cellValue(a, col);
		const y = cellValue(b, col);
		const nx = numberOf(x);
		const ny = numberOf(y);
		return nx !== null && ny !== null ? nx - ny : collator.compare(textOf(x), textOf(y));
	};
}

/** The whole list sorted (before it is split into pages), ties in their own order */
export function sortRows(
	rows: readonly Row[],
	col: TableColumn | undefined,
	dir: 'asc' | 'desc',
	locale?: string
): Row[] {
	if (!col) return rows as Row[];
	const cmp = compareCells(col, locale);
	const sign = dir === 'asc' ? 1 : -1;
	return rows
		.map((r, i) => ({ r, i }))
		.sort((a, b) => cmp(a.r, b.r) * sign || a.i - b.i)
		.map((x) => x.r);
}

export interface TablePage {
	rows: Row[];
	page: number;
	pages: number;
	/** 1-based first and last row shown, 0 when none */
	from: number;
	to: number;
	total: number;
}

export function pageOf(rows: readonly Row[], page: number, size: number): TablePage {
	const total = rows.length;
	const pages = Math.max(1, Math.ceil(total / size));
	const p = Math.min(Math.max(0, page), pages - 1);
	const start = p * size;
	const slice = rows.slice(start, start + size);
	return { rows: slice, page: p, pages, from: total ? start + 1 : 0, to: start + slice.length, total };
}

/* ── Device list ── */

export interface DeviceLike {
	id: string;
	connected?: boolean;
	manifest?: unknown;
	hostname?: string;
	username?: string;
	client_ip?: string;
	connected_at?: string;
	heartbeat_count?: number;
}

export interface ListedDevice<D extends DeviceLike = DeviceLike> {
	device: D;
	name: string;
	type: string;
	widgets: number;
}

export function describeDevice<D extends DeviceLike>(device: D): ListedDevice<D> {
	const m = readManifest(device.manifest);
	return {
		device,
		name: m.name || device.hostname || device.id,
		type: m.type || 'custom',
		widgets: m.widgets.length
	};
}

/** The name of a known type, or the type as the device wrote it */
export function typeLabelKey(type: string): string | null {
	return (DEVICE_TYPES as readonly string[]).includes(type) ? `cdap.type_${type}` : null;
}

export function filterListed<D extends DeviceLike>(
	list: readonly ListedDevice<D>[],
	type: string,
	query: string
): ListedDevice<D>[] {
	const q = query.trim().toLowerCase();
	return list.filter((x) => {
		if (type && x.type !== type) return false;
		if (!q) return true;
		const hay = [x.device.id, x.name, x.type, x.device.username ?? '', x.device.client_ip ?? '']
			.join(' ')
			.toLowerCase();
		return hay.includes(q);
	});
}

/** Seconds since the device connected, null when it isn't connected or the time is unknown */
export function connectedSeconds(d: DeviceLike, now: number = Date.now()): number | null {
	if (!d.connected || !d.connected_at) return null;
	const at = Date.parse(d.connected_at);
	if (!Number.isFinite(at)) return null;
	return Math.max(0, (now - at) / 1000);
}

/* ── Commands ── */

export const COOLDOWN_MS = 1000;
export const MAX_LOG = 50;

/** One command per widget per second; a second one within that second is dropped */
export class CommandGate {
	#last = new Map<string, number>();
	allow(widgetId: string, now: number = Date.now()): boolean {
		const t = this.#last.get(widgetId);
		if (t !== undefined && now - t < COOLDOWN_MS) return false;
		this.#last.set(widgetId, now);
		return true;
	}
}

export interface LogEntry {
	id: number;
	time: Date;
	widgetId: string;
	action: string;
	value: unknown;
	ok: boolean;
	error: string;
}

/** Newest first, at most MAX_LOG */
export function addLog(log: readonly LogEntry[], entry: LogEntry): LogEntry[] {
	return [entry, ...log].slice(0, MAX_LOG);
}

/* ── Alerts ── */

export type Severity = 'critical' | 'warning' | 'info';

export interface AlertLike {
	label?: string;
	message?: string;
	severity?: string;
	firing?: boolean;
	fired_at?: string;
}

export function severityOf(s: string | undefined): Severity {
	return s === 'critical' || s === 'warning' ? s : 'info';
}

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

/** Alerts firing now, the most severe first */
export function firingAlerts<A extends AlertLike>(alerts: readonly A[]): A[] {
	return alerts
		.filter((a) => a.firing)
		.map((a, i) => ({ a, i }))
		.sort((x, y) => ORDER[severityOf(x.a.severity)] - ORDER[severityOf(y.a.severity)] || x.i - y.i)
		.map((x) => x.a);
}

export function severityTone(s: Severity): 'danger' | 'warning' | 'neutral' {
	return s === 'critical' ? 'danger' : s === 'warning' ? 'warning' : 'neutral';
}

/* ── Linked devices ── */

export function peerOnline(p: { live_online?: boolean; status?: string }): boolean {
	return p.live_online === true || p.status === 'online';
}

/* ── File browser ── */

export interface FileEntry {
	name: string;
	dir: boolean;
	size: number | null;
	modified: string;
}

/** Entries from a file list (live: is_dir; from the widget state: type 'dir'), folders first */
export function readEntries(list: unknown, locale?: string): FileEntry[] {
	if (!Array.isArray(list)) return [];
	const collator = new Intl.Collator(locale, { numeric: true });
	return list
		.filter(isObj)
		.map((e) => ({
			name: str(e.name),
			dir: e.is_dir === true || e.type === 'dir',
			size: optNum(e.size),
			modified: str(e.modified)
		}))
		.filter((e) => e.name !== '' && e.name !== '.' && e.name !== '..' && !/[/\\\0]/.test(e.name))
		.sort((a, b) => (a.dir === b.dir ? collator.compare(a.name, b.name) : a.dir ? -1 : 1));
}

export function joinPath(dir: string, name: string): string {
	return (dir.replace(/\/+$/, '') || '') + '/' + name;
}

export function parentPath(dir: string): string {
	const parts = dir.split('/').filter(Boolean);
	parts.pop();
	return '/' + parts.join('/');
}

/** A plain file mark per kind; folders get their own */
export function fileIcon(e: FileEntry): string {
	return e.dir ? 'folder' : 'description';
}
