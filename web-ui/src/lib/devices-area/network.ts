/**
 * Network monitoring's rules without a DOM: labels for a target, its state,
 * the count sentence, search, the add/edit form (what it refuses, what it
 * sends) and the response time chart's points and summary.
 */

import type { CheckType, HistoryEntry, Target, TargetInput } from '#lib/api/network.ts';
import type { Sentence } from './sentences.ts';

/** The intervals the form offers, in seconds */
export const INTERVALS = [30, 60, 300, 600];

export function intervalSeconds(t: Pick<Target, 'interval_ms'>): number {
	return t.interval_ms ? Math.round(t.interval_ms / 1000) : 60;
}

export function intervalLabel(seconds: number): Sentence {
	return seconds % 60 === 0
		? { key: 'network.every_minutes', params: { count: seconds / 60 } }
		: { key: 'network.every_seconds', params: { count: seconds } };
}

/** The interval choices: the four standard ones, plus the target's own when it differs */
export function intervalOptions(current: number): number[] {
	return INTERVALS.includes(current) ? [...INTERVALS] : [...INTERVALS, current].sort((a, b) => a - b);
}

/** What is checked: a translated sentence, or the protocol name itself */
export function checkLabel(t: Pick<Target, 'check_type' | 'port'>): Sentence | { text: string } {
	switch (t.check_type) {
		case 'tcp':
			return { key: 'network.check_tcp', params: { port: t.port || 80 } };
		case 'http':
			return { text: 'HTTP' };
		case 'https':
			return { text: 'HTTPS' };
		default:
			return { key: 'network.check_ping' };
	}
}

/** host, host:port, or the URL */
export function address(t: Pick<Target, 'url' | 'host' | 'port' | 'check_type'>): string {
	if (t.url) return t.url;
	if (t.port && t.check_type !== 'ping') return `${t.host}:${t.port}`;
	return t.host;
}

export type TargetState = 'paused' | 'up' | 'down' | 'unchecked';

export function targetState(t: Pick<Target, 'enabled' | 'last_status'>): TargetState {
	if (!t.enabled) return 'paused';
	if (t.last_status === 'up') return 'up';
	if (t.last_status === 'down') return 'down';
	return 'unchecked';
}

/** Status tones: up good, down danger, paused and unchecked neutral */
export const STATE_TONE: Record<TargetState, 'good' | 'danger' | 'neutral'> = {
	up: 'good',
	down: 'danger',
	paused: 'neutral',
	unchecked: 'neutral'
};

export const STATE_KEY: Record<TargetState, string> = {
	up: 'network.status_up',
	down: 'network.status_down',
	paused: 'network.status_paused',
	unchecked: 'network.status_unchecked'
};

/** The last response time in whole ms, only while the target answers */
export function latency(t: Pick<Target, 'last_status' | 'last_rtt_ms'>): number | null {
	return t.last_status === 'up' && t.last_rtt_ms !== null ? Math.round(t.last_rtt_ms) : null;
}

export function matches(t: Pick<Target, 'name' | 'host' | 'url'>, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return [t.name, t.host, t.url].some((v) => v.toLowerCase().includes(q));
}

/** "4 targets. 1 down. 2 not checked yet. Average response time 12 ms. 3 shown." */
export function countLine(targets: Target[], searching: boolean, shown: number): Sentence[] {
	if (!targets.length) return [];
	const out: Sentence[] = [
		targets.length === 1
			? { key: 'network.count_one' }
			: { key: 'network.count_many', params: { count: targets.length } }
	];
	const active = targets.filter((t) => t.enabled);
	const down = active.filter((t) => t.last_status === 'down').length;
	const unchecked = active.filter((t) => t.last_status !== 'up' && t.last_status !== 'down').length;
	if (down) out.push({ key: 'network.count_down', params: { count: down } });
	else if (active.length && !unchecked) out.push({ key: 'network.count_all_up' });
	if (unchecked) out.push({ key: 'network.count_unchecked', params: { count: unchecked } });
	const times = active
		.filter((t) => t.last_status === 'up' && t.last_rtt_ms !== null)
		.map((t) => t.last_rtt_ms as number);
	if (times.length)
		out.push({
			key: 'network.count_latency',
			params: { ms: Math.round(times.reduce((a, b) => a + b, 0) / times.length) }
		});
	if (searching) out.push({ key: 'network.count_shown', params: { count: shown } });
	return out;
}

/* ── The add/edit form ── */

export interface TargetForm {
	name: string;
	host: string;
	check_type: CheckType;
	/** As typed (a number field may hand over a number); empty means the standard port */
	port: string | number | null;
	/** Seconds */
	interval: number;
	enabled: boolean;
}

export function formFor(t: Target | null): TargetForm {
	return {
		name: t?.name ?? '',
		host: t?.host ?? '',
		check_type: t?.check_type ?? 'ping',
		port: t?.port ? String(t.port) : '',
		interval: t ? intervalSeconds(t) : 60,
		enabled: t ? t.enabled : true
	};
}

/** Host names only: "https://example.com/path" becomes "example.com" */
export function cleanHost(input: string): string {
	return input
		.trim()
		.replace(/^[a-z]+:\/\//i, '')
		.replace(/\/.*$/, '');
}

/** The standard port of a web check */
export const defaultPort = (type: CheckType): number | null =>
	type === 'https' ? 443 : type === 'http' || type === 'tcp' ? 80 : null;

const portText = (p: TargetForm['port']) => (p === null || p === undefined ? '' : String(p).trim());

/** What the server would refuse, by field (translation keys) */
export function formErrors(f: TargetForm): Partial<Record<'name' | 'host' | 'port', string>> {
	const errors: Partial<Record<'name' | 'host' | 'port', string>> = {};
	if (!f.name.trim()) errors.name = 'network.name_required';
	if (!cleanHost(f.host)) errors.host = 'network.host_required';
	if (f.check_type !== 'ping' && portText(f.port)) {
		const port = Number(portText(f.port));
		if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'network.port_invalid';
	}
	return errors;
}

/** The body for POST or PATCH: a ping has no port, an empty port is the standard one */
export function formBody(f: TargetForm): TargetInput {
	const typed = portText(f.port);
	const port = f.check_type === 'ping' ? null : typed ? Number(typed) : defaultPort(f.check_type);
	return {
		name: f.name.trim(),
		host: cleanHost(f.host),
		check_type: f.check_type,
		port,
		interval_ms: f.interval * 1000,
		enabled: f.enabled
	};
}

/* ── Response times ── */

export interface RttPoints {
	/** Oldest first, so time runs left to right */
	dates: Date[];
	/** null where the target did not answer (a gap in the line) */
	values: (number | null)[];
	/** More than about a day: the labels need the day too */
	withDay: boolean;
	down: number;
	min: number | null;
	max: number | null;
}

export function rttPoints(history: HistoryEntry[], parse: (s: string) => Date | null): RttPoints | null {
	const checks = history
		.map((e) => ({ e, date: parse(e.checked_at) }))
		.filter((x): x is { e: HistoryEntry; date: Date } => x.date !== null)
		.sort((a, b) => a.date.getTime() - b.date.getTime());
	const firstCheck = checks[0];
	const lastCheck = checks[checks.length - 1];
	if (!firstCheck || !lastCheck) return null;
	const values = checks.map(({ e }) => (e.status === 'up' && e.rtt_ms !== null ? e.rtt_ms : null));
	const answered = values.filter((x): x is number => x !== null);
	const first = firstCheck.date.getTime();
	const last = lastCheck.date.getTime();
	return {
		dates: checks.map((c) => c.date),
		values,
		withDay: last - first > 20 * 3600 * 1000,
		down: checks.length - answered.length,
		min: answered.length ? Math.round(Math.min(...answered)) : null,
		max: answered.length ? Math.round(Math.max(...answered)) : null
	};
}
