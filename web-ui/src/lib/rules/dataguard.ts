/**
 * Data loss prevention without a DOM: transfer types and actions, the rules
 * JSON in the policy sheet, searching and filtering the two lists, and the
 * numbers above them.
 */

import type { DlpEvent, DlpPolicy } from '#lib/api/dataguard.ts';

export const DLP_TYPES = ['usb', 'file_type', 'clipboard', 'screen_share', 'file_transfer'] as const;
export const DLP_ACTIONS = ['block', 'log', 'allow'] as const;

export const DG_TABS = ['policies', 'events'] as const;
export type DataguardTab = (typeof DG_TABS)[number];
export function dgTabFrom(param: string | null): DataguardTab {
	return param === 'events' ? 'events' : 'policies';
}

/** The policy's transfer type (newer rows: policy_type, older: type) */
export function typeOf(p: Pick<DlpPolicy, 'policy_type' | 'type'>): string {
	return p.policy_type || p.type || '';
}

export function typeLabel(t: (key: string) => string, type: string): string {
	return (DLP_TYPES as readonly string[]).includes(type) ? t(`dataguard.type_${type}`) : type;
}

export function actionLabel(t: (key: string) => string, action: string): string {
	return (DLP_ACTIONS as readonly string[]).includes(action) ? t(`dataguard.action_${action}`) : action;
}

/** The rules as the sheet's text field shows them: empty for none */
export function rulesText(rules: unknown): string {
	if (rules === undefined || rules === null) return '';
	if (typeof rules === 'string') return rules;
	if (Array.isArray(rules) && rules.length === 0) return '';
	return JSON.stringify(rules, null, 2);
}

/** The field's text as the list the server wants; null when it is not a JSON list */
export function parseRules(text: string): unknown[] | null {
	const raw = text.trim();
	if (!raw) return [];
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export function filterPolicies(
	list: readonly DlpPolicy[],
	query: string,
	label: (type: string) => string
): DlpPolicy[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((p) =>
		[p.name, p.description, p.scope, label(typeOf(p))].join(' ').toLowerCase().includes(q)
	);
}

/** An event's details as one line of text (objects as JSON, empty objects as nothing) */
export function detailText(e: Pick<DlpEvent, 'details'>): string {
	const d = e.details;
	if (d === null || d === undefined || d === '') return '';
	if (typeof d === 'object') return Object.keys(d).length ? JSON.stringify(d) : '';
	return String(d as string | number | boolean);
}

export function filterEvents(list: readonly DlpEvent[], query: string, action: string): DlpEvent[] {
	const q = query.trim().toLowerCase();
	return list.filter(
		(e) =>
			(!action || e.action === action) &&
			(!q || [e.device_id, e.policy_name, detailText(e)].join(' ').toLowerCase().includes(q))
	);
}

/** Events per policy id, for the policy table's Events column */
export function eventsPerPolicy(events: readonly DlpEvent[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const e of events) if (e.policy_id !== null) out.set(e.policy_id, (out.get(e.policy_id) ?? 0) + 1);
	return out;
}

export function countByAction(events: readonly DlpEvent[]): Record<(typeof DLP_ACTIONS)[number], number> {
	const out = { block: 0, log: 0, allow: 0 };
	for (const e of events)
		if (e.action === 'block' || e.action === 'log' || e.action === 'allow') out[e.action]++;
	return out;
}
