/**
 * IoT devices through the CDAP gateway (routes/cdap.routes.js, which passes
 * the Go server's answers through flat).
 *
 * Two quirks of that route the schemas absorb:
 * - A failed Go call does not change the HTTP status: the route answers 200
 *   with `{ success: false, error: "Request failed with status code 404" }`.
 *   failed() turns that into an ApiError with the status from the message.
 * - Some answers may arrive wrapped as `{ success: true, data }`; unwrap()
 *   takes the inner value, so both shapes work.
 *
 * The manifest and the widget state come from the device and stay loose
 * here; lib/devices-area/cdap/model.ts reads them.
 */

import * as v from 'valibot';
import { ApiError, BoolLike, Text, api, clientMessages, request } from './client.ts';

const enc = encodeURIComponent;

/** An answer that says it failed, as an error (with the Go status when the message names one) */
function failed(data: unknown): ApiError | null {
	if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
	const o = data as Record<string, unknown>;
	const error = typeof o.error === 'string' ? o.error : '';
	if (o.success !== false && !(error && Object.keys(o).every((k) => k === 'error' || k === 'success')))
		return null;
	const m = /status code (\d{3})/i.exec(error);
	const status = m ? Number(m[1]) : 502;
	return new ApiError(error || `HTTP ${status}`, status, { data });
}

function unwrap(data: unknown): unknown {
	if (data && typeof data === 'object' && !Array.isArray(data)) {
		const o = data as Record<string, unknown>;
		if (o.success === true && 'data' in o) return o.data;
	}
	return data;
}

async function get(path: string, opts: { signal?: AbortSignal; query?: Record<string, string> } = {}) {
	const data = await request(path, { signal: opts.signal, query: opts.query });
	const err = failed(data);
	if (err) throw err;
	return unwrap(data);
}

function parse<S extends v.GenericSchema>(schema: S, data: unknown, path: string): v.InferOutput<S> {
	const r = v.safeParse(schema, data);
	if (!r.success) {
		console.error('Unexpected response', path, r.issues[0] ? v.getDotPath(r.issues[0]) : '');
		throw new ApiError(clientMessages.invalid, 200, { code: 'invalid_response', data });
	}
	return r.output;
}

const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), 0),
	v.transform((n) => {
		const x = Number(n);
		return Number.isFinite(x) ? x : 0;
	})
);

/* ── Gateway ── */

export const GatewayStatus = v.looseObject({
	enabled: BoolLike,
	connected: Num,
	port: Num,
	tls: BoolLike
});
export type GatewayStatus = v.InferOutput<typeof GatewayStatus>;

export async function getGatewayStatus(signal?: AbortSignal): Promise<GatewayStatus> {
	return parse(GatewayStatus, await get('/api/cdap/status', { signal }), '/api/cdap/status');
}

const Toggle = v.looseObject({
	success: v.optional(v.boolean()),
	enabled: v.optional(v.boolean()),
	restartRequired: v.optional(v.nullable(v.looseObject({ id: v.string() })))
});

/** Turn the gateway on or off (server.config); it changes after the next server restart */
export async function toggleGateway(enabled: boolean) {
	const data = await request('/api/cdap/toggle', { method: 'POST', body: { enabled } });
	const err = failed(data);
	if (err) throw err;
	return parse(Toggle, data, '/api/cdap/toggle');
}

/* ── Devices ── */

/** A connected device as the gateway lists it (cdap.DeviceInfo) */
export const CdapDevice = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	connected: v.pipe(
		v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), true),
		// The list holds connected devices; only an explicit false says otherwise
		v.transform((b) => !(b === false || b === 0 || b === '0' || b === 'false'))
	),
	manifest: v.optional(v.unknown()),
	widget_state: v.optional(v.unknown()),
	connected_at: Text,
	last_heartbeat: Text,
	heartbeat_count: Num,
	command_count: Num,
	username: Text,
	client_ip: Text,
	hostname: Text
});
export type CdapDevice = v.InferOutput<typeof CdapDevice>;

export async function listCdapDevices(signal?: AbortSignal): Promise<CdapDevice[]> {
	const out = parse(
		v.looseObject({ devices: v.optional(v.nullable(v.array(CdapDevice)), []) }),
		await get('/api/cdap/devices', { signal }),
		'/api/cdap/devices'
	);
	return out.devices ?? [];
}

export async function getCdapDevice(id: string, signal?: AbortSignal): Promise<CdapDevice> {
	return parse(CdapDevice, await get(`/api/cdap/devices/${enc(id)}`, { signal }), 'device');
}

/** The device's manifest as it sent it (loose; model.ts reads it), null when it has none */
export async function getManifest(id: string, signal?: AbortSignal): Promise<unknown> {
	try {
		return await get(`/api/cdap/devices/${enc(id)}/manifest`, { signal });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

/**
 * Widget values: Go answers `{ device_id, widget_state, connected }`; a
 * wrapped or a bare map works too. A device that is not connected has none
 * (404): an empty map.
 */
export async function getWidgetState(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
	let data: unknown;
	try {
		data = await get(`/api/cdap/devices/${enc(id)}/state`, { signal });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return {};
		throw err;
	}
	if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
	const o = data as Record<string, unknown>;
	const inner = 'widget_state' in o ? o.widget_state : o;
	return inner && typeof inner === 'object' && !Array.isArray(inner)
		? (inner as Record<string, unknown>)
		: {};
}

export interface CommandInput {
	widget_id: string;
	action: string;
	value?: unknown;
	reason?: string;
}

/** A command for one widget (cdap.command) */
export async function sendCommand(id: string, body: CommandInput): Promise<void> {
	const data = await request(`/api/cdap/devices/${enc(id)}/command`, {
		method: 'POST',
		body: { ...body, reason: body.reason || undefined }
	});
	const err = failed(data);
	if (err) throw err;
}

/* ── Alerts ── */

export const CdapAlert = v.looseObject({
	alert_id: Text,
	label: Text,
	severity: Text,
	message: Text,
	firing: BoolLike,
	fired_at: Text
});
export type CdapAlert = v.InferOutput<typeof CdapAlert>;

export async function getAlerts(deviceId: string, signal?: AbortSignal): Promise<CdapAlert[]> {
	const out = parse(
		v.looseObject({ alerts: v.optional(v.nullable(v.array(CdapAlert)), []) }),
		await get('/api/cdap/alerts', { signal, query: { device_id: deviceId } }),
		'/api/cdap/alerts'
	);
	return out.alerts ?? [];
}

/* ── Linked remote desktop devices ── */

export const LinkedPeer = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	hostname: Text,
	platform: Text,
	status: Text,
	live_online: BoolLike
});
export type LinkedPeer = v.InferOutput<typeof LinkedPeer>;

export async function getLinkedPeers(id: string, signal?: AbortSignal): Promise<LinkedPeer[]> {
	const out = parse(
		v.looseObject({ linked: v.optional(v.nullable(v.array(LinkedPeer)), []) }),
		await get(`/api/cdap/devices/${enc(id)}/linked`, { signal }),
		'linked'
	);
	return out.linked ?? [];
}

/**
 * Link a device from the device list to an IoT device: the call goes to the
 * peer's ID with the IoT device's ID; an empty ID unlinks it.
 */
export async function setLink(peerId: string, linkedPeerId: string): Promise<void> {
	const data = await api(v.unknown(), `/api/cdap/devices/${enc(peerId)}/link`, {
		method: 'POST',
		body: { linked_peer_id: linkedPeerId }
	});
	const err = failed(data);
	if (err) throw err;
	if (data && typeof data === 'object' && typeof (data as Record<string, unknown>).error === 'string')
		throw new ApiError(String((data as Record<string, unknown>).error), 400, { data });
}
