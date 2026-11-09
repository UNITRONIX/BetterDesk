import { describe, expect, test } from 'vitest';
import type { Relay } from '../../../src/lib/api/scaling.ts';
import {
	availability,
	capacityTiers,
	diagramProps,
	filterRelays,
	matchHint,
	recommendations,
	relayName,
	relayStatus,
	reportingCount,
	sectionFor,
	sortRules,
	splitHostPort,
	totals
} from '../../../src/lib/serverarea/scaling.ts';
import {
	outcome,
	phaseText,
	progressPercent,
	reportFileName,
	tierName
} from '../../../src/lib/serverarea/attestation.ts';

const relay = (over: Partial<Relay> = {}): Relay => ({
	id: 'r-1',
	name: 'Berlin',
	address: 'relay.example.com:21117',
	location: 'Office',
	max_sessions: 50,
	max_bandwidth_mbps: 100,
	connected_devices: 0,
	active_sessions: 0,
	bandwidth_mbps: 0,
	cpu: 0,
	memory: 0,
	status: 'unknown',
	...over
});

describe('relay servers: what shows when', () => {
	test('nothing loaded yet: no search, rules stay', () => {
		expect(availability(null, null)).toEqual({
			search: false,
			addRule: true,
			foldRules: false,
			capacity: true
		});
	});
	test('no relay servers and no rules: one sentence instead of the rules table and Add rule', () => {
		expect(availability([], [])).toEqual({ search: false, addRule: false, foldRules: true, capacity: false });
	});
	test('no relay servers but rules exist: the rules stay listed, Add rule stays hidden', () => {
		expect(availability([], [{}])).toMatchObject({ addRule: false, foldRules: false });
	});
	test('with a relay server: search, Add rule and capacity', () => {
		expect(availability([relay()], [])).toEqual({
			search: true,
			addRule: true,
			foldRules: false,
			capacity: true
		});
	});
	test('?tab= names the section to scroll to', () => {
		expect(sectionFor('rules')).toBe('panel-rules');
		expect(sectionFor('capacity')).toBe('panel-capacity');
		expect(sectionFor('overview')).toBeNull();
		expect(sectionFor(null)).toBeNull();
	});
});

describe('relay servers: values', () => {
	test('search by name, address and location', () => {
		const list = [relay(), relay({ id: 'r-2', name: 'Munich', address: '10.0.0.5:21117', location: 'DC' })];
		expect(filterRelays(list, '10.0.0').map((r) => r.id)).toEqual(['r-2']);
		expect(filterRelays(list, 'office').map((r) => r.id)).toEqual(['r-1']);
		expect(filterRelays(list, '')).toHaveLength(2);
	});
	test('status tones and whether usage is shown', () => {
		expect(relayStatus({ status: 'unknown' })).toEqual({
			tone: 'neutral',
			label: 'scaling.status_unknown',
			reports: false
		});
		expect(relayStatus({ status: '' }).reports).toBe(false);
		expect(relayStatus({ status: 'online' })).toMatchObject({ tone: 'good', reports: true });
		expect(relayStatus({ status: 'degraded' }).tone).toBe('warning');
		expect(relayStatus({ status: 'offline' }).tone).toBe('neutral');
		expect(reportingCount([relay(), relay({ status: 'online' })])).toBe(1);
	});
	test('rules by priority, lowest first; relay names by id', () => {
		expect(sortRules([{ priority: 20 }, { priority: 5 }, { priority: 10 }]).map((r) => r.priority)).toEqual([
			5, 10, 20
		]);
		expect(relayName([relay()], 'r-1')).toBe('Berlin');
		expect(relayName([relay()], 'gone')).toBe('gone');
	});
	test('capacity: totals against the limits, with the old defaults', () => {
		const list = [relay({ connected_devices: 100, active_sessions: 10, bandwidth_mbps: 12.34 })];
		expect(totals(list)).toEqual({ devices: 100, sessions: 10, bandwidth: 12.3 });
		const tiers = capacityTiers(list, null);
		expect(tiers.map((x) => [x.current, x.max])).toEqual([
			[100, 500],
			[10, 50],
			[12.3, 100]
		]);
		expect(
			capacityTiers(list, { relay_count: 1, max_devices: 700, max_sessions: 60, max_bandwidth_mbps: 200 })[0]
				?.max
		).toBe(700);
	});
	test('advice: no relays, high device and session use, hot relay servers', () => {
		expect(recommendations([], null).map((r) => r.key)).toEqual(['scaling.rec_no_relays']);
		const busy = [relay({ connected_devices: 450, active_sessions: 45, cpu: 90, name: 'Hot' })];
		const recs = recommendations(busy, null);
		expect(recs.map((r) => r.key)).toEqual([
			'scaling.rec_devices_high',
			'scaling.rec_sessions_high',
			'scaling.rec_cpu_high_named'
		]);
		expect(recs[2]?.params).toEqual({ names: 'Hot' });
		expect(recommendations([relay()], null)).toEqual([]);
	});
	test('match hints follow the kind of match', () => {
		expect(matchHint('tag')[0]).toBe('scaling.rule_match_hint_tag');
		expect(matchHint('whatever')[0]).toBe('scaling.rule_match_value_hint');
	});
});

describe('connection diagram addresses', () => {
	test('host:port, bare hosts and IPv6', () => {
		expect(splitHostPort('id.example.com:21116', 1)).toEqual({ host: 'id.example.com', port: 21116 });
		expect(splitHostPort('id.example.com', 21116)).toEqual({ host: 'id.example.com', port: 21116 });
		expect(splitHostPort('[2001:db8::1]:21117', 1)).toEqual({ host: '2001:db8::1', port: 21117 });
		expect(splitHostPort('2001:db8::1', 21117)).toEqual({ host: '2001:db8::1', port: 21117 });
	});
	test('RELAY_SERVERS from the ID server wins over the client setting; relay only when forced', () => {
		const cfg = { server_id: '127.0.0.1', relay_server: '127.0.0.1' };
		expect(
			diagramProps(cfg, { mode: 'p2p_first', runtime: { relay_servers: '178.25.162.40, other' } })
		).toEqual({
			idServer: '127.0.0.1',
			idPort: 21116,
			relay: '178.25.162.40',
			relayPort: 21117,
			mode: 'direct-first'
		});
		expect(diagramProps(cfg, null).relay).toBe('127.0.0.1');
		expect(diagramProps(cfg, { mode: 'relay_only', runtime: {} }).mode).toBe('relay-only');
		expect(diagramProps(cfg, { mode: 'p2p_first', runtime: { always_use_relay: true } }).mode).toBe(
			'relay-only'
		);
	});
});

describe('capacity test', () => {
	test('progress by phase', () => {
		expect(progressPercent(null)).toBe(10);
		expect(progressPercent({ phase: 'baseline', connections: 0 })).toBe(15);
		expect(progressPercent({ phase: 'ramp-up', connections: 100 })).toBe(40);
		expect(progressPercent({ phase: 'ramp-up', connections: 1000 })).toBe(80);
		expect(progressPercent({ phase: 'stabilize', connections: 0 })).toBe(85);
		expect(progressPercent({ phase: 'done', connections: 0 })).toBe(100);
	});
	test('progress line', () => {
		expect(phaseText({ phase: 'ramp-up', connections: 25, message: '' })).toMatchObject({
			key: 'server_attestation.phase_ramp',
			params: { count: 25 }
		});
		expect(phaseText({ phase: 'mystery', connections: 0, message: 'Working' })).toEqual({
			key: null,
			fallback: 'Working'
		});
	});
	test('how a run ended', () => {
		expect(outcome({ aborted: true, valid: true })).toBe('stopped');
		expect(outcome({ aborted: false, valid: true })).toBe('complete');
		expect(outcome({ aborted: false, valid: false })).toBe('incomplete');
	});
	test("tier names: the admin's own name, else the translation", () => {
		const tr = (k: string) =>
			({ 'server_attestation.tier_iron': 'Eisen', 'server_attestation.tier_none': 'Nicht getestet' })[k] ?? k;
		expect(tierName('iron', {}, tr)).toBe('Eisen');
		expect(tierName('iron', { iron: '  Gold  ' }, tr)).toBe('Gold');
		expect(tierName('iron', { iron: '  ' }, tr)).toBe('Eisen');
		expect(tierName(null, {}, tr)).toBe('Nicht getestet');
		expect(tierName('mythic', {}, tr)).toBe('mythic');
	});
	test('report file name', () => {
		expect(reportFileName({ testedAt: '2026-11-09T10:00:00Z' })).toBe(
			'betterdesk-server-attestation-2026-11-09T10:00:00Z.json'
		);
		expect(reportFileName({ testedAt: null }, 42)).toBe('betterdesk-server-attestation-42.json');
	});
});
