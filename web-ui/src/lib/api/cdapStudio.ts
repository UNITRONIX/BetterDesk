/**
 * Flow builder (routes/cdap-studio.routes.js): saved flows in the
 * studio_flows table, a simulated test run, deploy (sets the status), the
 * .bdflow export and the built-in templates. Reading needs a session,
 * changing the operator role (super admins pass every role check). Each
 * person sees their own flows; super admins see every flow.
 */

import * as v from 'valibot';
import { api, NumLike, Ok } from './client.ts';

const enc = (s: string) => encodeURIComponent(s);

/** Text that is always a string ('' for missing or null) */
const Text = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);

export const FlowSummary = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Text,
	description: Text,
	status: Text,
	version: v.optional(v.nullable(NumLike), 1),
	created_by: Text,
	created_at: Text,
	updated_at: Text
});
export type FlowSummary = v.InferOutput<typeof FlowSummary>;

export const StoredFlow = v.looseObject({
	...FlowSummary.entries,
	flow_json: Text
});
export type StoredFlow = v.InferOutput<typeof StoredFlow>;

const FlowList = v.pipe(
	v.looseObject({ flows: v.optional(v.nullable(v.array(FlowSummary)), null) }),
	v.transform((o) => o.flows ?? [])
);

export function listFlows(signal?: AbortSignal): Promise<FlowSummary[]> {
	return api(FlowList, '/api/cdap-studio/flows', { signal });
}

export async function getFlow(id: string): Promise<StoredFlow> {
	const out = await api(v.looseObject({ flow: StoredFlow }), `/api/cdap-studio/flows/${enc(id)}`);
	return out.flow;
}

export interface FlowInput {
	name: string;
	description: string;
	/** The flow as a JSON string */
	flow_json: string;
}

/** A new flow; resolves its id */
export async function createFlow(body: FlowInput): Promise<string> {
	const out = await api(
		v.looseObject({ id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)) }),
		'/api/cdap-studio/flows',
		{ method: 'POST', body }
	);
	return out.id;
}

export function updateFlow(id: string, body: FlowInput) {
	return api(Ok, `/api/cdap-studio/flows/${enc(id)}`, { method: 'PUT', body });
}

export function deleteFlow(id: string) {
	return api(Ok, `/api/cdap-studio/flows/${enc(id)}`, { method: 'DELETE' });
}

export function deployFlow(id: string) {
	return api(Ok, `/api/cdap-studio/flows/${enc(id)}/deploy`, { method: 'POST' });
}

export const TestResult = v.looseObject({
	nodeId: Text,
	nodeType: Text,
	label: Text,
	status: Text,
	output: v.optional(v.unknown())
});
export type TestResult = v.InferOutput<typeof TestResult>;

const TestRun = v.looseObject({
	results: v.optional(v.nullable(v.array(TestResult)), null),
	nodeCount: v.optional(NumLike, 0),
	wireCount: v.optional(NumLike, 0)
});
export type TestRun = v.InferOutput<typeof TestRun>;

/** The server's dry run of the saved flow: every node with its simulated output */
export function testFlow(id: string): Promise<TestRun> {
	return api(TestRun, `/api/cdap-studio/flows/${enc(id)}/test`, { method: 'POST' });
}

/** The server's .bdflow download of a saved flow (a link, not a request) */
export function flowExportUrl(id: string): string {
	return `/api/cdap-studio/flows/${enc(id)}/export`;
}

export const FlowTemplate = v.looseObject({
	id: Text,
	name: Text,
	description: Text,
	icon: Text,
	flow: v.optional(v.unknown())
});
export type FlowTemplate = v.InferOutput<typeof FlowTemplate>;

const TemplateList = v.pipe(
	v.looseObject({ templates: v.optional(v.nullable(v.array(FlowTemplate)), null) }),
	v.transform((o) => o.templates ?? [])
);

export function listTemplates(signal?: AbortSignal): Promise<FlowTemplate[]> {
	return api(TemplateList, '/api/cdap-studio/templates', { signal });
}
