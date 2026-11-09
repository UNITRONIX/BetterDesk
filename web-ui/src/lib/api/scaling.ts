/**
 * Relay servers and assignment rules (routes/scaling.routes.js), kept in
 * the console's settings table; clients don't read them yet (the Go server
 * hands out its own relay address). Every call needs server.config. The
 * routes answer `{ data: ... }` without `success`; errors are `{ error }`.
 *
 * The connection diagram reads what clients get from two endpoints other
 * pages own (dashboard client config, connection mode); the small readers
 * for them are here so this page doesn't depend on those pages' files.
 */

import * as v from 'valibot';
import { api } from './client.ts';

/* Fields that are always there in the output, whatever the server leaves out */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null ? '' : String(s)))
);

const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), 0),
	v.transform((n) => Number(n ?? 0)),
	v.transform((n) => (Number.isFinite(n) ? n : 0))
);

export const Relay = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Str,
	address: Str,
	location: Str,
	max_sessions: Num,
	max_bandwidth_mbps: Num,
	connected_devices: Num,
	active_sessions: Num,
	bandwidth_mbps: Num,
	cpu: Num,
	memory: Num,
	status: Str
});
export type Relay = v.InferOutput<typeof Relay>;

export const Rule = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Str,
	match_type: Str,
	match_value: Str,
	target_relay: Str,
	target_relay_name: Str,
	fallback: Str,
	priority: Num,
	enabled: v.optional(v.nullable(v.boolean()), null)
});
export type Rule = v.InferOutput<typeof Rule>;

export const Capacity = v.looseObject({
	relay_count: Num,
	max_devices: Num,
	max_sessions: Num,
	max_bandwidth_mbps: Num
});
export type Capacity = v.InferOutput<typeof Capacity>;

const list = <S extends v.GenericSchema>(item: S) =>
	v.pipe(
		v.union([v.array(item), v.looseObject({ data: v.optional(v.array(item)) })]),
		v.transform((o) => (Array.isArray(o) ? o : (o.data ?? [])) as v.InferOutput<S>[])
	);

const one = <S extends v.GenericSchema>(item: S) =>
	v.pipe(
		v.looseObject({ data: item }),
		v.transform((o) => o.data as v.InferOutput<S>)
	);

const enc = encodeURIComponent;
const Any = v.unknown();

export function listRelays(signal?: AbortSignal) {
	return api(list(Relay), '/api/panel/scaling/relays', { signal });
}

export interface RelayInput {
	name: string;
	address: string;
	location: string;
	max_sessions: number;
	max_bandwidth_mbps: number;
}

export function saveRelay(id: string | null, body: RelayInput) {
	return id
		? api(one(Relay), `/api/panel/scaling/relays/${enc(id)}`, { method: 'PUT', body })
		: api(one(Relay), '/api/panel/scaling/relays', { method: 'POST', body });
}

export function deleteRelay(id: string) {
	return api(Any, `/api/panel/scaling/relays/${enc(id)}`, { method: 'DELETE' });
}

const CapacityAnswer = v.pipe(
	v.looseObject({ data: Capacity }),
	v.transform((o) => o.data)
);

export function getCapacity(signal?: AbortSignal) {
	return api(CapacityAnswer, '/api/panel/scaling/capacity', { signal });
}

export function listRules(signal?: AbortSignal) {
	return api(list(Rule), '/api/panel/scaling/rules', { signal });
}

export interface RuleInput {
	name: string;
	match_type: string;
	match_value: string;
	target_relay: string;
	fallback: string;
	priority: number;
	/** Off keeps the rule in the list; the server treats a missing value as on */
	enabled?: boolean;
}

export function saveRule(id: string | null, body: RuleInput) {
	return id
		? api(one(Rule), `/api/panel/scaling/rules/${enc(id)}`, { method: 'PUT', body })
		: api(one(Rule), '/api/panel/scaling/rules', { method: 'POST', body });
}

export function deleteRule(id: string) {
	return api(Any, `/api/panel/scaling/rules/${enc(id)}`, { method: 'DELETE' });
}

/* ── What clients get now (for the connection diagram) ── */

const ClientConfig = v.pipe(
	v.looseObject({
		data: v.optional(v.looseObject({ server_id: Str, relay_server: Str })),
		server_id: Str,
		relay_server: Str
	}),
	v.transform((o) => ({
		server_id: o.data?.server_id || o.server_id,
		relay_server: o.data?.relay_server || o.relay_server
	}))
);

/** The ID server and relay addresses clients are set up with (GET /api/dashboard/client-config) */
export function getClientAddresses(signal?: AbortSignal) {
	return api(ClientConfig, '/api/dashboard/client-config', { signal });
}

const Runtime = v.optional(
	v.looseObject({
		relay_servers: Str,
		always_use_relay: v.optional(v.nullable(v.boolean()))
	}),
	{}
);

const ConnectionMode = v.pipe(
	v.looseObject({
		data: v.optional(v.looseObject({ mode: Str, runtime: Runtime })),
		mode: Str,
		runtime: Runtime
	}),
	v.transform((o) => {
		const d = o.data ?? o;
		return { mode: d.mode, runtime: d.runtime ?? {} };
	})
);

/** How the ID server connects clients now (GET /api/settings/connection-mode) */
export function getConnectionMode(signal?: AbortSignal) {
	return api(ConnectionMode, '/api/settings/connection-mode', { signal });
}
