/**
 * Support packages and contracts (routes/commercialization.routes.js).
 * Only what the device list needs so far (a package for a device group);
 * the billing pages add the rest when they are ported. These routes answer
 * without the { success, data } envelope.
 */

import * as v from 'valibot';
import { api, Text } from './client.ts';

export const Package = v.looseObject({
	id: v.pipe(v.union([v.string(), v.number()]), v.transform(String)),
	name: Text,
	included_minutes: v.optional(v.nullable(v.number())),
	currency: Text
});
export type Package = v.InferOutput<typeof Package>;

const PackageList = v.pipe(
	v.looseObject({
		packages: v.optional(v.array(Package)),
		data: v.optional(v.looseObject({ packages: v.optional(v.array(Package)) }))
	}),
	v.transform((o) => o.data?.packages ?? o.packages ?? [])
);

const Any = v.unknown();

/** Needs billing.view */
export function listPackages(signal?: AbortSignal) {
	return api(PackageList, '/api/panel/billing/packages', { signal });
}

export interface PackageInput {
	name: string;
	description: string;
	included_minutes: number;
	overage_rate: number;
	currency: string;
}

/** Needs billing.manage */
export function createPackage(p: PackageInput) {
	return api(Any, '/api/panel/billing/packages', { method: 'POST', body: p });
}

/** Attach a package to a device group (needs billing.manage) */
export function assignPackageToGroup(groupGuid: string, packageId: string) {
	return api(Any, '/api/panel/billing/contracts', {
		method: 'POST',
		body: { target_type: 'device_group', target_key: groupGuid, package_id: packageId }
	});
}

/* ── The billing pages (/commercialization) ──
   Everything below is used by the packages and sessions views. Read calls
   need billing.view; writes billing.manage; work reports billing.reports;
   the exports billing.export. */

/* Fields that are always there in the output, whatever the server leaves out */
const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null ? '' : String(s)))
);
const Num = v.pipe(
	v.optional(v.nullable(v.union([v.number(), v.string()])), null),
	v.transform((n) => (n === null || n === '' ? null : Number(n))),
	v.transform((n) => (n === null || Number.isFinite(n) ? n : null))
);
const Bool = v.pipe(
	v.optional(v.nullable(v.union([v.boolean(), v.number(), v.string()])), false),
	v.transform((b) => b === true || b === 1 || b === '1' || b === 'true')
);
const Id = v.pipe(v.union([v.string(), v.number()]), v.transform(String));
const StrList = v.pipe(
	v.optional(v.nullable(v.array(v.unknown())), []),
	v.transform((a) => (a ?? []).filter((x): x is string => typeof x === 'string'))
);
const listOf = <S extends v.GenericSchema>(key: string, item: S) =>
	v.pipe(
		v.looseObject({ [key]: v.optional(v.nullable(v.array(item)), []) }),
		v.transform((o) => (o[key] ?? []) as v.InferOutput<S>[])
	);

export const BillingPackage = v.looseObject({
	id: Id,
	name: Str,
	description: Str,
	included_minutes: Num,
	rounding_minutes: Num,
	overage_rate: Num,
	currency: Str
});
export type BillingPackage = v.InferOutput<typeof BillingPackage>;

/** Every package with all its fields (listPackages above keeps only what the device list needs) */
export function listBillingPackages(signal?: AbortSignal) {
	return api(listOf('packages', BillingPackage), '/api/panel/billing/packages', { signal });
}

export interface PackageBody extends PackageInput {
	rounding_minutes: number;
}

export function savePackage(id: string | null, p: PackageBody) {
	return id
		? api(Any, `/api/panel/billing/packages/${encodeURIComponent(id)}`, { method: 'PUT', body: p })
		: api(Any, '/api/panel/billing/packages', { method: 'POST', body: p });
}

export function deletePackage(id: string) {
	return api(Any, `/api/panel/billing/packages/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const Preview = v.looseObject({
	period_ym: Str,
	available_periods: StrList,
	companies: StrList,
	device_count: Num,
	included_limit: Num,
	included_minutes_used: Num,
	remaining_minutes: Num,
	overage_minutes: Num,
	amount_overage: Num,
	currency: Str,
	timezone: Str
});
export type Preview = v.InferOutput<typeof Preview>;

/** One package's use in a month (period "2026-11"; none: the current month) */
export function packagePreview(id: string, period?: string, signal?: AbortSignal) {
	return api(Preview, `/api/panel/billing/packages/${encodeURIComponent(id)}/preview`, {
		query: { period },
		signal
	});
}

export const Contract = v.looseObject({
	id: Id,
	target_type: Str,
	target_key: Str,
	target_name: Str,
	package_id: Str,
	package_name: Str,
	status: Str,
	remaining_minutes: Num,
	hourly_rate: Num,
	overage_rate: Num,
	currency: Str,
	valid_from: Str,
	valid_until: Str,
	current_period_ym: Str
});
export type Contract = v.InferOutput<typeof Contract>;

export function listContracts(filter: { status?: string; target_type?: string } = {}, signal?: AbortSignal) {
	return api(listOf('contracts', Contract), '/api/panel/billing/contracts', { query: { ...filter }, signal });
}

export interface ContractBody {
	target_type?: string;
	target_key?: string;
	package_id?: string;
	currency?: string;
	status?: string;
	remaining_minutes?: number;
	hourly_rate?: number;
	overage_rate?: number;
	valid_from?: string | null;
	valid_until?: string | null;
}

export function createContract(body: ContractBody) {
	return api(Any, '/api/panel/billing/contracts', { method: 'POST', body });
}

export function updateContract(id: string, body: ContractBody) {
	return api(Any, `/api/panel/billing/contracts/${encodeURIComponent(id)}`, { method: 'PUT', body });
}

export function deleteContract(id: string) {
	return api(Any, `/api/panel/billing/contracts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export const BillingSession = v.looseObject({
	id: Id,
	org_id: Str,
	contract_id: Str,
	operator_id: Str,
	operator_name: Str,
	device_id: Str,
	device_name: Str,
	relay_uuid: Str,
	transport: Str,
	status: Str,
	billing_phase: Str,
	started_at: Str,
	ended_at: Str,
	raw_seconds: Num,
	billed_minutes: Num,
	included_minutes_used: Num,
	overage_minutes: Num,
	amount_included: Num,
	amount_overage: Num,
	currency: Str,
	clock_offset_ms_at_start: Num,
	clock_synced_at_start: Bool
});
export type BillingSession = v.InferOutput<typeof BillingSession>;

export interface SessionFilter {
	org_id?: string;
	status?: string;
	device_id?: string;
}

export function listSessions(filter: SessionFilter = {}, signal?: AbortSignal) {
	return api(listOf('sessions', BillingSession), '/api/panel/billing/sessions', {
		query: { ...filter },
		signal
	});
}

export const WorkReport = v.looseObject({
	session_id: Str,
	operator_id: Str,
	summary: Str,
	category: Str,
	ticket_ref: Str,
	created_at: Str
});
export type WorkReport = v.InferOutput<typeof WorkReport>;

export function listReports(filter: { org_id?: string } = {}, signal?: AbortSignal) {
	return api(listOf('reports', WorkReport), '/api/panel/billing/reports', { query: { ...filter }, signal });
}

export function writeReport(
	sessionId: string,
	body: { summary: string; category: string; ticket_ref: string }
) {
	return api(Any, `/api/panel/billing/sessions/${encodeURIComponent(sessionId)}/report`, {
		method: 'POST',
		body
	});
}

/** Whether the server clock is in sync (billing may refuse sessions otherwise) */
export function timesyncStatus(signal?: AbortSignal) {
	return api(v.looseObject({ synced: Bool }), '/api/panel/billing/timesync/status', { signal });
}

export const EmailConfig = v.object({
	help_requests_enabled: v.optional(v.boolean(), true),
	notify_assigned_operators: v.optional(v.boolean(), true),
	fallback_alert_email: v.optional(v.boolean(), true),
	include_folder_in_subject: v.optional(v.boolean(), true)
});
export type EmailConfig = v.InferOutput<typeof EmailConfig>;

const EmailAnswer = v.looseObject({
	config: v.optional(v.looseObject(EmailConfig.entries), {})
});

export async function getEmailConfig(signal?: AbortSignal): Promise<EmailConfig> {
	const out = await api(EmailAnswer, '/api/panel/commercialization/email-config', { signal });
	return v.parse(EmailConfig, out.config);
}

export async function saveEmailConfig(config: EmailConfig): Promise<EmailConfig> {
	const out = await api(EmailAnswer, '/api/panel/commercialization/email-config', {
		method: 'PUT',
		body: config
	});
	return v.parse(EmailConfig, out.config);
}

/** Whether email sending (SMTP) is set up */
export async function smtpConfigured(signal?: AbortSignal): Promise<boolean> {
	const out = await api(
		v.looseObject({ configured: Bool, data: v.optional(v.looseObject({ configured: Bool })) }),
		'/api/panel/commercialization/smtp-status',
		{ signal }
	);
	return out.configured || !!out.data?.configured;
}

export const Org = v.looseObject({ id: Id, name: Str });
export type Org = v.InferOutput<typeof Org>;

/** Organizations for the sessions filter (GET /api/panel/org; the people pages own the rest of it) */
export function listOrgs(signal?: AbortSignal) {
	return api(
		v.pipe(
			v.looseObject({
				organizations: v.optional(v.nullable(v.array(Org))),
				orgs: v.optional(v.nullable(v.array(Org))),
				data: v.optional(v.looseObject({ organizations: v.optional(v.nullable(v.array(Org))) }))
			}),
			v.transform((o) => o.organizations ?? o.orgs ?? o.data?.organizations ?? [])
		),
		'/api/panel/org',
		{ signal }
	);
}

/** Download URLs (the server answers a file; needs billing.export) */
export function sessionsExportUrl(filter: SessionFilter): string {
	const q = new URLSearchParams({ format: 'csv' });
	for (const [k, val] of Object.entries(filter)) if (val) q.set(k, String(val));
	return `/api/panel/billing/sessions/export?${q.toString()}`;
}

export function reportsExportUrl(format: 'csv' | 'pdf', orgId?: string): string {
	const q = new URLSearchParams({ format });
	if (orgId) q.set('org_id', orgId);
	return `/api/panel/billing/reports/export?${q.toString()}`;
}
