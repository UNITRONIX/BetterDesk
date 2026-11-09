/**
 * The connection side of Terminal.svelte.
 *
 * The component owns xterm (screen, keyboard, fit, status line). How bytes
 * get to and from the other end is a `TerminalConnect` function: it gets a
 * `TerminalSession` to write to and returns a `TerminalConnection` that
 * takes the user's input. Most terminals are a WebSocket with a small
 * message format, so `socketConnect(url, adapter)` builds one from a URL (or
 * a function that finds the URL) and a `SocketAdapter`.
 *
 * The three terminals of the console:
 *   server shell   socketConnect('/ws/server-management/terminal', shellAdapter())
 *   IoT device     socketConnect(`/api/cdap/devices/${id}/terminal`, cdapAdapter())
 *   MeshAgent      socketConnect(() => meshTerminalUrl(id), meshAdapter())
 */

import * as v from 'valibot';
import { request } from '#lib/api/client.ts';
import { tf } from '#lib/i18n/i18n.svelte.ts';

export type TerminalState = 'loading' | 'connecting' | 'open' | 'closed' | 'error';

/** What a connection can do with the terminal on screen */
export interface TerminalSession {
	write(data: string | Uint8Array): void;
	writeln(text: string): void;
	clear(): void;
	focus(): void;
	readonly cols: number;
	readonly rows: number;
	/**
	 * Status line. 'open' once the other end is ready; 'closed' when it ended
	 * normally; 'error' when it failed. `message` replaces the default words.
	 */
	status(state: 'connecting' | 'open' | 'closed' | 'error', message?: string): void;
}

export interface TerminalConnection {
	input(data: string): void;
	resize(cols: number, rows: number): void;
	/** Called when the user reconnects or the component goes away */
	close(): void;
}

export type TerminalConnect = (session: TerminalSession) => TerminalConnection | Promise<TerminalConnection>;

export type SocketData = Parameters<WebSocket['send']>[0];

export interface SocketContext {
	session: TerminalSession;
	/** Sends when the socket is open; null/undefined sends nothing */
	send(data: SocketData | null | undefined): void;
	/** The other end finished: set the status and close the socket */
	end(state: 'closed' | 'error', message?: string): void;
}

export interface SocketAdapter {
	protocols?: string | string[];
	binaryType?: BinaryType;
	/** Right after the socket opens (send the terminal size, a hello) */
	open?(ctx: SocketContext): void;
	message(data: unknown, ctx: SocketContext): void;
	input(data: string, ctx: SocketContext): SocketData | null;
	resize?(cols: number, rows: number, ctx: SocketContext): SocketData | null;
	/** Sent before the console closes the socket itself */
	close?(ctx: SocketContext): SocketData | null;
}

/** A same-origin path or an http(s) URL as a ws(s) URL */
export function socketUrl(url: string): string {
	if (url.startsWith('/') && !url.startsWith('//')) {
		return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${url}`;
	}
	return url.replace(/^http(s?):/i, 'ws$1:');
}

export function socketConnect(
	url: string | (() => Promise<string>),
	adapter: SocketAdapter
): TerminalConnect {
	return async (session) => {
		const target = socketUrl(typeof url === 'function' ? await url() : url);
		const ws = new WebSocket(target, adapter.protocols);
		if (adapter.binaryType) ws.binaryType = adapter.binaryType;
		let opened = false;
		let done = false;
		const ctx: SocketContext = {
			session,
			send(data) {
				if (data !== null && data !== undefined && ws.readyState === WebSocket.OPEN) ws.send(data);
			},
			end(state, message) {
				if (done) return;
				done = true;
				session.status(state, message);
				ws.close();
			}
		};
		ws.onopen = () => {
			opened = true;
			adapter.open?.(ctx);
		};
		ws.onmessage = (ev: MessageEvent) => {
			if (!done) adapter.message(ev.data, ctx);
		};
		ws.onerror = () => {
			if (!done) session.status('error');
		};
		ws.onclose = () => {
			if (done) return;
			done = true;
			// A socket that never opened keeps its error instead of a plain "Disconnected"
			session.status(opened ? 'closed' : 'error');
		};
		return {
			input: (data) => ctx.send(adapter.input(data, ctx)),
			resize: (cols, rows) => ctx.send(adapter.resize?.(cols, rows, ctx)),
			close() {
				if (done) return;
				done = true;
				ctx.send(adapter.close?.(ctx));
				ws.close();
			}
		};
	};
}

function parseJson(data: unknown): Record<string, unknown> | null {
	if (typeof data !== 'string') return null;
	try {
		const msg: unknown = JSON.parse(data);
		return msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

const str = (value: unknown, fallback = ''): string =>
	typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;

const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const RED = (s: string) => `\x1b[31m${s}\x1b[0m`;

/**
 * The console host's shell (/ws/server-management/terminal). JSON both ways:
 * init, input, resize, close out; ready, output, end, error in.
 */
export function shellAdapter(): SocketAdapter {
	// A shell that ends within a few seconds never started; say why
	let readyAt = 0;
	let shell = '';
	let early = '';
	return {
		open({ session, send }) {
			readyAt = 0;
			early = '';
			send(JSON.stringify({ type: 'init', cols: session.cols, rows: session.rows }));
		},
		message(data, { session, end }) {
			const msg = parseJson(data);
			if (!msg) return;
			if (msg.type === 'ready') {
				readyAt = Date.now();
				shell = str(msg.shell);
				let text = tf('server_mgmt.term_connected_as', 'Connected as {user} on {platform}.', {
					user: str(msg.user, '?'),
					platform: str(msg.platform)
				});
				if (!msg.pty_available || msg.kind === 'pipe') {
					text +=
						' ' +
						tf(
							'server_mgmt.term_limited',
							'Limited mode: programs that need a full terminal, such as editors, may not work.'
						);
				}
				session.status('open', text);
			} else if (msg.type === 'output') {
				const out = str(msg.data);
				if (readyAt && Date.now() - readyAt < 3000 && early.length < 2000) early += out;
				session.write(out);
			} else if (msg.type === 'end') {
				const code = str(msg.code, '?');
				session.writeln(`\r\n[${tf('server_mgmt.term_exited', 'Shell ended with code {code}', { code })}]`);
				if (readyAt && Date.now() - readyAt < 3000 && msg.code !== 0) {
					const missing = /no such file|not found|execvp|ENOENT/i.test(early);
					end(
						'error',
						missing
							? tf(
									'server_mgmt.term_shell_missing',
									"The terminal can't start: the shell {shell} isn't installed on this machine.",
									{ shell: shell || '/bin/bash' }
								)
							: tf(
									'server_mgmt.term_shell_ended',
									'The shell ended right after it started (code {code}). The output in the terminal may say why.',
									{ code }
								)
					);
				} else end('closed');
			} else if (msg.type === 'error') {
				const error = str(msg.error);
				session.writeln(`\r\n[${error}]`);
				session.status('error', tf('server_mgmt.term_error_reason', 'Terminal error: {error}', { error }));
			}
		},
		input: (data) => JSON.stringify({ type: 'input', data }),
		resize: (cols, rows) => JSON.stringify({ type: 'resize', cols, rows }),
		close: () => JSON.stringify({ type: 'close' })
	};
}

/**
 * An IoT device's terminal through the CDAP gateway
 * (/api/cdap/devices/:id/terminal, subprotocol cdap-terminal). Device output
 * uses bare \n, so give the Terminal `convertEol`.
 */
export function cdapAdapter(): SocketAdapter {
	return {
		protocols: ['cdap-terminal'],
		open({ session, send }) {
			session.writeln(YELLOW(tf('cdap.terminal_connecting', 'Connecting to device...')));
			send(JSON.stringify({ cols: session.cols, rows: session.rows }));
		},
		message(data, { session, end }) {
			const msg = parseJson(data);
			if (!msg) {
				// Not JSON: raw output
				if (typeof data === 'string') session.write(data);
				return;
			}
			if (msg.type === 'ready') {
				session.clear();
				session.status('open');
			} else if (msg.type === 'output') {
				session.write(str(msg.data));
			} else if (msg.type === 'error') {
				const error = str(msg.error, tf('cdap.terminal_error', 'Terminal connection failed'));
				session.writeln(RED(error));
				session.status('error', error);
			} else if (msg.type === 'end') {
				const reason = str(msg.reason, tf('cdap.terminal_disconnected', 'Disconnected'));
				session.writeln(YELLOW(`\r\n${reason}`));
				end('closed', reason);
			}
		},
		input: (data) => JSON.stringify({ type: 'input', data }),
		resize: (cols, rows) => JSON.stringify({ type: 'resize', cols, rows }),
		close: () => JSON.stringify({ type: 'close' })
	};
}

const MESH_CTRL = '102938';
const MESH_PROTOCOL_TERMINAL = '1';

/**
 * A MeshAgent shell through the MeshCentral relay. The relay says "c" (or
 * "cr") when the agent is there; the browser answers with the protocol
 * number. Terminal bytes are binary both ways; control messages are JSON
 * with the ctrlChannel marker.
 */
export function meshAdapter(): SocketAdapter {
	let ready = false;
	const size = (session: TerminalSession) =>
		JSON.stringify({ ctrlChannel: MESH_CTRL, type: 'termsize', cols: session.cols, rows: session.rows });
	return {
		binaryType: 'arraybuffer',
		open() {
			ready = false;
		},
		message(data, { session, send }) {
			if (typeof data === 'string') {
				if (data === 'c' || data === 'cr') {
					if (ready) return;
					ready = true;
					send(MESH_PROTOCOL_TERMINAL);
					session.clear();
					send(size(session));
					session.status('open', tf('mesh.terminal_connected', 'Connected.'));
					return;
				}
				const msg = parseJson(data);
				if (msg && msg.ctrlChannel === MESH_CTRL && msg.type === 'console' && msg.msg) {
					session.writeln(YELLOW(str(msg.msg)));
				}
				return;
			}
			if (data instanceof ArrayBuffer || Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
				session.write(new Uint8Array(data as ArrayBuffer));
			} else if (ArrayBuffer.isView(data))
				session.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
		},
		input: (data) => new TextEncoder().encode(data),
		resize: (_cols, _rows, { session }) => (ready ? size(session) : null)
	};
}

const MeshTunnel = v.looseObject({
	browser_url: v.optional(v.string()),
	data: v.optional(v.looseObject({ browser_url: v.optional(v.string()) }))
});

/** Opens a relay tunnel for a MeshAgent's terminal and returns its URL */
export async function meshTerminalUrl(deviceId: string): Promise<string> {
	const data = v.parse(
		MeshTunnel,
		await request(`/api/mesh/devices/${encodeURIComponent(deviceId)}/terminal`, {
			method: 'POST',
			query: { relay_base: location.origin + '/' }
		})
	);
	const url = data.browser_url || data.data?.browser_url;
	if (!url) throw new Error(tf('cdap.terminal_error', 'Terminal connection failed'));
	return url.startsWith('http') ? url : location.origin + url;
}
