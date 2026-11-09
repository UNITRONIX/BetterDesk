import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { Target } from '../../../src/lib/api/network.ts';
import {
	address,
	checkLabel,
	cleanHost,
	countLine,
	formBody,
	formErrors,
	formFor,
	intervalLabel,
	intervalOptions,
	latency,
	matches,
	rttPoints,
	targetState,
	type TargetForm
} from '../../../src/lib/devices-area/network.ts';
import { parseDate } from '../../../src/lib/i18n/format.ts';

const target = (o: Record<string, unknown> = {}) =>
	v.parse(Target, { id: 1, name: 'Router', host: '10.0.0.1', check_type: 'ping', enabled: 1, ...o });

describe('target schema', () => {
	test('SQLite flags, numeric ids and unknown check types become clean values', () => {
		const t = target({ id: 7, enabled: 0, check_type: 'smtp', port: '25', last_rtt_ms: null });
		expect(t.id).toBe('7');
		expect(t.enabled).toBe(false);
		expect(t.check_type).toBe('ping');
		expect(t.port).toBe(25);
		expect(target({ enabled: undefined }).enabled).toBe(true);
	});
});

describe('labels', () => {
	test('intervals in minutes when whole, seconds otherwise', () => {
		expect(intervalLabel(300)).toEqual({ key: 'network.every_minutes', params: { count: 5 } });
		expect(intervalLabel(45)).toEqual({ key: 'network.every_seconds', params: { count: 45 } });
		expect(intervalOptions(60)).toEqual([30, 60, 300, 600]);
		expect(intervalOptions(45)).toEqual([30, 45, 60, 300, 600]);
	});

	test('what is checked and where', () => {
		expect(checkLabel(target({ check_type: 'tcp', port: 22 }))).toEqual({
			key: 'network.check_tcp',
			params: { port: 22 }
		});
		expect(checkLabel(target({ check_type: 'tcp', port: null }))).toEqual({
			key: 'network.check_tcp',
			params: { port: 80 }
		});
		expect(checkLabel(target({ check_type: 'https' }))).toEqual({ text: 'HTTPS' });
		expect(checkLabel(target())).toEqual({ key: 'network.check_ping' });
		expect(address(target({ check_type: 'tcp', port: 3389 }))).toBe('10.0.0.1:3389');
		expect(address(target({ port: 3389 }))).toBe('10.0.0.1');
		expect(address(target({ url: 'https://x.example/health' }))).toBe('https://x.example/health');
	});

	test('state, and the response time only while it answers', () => {
		expect(targetState(target({ enabled: 0, last_status: 'up' }))).toBe('paused');
		expect(targetState(target({ last_status: 'up' }))).toBe('up');
		expect(targetState(target({ last_status: 'down' }))).toBe('down');
		expect(targetState(target({ last_status: null }))).toBe('unchecked');
		expect(latency(target({ last_status: 'up', last_rtt_ms: 12.6 }))).toBe(13);
		expect(latency(target({ last_status: 'down', last_rtt_ms: 12 }))).toBeNull();
	});

	test('search: name, host or URL', () => {
		expect(matches(target(), 'rout')).toBe(true);
		expect(matches(target(), '10.0')).toBe(true);
		expect(matches(target({ url: 'https://status.example' }), 'status')).toBe(true);
		expect(matches(target(), 'switch')).toBe(false);
	});
});

describe('count line', () => {
	test('down, not checked yet and the average of those that answer; paused ones left out', () => {
		const list = [
			target({ id: 1, last_status: 'up', last_rtt_ms: 10 }),
			target({ id: 2, last_status: 'up', last_rtt_ms: 21 }),
			target({ id: 3, last_status: 'down' }),
			target({ id: 4 }),
			target({ id: 5, enabled: 0, last_status: 'down' })
		];
		expect(countLine(list, true, 2)).toEqual([
			{ key: 'network.count_many', params: { count: 5 } },
			{ key: 'network.count_down', params: { count: 1 } },
			{ key: 'network.count_unchecked', params: { count: 1 } },
			{ key: 'network.count_latency', params: { ms: 16 } },
			{ key: 'network.count_shown', params: { count: 2 } }
		]);
		expect(countLine([target({ last_status: 'up', last_rtt_ms: 4 })], false, 1)).toEqual([
			{ key: 'network.count_one' },
			{ key: 'network.count_all_up' },
			{ key: 'network.count_latency', params: { ms: 4 } }
		]);
		expect(countLine([], false, 0)).toEqual([]);
	});
});

describe('add and edit', () => {
	const form = (o: Partial<TargetForm> = {}): TargetForm => ({
		...formFor(null),
		name: 'Web',
		host: 'example.com',
		...o
	});

	test('a new target: ping, every minute, checked', () => {
		expect(formFor(null)).toEqual({
			name: '',
			host: '',
			check_type: 'ping',
			port: '',
			interval: 60,
			enabled: true
		});
		expect(formFor(target({ port: 22, check_type: 'tcp', interval_ms: 300000, enabled: 0 }))).toMatchObject({
			check_type: 'tcp',
			port: '22',
			interval: 300,
			enabled: false
		});
	});

	test('a host is a host: no scheme, no path', () => {
		expect(cleanHost(' https://example.com/status?x=1 ')).toBe('example.com');
		expect(cleanHost('10.0.0.1')).toBe('10.0.0.1');
	});

	test('what the server would refuse is said at the field', () => {
		expect(formErrors(form({ name: ' ', host: 'http://' }))).toEqual({
			name: 'network.name_required',
			host: 'network.host_required'
		});
		expect(formErrors(form({ check_type: 'tcp', port: '70000' }))).toEqual({ port: 'network.port_invalid' });
		expect(formErrors(form({ check_type: 'tcp', port: 1.5 }))).toEqual({ port: 'network.port_invalid' });
		// A ping has no port, whatever the field holds
		expect(formErrors(form({ check_type: 'ping', port: 'abc' }))).toEqual({});
	});

	test('the body: no port for a ping, the standard port when empty', () => {
		expect(formBody(form({ host: 'https://example.com/x' }))).toEqual({
			name: 'Web',
			host: 'example.com',
			check_type: 'ping',
			port: null,
			interval_ms: 60000,
			enabled: true
		});
		expect(formBody(form({ check_type: 'https', port: '' })).port).toBe(443);
		expect(formBody(form({ check_type: 'http', port: null })).port).toBe(80);
		expect(formBody(form({ check_type: 'tcp', port: 3389, interval: 30, enabled: false }))).toMatchObject({
			port: 3389,
			interval_ms: 30000,
			enabled: false
		});
	});
});

describe('response times', () => {
	test('oldest first, gaps where nothing answered, the range of answers', () => {
		const p = rttPoints(
			[
				{
					checked_at: '2026-11-09T10:02:00Z',
					status: 'down',
					rtt_ms: null,
					error_msg: 'x',
					status_code: null
				},
				{ checked_at: '2026-11-09T10:03:00Z', status: 'up', rtt_ms: 40.4, error_msg: '', status_code: null },
				{ checked_at: 'not a date', status: 'up', rtt_ms: 1, error_msg: '', status_code: null },
				{ checked_at: '2026-11-09T10:01:00Z', status: 'up', rtt_ms: 12, error_msg: '', status_code: null }
			],
			parseDate
		);
		expect(p?.values).toEqual([12, null, 40.4]);
		expect(p?.down).toBe(1);
		expect(p?.min).toBe(12);
		expect(p?.max).toBe(40);
		expect(p?.withDay).toBe(false);
	});

	test('a day or more needs the day in the labels; nothing answered has no range', () => {
		const p = rttPoints(
			[
				{
					checked_at: '2026-11-08T08:00:00Z',
					status: 'down',
					rtt_ms: null,
					error_msg: '',
					status_code: null
				},
				{ checked_at: '2026-11-09T09:00:00Z', status: 'down', rtt_ms: null, error_msg: '', status_code: null }
			],
			parseDate
		);
		expect(p?.withDay).toBe(true);
		expect(p?.min).toBeNull();
		expect(rttPoints([], parseDate)).toBeNull();
	});
});
