/**
 * Client setup (/keys): the values a RustDesk client needs, the server API
 * key for scripts, and what the connection diagram needs
 * (routes/dashboard.routes.js, routes/keys.routes.js, routes/settings.routes.js).
 */

import * as v from 'valibot';
import { api } from './client.ts';

const Text = v.optional(
	v.pipe(
		v.nullable(v.union([v.string(), v.number()])),
		v.transform((s) => (s === null ? '' : String(s)))
	),
	''
);

/** GET /api/dashboard/client-config: every value, the config string and the QR's text in one answer */
export const ClientConfig = v.object({
	server_id: Text,
	relay_server: Text,
	api_url: Text,
	public_key: Text,
	deploy_config_string: Text,
	/** rustdesk://config/... : what the phone app scans */
	config_uri: Text,
	phone_unreachable_host: v.optional(v.boolean(), false)
});
export type ClientConfig = v.InferOutput<typeof ClientConfig>;

/**
 * Any signed-in account. `host` is the overview's client address override
 * for this browser tab (sessionStorage), passed on as ?host=.
 */
export async function getClientConfig(host: string, signal?: AbortSignal): Promise<ClientConfig> {
	const out = await api(v.object({ data: ClientConfig }), '/api/dashboard/client-config', {
		query: { host: host || undefined },
		signal
	});
	return out.data;
}

const ApiKey = v.object({ data: v.object({ key: Text, masked: v.optional(v.boolean(), true) }) });

/** What the server shows when it has no API key file */
export const NO_API_KEY = '••••••••';

/**
 * The server API key, shortened (any signed-in account), from the server
 * info: unlike /api/keys/api it answers without a 404 when there is no key.
 */
export async function getMaskedApiKey(signal?: AbortSignal): Promise<string> {
	const out = await api(v.object({ data: v.object({ api_key_masked: Text }) }), '/api/keys/server-info', {
		signal
	});
	return out.data.api_key_masked;
}

/** The whole server API key: needs server.keys */
export async function getFullApiKey(): Promise<string> {
	return (await api(ApiKey, '/api/keys/api', { query: { show: 'true' } })).data.key;
}

/** Whether clients go straight to each other first or always through the relay (server.config) */
export async function getDiagramMode(signal?: AbortSignal): Promise<'direct-first' | 'relay-only'> {
	const out = await api(
		v.looseObject({
			data: v.looseObject({
				mode: v.optional(v.nullable(v.string())),
				runtime: v.optional(
					v.nullable(
						v.looseObject({
							always_use_relay: v.optional(v.nullable(v.boolean())),
							p2p_first: v.optional(v.nullable(v.boolean()))
						})
					)
				)
			})
		}),
		'/api/settings/connection-mode',
		{ signal }
	);
	const { runtime, mode } = out.data;
	const relayOnly = runtime
		? runtime.always_use_relay === true || runtime.p2p_first === false
		: mode === 'relay_only';
	return relayOnly ? 'relay-only' : 'direct-first';
}

/** The key file (id_ed25519.pub) as text, for a download made in the browser */
export const KEY_FILE_URL = '/api/keys/public/download';
