/**
 * Fleet tasks (routes/fleet.routes.js): resources pushed to an
 * organization's devices, tasks run on many devices, saved workflows and
 * compliance results. Every route needs org.manage_devices and proxies to
 * the Go server's /api/fleet; Go answers lists bare, as { data }, or under
 * a key (resources, tasks, workflows, devices), so the lists accept all
 * three, as the old page did.
 *
 * Go has no fleet handlers yet (BUGS.md P4) and answers 404 for all of
 * them. fleetAvailability() asks the console once; a 404 from a list means
 * the same.
 */

import * as v from 'valibot';
import { api, ApiError, Ok, request } from './client.ts';

const enc = (s: string) => encodeURIComponent(s);

/** Text that is always a string ('' for missing or null) */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);
const Id = v.pipe(v.union([v.string(), v.number()]), v.transform(String));
const OptNum = v.optional(v.nullable(v.union([v.number(), v.string()])), null);

/** A list bare, as { data }, or under `key` */
function listOf<S extends v.GenericSchema>(key: string, item: S) {
	return v.pipe(
		v.unknown(),
		v.transform((data): unknown[] => {
			if (Array.isArray(data)) return data;
			if (!data || typeof data !== 'object') return [];
			const o = data as Record<string, unknown>;
			const list = o.data ?? o[key];
			return Array.isArray(list) ? list : [];
		}),
		v.array(item)
	);
}

/** Go answers 404 for every fleet path it has no handler for */
export function isUnavailable(err: unknown): boolean {
	return err instanceof ApiError && err.status === 404;
}

/**
 * Whether the server offers fleet tasks: true or false, or null when the
 * console is older than this question (then the lists find out).
 */
export async function fleetAvailability(signal?: AbortSignal): Promise<boolean | null> {
	try {
		const out = await api(v.looseObject({ available: v.boolean() }), '/api/panel/fleet/availability', {
			signal
		});
		return out.available;
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

/* ── Resources ── */

export const RESOURCE_TYPES = ['printer', 'network_drive', 'dns', 'vpn', 'proxy'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const Resource = v.looseObject({
	id: Id,
	name: Str,
	type: Str,
	address: Str,
	value: Str,
	scope: Str,
	scope_value: Str,
	active: v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), null)
});
export type Resource = v.InferOutput<typeof Resource>;

export interface ResourceInput {
	name: string;
	type: string;
	address: string;
	scope: string;
	scope_value: string;
}

export function listResources(orgId: string, signal?: AbortSignal): Promise<Resource[]> {
	return api(listOf('resources', Resource), `/api/panel/fleet/resources/${enc(orgId)}`, { signal });
}

export function saveResource(orgId: string, id: string | null, body: ResourceInput) {
	return id
		? request(`/api/panel/fleet/resources/${enc(orgId)}/${enc(id)}`, { method: 'PUT', body })
		: request(`/api/panel/fleet/resources/${enc(orgId)}`, { method: 'POST', body });
}

export function deleteResource(orgId: string, id: string) {
	return request(`/api/panel/fleet/resources/${enc(orgId)}/${enc(id)}`, { method: 'DELETE' });
}

/* ── Tasks ── */

export const TASK_TYPES = ['script', 'restart', 'update', 'install', 'file_deploy', 'registry'] as const;
export const TASK_STATUSES = ['pending', 'running', 'success', 'failed'] as const;

export const Task = v.looseObject({
	id: Id,
	name: Str,
	type: Str,
	task_type: Str,
	targets: Str,
	device_id: Str,
	schedule_type: Str,
	schedule_value: Str,
	cron: Str,
	status: Str,
	last_run: Str,
	script: Str,
	payload: Str,
	retries: OptNum,
	timeout: OptNum
});
export type Task = v.InferOutput<typeof Task>;

export interface TaskInput {
	name: string;
	type: string;
	targets: string;
	schedule_type: string;
	schedule_value: string;
	script: string;
	retries: number;
	timeout: number;
}

export function listTasks(status: string, signal?: AbortSignal): Promise<Task[]> {
	return api(listOf('tasks', Task), '/api/panel/fleet/tasks', { query: { status }, signal });
}

export function saveTask(id: string | null, body: TaskInput) {
	return id
		? request(`/api/panel/fleet/tasks/${enc(id)}`, { method: 'PUT', body })
		: request('/api/panel/fleet/tasks', { method: 'POST', body });
}

export function deleteTask(id: string) {
	return request(`/api/panel/fleet/tasks/${enc(id)}`, { method: 'DELETE' });
}

export function retryTask(id: string) {
	return api(Ok, `/api/panel/fleet/tasks/${enc(id)}/retry`, { method: 'POST' });
}

/** A task's output text ('' when it has none yet) */
export async function taskOutput(id: string, signal?: AbortSignal): Promise<string> {
	const out = await api(
		v.looseObject({ output: Str, log: Str }),
		`/api/panel/fleet/tasks/${enc(id)}/output`,
		{
			signal
		}
	);
	return out.output || out.log;
}

/* ── Workflows ── */

export const WorkflowSummary = v.looseObject({ id: Id, name: Str });
export type WorkflowSummary = v.InferOutput<typeof WorkflowSummary>;

export function listWorkflows(signal?: AbortSignal): Promise<WorkflowSummary[]> {
	return api(listOf('workflows', WorkflowSummary), '/api/panel/fleet/workflows', { signal });
}

/** A saved workflow as the server sends it ({ data } or bare); workflow.ts reads it */
export function getWorkflow(id: string): Promise<unknown> {
	return request(`/api/panel/fleet/workflows/${enc(id)}`);
}

export interface WorkflowInput {
	name: string;
	nodes: unknown[];
	connections: unknown[];
}

/** Save a workflow; resolves the id the server gives a new one ('' when it sends none) */
export async function saveWorkflow(id: string | null, body: WorkflowInput): Promise<string> {
	const out = await api(
		v.looseObject({ id: v.optional(v.nullable(v.union([v.string(), v.number()])), null) }),
		id ? `/api/panel/fleet/workflows/${enc(id)}` : '/api/panel/fleet/workflows',
		{ method: id ? 'PUT' : 'POST', body }
	);
	return out.id === null || out.id === undefined ? '' : String(out.id);
}

/** Run (or try with dry_run) a workflow; resolves the output it reported, if any */
export async function executeWorkflow(
	id: string,
	body: { dry_run: boolean; nodes: unknown[]; connections: unknown[] }
): Promise<string> {
	const out = await api(
		v.looseObject({ output: Str, log: Str }),
		`/api/panel/fleet/workflows/${enc(id)}/execute`,
		{
			method: 'POST',
			body
		}
	);
	return out.output || out.log;
}

/* ── Compliance ── */

export const ComplianceRow = v.looseObject({
	id: Str,
	device_id: Str,
	hostname: Str,
	os: Str,
	platform: Str,
	score: OptNum,
	issues: OptNum,
	last_scan: Str
});
export type ComplianceRow = v.InferOutput<typeof ComplianceRow>;

export function listCompliance(orgId: string, signal?: AbortSignal): Promise<ComplianceRow[]> {
	return api(listOf('devices', ComplianceRow), '/api/panel/fleet/compliance', { query: { orgId }, signal });
}

export function scanDevice(deviceId: string) {
	return request(`/api/panel/fleet/compliance/${enc(deviceId)}/scan`, { method: 'POST' });
}

export function remediateDevice(deviceId: string) {
	return request(`/api/panel/fleet/compliance/${enc(deviceId)}/remediate`, {
		method: 'POST',
		body: { action: 'auto' }
	});
}
