/**
 * Server management without a DOM: the overview's server states and chart
 * data, the file browser's paths and the services' states. The page
 * (routes/(console)/server-management) renders what these return; the unit
 * tests (tests/unit/server/management.test.ts) cover them.
 *
 * Note: this folder is not src/lib/server, which SvelteKit keeps out of
 * the browser build.
 */

import type { FileEntry, Sample, ServerPart, Service } from '#lib/api/serverManagement.ts';

/* ── Tabs ── */

export const TABS = ['overview', 'terminal', 'files', 'services'] as const;
export type Tab = (typeof TABS)[number];

/** ?tab= as the server reads it: unknown or missing is the overview */
export function tabFrom(value: string | null | undefined): Tab {
	const v = String(value ?? '').toLowerCase();
	return (TABS as readonly string[]).includes(v) ? (v as Tab) : 'overview';
}

/** Title key per tab, as the navigation names them */
export const TAB_TITLE: Record<Tab, string> = {
	overview: 'nav.server_status',
	terminal: 'server_mgmt.tab_terminal',
	files: 'server_mgmt.tab_files',
	services: 'server_mgmt.tab_services'
};

/* ── Overview ── */

export type ServerState = 'running' | 'stopped' | 'unknown';

export function serverState(part: ServerPart | null | undefined): ServerState {
	if (part && (part.status === 'running' || part.online === true)) return 'running';
	if (part && (part.status === 'stopped' || part.online === false)) return 'stopped';
	return 'unknown';
}

/** Tone and the sentence under it for the ID server (hbbs) or the relay (hbbr) */
export function serverLine(
	kind: 'hbbs' | 'hbbr',
	state: ServerState
): { tone: string; label: string; meaning: string } {
	if (state === 'running')
		return {
			tone: 'good',
			label: 'status.running',
			meaning: kind === 'hbbs' ? 'server_mgmt.id_running' : 'server_mgmt.relay_running'
		};
	if (state === 'stopped')
		return {
			tone: 'danger',
			label: 'status.stopped',
			meaning: kind === 'hbbs' ? 'dashboard.status_signal_down' : 'dashboard.status_relay_down'
		};
	return { tone: 'warning', label: 'status.unknown', meaning: 'server_mgmt.status_unknown_meaning' };
}

/** A share 0..100 for a meter, rounded */
export function share(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(100, Math.round(n)));
}

/** A disk's used share in percent (0 when the size is unknown) */
export function diskShare(d: { size?: number | null; total?: number | null; used?: number | null }): number {
	const total = Number(d.size || d.total) || 0;
	const used = Number(d.used) || 0;
	return total > 0 ? (used / total) * 100 : 0;
}

/**
 * Only the samples taken without a break up to now: older ones belong to
 * an earlier visit and would make the time axis lie. At most the last 60.
 */
export function recentRun<T extends Pick<Sample, 'ts'>>(
	history: readonly T[],
	gapMs = 10_000,
	max = 60
): T[] {
	const out: T[] = [];
	for (let i = history.length - 1; i >= 0; i--) {
		const s = history[i];
		if (!s) continue;
		const newest = out[0];
		if (newest && newest.ts - s.ts > gapMs) break;
		out.unshift(s);
	}
	return out.slice(-max);
}

export interface HistoryChart {
	times: number[];
	cpu: number[];
	mem: number[];
	spanSeconds: number;
	cpuAvg: number;
	cpuMax: number;
	memAvg: number;
	memMax: number;
}

/** The chart's numbers from the samples; null until there are two in a row */
export function historyChart(history: readonly Sample[]): HistoryChart | null {
	const run = recentRun(history);
	if (run.length < 2) return null;
	const cpu = run.map((s) => Math.round(Number(s.cpu) || 0));
	const mem = run.map((s) => Math.round(Number(s.mem) || 0));
	const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
	const first = run[0]?.ts ?? 0;
	const last = run[run.length - 1]?.ts ?? 0;
	return {
		times: run.map((s) => s.ts),
		cpu,
		mem,
		spanSeconds: Math.max(1, Math.round((last - first) / 1000)),
		cpuAvg: avg(cpu),
		cpuMax: Math.max(...cpu),
		memAvg: avg(mem),
		memMax: Math.max(...mem)
	};
}

/* ── Files ── */

export type EntryType = 'dir' | 'file' | 'symlink';

export function entryType(e: Pick<FileEntry, 'type' | 'isSymlink' | 'isDirectory'>): EntryType {
	if (e.type) return e.type;
	if (e.isSymlink) return 'symlink';
	if (e.isDirectory) return 'dir';
	return 'file';
}

/** Permission bits as four octal digits ("0644"); '' without a mode */
export function permsText(mode: number | null | undefined): string {
	if (mode === null || mode === undefined || !Number.isFinite(mode)) return '';
	return (mode & 0o7777).toString(8).padStart(4, '0');
}

const sepOf = (p: string) => (p.includes('\\') ? '\\' : '/');

export function joinPath(dir: string, name: string): string {
	const sep = sepOf(dir);
	return dir.endsWith(sep) ? dir + name : dir + sep + name;
}

/** The folder an entry is in ("/" for top-level entries) */
export function parentOf(path: string): string {
	return path.replace(/[/\\][^/\\]*$/, '') || '/';
}

/** One level up from the open folder */
export function upFrom(cwd: string): string {
	const sep = sepOf(cwd);
	const trimmed = cwd.replace(/[\\/]+$/, '');
	return trimmed.replace(/[/\\][^/\\]*$/, '') || sep;
}

/** Whether files can be changed under a root: true, false, or null when the server doesn't say */
export function rootWritable(root: string, mutable: readonly string[] | null): boolean | null {
	if (!mutable) return null;
	return mutable.some((m) => root === m || root.startsWith(m.replace(/\/+$/, '') + '/'));
}

export function countEntries(entries: readonly Pick<FileEntry, 'type' | 'isSymlink' | 'isDirectory'>[]): {
	folders: number;
	files: number;
} {
	const folders = entries.filter((e) => entryType(e) === 'dir').length;
	return { folders, files: entries.length - folders };
}

/* ── Services ── */

export function isRunning(s: Pick<Service, 'state' | 'sub'>): boolean {
	return s.state === 'active' || s.state === 'running' || s.sub === 'running';
}

/** Tone and words for a service state; `label` is a key unless `raw` */
export function serviceState(s: Pick<Service, 'state' | 'status' | 'sub'>): {
	tone: string;
	label: string;
	raw: boolean;
	sub: string;
} {
	const state = String(s.state || s.status || '').toLowerCase();
	const sub = s.sub && s.sub !== state ? s.sub : '';
	if (isRunning(s)) return { tone: 'good', label: 'status.running', raw: false, sub };
	if (state === 'failed') return { tone: 'danger', label: 'server_mgmt.svc_failed', raw: false, sub };
	if (state === 'inactive' || state === 'stopped')
		return { tone: 'neutral', label: 'status.stopped', raw: false, sub };
	if (!state) return { tone: 'neutral', label: 'status.unknown', raw: false, sub };
	return { tone: state, label: state, raw: true, sub };
}

export function filterServices<T extends Pick<Service, 'name' | 'description'>>(
	list: readonly T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q));
}

/** Actions that ask first, and which of them are dangerous */
export function confirmFor(action: string): 'none' | 'confirm' | 'danger' {
	if (action === 'restart') return 'confirm';
	if (action === 'stop' || action === 'disable') return 'danger';
	return 'none';
}

/** The row menu's extra actions: none on Windows (no systemd) */
export function menuActions(platform: string): ('reload' | 'enable' | 'disable')[] {
	return platform === 'win32' ? [] : ['reload', 'enable', 'disable'];
}
