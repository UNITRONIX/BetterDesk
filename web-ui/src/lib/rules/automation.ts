/**
 * Alerts and automation without a DOM: the choices the forms offer, tones
 * for severities and command states, the rule body and its checks, and the
 * page's tab in the URL (?tab=alerts|commands; rules is the default and
 * leaves the parameter out).
 */

import type { Alert, AlertRule, RuleBody } from '#lib/api/automation.ts';
import type { Tone } from '#lib/util/display.ts';

export const TABS = ['rules', 'alerts', 'commands'] as const;
export type AutomationTab = (typeof TABS)[number];

export function tabFrom(param: string | null): AutomationTab {
	return (TABS as readonly string[]).includes(param ?? '') ? (param as AutomationTab) : 'rules';
}

/** The URL for a tab, keeping other parameters */
export function urlForTab(url: URL, tab: AutomationTab): URL {
	const next = new URL(url);
	if (tab === 'rules') next.searchParams.delete('tab');
	else next.searchParams.set('tab', tab);
	return next;
}

export const CONDITION_TYPES = [
	'cpu_usage',
	'memory_usage',
	'disk_usage',
	'offline_duration',
	'idle_duration',
	'custom'
] as const;
export const OPERATORS = ['gt', 'gte', 'lt', 'lte', 'eq', 'neq'] as const;
export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export const COMMAND_TYPES = ['shell', 'powershell', 'script', 'restart_service', 'reboot'] as const;

/** A translated label for a stored value, or the value itself when there is no string for it */
export function labelFor(t: (key: string) => string, prefix: string, value: string): string {
	const key = `automation.${prefix}_${value}`;
	const word = t(key);
	return word === key ? value : word;
}

/** critical and high: danger; warning and medium: warning; info, low and anything else: neutral */
export function severityTone(sev: string): Tone {
	if (sev === 'critical' || sev === 'high') return 'danger';
	if (sev === 'warning' || sev === 'medium') return 'warning';
	return 'neutral';
}

export function commandTone(status: string): Tone {
	if (status === 'failed' || status === 'error') return 'danger';
	if (status === 'completed' || status === 'success' || status === 'running') return 'good';
	if (status === 'cancelled') return 'neutral';
	return 'waiting';
}

/** The unit next to the threshold: seconds for durations, percent for usage, none for custom */
export function unitKey(type: string): string | null {
	if (type === 'custom') return null;
	return /_duration$/.test(type) ? 'automation.unit_seconds' : 'automation.unit_percent';
}

export function isAcknowledged(a: Pick<Alert, 'acknowledged' | 'acknowledged_at'>): boolean {
	return a.acknowledged || !!a.acknowledged_at;
}

export interface RuleValues {
	name: string;
	description: string;
	condition_type: string;
	condition_op: string;
	/** The field's text: empty is "no threshold" */
	condition_value: number | null;
	severity: string;
	scope_device_id: string;
	enabled: boolean;
}

export function ruleValues(r: AlertRule | null): RuleValues {
	return {
		name: r?.name ?? '',
		description: r?.description ?? '',
		condition_type: r?.condition_type || 'cpu_usage',
		condition_op: r?.condition_op || 'gt',
		condition_value: r ? r.condition_value : null,
		severity: r?.severity || 'warning',
		scope_device_id: r?.scope_device_id ?? '',
		// A new rule starts on
		enabled: r ? r.enabled : true
	};
}

export type RuleCheck = { ok: true; body: RuleBody } | { ok: false; field: 'name' | 'condition_value' };

/** The body to save, or the field to fix. A custom rule has no limit: its stored value stays (or 0). */
export function ruleBody(v: RuleValues): RuleCheck {
	const name = v.name.trim();
	if (!name) return { ok: false, field: 'name' };
	const n = v.condition_value;
	const has = typeof n === 'number' && Number.isFinite(n);
	if (v.condition_type !== 'custom' && !has) return { ok: false, field: 'condition_value' };
	return {
		ok: true,
		body: {
			name,
			description: v.description.trim(),
			condition_type: v.condition_type,
			condition_op: v.condition_op,
			condition_value: has ? n : 0,
			severity: v.severity,
			scope_device_id: v.scope_device_id.trim() || null,
			enabled: v.enabled
		}
	};
}

/** Cut a long payload for the table; the full text is in the title and the details */
export function truncate(s: string, max = 40): string {
	return s.length > max ? s.slice(0, max) + '…' : s;
}
