/**
 * MeshAgent devices (routes/meshcentral.routes.js) and linking a MeshAgent
 * to the RustDesk or CDAP device on the same computer (cdap.routes.js).
 * The Go server answers these; bodies come back as Go sends them.
 */

import * as v from 'valibot';
import { api, request, Ok } from './client.ts';

const enc = encodeURIComponent;

export type MeshPowerAction = 'wake' | 'sleep' | 'reset' | 'off';

/** Run a command on the device through its MeshAgent */
export function meshExec(id: string, command: string, shell: boolean) {
	return api(Ok, `/api/mesh/devices/${enc(id)}/exec`, { method: 'POST', body: { command, shell } });
}

export function meshPower(id: string, action: MeshPowerAction) {
	return api(Ok, `/api/mesh/devices/${enc(id)}/power`, { method: 'POST', body: { action } });
}

/** A path the share answers with, at the top level or under data */
const SharePath = v.pipe(
	v.looseObject({
		path: v.optional(v.string()),
		data: v.optional(v.looseObject({ path: v.optional(v.string()) }))
	}),
	v.transform((o) => o.data?.path ?? o.path ?? '')
);

/** A time-limited, view-only desktop link that needs no console sign-in; returns the full URL */
export async function meshShareLink(id: string, ttlMinutes: number): Promise<string> {
	const path = await api(SharePath, `/api/mesh/devices/${enc(id)}/share`, {
		method: 'POST',
		body: { ttl_minutes: ttlMinutes, view_only: true }
	});
	return location.origin + path;
}

/** Link a MeshAgent to a RustDesk or CDAP peer ID on the same host; '' unlinks */
export function linkMeshPeer(id: string, linkedPeerId: string) {
	return api(Ok, `/api/cdap/devices/${enc(id)}/link`, {
		method: 'POST',
		body: { linked_peer_id: linkedPeerId }
	});
}

const Tunnel = v.looseObject({
	browser_url: v.optional(v.string()),
	data: v.optional(v.looseObject({ browser_url: v.optional(v.string()) }))
});

/** Open a TCP or UDP relay from the device to host:port; returns the relay WebSocket URL */
export async function meshRelayUrl(id: string, udp: boolean, host: string, port: number): Promise<string> {
	const data = v.parse(
		Tunnel,
		await request(`/api/mesh/devices/${enc(id)}/${udp ? 'udp' : 'tcp'}`, {
			method: 'POST',
			query: { relay_base: location.origin + '/' },
			body: { host, port }
		})
	);
	const url = data.browser_url || data.data?.browser_url || '';
	if (!url) throw new Error('No relay URL');
	const full = url.startsWith('http') ? url : location.origin + url;
	return full.replace(/^http(s?):/i, 'ws$1:');
}
