/**
 * The hardware list (routes/inventory.routes.js, GET /api/inventory): one
 * row per device whose agent sent a report, or the plain device list
 * (source "peer_list") when no agent ever did. Paged by the server; the
 * page reads every page. A device's full report is in the device panel
 * (api/device-agent.ts).
 */

import * as v from 'valibot';
import { api } from './client.ts';

const Str = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

/** A number the server may leave out or send as text; null when unknown */
const Num = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => {
			if (n === null || n === '') return null;
			const num = Number(n);
			return Number.isFinite(num) ? num : null;
		})
	),
	null
);

export const InventoryRow = v.looseObject({
	device_id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	hostname: Str,
	os: Str,
	os_name: Str,
	cpu: Str,
	cpu_cores: Num,
	cpu_usage: Num,
	memory_total_mb: Num,
	memory_used_mb: Num,
	disk_count: Num,
	/** The fullest disk: its use in percent, mount point and free bytes */
	disk_max_used_percent: Num,
	disk_max_mount: Str,
	disk_max_free_bytes: Num,
	collected_at: Str,
	last_seen: Str,
	source: Str
});
export type InventoryRow = v.InferOutput<typeof InventoryRow>;

const Page = v.looseObject({
	devices: v.optional(v.nullable(v.array(InventoryRow)), null),
	total_pages: Num
});

/** The most pages read (100 rows each), as the old page did */
export const MAX_PAGES = 50;

function getPage(page: number, signal?: AbortSignal) {
	return api(Page, '/api/inventory', { query: { limit: 100, page }, signal });
}

/**
 * Every row: the first page, then the rest at the same time. `peerList` is
 * true when the rows are the plain device list (no agent sent a report).
 */
export async function listInventory(
	signal?: AbortSignal
): Promise<{ rows: InventoryRow[]; peerList: boolean }> {
	const first = await getPage(1, signal);
	const pages = Math.min(MAX_PAGES, Math.max(1, first.total_pages ?? 1));
	const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => getPage(i + 2, signal)));
	const rows = [first, ...rest].flatMap((p) => p.devices ?? []);
	return { rows, peerList: rows.some((r) => r.source === 'peer_list') };
}
