/**
 * Alerts and automation (routes/automation.routes.js, mounted at
 * /api/automation): alert rules, the alerts they raised, and remote
 * commands for device agents. Reading and acknowledging need a session;
 * creating, changing and deleting rules and sending commands need
 * server.config.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';
import { listIn, Str, Bool } from './lists.ts';

const enc = encodeURIComponent;

const Id = v.pipe(v.union([v.number(), v.string()]), v.transform(String));
/** A number the database sends as a number, a numeric string or null */
const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), null),
	v.transform((n) => {
		if (n === null || n === '') return null;
		const x = Number(n);
		return Number.isFinite(x) ? x : null;
	})
);
const NullableText = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), null),
	v.transform((s) => (s === null || s === '' ? null : String(s)))
);

export const AlertRule = v.looseObject({
	id: Id,
	name: Str,
	description: Str,
	enabled: Bool,
	condition_type: Str,
	condition_op: Str,
	condition_value: Num,
	severity: Str,
	scope_device_id: NullableText,
	cooldown_secs: Num,
	created_by: Str,
	created_at: Str
});
export type AlertRule = v.InferOutput<typeof AlertRule>;

export async function listRules(signal?: AbortSignal): Promise<AlertRule[]> {
	return api(listIn(AlertRule, 'rules', 'data'), '/api/automation/rules', { signal });
}

export interface RuleBody {
	name: string;
	description: string;
	condition_type: string;
	condition_op: string;
	condition_value: number;
	severity: string;
	scope_device_id: string | null;
	enabled: boolean;
}

export async function createRule(body: RuleBody): Promise<void> {
	await request('/api/automation/rules', { method: 'POST', body });
}

export async function updateRule(id: string, body: Partial<RuleBody>): Promise<void> {
	await request(`/api/automation/rules/${enc(id)}`, { method: 'PATCH', body });
}

export async function deleteRule(id: string): Promise<void> {
	await request(`/api/automation/rules/${enc(id)}`, { method: 'DELETE' });
}

export const Alert = v.looseObject({
	id: Id,
	rule_id: NullableText,
	rule_name: Str,
	device_id: Str,
	severity: Str,
	message: Str,
	measured_value: Num,
	triggered_at: Str,
	acknowledged: Bool,
	acknowledged_by: Str,
	acknowledged_at: Str
});
export type Alert = v.InferOutput<typeof Alert>;

export async function listAlerts(severity: string, signal?: AbortSignal): Promise<Alert[]> {
	return api(listIn(Alert, 'alerts', 'data'), '/api/automation/alerts', { query: { severity }, signal });
}

export async function acknowledgeAlert(id: string): Promise<void> {
	await request(`/api/automation/alerts/${enc(id)}/ack`, { method: 'POST' });
}

export const Command = v.looseObject({
	id: Id,
	device_id: Str,
	command_type: Str,
	payload: Str,
	status: Str,
	result: NullableText,
	created_by: Str,
	created_at: Str,
	executed_at: Str,
	completed_at: Str
});
export type Command = v.InferOutput<typeof Command>;

export async function listCommands(signal?: AbortSignal): Promise<Command[]> {
	return api(listIn(Command, 'commands', 'data'), '/api/automation/commands', { signal });
}

export async function getCommand(id: string, signal?: AbortSignal): Promise<Command> {
	return api(Command, `/api/automation/commands/${enc(id)}`, { signal });
}

export interface CommandBody {
	device_id: string;
	command_type: string;
	payload: string;
}

export async function sendCommand(body: CommandBody): Promise<void> {
	await request('/api/automation/commands', { method: 'POST', body });
}
