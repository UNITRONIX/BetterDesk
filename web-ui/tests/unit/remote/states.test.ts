import { describe, expect, test } from 'vitest';
import {
	classifyEnd,
	detailRows,
	detailsText,
	endOutcome,
	loginErrorText,
	showDetails,
	stepAdvances,
	stepFromLog,
	stepRows,
	tabStatus
} from '../../../src/lib/remote/states.ts';

const ctx = { name: 'demo-build-server', everStreamed: false };

describe('what happened, in plain words', () => {
	test.each([
		['Connection refused: Device offline', 'offline', 'demo-build-server is offline.'],
		[
			'Rendezvous response timeout (30s) - target device may be offline',
			'timeout',
			'demo-build-server did not answer in time.'
		],
		[
			'Relay refused: the remote user declined the connection',
			'refused',
			'demo-build-server refused the connection.'
		],
		['ID_NOT_EXIST', 'notfound', 'This ID is not registered on the server.'],
		['Wrong password', 'password', 'The password was not accepted.'],
		[
			'Permission denied: device.connect',
			'permission',
			'You do not have permission to connect to demo-build-server.'
		],
		['License limit reached', 'limit', 'The server does not allow this connection right now.'],
		['Rendezvous connection failed', 'relay', 'The relay server could not be reached.'],
		['something odd', 'generic', 'Could not connect to demo-build-server.']
	])('%s', (reason, kind, text) => {
		const out = classifyEnd(reason, null, ctx);
		expect(out.kind).toBe(kind);
		expect(out.text).toBe(text);
		expect(out.tryText.length).toBeGreaterThan(10);
		expect(out.ended).toBeUndefined();
	});

	test('a WebSocket close before the device answered differs from a drop during the session', () => {
		expect(classifyEnd('Relay connection closed (WebSocket 1005)', { closeCode: 1005 }, ctx).kind).toBe(
			'dropped_early'
		);
		expect(classifyEnd('', { closeCode: 1006 }, { ...ctx, everStreamed: true }).kind).toBe('dropped');
		expect(classifyEnd('Connection closed', null, { ...ctx, everStreamed: true }).text).toBe(
			'The connection to demo-build-server dropped.'
		);
	});

	test('an end on the device is an end, not a failure; a refusal there is a failure', () => {
		const peer = classifyEnd('remote: session ended', null, ctx);
		expect(peer).toMatchObject({ kind: 'peer', ended: true });
		expect(classifyEnd('remote: refused', null, ctx).ended).toBeUndefined();
	});

	test('ended by you, cancelled, or plainly after a picture', () => {
		expect(endOutcome('cancel', '', null, ctx)).toMatchObject({ kind: 'cancel', ended: true });
		expect(endOutcome('user', 'whatever', null, ctx).text).toBe(
			'You ended the session with demo-build-server.'
		);
		expect(endOutcome('', '', null, { ...ctx, everStreamed: true }).kind).toBe('plain');
		// No reason before any picture: classified like any failure
		expect(endOutcome('', '', null, ctx).kind).toBe('generic');
	});

	test('a wrong password from the device reads the same whatever the transport says', () => {
		expect(loginErrorText('Wrong Password')).toBe('That password was not accepted. Check it and try again.');
		expect(loginErrorText('Invalid password provided')).toBe(
			'That password was not accepted. Check it and try again.'
		);
		expect(loginErrorText('Too many attempts')).toBe('Too many attempts');
		expect(loginErrorText('')).toBe('That password was not accepted. Check it and try again.');
	});
});

describe('connecting steps', () => {
	test('log lines of the transports map to steps', () => {
		expect(stepFromLog('Connecting to rendezvous server...')).toBe('find');
		expect(stepFromLog('Requesting relay (uuid: 6f1c2a9e...)...')).toBe('route');
		expect(stepFromLog('Waiting for peer handshake...')).toBe('accept');
		expect(stepFromLog('Password required')).toBe('signin');
		expect(stepFromLog('Video codec: VP9')).toBe('screen');
		expect(stepFromLog('nothing to see')).toBeNull();
	});

	test('steps only move forward', () => {
		expect(stepAdvances(null, 'find')).toBe(true);
		expect(stepAdvances('route', 'accept')).toBe(true);
		expect(stepAdvances('accept', 'route')).toBe(false);
		expect(stepAdvances('accept', 'accept')).toBe(false);
	});

	test('the list marks done, current and stopped steps with words for screen readers', () => {
		const now = stepRows('accept', false, 'pc', 'rd');
		expect(now.map((r) => r.state)).toEqual(['done', 'done', 'now', 'todo', 'todo']);
		expect(now[2]).toMatchObject({ tone: 'waiting', word: 'in progress', label: 'Wait for pc to answer' });
		const failed = stepRows('route', true, 'pc', 'rd');
		expect(failed[1]).toMatchObject({ state: 'failed', tone: 'danger', word: 'stopped here' });
		// Transports through the console server say "server", not "relay server"
		expect(stepRows('route', false, 'pc', 'cdap')[1]?.label).toBe('Connect through the server');
	});
});

describe('tabs and details', () => {
	test('the tab mark follows the state', () => {
		expect(tabStatus('streaming')).toEqual({ tone: 'good', label: 'Connected' });
		expect(tabStatus('failed').tone).toBe('danger');
		expect(tabStatus('ended').tone).toBe('neutral');
		expect(tabStatus('password').label).toBe('Needs a password');
		expect(tabStatus('connecting').tone).toBe('waiting');
	});

	test('details leave out what is empty and copy as text', () => {
		const rows = detailRows(
			{
				reason: 'Relay connection closed (WebSocket 1005)',
				meta: { closeCode: 1005 },
				at: 0,
				step: 'accept'
			},
			{ deviceId: '900100012', name: 'pc', transport: 'rd', lastError: '', formatTime: () => 'T' }
		);
		expect(rows.map((r) => r[0])).toEqual([
			'Message',
			'Close code',
			'Last step',
			'Time',
			'Device ID',
			'Connection type'
		]);
		expect(rows.find((r) => r[0] === 'Connection type')?.[1]).toBe('RustDesk relay');
		expect(detailsText('pc', '900100012', 'It dropped.', rows)).toContain(
			'pc (900100012)\nIt dropped.\nMessage: Relay'
		);
	});

	test('details show for failures with a message and for ends you did not cause', () => {
		expect(showDetails('failed', true, '')).toBe(true);
		expect(showDetails('failed', false, '')).toBe(false);
		expect(showDetails('ended', true, '')).toBe(true);
		expect(showDetails('ended', true, 'user')).toBe(false);
	});
});
