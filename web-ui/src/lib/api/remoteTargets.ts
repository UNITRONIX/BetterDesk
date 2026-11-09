/**
 * RDP/VNC targets (routes/devices.routes.js "remote-targets"): computers
 * without the BetterDesk client that people reach in the browser through
 * this server. In the device list they are devices with remote_target set.
 */

import * as v from 'valibot';
import { api, Ok } from './client.ts';

const enc = encodeURIComponent;

export type RemoteProtocol = 'rdp' | 'vnc';
export type CredentialMode = 'saved' | 'prompt' | 'none';
export type TlsMode = 'required' | 'preferred' | 'disabled';

/** The fields the target sheet sends (create and update) */
export interface RemoteTargetInput {
	name: string;
	protocol: RemoteProtocol;
	platform: string;
	host: string;
	port: number;
	username: string;
	credential_mode: CredentialMode;
	tls_mode: TlsMode;
	cert_fingerprint: string;
	enabled?: boolean;
}

/** POST answers the new target (wrapped by the server); only its id matters here */
const Created = v.pipe(
	v.looseObject({
		success: v.optional(v.boolean()),
		id: v.optional(v.string()),
		data: v.optional(v.looseObject({ id: v.optional(v.string()) }))
	}),
	v.transform((o) => ({ id: o.data?.id ?? o.id ?? '' }))
);

export function createRemoteTarget(target: RemoteTargetInput) {
	return api(Created, '/api/remote-targets', { method: 'POST', body: target });
}

export function updateRemoteTarget(id: string, target: RemoteTargetInput) {
	return api(Ok, `/api/remote-targets/${enc(id)}`, { method: 'PATCH', body: target });
}

export function deleteRemoteTarget(id: string) {
	return api(Ok, `/api/remote-targets/${enc(id)}`, { method: 'DELETE' });
}

/** Store the password on the server (encrypted there, filled in at each connection) */
export function saveRemoteTargetPassword(id: string, username: string, password: string) {
	return api(Ok, `/api/remote-targets/${enc(id)}/credentials`, {
		method: 'PUT',
		body: { username, password }
	});
}

export function deleteRemoteTargetPassword(id: string) {
	return api(Ok, `/api/remote-targets/${enc(id)}/credentials`, { method: 'DELETE' });
}

/** Whether this server reaches host and port (throws with the server's reason when not) */
export function testRemoteTarget(target: RemoteTargetInput) {
	return api(Ok, '/api/remote-targets/test', { method: 'POST', body: target });
}
