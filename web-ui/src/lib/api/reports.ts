/**
 * Reports (routes/reports.routes.js and routes/trends.routes.js).
 * Reading, generating and the trends need audit.view; saving and deleting a
 * saved report need super_admin, admin or global_admin (a role check on
 * the server, not a permission). Answers come without the envelope, except
 * the trends.
 */

import * as v from 'valibot';
import { api, request, wrapped } from './client.ts';

const Str = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.number()])), ''),
	v.transform((s) => (s === null || s === undefined ? '' : String(s)))
);

export interface ReportFilters {
	from?: string | undefined;
	to?: string | undefined;
}

export const Report = v.looseObject({
	type: Str,
	label: Str,
	generated_at: Str,
	data: v.pipe(
		v.optional(v.nullable(v.record(v.string(), v.unknown())), null),
		v.transform((d) => d ?? {})
	)
});
export type Report = v.InferOutput<typeof Report>;

export function generateReport(type: string, filters: ReportFilters): Promise<Report> {
	return api(Report, '/api/reports/generate', { method: 'POST', body: { type, ...filters } });
}

/** The report as CSV text; `section` names the list in the data to export */
export async function reportCsv(type: string, filters: ReportFilters, section?: string): Promise<string> {
	const out = await request('/api/reports/generate/csv', {
		method: 'POST',
		body: { type, ...filters, section }
	});
	return typeof out === 'string' ? out : '';
}

export const SavedReport = v.looseObject({
	id: v.union([v.number(), v.string()]),
	title: Str,
	name: Str,
	report_type: Str,
	type: Str,
	created_by: Str,
	created_at: Str
});
export type SavedReport = v.InferOutput<typeof SavedReport>;

export function listSavedReports(signal?: AbortSignal): Promise<SavedReport[]> {
	return api(v.array(SavedReport), '/api/reports/saved', { signal });
}

const JsonObject = v.pipe(
	v.optional(v.nullable(v.union([v.string(), v.record(v.string(), v.unknown())])), null),
	v.transform((p): Record<string, unknown> => {
		if (!p) return {};
		if (typeof p !== 'string') return p;
		try {
			const parsed: unknown = JSON.parse(p);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		} catch {
			return {};
		}
	})
);

export const SavedReportFull = v.looseObject({
	...SavedReport.entries,
	filters: JsonObject,
	payload: JsonObject
});
export type SavedReportFull = v.InferOutput<typeof SavedReportFull>;

export function getSavedReport(id: number | string): Promise<SavedReportFull> {
	return api(SavedReportFull, `/api/reports/saved/${encodeURIComponent(String(id))}`);
}

/** Generates the report again and stores it. Needs super_admin, admin or global_admin */
export function saveReport(type: string, title: string, filters: ReportFilters) {
	return api(SavedReport, '/api/reports/save', { method: 'POST', body: { type, title, ...filters } });
}

/** Needs super_admin, admin or global_admin */
export function deleteSavedReport(id: number | string) {
	return request(`/api/reports/saved/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
}

/* ── Trends (last days of sessions and help requests) ── */

const Ms = v.pipe(
	v.optional(v.nullable(v.number()), null),
	v.transform((n) => n ?? null)
);

export const Trends = v.looseObject({
	days: v.optional(v.number()),
	sessions: v.pipe(
		v.optional(v.nullable(v.array(v.looseObject({ start: v.number(), end: Ms }))), null),
		v.transform((a) => a ?? [])
	),
	help: v.pipe(
		v.optional(v.nullable(v.array(v.looseObject({ created: v.number(), updated: Ms, status: Str }))), null),
		v.transform((a) => a ?? [])
	),
	devicesChecked: v.pipe(
		v.optional(v.nullable(v.number()), 0),
		v.transform((n) => n ?? 0)
	),
	devicesTotal: v.pipe(
		v.optional(v.nullable(v.number()), 0),
		v.transform((n) => n ?? 0)
	)
});
export type Trends = v.InferOutput<typeof Trends>;

export function getTrends(days: number, signal?: AbortSignal): Promise<Trends> {
	return api(wrapped(Trends), '/api/reports/trends', { query: { days }, signal });
}
