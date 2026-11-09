/**
 * Network tools without a DOM: which tools and groups a role sees, input
 * checks, and how results are read (certificate days, password strength,
 * DNS records). The page and its tests use these.
 */

import type { DnsRecords } from '#lib/api/toolkit.ts';

export type GroupId = 'network' | 'crypto' | 'encoding' | 'system';
export const GROUPS: readonly GroupId[] = ['network', 'crypto', 'encoding', 'system'];

export type ToolId =
	| 'ping'
	| 'tcp'
	| 'ssl'
	| 'http'
	| 'dns'
	| 'whois'
	| 'speed'
	| 'wol'
	| 'hash'
	| 'password'
	| 'jwt'
	| 'base64'
	| 'urlencode'
	| 'processes'
	| 'disk'
	| 'db'
	| 'docker'
	| 'logs';

export interface ToolDef {
	id: ToolId;
	group: GroupId;
	/** Permission the server checks for it; none: any signed-in user */
	requires?: string;
}

/** Every tool in the old order, with the permission its API needs */
export const TOOLS: readonly ToolDef[] = [
	{ id: 'ping', group: 'network', requires: 'device.connect' },
	{ id: 'tcp', group: 'network', requires: 'device.connect' },
	{ id: 'ssl', group: 'network' },
	{ id: 'http', group: 'network', requires: 'device.connect' },
	{ id: 'dns', group: 'network', requires: 'device.connect' },
	{ id: 'whois', group: 'network' },
	{ id: 'speed', group: 'network', requires: 'metrics.view' },
	{ id: 'wol', group: 'network', requires: 'device.connect' },
	{ id: 'hash', group: 'crypto' },
	{ id: 'password', group: 'crypto' },
	{ id: 'jwt', group: 'crypto' },
	{ id: 'base64', group: 'encoding' },
	{ id: 'urlencode', group: 'encoding' },
	{ id: 'processes', group: 'system', requires: 'metrics.view' },
	{ id: 'disk', group: 'system', requires: 'metrics.view' },
	{ id: 'db', group: 'system', requires: 'metrics.view' },
	{ id: 'docker', group: 'system', requires: 'metrics.view' },
	{ id: 'logs', group: 'system', requires: 'metrics.view' }
];

export function visibleTools(can: (permission: string) => boolean): ToolDef[] {
	return TOOLS.filter((t) => !t.requires || can(t.requires));
}

/** Groups that still have a tool, in order */
export function visibleGroups(tools: readonly ToolDef[]): GroupId[] {
	return GROUPS.filter((g) => tools.some((t) => t.group === g));
}

/** The group a URL hash asks for (#crypto), when it is shown; else the first */
export function groupFromHash(hash: string, groups: readonly GroupId[]): GroupId | null {
	const wanted = hash.replace(/^#/, '');
	return (groups as readonly string[]).includes(wanted) ? (wanted as GroupId) : (groups[0] ?? null);
}

export function validPort(value: unknown): boolean {
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 && n <= 65535;
}

export function inRange(value: unknown, min: number, max: number): boolean {
	const n = Number(value);
	return Number.isInteger(n) && n >= min && n <= max;
}

/** The HTTP check takes a URL; a bare host gets https:// */
export function withScheme(url: string): string {
	const u = url.trim();
	return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

/** Certificate days left: expired or a week left is an error, a month a warning */
export function certTone(days: number): 'error' | 'warning' | 'ok' {
	if (days <= 7) return 'error';
	return days <= 30 ? 'warning' : 'ok';
}

/** Password strength from the entropy in bits */
export function strength(entropy: number): { key: 'very_strong' | 'strong' | 'weak'; tone: 'ok' | 'error' } {
	if (entropy >= 128) return { key: 'very_strong', tone: 'ok' };
	if (entropy >= 60) return { key: 'strong', tone: 'ok' };
	return { key: 'weak', tone: 'error' };
}

/** DNS records as rows: A, AAAA, NS, MX, TXT */
export function dnsRows(
	d: DnsRecords,
	mx: (host: string, priority: number) => string,
	mxNull: string
): { type: string; value: string }[] {
	const dns = d.dns ?? {};
	const rows: { type: string; value: string }[] = [];
	for (const v of dns.A ?? []) rows.push({ type: 'A', value: v });
	for (const v of dns.AAAA ?? []) rows.push({ type: 'AAAA', value: v });
	for (const v of dns.NS ?? []) rows.push({ type: 'NS', value: v });
	for (const m of dns.MX ?? [])
		rows.push({ type: 'MX', value: m.exchange ? mx(m.exchange, m.priority ?? 0) : mxNull });
	for (const v of dns.TXT ?? []) rows.push({ type: 'TXT', value: v });
	return rows;
}

/** Disk use in percent (0 when the size is unknown) */
export function diskPercent(used: unknown, total: unknown): number {
	const t = Number(total) || 0;
	return t ? Math.round(((Number(used) || 0) / t) * 100) : 0;
}

/** A container is running when Docker says so or its status starts with "Up" */
export function containerRunning(c: { state?: string | null; status?: string | null }): boolean {
	return c.state === 'running' || /^up\b/i.test(c.status ?? '');
}

/** This page's address with the group as its hash (#crypto) */
export function urlWithGroup(href: string, group: GroupId): URL {
	const url = new URL(href);
	url.hash = group;
	return url;
}
