/**
 * The hardware list's rules without a DOM: names, the system without its
 * version twice, search, the count sentence, the systems across all
 * devices and the devices short of space.
 */

import type { InventoryRow } from '#lib/api/inventory.ts';
import { platformId } from '#lib/util/display.ts';
import type { Sentence } from './sentences.ts';

/** Disks and memory above this share count as almost full */
export const FULL_PERCENT = 90;
/** Rows in the side column's list of systems */
export const OS_ROWS = 6;

/** 0 to 100, or null without both numbers */
export function percent(used: number | null, total: number | null): number | null {
	if (!total || total <= 0 || used === null) return null;
	return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

export const memoryPercent = (r: InventoryRow) => percent(r.memory_used_mb, r.memory_total_mb);

/** The host name, unless it is only the ID again */
export function rowName(r: InventoryRow): string {
	return r.hostname && r.hostname !== r.device_id ? r.hostname : '';
}

/**
 * The system as the device reports it, without the version twice
 * ("macOS 15.1" with version "15.1" reads "macOS 15.1", not "macOS 15.1 15.1")
 */
export function osText(r: Pick<InventoryRow, 'os' | 'os_name'>): string {
	const full = r.os.trim();
	const name = r.os_name.trim();
	if (!name || !full.startsWith(name)) return full;
	const version = full.slice(name.length).trim();
	if (!version) return name;
	return name.split(/\s+/).includes(version) ? name : full;
}

/** The system without build numbers: "Windows 11 Pro", "Ubuntu 24.04" */
export function osName(r: Pick<InventoryRow, 'os' | 'os_name'>): string {
	if (r.os_name.trim()) return r.os_name.trim();
	return r.os.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

export type OsFamily = 'windows' | 'linux' | 'apple' | 'other';

export function osFamily(os: string): OsFamily {
	const id = platformId(os);
	return id === 'windows' || id === 'linux' || id === 'apple' ? id : 'other';
}

/** ID, host name, system or CPU contains the text (any case) */
export function matches(r: InventoryRow, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [r.device_id, r.hostname, r.os, r.cpu].some((v) => v.toLowerCase().includes(q));
}

/**
 * The line over the table: how many devices, the average CPU load, and how
 * many the search shows. The plain device list says no report came yet.
 */
export function countLine(
	rows: InventoryRow[],
	peerList: boolean,
	searching: boolean,
	shown: number
): Sentence[] {
	if (!rows.length) return [];
	if (peerList) return [{ key: 'inventory.count_no_reports', params: { count: rows.length } }];
	const out: Sentence[] = [
		rows.length === 1
			? { key: 'inventory.count_one' }
			: { key: 'inventory.count_many', params: { count: rows.length } }
	];
	const loads = rows.map((r) => r.cpu_usage).filter((v): v is number => v !== null);
	if (loads.length) {
		const avg = loads.reduce((s, v) => s + v, 0) / loads.length;
		out.push({ key: 'inventory.count_cpu', params: { cpu: Math.round(avg) } });
	}
	if (searching) out.push({ key: 'inventory.count_shown', params: { count: shown } });
	return out;
}

export interface OsSummary {
	families: { id: OsFamily; count: number }[];
	/** The most common systems, most first, then by name */
	top: { name: string; count: number }[];
	/** Systems not in `top` */
	more: number;
}

export function osSummary(rows: InventoryRow[], collator: Intl.Collator = new Intl.Collator()): OsSummary {
	const withOs = rows.filter((r) => osName(r));
	const order: OsFamily[] = ['windows', 'linux', 'apple', 'other'];
	const families = order
		.map((id) => ({ id, count: withOs.filter((r) => osFamily(r.os || r.os_name) === id).length }))
		.filter((f) => f.count > 0);
	const counts = new Map<string, number>();
	for (const r of withOs) counts.set(osName(r), (counts.get(osName(r)) ?? 0) + 1);
	const ranked = [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
	return { families, top: ranked.slice(0, OS_ROWS), more: Math.max(0, ranked.length - OS_ROWS) };
}

/** Whether any device reported its fullest disk (older agents don't) */
export const hasDiskData = (rows: InventoryRow[]) => rows.some((r) => r.disk_max_used_percent !== null);

/** Devices with a disk over FULL_PERCENT, fullest first */
export function fullDisks(rows: InventoryRow[]): InventoryRow[] {
	return rows
		.filter((r) => (r.disk_max_used_percent ?? 0) > FULL_PERCENT)
		.sort((a, b) => (b.disk_max_used_percent ?? 0) - (a.disk_max_used_percent ?? 0));
}

/** Devices using more than FULL_PERCENT of their memory, fullest first */
export function fullMemory(rows: InventoryRow[]): { row: InventoryRow; pct: number }[] {
	return rows
		.map((row) => ({ row, pct: memoryPercent(row) }))
		.filter((x): x is { row: InventoryRow; pct: number } => x.pct !== null && x.pct > FULL_PERCENT)
		.sort((a, b) => b.pct - a.pct);
}
