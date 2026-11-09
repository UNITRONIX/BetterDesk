/**
 * The device panel's calls beyond the device record itself
 * (routes/devices.routes.js, routes/inventory.routes.js): availability
 * history, connection sessions, the agent's inventory report, and the live
 * views read from the device's agent (services, processes, events,
 * activity, files) with the commands that go back to it.
 *
 * Agent replies (proxyAgentRequest): `{ success, data }` when the agent
 * answered; `{ success, cached: true, collected_at, data }` with the last
 * snapshot while it is offline; `202 { success, pending: true, data }` when
 * the request waits for the next check-in. Failures are 503 agent_offline,
 * 504 agent_timeout or 502 with a code (not translated text).
 */

import * as v from 'valibot';
import { ApiError, api, request, wrapped, BoolLike, Text, Ok } from './client.ts';

const enc = encodeURIComponent;
const NullableNum = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()]))),
	v.transform((n) => (n === null || n === undefined || n === '' ? null : Number(n)))
);
const list = <S extends v.GenericSchema>(item: S) =>
	v.pipe(
		v.optional(v.nullable(v.array(item))),
		v.transform((a) => a ?? [])
	);

/* ── Availability history and connection sessions ── */

export const AvailabilityEvent = v.looseObject({
	from_status: Text,
	to_status: Text,
	source: Text,
	created_at: Text
});
export type AvailabilityEvent = v.InferOutput<typeof AvailabilityEvent>;

export const Availability = v.looseObject({
	enabled: BoolLike,
	day: Text,
	retention_days: NullableNum,
	events: list(AvailabilityEvent)
});
export type Availability = v.InferOutput<typeof Availability>;

/** Status changes on one day (YYYY-MM-DD in the browser's time zone) */
export function getAvailability(id: string, day: string, signal?: AbortSignal): Promise<Availability> {
	return api(wrapped(Availability), `/api/devices/${enc(id)}/availability`, {
		signal,
		query: { day, tz_offset: new Date().getTimezoneOffset() }
	});
}

export const ConnectionSession = v.looseObject({
	started_at: Text,
	ended_at: Text,
	duration_seconds: NullableNum,
	username: Text,
	peer_name: Text,
	peer_id: Text,
	peer_ip: Text,
	transport: Text,
	active: BoolLike
});
export type ConnectionSession = v.InferOutput<typeof ConnectionSession>;

export async function getConnectionSessions(id: string, signal?: AbortSignal): Promise<ConnectionSession[]> {
	const out = await api(
		wrapped(v.looseObject({ sessions: list(ConnectionSession) })),
		`/api/devices/${enc(id)}/connection-sessions`,
		{ signal, query: { limit: 50 } }
	);
	return out.sessions ?? [];
}

/* ── The agent's inventory report ── */

/**
 * GET /api/inventory/:id answers the report unwrapped, or 404 when the agent
 * never sent one (null here). Its shape differs between agent versions, so
 * it stays loose; panel-logic.ts reads it.
 */
export async function getInventoryReport(
	id: string,
	signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
	try {
		const data = await request(`/api/inventory/${enc(id)}`, { signal });
		if (data && typeof data === 'object' && !Array.isArray(data)) {
			const o = data as Record<string, unknown>;
			// Some proxies wrap it
			if (o.success === true && o.data && typeof o.data === 'object')
				return o.data as Record<string, unknown>;
			return o;
		}
		return {};
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

/* ── Live views read from the agent ── */

export type AgentView = 'services' | 'processes' | 'events' | 'activity';

const AgentReply = v.looseObject({
	pending: v.optional(v.boolean()),
	cached: v.optional(v.boolean()),
	collected_at: Text,
	data: v.optional(v.unknown())
});

export interface AgentResult {
	/** The request waits for the device's next check-in */
	pending: boolean;
	/** The last snapshot (the agent is offline); collectedAt says when */
	cached: boolean;
	collectedAt: string;
	data: unknown;
}

function agentResult(reply: v.InferOutput<typeof AgentReply>): AgentResult {
	const inner = reply.data;
	const innerPending =
		!!inner && typeof inner === 'object' && (inner as { pending?: unknown }).pending === true;
	return {
		pending: reply.pending === true || innerPending,
		cached: reply.cached === true,
		collectedAt: reply.collected_at ?? '',
		data: innerPending ? null : (inner ?? null)
	};
}

export async function getAgentView(id: string, view: AgentView, signal?: AbortSignal): Promise<AgentResult> {
	const reply = await api(AgentReply, `/api/devices/${enc(id)}/${view}`, {
		signal,
		query: view === 'events' ? { limit: 200 } : undefined
	});
	return agentResult(reply);
}

export async function browseFiles(id: string, path: string, signal?: AbortSignal): Promise<AgentResult> {
	const reply = await api(AgentReply, `/api/devices/${enc(id)}/files/browse`, {
		method: 'POST',
		body: { path, show_hidden: false },
		signal
	});
	return agentResult(reply);
}

/** Up to 1 MiB of a file, base64 in data.data */
export async function readFile(id: string, path: string): Promise<AgentResult> {
	const reply = await api(AgentReply, `/api/devices/${enc(id)}/files/read`, {
		method: 'POST',
		body: { path, offset: 0, length: 1024 * 1024 }
	});
	return agentResult(reply);
}

/** Ask the device to send its hardware details again (202) */
export function refreshTelemetry(id: string) {
	return api(Ok, `/api/devices/${enc(id)}/telemetry/refresh`, { method: 'POST' });
}

export type AgentCommand =
	| { command: 'service.control'; args: { name: string; action: 'start' | 'stop' } }
	| { command: 'process.terminate'; args: { pid: number } };

/** A command for the agent; true when it waits for the next check-in */
export async function sendAgentCommand(id: string, cmd: AgentCommand): Promise<boolean> {
	const reply = await api(AgentReply, `/api/devices/${enc(id)}/telemetry/command`, {
		method: 'POST',
		body: cmd
	});
	return agentResult(reply).pending;
}

/* ── Agent calls the panel doesn't offer yet (kept with their routes) ── */

/** Whether the device has a connect password, and the password for device.connect */
export const ConnectPassword = v.looseObject({
	password_set: BoolLike,
	password: v.optional(v.nullable(v.string()))
});

export function getConnectPassword(id: string, signal?: AbortSignal) {
	return api(ConnectPassword, `/api/devices/${enc(id)}/connect-password`, { signal });
}

export async function getClipboard(id: string): Promise<AgentResult> {
	return agentResult(await api(AgentReply, `/api/devices/${enc(id)}/clipboard`));
}

export function setClipboard(id: string, text: string) {
	return api(Ok, `/api/devices/${enc(id)}/clipboard`, { method: 'POST', body: { text } });
}

/** A JPEG of the screen, base64 */
export async function takeScreenshot(id: string): Promise<AgentResult> {
	return agentResult(await api(AgentReply, `/api/devices/${enc(id)}/screenshot`, { method: 'POST' }));
}

/** One command without a terminal (30 s), as the server's audit log records it */
export async function executeCommand(id: string, command: string): Promise<AgentResult> {
	return agentResult(
		await api(AgentReply, `/api/devices/${enc(id)}/terminal/execute`, { method: 'POST', body: { command } })
	);
}
