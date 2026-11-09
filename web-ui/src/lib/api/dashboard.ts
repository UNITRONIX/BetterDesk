/**
 * The overview page (/): device counts, server status, the RustDesk client
 * values, what waits for someone, and activating a support agent from its
 * QR code (routes/dashboard.routes.js, routes/registration.routes.js,
 * routes/phase4_5.routes.js). Only what the overview reads; other pages
 * keep their own calls.
 */

import * as v from 'valibot';
import { api } from './client.ts';

/* Every key comes out set (a default when the server leaves it out), so the page reads plain values */

/** A count; missing, negative or not a number gives 0 */
const Count = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => {
			const num = Number(n);
			return Number.isFinite(num) && num > 0 ? num : 0;
		})
	),
	0
);

/** Text the server may send as null or a number; missing gives '' */
const Str = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

const Flag = v.optional(
	v.pipe(
		v.nullable(v.boolean()),
		v.transform((b) => b === true)
	),
	false
);

/* ── Device counts (any signed-in account) ── */

export const DeviceStats = v.looseObject({
	total: Count,
	online: Count,
	offline: Count,
	banned: Count
});
export type DeviceStats = v.InferOutput<typeof DeviceStats>;

const Stats = v.pipe(
	v.looseObject({
		data: v.looseObject({ devices: v.optional(v.nullable(DeviceStats)) })
	}),
	v.transform((o) => o.data.devices ?? { total: 0, online: 0, offline: 0, banned: 0 })
);

export function getDeviceStats(signal?: AbortSignal): Promise<DeviceStats> {
	return api(Stats, '/api/stats', { signal });
}

/* ── Server status (any signed-in account) ── */

/** One server process: { status: 'running' } or { online: true }; null when the server didn't say */
const Part = v.optional(
	v.nullable(
		v.looseObject({
			status: v.optional(v.nullable(v.string()), null),
			online: v.optional(v.nullable(v.boolean()), null)
		})
	),
	null
);

/** A port number as text; null when missing or 0 */
const Port = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => (n === null || n === '' || n === 0 ? null : String(n)))
	),
	null
);

/** Seconds the console has been running; null when missing */
const Seconds = v.optional(
	v.pipe(
		v.nullable(v.union([v.number(), v.string()])),
		v.transform((n) => (n === null || n === '' || !Number.isFinite(Number(n)) ? null : Number(n)))
	),
	null
);

export const ServerStatus = v.looseObject({
	uptime: Seconds,
	hbbs: Part,
	hbbr: Part,
	api_port: Port,
	signal_port: Port,
	hbbs_port: Port,
	relay_port: Port,
	hbbr_port: Port,
	nat_port: Port,
	ws_signal_port: Port,
	ws_relay_port: Port,
	client_api_port: Port,
	console_port: Port
});
export type ServerStatus = v.InferOutput<typeof ServerStatus>;

export async function getServerStatus(signal?: AbortSignal): Promise<ServerStatus> {
	const out = await api(v.looseObject({ data: ServerStatus }), '/api/server/status', { signal });
	return out.data;
}

/* ── RustDesk client values (any signed-in account) ── */

export const ClientConfig = v.looseObject({
	server_id: Str,
	relay_server: Str,
	api_url: Str,
	public_key: Str,
	deploy_config_string: Str,
	/** rustdesk://config/...: what the QR code holds */
	config_uri: Str,
	/** The address the values were built for (the field shows it) */
	client_server_host: Str,
	/** Settings › Public client endpoints decides; the field can't change it */
	env_override_active: Flag,
	/** localhost or a .local name: other machines and phones can't reach it */
	phone_unreachable_host: Flag
});
export type ClientConfig = v.InferOutput<typeof ClientConfig>;

/** `host`: the address typed into the overview for this tab (?host=), or '' for the server's own */
export async function getClientConfig(host: string, signal?: AbortSignal): Promise<ClientConfig> {
	const out = await api(v.looseObject({ data: ClientConfig }), '/api/dashboard/client-config', {
		query: { host: host || undefined },
		signal
	});
	return out.data;
}

/* ── What waits for someone ── */

/** Enrollment requests waiting for approval (enrollment.approve) */
export async function countRegistrations(signal?: AbortSignal): Promise<number> {
	const out = await api(v.looseObject({ count: Count }), '/api/registrations/count', { signal });
	return out.count;
}

const HelpList = v.looseObject({
	requests: v.optional(v.nullable(v.array(v.looseObject({ status: Str }))), null)
});

/** Help requests nobody has taken yet (chat.access) */
export async function countOpenHelpRequests(signal?: AbortSignal): Promise<number> {
	const out = await api(HelpList, '/api/help/requests', { signal });
	return (out.requests ?? []).filter((r) => r.status === 'pending').length;
}

/* ── Activating a support agent (enrollment.approve) ── */

const Pending = v.looseObject({
	data: v.optional(v.nullable(v.array(v.looseObject({ device_id: Str, hostname: Str }))), null)
});

/** Agents waiting for activation: their ID and the host name they reported */
export async function listPendingAgents(
	signal?: AbortSignal
): Promise<{ device_id: string; hostname: string }[]> {
	const out = await api(Pending, '/api/enrollment/pending', { signal });
	return (out.data ?? []).map((p) => ({ device_id: p.device_id, hostname: p.hostname }));
}

export interface Activation {
	device_id: string;
	display_name: string;
	/** 0 for no folder */
	folder_id: number;
}

/** Approves the waiting agent (or renames it when it is already in), and puts it in a folder */
export async function activateAgent(body: Activation): Promise<void> {
	await api(v.looseObject({ success: v.literal(true) }), '/api/agent-pairing/activate', {
		method: 'POST',
		body
	});
}
