/**
 * The billing pages (/commercialization) without a DOM: which view the URL
 * asks for, how minutes, money and months read, what the included-time
 * list shows, and the bodies the sheets send. Tests:
 * tests/unit/server/billing.test.ts.
 */

import type { BillingPackage, BillingSession, Contract, ContractBody } from '#lib/api/billing.ts';
import { formatDuration, formatNumber, parseDate } from '#lib/i18n/format.ts';

/* ── URL ── */

export type BillingTab = 'packages' | 'sessions';

/** ?tab= as the server read it: packages and sessions, the old tabs mapped onto them */
export function billingTab(raw: string | null | undefined): BillingTab {
	const v = String(raw ?? '');
	if (v === 'sessions' || v === 'reports') return 'sessions';
	return 'packages';
}

/** ?tab=settings or ?settings=1 opens the billing settings (on the packages view) */
export function opensSettings(params: { get(name: string): string | null }): boolean {
	return params.get('tab') === 'settings' || params.get('settings') === '1';
}

/* ── Values ── */

/** Billing counts whole minutes, shown as a duration ("4h 20m"; "0m" for none) */
export function formatMinutes(m: unknown): string {
	const n = Math.max(0, Math.round(Number(m) || 0));
	if (!n) return formatNumber(0, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' });
	return formatDuration(n * 60, { largest: 'hour' });
}

export function formatMoney(amount: unknown, currency: string, locale?: string): string {
	const n = Number(amount) || 0;
	try {
		return new Intl.NumberFormat(locale, { style: 'currency', currency: currency || 'EUR' }).format(n);
	} catch {
		return `${n.toFixed(2)} ${currency || ''}`.trim();
	}
}

/** "2026-11" as the month's name in the console language: "November 2026" */
export function formatMonth(ym: string, locale?: string): string {
	const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
	if (!m) return String(ym || '');
	try {
		return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)).toLocaleDateString(locale, {
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
	} catch {
		return String(ym);
	}
}

export function thisMonth(now = new Date()): string {
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** Active: good. Pending report: waits for the operator. Closed and suspended: ended or paused, nothing wrong. */
export const STATUS_TONE: Record<string, string> = {
	active: 'good',
	pending_report: 'waiting',
	closed: 'neutral',
	suspended: 'neutral'
};

/** A session ended on the day it started: its end shows only the time */
export function sameDay(a: unknown, b: unknown): boolean {
	const x = parseDate(a);
	const y = parseDate(b);
	return !!x && !!y && x.toDateString() === y.toDateString();
}

/* ── Packages ── */

export function filterPackages<T extends Pick<BillingPackage, 'name' | 'description'>>(
	list: readonly T[],
	q: string
): T[] {
	const s = q.trim().toLowerCase();
	if (!s) return [...list];
	return list.filter((p) => `${p.name} ${p.description}`.toLowerCase().includes(s));
}

/** Included time as a number and a unit for the package sheet: hours when it divides evenly */
export function amountFromMinutes(minutes: number): { amount: string; unit: 'hours' | 'minutes' } {
	const m = Math.max(0, Math.round(minutes || 0));
	return m % 60 === 0 ? { amount: String(m / 60), unit: 'hours' } : { amount: String(m), unit: 'minutes' };
}

export function minutesFromAmount(amount: string, unit: 'hours' | 'minutes'): number {
	const n = parseFloat(amount) || 0;
	return Math.max(0, unit === 'hours' ? Math.round(n * 60) : Math.round(n));
}

export const ROUNDING_STEPS = ['5', '10', '15', '20', '30'] as const;

/** A package's rounding as the select's choice, or "custom" with its value */
export function roundingChoice(value: number | null | undefined): { choice: string; custom: string } {
	const v = String(value || 10);
	return (ROUNDING_STEPS as readonly string[]).includes(v)
		? { choice: v, custom: '15' }
		: { choice: 'custom', custom: v };
}

export function roundingMinutes(choice: string, custom: string): number {
	return parseInt(choice === 'custom' ? custom || '15' : choice, 10) || 10;
}

/* ── Assignments ── */

export function filterContracts<T extends Pick<Contract, 'target_name' | 'target_key' | 'package_name'>>(
	list: readonly T[],
	q: string
): T[] {
	const s = q.trim().toLowerCase();
	if (!s) return [...list];
	return list.filter((c) => `${c.target_name} ${c.target_key} ${c.package_name}`.toLowerCase().includes(s));
}

export interface AssignValues {
	targetKey: string;
	packageId: string;
	remaining: string;
	hourlyRate: string;
	overageRate: string;
	validFrom: string;
	validUntil: string;
}

/** Dates come from <input type="date"> as YYYY-MM-DD; the end may not be before the start */
export function datesInOrder(from: string, until: string): boolean {
	return !(from && until && until < from);
}

/** What a new assignment sends: empty optional fields are left out (the package's values apply) */
export function newContractBody(
	v: AssignValues,
	pkg: Pick<BillingPackage, 'currency'> | undefined
): ContractBody {
	const body: ContractBody = {
		target_type: 'device_group',
		target_key: v.targetKey,
		package_id: v.packageId,
		currency: pkg?.currency || 'EUR'
	};
	const hourly = parseFloat(v.hourlyRate);
	if (v.remaining !== '') body.remaining_minutes = parseInt(v.remaining, 10);
	if (!Number.isNaN(hourly)) body.hourly_rate = hourly;
	if (v.overageRate !== '') body.overage_rate = parseFloat(v.overageRate);
	if (v.validFrom) body.valid_from = `${v.validFrom}T00:00:00Z`;
	if (v.validUntil) body.valid_until = `${v.validUntil}T23:59:59Z`;
	return body;
}

/** What an edit sends: the fields people can change; empty dates clear them */
export function contractPatch(v: AssignValues): ContractBody {
	const patch: ContractBody = {};
	const hourly = parseFloat(v.hourlyRate);
	if (v.remaining !== '') patch.remaining_minutes = parseInt(v.remaining, 10);
	if (!Number.isNaN(hourly)) patch.hourly_rate = hourly;
	if (v.overageRate !== '') patch.overage_rate = parseFloat(v.overageRate);
	patch.valid_from = v.validFrom ? `${v.validFrom}T00:00:00Z` : null;
	patch.valid_until = v.validUntil ? `${v.validUntil}T23:59:59Z` : null;
	return patch;
}

/** The sheet's values for an assignment being edited */
export function contractValues(c: Contract): AssignValues {
	const num = (n: number | null) => (n === null || n === undefined ? '' : String(n));
	return {
		targetKey: c.target_key,
		packageId: c.package_id,
		remaining: String(c.remaining_minutes ?? 0),
		hourlyRate: String(c.hourly_rate ?? 0),
		overageRate: num(c.overage_rate),
		validFrom: c.valid_from ? c.valid_from.slice(0, 10) : '',
		validUntil: c.valid_until ? c.valid_until.slice(0, 10) : ''
	};
}

/* ── Included time this month ── */

export interface UsageRow {
	contract: Contract;
	packageName: string;
	included: number;
	used: number;
	/** used / included; -1 without included time (sorted last) */
	share: number;
}

/**
 * Used time per assignment this month: the package's included minutes minus
 * the assignment's remaining minutes. A period from an earlier month is
 * reset by the server at the next session, so it counts as unused.
 */
export function usageRows(
	contracts: readonly Contract[],
	packages: readonly Pick<BillingPackage, 'id' | 'name' | 'included_minutes'>[],
	month: string
): UsageRow[] {
	const byId = new Map(packages.map((p) => [p.id, p]));
	return contracts
		.map((c) => {
			const pkg = byId.get(c.package_id);
			const included = Math.max(0, Number(pkg?.included_minutes) || 0);
			const stale = !!c.current_period_ym && c.current_period_ym !== month;
			const remaining = stale ? included : Math.max(0, Number(c.remaining_minutes) || 0);
			const used = Math.max(0, included - remaining);
			return {
				contract: c,
				packageName: c.package_name || pkg?.name || '',
				included,
				used,
				share: included ? used / included : -1
			};
		})
		.sort((a, b) => b.share - a.share);
}

/* ── Sessions ── */

/** The server ignores device_id, so the list is narrowed here as well */
export function filterByDevice<T extends Pick<BillingSession, 'device_id' | 'device_name'>>(
	list: readonly T[],
	q: string
): T[] {
	const s = q.trim().toLowerCase();
	if (!s) return [...list];
	return list.filter((x) => `${x.device_id} ${x.device_name}`.toLowerCase().includes(s));
}

/** Ended sessions read by status (when the full list fails), newest first */
export function mergeEnded<T extends Pick<BillingSession, 'started_at'>>(
	lists: readonly (readonly T[])[]
): T[] {
	return lists.flat().sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
}

export const REPORT_CATEGORIES = ['software', 'hardware', 'network', 'account', 'other'] as const;
