/**
 * What the remote viewer says about a connection, in plain words: the
 * connecting steps, what failed and what to try, the tab's status mark and
 * the Details rows. Pure functions; the strings come from t() so they
 * follow the console language (remote_viewer.* keys, same as the old
 * public/js/remote.js).
 */

import { tf } from '#lib/i18n/i18n.svelte.ts';
import type { Tone } from '#lib/util/display.ts';

export const STEP_IDS = ['find', 'route', 'accept', 'signin', 'screen'] as const;
export type StepId = (typeof STEP_IDS)[number];

/** A step that takes longer than this shows a hint on what may be wrong */
export const SLOW_AFTER_MS = 8000;

export type View = 'connecting' | 'password' | 'tfa' | 'failed' | 'ended' | 'streaming';

export type Transport = 'rd' | 'cdap' | 'mesh' | 'rdp' | 'vnc';

export function isStep(id: unknown): id is StepId {
	return typeof id === 'string' && (STEP_IDS as readonly string[]).includes(id);
}

export interface StepText {
	label: string;
	now: string;
	slow: string;
}

/** Label, "now" sentence and slow hint of a step; route says "server" for transports that go through it */
export function stepText(id: StepId, name: string, transport: Transport): StepText {
	const p = { name };
	const throughServer = transport !== 'rd';
	switch (id) {
		case 'find':
			return {
				label: tf('remote_viewer.step_find', 'Find {name} on the server', p),
				now: tf('remote_viewer.now_find', 'Looking for {name} on the server.', p),
				slow: tf(
					'remote_viewer.slow_find',
					'This takes long when the server is busy or this browser cannot reach it. Check the server address and your network.',
					p
				)
			};
		case 'route':
			return {
				label: throughServer
					? tf('remote_viewer.step_route_server', 'Connect through the server', p)
					: tf('remote_viewer.step_route', 'Connect through the relay server', p),
				now: throughServer
					? tf('remote_viewer.now_route_server', 'Setting up the connection through the server.', p)
					: tf('remote_viewer.now_route', 'Setting up the connection through the relay server.', p),
				slow: tf(
					'remote_viewer.slow_route',
					'This takes long when the relay server is slow or a firewall blocks it.',
					p
				)
			};
		case 'accept':
			return {
				label: tf('remote_viewer.step_accept', 'Wait for {name} to answer', p),
				now: tf('remote_viewer.now_accept', 'Waiting for {name} to answer.', p),
				slow: tf(
					'remote_viewer.slow_accept',
					'{name} may be asleep, or someone has to accept the connection on the device. Ask them to click Accept.',
					p
				)
			};
		case 'signin':
			return {
				label: tf('remote_viewer.step_signin', 'Sign in, if the device asks for a password', p),
				now: tf('remote_viewer.now_signin', 'Signing in to {name}.', p),
				slow: tf('remote_viewer.slow_signin', 'Signing in takes long when the device is busy.', p)
			};
		case 'screen':
			return {
				label: tf('remote_viewer.step_screen', 'Receive the screen', p),
				now: tf('remote_viewer.now_screen', 'Waiting for the first picture from {name}.', p),
				slow: tf(
					'remote_viewer.slow_screen',
					'The device is starting its screen capture. On a slow network this takes a moment.',
					p
				)
			};
	}
}

/** Transport log lines to steps (RDClient, CDAP, mesh and the gateway all log in English) */
export function stepFromLog(msg: unknown): StepId | null {
	const m = String(msg ?? '').toLowerCase();
	if (/login successful|no password required|video codec|streaming/.test(m)) return 'screen';
	if (/authenticat|password required|2fa|verifying/.test(m)) return 'signin';
	if (/handshake|peer identified|key exchange|consent|accept/.test(m)) return 'accept';
	if (/relay|tunnel|desktop session|gateway/.test(m)) return 'route';
	if (/protocol|rendezvous|requesting connection|loading/.test(m)) return 'find';
	return null;
}

/** Whether a step moves the connection forward (steps never go back unless forced) */
export function stepAdvances(current: StepId | null, next: StepId): boolean {
	return STEP_IDS.indexOf(next) > (current ? STEP_IDS.indexOf(current) : -1);
}

export type StepState = 'done' | 'now' | 'failed' | 'todo';

export interface StepRow {
	id: StepId;
	label: string;
	state: StepState;
	tone: Tone;
	word: string;
}

/** The steps list: done (good), now (waiting), stopped (danger), still to come (neutral) */
export function stepRows(
	current: StepId | null,
	failed: boolean,
	name: string,
	transport: Transport
): StepRow[] {
	const at = current ? STEP_IDS.indexOf(current) : -1;
	return STEP_IDS.map((id, i) => {
		let state: StepState = 'todo';
		if (i < at) state = 'done';
		else if (i === at) state = failed ? 'failed' : 'now';
		const tone: Tone =
			state === 'done' ? 'good' : state === 'now' ? 'waiting' : state === 'failed' ? 'danger' : 'neutral';
		const word =
			state === 'done'
				? tf('remote_viewer.step_done', 'done')
				: state === 'now'
					? tf('remote_viewer.step_now', 'in progress')
					: state === 'failed'
						? tf('remote_viewer.step_failed', 'stopped here')
						: tf('remote_viewer.step_todo', 'not started');
		return { id, label: stepText(id, name, transport).label, state, tone, word };
	});
}

export interface Outcome {
	kind: string;
	text: string;
	tryText: string;
	/** An end rather than a failure */
	ended?: boolean;
}

export interface CloseMeta {
	closeCode?: number | string;
	code?: number | string;
	closeReason?: string;
	peerReason?: string;
	cdapFallback?: boolean;
}

/** Known messages and close codes to a sentence on what happened and what to try */
export function classifyEnd(
	reason: unknown,
	meta: CloseMeta | null | undefined,
	ctx: { name: string; everStreamed: boolean }
): Outcome {
	const m = String(reason ?? '').toLowerCase();
	const code = Number(meta?.closeCode || meta?.code || (m.match(/websocket (\d{4})/) || [])[1] || 0);
	const p = { name: ctx.name };
	const pick = (kind: string, text: string, tryText: string): Outcome => ({ kind, text, tryText });

	if (
		/^remote:|closed manually|by the peer|peer closed|session (was )?ended|agent_end/.test(m) &&
		!/refus|reject|declin|denied/.test(m)
	) {
		return {
			...pick(
				'peer',
				tf('remote_viewer.ended_peer', 'The session was ended on {name}.', p),
				tf('remote_viewer.try_ended', 'Reconnect to continue, or close the tab.')
			),
			ended: true
		};
	}
	if (/permission|not allowed|forbidden|\b403\b|unauthori[sz]ed/.test(m)) {
		return pick(
			'permission',
			tf('remote_viewer.fail_permission', 'You do not have permission to connect to {name}.', p),
			tf('remote_viewer.try_permission', 'Ask an administrator to give you access to this device.')
		);
	}
	if (/wrong password|password (was )?(wrong|incorrect|invalid)|invalid password/.test(m)) {
		return pick(
			'password',
			tf('remote_viewer.fail_password', 'The password was not accepted.'),
			tf('remote_viewer.try_password', 'Reconnect and enter the password set in RustDesk on the device.')
		);
	}
	if (
		/refus|reject|declin|dismiss|denied/.test(m) &&
		!/relay refused: *$/.test(m) &&
		!/offline|not online|not found|not exist|timeout/.test(m)
	) {
		return pick(
			'refused',
			tf('remote_viewer.fail_refused', '{name} refused the connection.', p),
			tf(
				'remote_viewer.try_refused',
				'Someone on the device declined it, or the device only accepts connections that are approved there. Ask them to accept, then reconnect.'
			)
		);
	}
	if (/timeout|timed out|did not respond|no response/.test(m)) {
		return pick(
			'timeout',
			tf('remote_viewer.fail_timeout', '{name} did not answer in time.', p),
			tf(
				'remote_viewer.try_timeout',
				'The device may be asleep, busy or offline. Wake it up or wait a moment, then reconnect.'
			)
		);
	}
	if (/not found|not exist|id_not_exist|unknown id|not registered/.test(m)) {
		return pick(
			'notfound',
			tf('remote_viewer.fail_notfound', 'This ID is not registered on the server.'),
			tf(
				'remote_viewer.try_notfound',
				'Check the ID. The device may have been removed or registered again under a new ID.'
			)
		);
	}
	if (/offline|not online/.test(m)) {
		return pick(
			'offline',
			tf('remote_viewer.fail_offline', '{name} is offline.', p),
			tf(
				'remote_viewer.try_offline',
				'It has not checked in with the server recently. Turn it on or wake it up, then reconnect.'
			)
		);
	}
	if (/license|licence|too many/.test(m)) {
		return pick(
			'limit',
			tf('remote_viewer.fail_limit', 'The server does not allow this connection right now.'),
			tf(
				'remote_viewer.try_limit',
				'The licence or the number of connections is at its limit. Ask an administrator.'
			)
		);
	}
	if (
		/rendezvous connection failed|relay connection failed|relay error|gateway connection failed|websocket open failed|mesh relay error/.test(
			m
		)
	) {
		return pick(
			'relay',
			tf('remote_viewer.fail_relay', 'The relay server could not be reached.'),
			tf(
				'remote_viewer.try_relay',
				'Check that the relay server is running and that this browser can reach it, then reconnect.'
			)
		);
	}
	if (code === 1005 || code === 1006 || /connection closed|socket closed|closed/.test(m)) {
		if (!ctx.everStreamed) {
			return pick(
				'dropped_early',
				tf('remote_viewer.fail_dropped_early', 'The connection closed before {name} answered.', p),
				tf(
					'remote_viewer.try_dropped_early',
					'The device may be asleep or offline, or it cannot reach the relay server. Wake it up, then reconnect.'
				)
			);
		}
		return pick(
			'dropped',
			tf('remote_viewer.fail_dropped', 'The connection to {name} dropped.', p),
			tf(
				'remote_viewer.try_dropped',
				'The network between this browser, the server and the device was interrupted. Reconnect. If it keeps happening, check the network of the device.'
			)
		);
	}
	return pick(
		'generic',
		tf('remote_viewer.fail_generic', 'Could not connect to {name}.', p),
		tf(
			'remote_viewer.try_generic',
			'Reconnect. If it keeps failing, copy the details below and send them to your administrator.'
		)
	);
}

/** Ended by you, cancelled, or a plain end after a session that showed a picture */
export function endOutcome(
	endedBy: '' | 'user' | 'cancel',
	reason: string,
	meta: CloseMeta | null | undefined,
	ctx: { name: string; everStreamed: boolean }
): Outcome {
	const tryEnded = tf('remote_viewer.try_ended', 'Reconnect to continue, or close the tab.');
	if (endedBy === 'cancel')
		return {
			kind: 'cancel',
			text: tf('remote_viewer.ended_cancel', 'You cancelled the connection.'),
			tryText: tryEnded,
			ended: true
		};
	if (endedBy === 'user')
		return {
			kind: 'user',
			text: tf('remote_viewer.ended_user', 'You ended the session with {name}.', { name: ctx.name }),
			tryText: tryEnded,
			ended: true
		};
	if (!reason && ctx.everStreamed)
		return {
			kind: 'plain',
			text: tf('remote_viewer.ended_plain', 'The session with {name} ended.', { name: ctx.name }),
			tryText: tryEnded,
			ended: true
		};
	return classifyEnd(reason, meta, ctx);
}

/** Wrong password from the device, in plain words */
export function loginErrorText(error: unknown): string {
	const raw = String(error ?? '');
	const plain = tf('remote_viewer.password_wrong', 'That password was not accepted. Check it and try again.');
	if (/wrong|incorrect|invalid|bad/i.test(raw) && /pass/i.test(raw)) return plain;
	return raw || plain;
}

export interface TabStatus {
	tone: Tone;
	label: string;
}

/** Tab status: connecting = waiting, connected = good, failed = danger, ended = neutral */
export function tabStatus(view: View | null): TabStatus {
	switch (view) {
		case 'streaming':
			return { tone: 'good', label: tf('remote.streaming', 'Connected') };
		case 'failed':
			return { tone: 'danger', label: tf('remote_viewer.tab_failed', 'Could not connect') };
		case 'ended':
		case null:
			return { tone: 'neutral', label: tf('remote_viewer.tab_ended', 'Ended') };
		case 'password':
		case 'tfa':
			return { tone: 'waiting', label: tf('remote_viewer.tab_password', 'Needs a password') };
		default:
			return { tone: 'waiting', label: tf('remote_viewer.tab_connecting', 'Connecting') };
	}
}

export function transportLabel(transport: Transport): string {
	return transport === 'rd' ? 'RustDesk relay' : transport.toUpperCase();
}

export interface EndInfo {
	reason: string;
	meta: CloseMeta | null;
	at: number;
	step: StepId | null;
}

/** Details under a failure or an end; empty values are left out */
export function detailRows(
	end: EndInfo | null,
	ctx: {
		deviceId: string;
		name: string;
		transport: Transport;
		lastError: string;
		formatTime: (d: Date) => string;
	}
): [string, string][] {
	const rows: [string, string][] = [];
	const add = (label: string, value: unknown) => {
		if (value !== undefined && value !== null && String(value) !== '') rows.push([label, String(value)]);
	};
	const meta = end?.meta ?? {};
	add(tf('remote_viewer.detail_message', 'Message'), end?.reason || ctx.lastError || '');
	add(tf('remote_viewer.detail_code', 'Close code'), meta.closeCode || '');
	add(tf('remote_viewer.detail_close_reason', 'Close reason'), meta.closeReason || meta.peerReason || '');
	if (end?.step)
		add(tf('remote_viewer.detail_step', 'Last step'), stepText(end.step, ctx.name, ctx.transport).label);
	add(tf('remote_viewer.detail_time', 'Time'), ctx.formatTime(new Date(end?.at || Date.now())));
	add(tf('remote_viewer.detail_device', 'Device ID'), ctx.deviceId);
	add(tf('remote_viewer.detail_transport', 'Connection type'), transportLabel(ctx.transport));
	return rows;
}

/** The text Copy details puts on the clipboard */
export function detailsText(
	name: string,
	deviceId: string,
	sentence: string,
	rows: [string, string][]
): string {
	return [`${name} (${deviceId})`, sentence].concat(rows.map(([k, v]) => `${k}: ${v}`)).join('\n');
}

/** Whether Details shows: a failure with a message, or an end the device or network caused */
export function showDetails(view: View, hasMessage: boolean, endedBy: '' | 'user' | 'cancel'): boolean {
	return (hasMessage && view === 'failed') || (hasMessage && view === 'ended' && !endedBy);
}
