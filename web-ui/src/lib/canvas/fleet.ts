/**
 * The Fleet page's logic without a DOM (old public/js/fleet.js): tabs in
 * the URL, filters, the compliance summary and score levels, schedule
 * text, and the resource form's address label and example.
 */

import type { ComplianceRow, Resource, Task } from '#lib/api/fleet.ts';

export const FLEET_TABS = ['resources', 'tasks', 'builder', 'compliance'] as const;
export type FleetTab = (typeof FLEET_TABS)[number];

export function tabFrom(param: string | null): FleetTab {
	return (FLEET_TABS as readonly string[]).includes(param ?? '') ? (param as FleetTab) : 'resources';
}

/** The URL for a tab, keeping other parameters (the old page always wrote ?tab=) */
export function urlForTab(url: URL, tab: FleetTab): URL {
	const next = new URL(url);
	next.searchParams.set('tab', tab);
	return next;
}

/* ── Resources ── */

const RES_TYPES = ['printer', 'network_drive', 'dns', 'vpn', 'proxy'];
const SCOPES = ['org', 'group', 'device'];

/** fleet.type_<type> for known types, else null (the raw type is shown) */
export function resourceTypeKey(type: string): string | null {
	return RES_TYPES.includes(type) ? 'fleet.type_' + type : null;
}

/** fleet.scope_<scope>; no scope means the organization */
export function scopeKey(scope: string): string | null {
	if (!scope) return 'fleet.scope_org';
	return SCOPES.includes(scope) ? 'fleet.scope_' + scope : null;
}

export function resourceActive(r: Pick<Resource, 'active'>): boolean {
	return r.active !== false && r.active !== 0 && r.active !== '0' && r.active !== 'false';
}

export function filterResources(list: readonly Resource[], type: string): Resource[] {
	return type ? list.filter((r) => r.type === type) : [...list];
}

/** What the address field is called and an example, per resource type */
export function addressFor(type: string): { labelKey: string; example: string } {
	const examples: Record<string, string> = {
		printer: '\\\\server\\printer',
		network_drive: '\\\\server\\share',
		dns: '8.8.8.8, 1.1.1.1',
		vpn: 'vpn.example.com',
		proxy: 'http://proxy:8080'
	};
	const labelKey =
		type === 'dns' ? 'fleet.address_dns' : type === 'vpn' ? 'fleet.address_vpn' : 'fleet.address';
	return { labelKey, example: examples[type] ?? '' };
}

/* ── Tasks ── */

export function taskType(t: Pick<Task, 'type' | 'task_type'>): string {
	return t.type || t.task_type;
}

/** The devices a task runs on, as entered */
export function taskTargets(t: Pick<Task, 'targets' | 'device_id'>): string {
	return t.targets || t.device_id;
}

/** Search in the task's name and devices (case-insensitive) */
export function filterTasks(list: readonly Task[], query: string): Task[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((t) => t.name.toLowerCase().includes(q) || taskTargets(t).toLowerCase().includes(q));
}

export type Schedule =
	| { kind: 'immediate' }
	| { kind: 'cron'; value: string }
	| { kind: 'once'; value: string; date: Date | null };

/** When a task runs: right away, on a cron expression, or once at a time */
export function taskSchedule(t: Pick<Task, 'schedule_type' | 'schedule_value' | 'cron'>): Schedule {
	if (t.schedule_type === 'cron') return { kind: 'cron', value: t.schedule_value || t.cron };
	if (t.schedule_type === 'once') {
		const d = t.schedule_value ? new Date(t.schedule_value) : null;
		return { kind: 'once', value: t.schedule_value, date: d && !Number.isNaN(d.getTime()) ? d : null };
	}
	return { kind: 'immediate' };
}

/** The task form's check: the first missing field and its message key, or null */
export function taskProblem(body: {
	name: string;
	targets: string;
	schedule_type: string;
	schedule_value: string;
}): {
	field: 'name' | 'targets' | 'schedule';
	key: string;
} | null {
	if (!body.name) return { field: 'name', key: 'fleet.name_required' };
	if (!body.targets) return { field: 'targets', key: 'fleet.targets_required' };
	if (body.schedule_type !== 'immediate' && !body.schedule_value)
		return { field: 'schedule', key: 'fleet.schedule_required' };
	return null;
}

/** Retries 0-3 and a time limit of 30-3600 s as the server gets them (empty or invalid: 0 and 300, as before) */
export function taskNumbers(retries: unknown, timeout: unknown): { retries: number; timeout: number } {
	return { retries: parseInt(String(retries), 10) || 0, timeout: parseInt(String(timeout), 10) || 300 };
}

/* ── Compliance ── */

export function deviceOf(row: Pick<ComplianceRow, 'device_id' | 'id'>): string {
	return row.device_id || row.id;
}

/** A score as a whole percentage 0-100 */
export function score(row: Pick<ComplianceRow, 'score'>): number {
	const n = Number(row.score ?? 0);
	return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0));
}

/** 80 and more meets the rules, 50 and more is a warning, less is critical */
export function scoreLevel(value: number): 'good' | 'warning' | 'danger' {
	return value >= 80 ? 'good' : value >= 50 ? 'warning' : 'danger';
}

export function complianceSummary(list: readonly Pick<ComplianceRow, 'score'>[]): {
	count: number;
	compliant: number;
	warning: number;
	critical: number;
	score: number;
} {
	let compliant = 0;
	let warning = 0;
	let critical = 0;
	let total = 0;
	for (const d of list) {
		const s = Number(d.score ?? 0) || 0;
		total += s;
		if (s >= 80) compliant++;
		else if (s >= 50) warning++;
		else critical++;
	}
	return {
		count: list.length,
		compliant,
		warning,
		critical,
		score: list.length ? Math.round(total / list.length) : 0
	};
}
