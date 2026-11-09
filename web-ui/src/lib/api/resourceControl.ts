/**
 * USB and drive access (routes/resource-control.routes.js): the device list,
 * the summary of how many devices follow their rules, and one device's rules
 * per category. All need server.config.
 *
 * The Go server has no /devices/{id}/resources endpoint yet (BUGS.md P5):
 * reading a device's rules answers 404 and saving fails with 404. The
 * summary falls back to zeros.
 */

import * as v from 'valibot';
import { api, ApiError, request } from './client.ts';
import { listIn, Str } from './lists.ts';

const enc = encodeURIComponent;

export const RcDevice = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	hostname: Str,
	platform: Str,
	status: Str,
	online: v.optional(v.boolean()),
	device_type: Str,
	/** Per category: compliant, partial, noncompliant or na, once devices report it */
	resources: v.optional(v.nullable(v.record(v.string(), v.unknown())), null)
});
export type RcDevice = v.InferOutput<typeof RcDevice>;

export async function listRcDevices(signal?: AbortSignal): Promise<RcDevice[]> {
	return api(listIn(RcDevice, 'devices', 'data'), '/api/panel/resource-control/devices', { signal });
}

const Count = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), 0),
	v.transform((n) => (Number.isFinite(Number(n)) ? Number(n) : 0))
);

export const Compliance = v.looseObject({
	total_devices: Count,
	compliant: Count,
	non_compliant: v.optional(v.nullable(v.union([v.number(), v.string()]))),
	noncompliant: v.optional(v.nullable(v.union([v.number(), v.string()]))),
	no_policy: Count,
	/** { usb: { enforced, total } }; older builds sent [{ key, pct }] */
	categories: v.optional(v.unknown())
});
export type Compliance = v.InferOutput<typeof Compliance>;

const ComplianceAnswer = v.pipe(
	v.unknown(),
	v.transform((o) => {
		const inner = o && typeof o === 'object' ? (o as Record<string, unknown>).data : undefined;
		return inner && typeof inner === 'object' ? inner : o;
	}),
	Compliance
);

export async function getCompliance(signal?: AbortSignal): Promise<Compliance> {
	return api(ComplianceAnswer, '/api/panel/resource-control/compliance', { signal });
}

const RulesAnswer = v.pipe(
	v.unknown(),
	v.transform((o): Record<string, unknown> => {
		if (!o || typeof o !== 'object') return {};
		const r = o as Record<string, unknown>;
		const inner = r.data ?? r.policy;
		return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : r;
	})
);

/** A device's saved rules by category, or null when none are saved (404) */
export async function getDeviceRules(
	id: string,
	signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
	try {
		return await api(RulesAnswer, `/api/panel/resource-control/policies/${enc(id)}`, { signal });
	} catch (err) {
		if (err instanceof ApiError && err.status === 404) return null;
		throw err;
	}
}

export async function saveDeviceRules(
	id: string,
	category: string,
	body: Record<string, unknown>
): Promise<void> {
	await request(`/api/panel/resource-control/policies/${enc(id)}/${enc(category)}`, { method: 'POST', body });
}
