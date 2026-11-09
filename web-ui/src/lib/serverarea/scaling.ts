/**
 * Relay servers (/scaling) without a DOM: what shows when, the capacity
 * numbers, the advice under them and the connection diagram's addresses.
 * Tests: tests/unit/server/scaling.test.ts.
 */

import type { Capacity, Relay, Rule } from '#lib/api/scaling.ts';

/** ?tab= names the section to scroll to (old links used tabs) */
export const SECTIONS: Record<string, string> = {
	relays: 'panel-relays',
	rules: 'panel-rules',
	capacity: 'panel-capacity'
};

export function sectionFor(tab: string | null | undefined): string | null {
	return (tab && SECTIONS[tab]) || null;
}

export const MATCH_TYPES = ['subnet', 'group', 'tag', 'country', 'device_id'] as const;

/** Show only what applies: no search without relay servers, no rules table or "Add rule" until there is one to point to */
export function availability(
	relays: readonly unknown[] | null,
	rules: readonly unknown[] | null
): { search: boolean; addRule: boolean; foldRules: boolean; capacity: boolean } {
	const none = relays !== null && relays.length === 0;
	return {
		search: relays !== null && relays.length > 0,
		addRule: !none,
		foldRules: none && rules !== null && rules.length === 0,
		capacity: !none
	};
}

export function filterRelays<T extends Pick<Relay, 'name' | 'address' | 'location'>>(
	list: readonly T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((r) => `${r.name} ${r.address} ${r.location}`.toLowerCase().includes(q));
}

/** Status tone and label key; usage only for relay servers that report */
export function relayStatus(r: Pick<Relay, 'status'>): { tone: string; label: string; reports: boolean } {
	const status = r.status || 'unknown';
	if (status === 'unknown') return { tone: 'neutral', label: 'scaling.status_unknown', reports: false };
	const tone = status === 'online' ? 'good' : status === 'degraded' ? 'warning' : 'neutral';
	return { tone, label: 'scaling.status_' + status, reports: true };
}

export function reportingCount(relays: readonly Pick<Relay, 'status'>[]): number {
	return relays.filter((r) => r.status && r.status !== 'unknown').length;
}

export function sortRules<T extends Pick<Rule, 'priority'>>(rules: readonly T[]): T[] {
	return [...rules].sort((a, b) => (a.priority || 0) - (b.priority || 0));
}

export function relayName(relays: readonly Pick<Relay, 'id' | 'name'>[], id: string): string {
	const r = relays.find((x) => x.id === id);
	return r ? r.name || r.id : id || '';
}

export interface Totals {
	devices: number;
	sessions: number;
	bandwidth: number;
}

export function totals(relays: readonly Relay[]): Totals {
	return {
		devices: relays.reduce((s, r) => s + (r.connected_devices || 0), 0),
		sessions: relays.reduce((s, r) => s + (r.active_sessions || 0), 0),
		bandwidth: Math.round(relays.reduce((s, r) => s + (r.bandwidth_mbps || 0), 0) * 10) / 10
	};
}

/** The defaults the old page used when the capacity answer was missing */
export function limits(cap: Capacity | null): { devices: number; sessions: number; bandwidth: number } {
	return {
		devices: cap?.max_devices || 500,
		sessions: cap?.max_sessions || 50,
		bandwidth: cap?.max_bandwidth_mbps || 100
	};
}

export interface Tier {
	key: string;
	current: number;
	max: number;
	unit: string;
}

export function capacityTiers(relays: readonly Relay[], cap: Capacity | null): Tier[] {
	const tot = totals(relays);
	const lim = limits(cap);
	return [
		{ key: 'scaling.cap_tier_devices', current: tot.devices, max: lim.devices, unit: '' },
		{ key: 'scaling.cap_tier_sessions', current: tot.sessions, max: lim.sessions, unit: '' },
		{ key: 'scaling.cap_tier_bandwidth', current: tot.bandwidth, max: lim.bandwidth, unit: ' Mbps' }
	];
}

/** Advice as keys and their values, in the old order */
export function recommendations(
	relays: readonly Relay[],
	cap: Capacity | null
): { key: string; params?: Record<string, string> }[] {
	const tot = totals(relays);
	const lim = limits(cap);
	const out: { key: string; params?: Record<string, string> }[] = [];
	if (!relays.length) out.push({ key: 'scaling.rec_no_relays' });
	if (tot.devices / lim.devices > 0.8) out.push({ key: 'scaling.rec_devices_high' });
	if (tot.sessions / lim.sessions > 0.8) out.push({ key: 'scaling.rec_sessions_high' });
	const hot = relays.filter((r) => (r.cpu || 0) > 80).map((r) => r.name || r.id);
	if (hot.length) out.push({ key: 'scaling.rec_cpu_high_named', params: { names: hot.join(', ') } });
	return out;
}

/** The sizing guide: rough numbers for common setups */
export const SIZING = [
	{ key: 'scaling.cap_single_sqlite', devices: 200, sessions: 30 },
	{ key: 'scaling.cap_single_pg', devices: 1000, sessions: 50 },
	{ key: 'scaling.cap_master_3', devices: 5000, sessions: 150 },
	{ key: 'scaling.cap_master_10', devices: 20000, sessions: 500 }
] as const;

/** "host:port" → host and port; bare IPv6 addresses keep their colons */
export function splitHostPort(value: string, fallbackPort: number): { host: string; port: number } {
	const v = String(value || '').trim();
	const m = v.match(/^\[?([^\]]+?)\]?:(\d{1,5})$/);
	if (m && m[1] && m[2] && (v.startsWith('[') || v.indexOf(':') === v.lastIndexOf(':')))
		return { host: m[1], port: Number(m[2]) };
	return { host: v, port: fallbackPort };
}

/**
 * What the connection diagram draws: the ID server hands out RELAY_SERVERS
 * when it is set; otherwise clients use their own relay setting.
 */
export function diagramProps(
	cfg: { server_id: string; relay_server: string },
	mode: { mode: string; runtime: { relay_servers?: string; always_use_relay?: boolean | null } } | null
): {
	idServer: string;
	idPort: number;
	relay: string;
	relayPort: number;
	mode: 'direct-first' | 'relay-only';
} {
	const runtime = mode?.runtime ?? {};
	const relayRaw =
		String(runtime.relay_servers || '')
			.split(',')
			.map((x) => x.trim())
			.filter(Boolean)[0] || cfg.relay_server;
	const id = splitHostPort(cfg.server_id, 21116);
	const relay = splitHostPort(relayRaw || cfg.server_id, 21117);
	const relayOnly = mode?.mode === 'relay_only' || runtime.always_use_relay === true;
	return {
		idServer: id.host,
		idPort: id.port,
		relay: relay.host,
		relayPort: relay.port,
		mode: relayOnly ? 'relay-only' : 'direct-first'
	};
}

/** The hint under a rule's value, by kind of match: key and English fallback */
export function matchHint(type: string): [string, string] {
	const hints: Record<string, [string, string]> = {
		subnet: ['scaling.rule_match_value_hint', 'For a subnet, for example 192.168.1.0/24.'],
		group: ['scaling.rule_match_hint_group', 'The name of a device group.'],
		tag: ['scaling.rule_match_hint_tag', 'One tag, as it is set on the devices.'],
		country: ['scaling.rule_match_hint_country', 'The country the devices connect from.'],
		device_id: ['scaling.rule_match_hint_device_id', 'One device ID.']
	};
	return hints[type] ?? ['scaling.rule_match_value_hint', 'For a subnet, for example 192.168.1.0/24.'];
}
