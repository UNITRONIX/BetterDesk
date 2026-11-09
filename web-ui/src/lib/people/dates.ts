/**
 * Calendar days in the browser's time zone: the range fields of the
 * activity and reports pages, and counts per day for their charts.
 */

import { parseDate } from '#lib/i18n/format.ts';

/** Local calendar day of a time, "2026-11-09" */
export function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The last `n` days up to today, each at noon */
export function lastDays(n: number, now = new Date()): Date[] {
	const out: Date[] = [];
	for (let i = n - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setHours(12, 0, 0, 0);
		d.setDate(d.getDate() - i);
		out.push(d);
	}
	return out;
}

/** How many of `times` fall on each of `days` */
export function countPerDay(
	times: readonly (Date | number | string | null | undefined)[],
	days: readonly Date[]
): number[] {
	const keys = days.map(dayKey);
	const counts = keys.map(() => 0);
	for (const t of times) {
		const d = parseDate(t);
		if (!d) continue;
		const i = keys.indexOf(dayKey(d));
		if (i >= 0) counts[i] = (counts[i] ?? 0) + 1;
	}
	return counts;
}

/**
 * The chart covers the last `days` days only when the loaded events reach
 * back to the first of them (the server keeps events since it started).
 */
export function coversDays(oldest: Date, days: readonly Date[]): boolean {
	const first = new Date(days[0] ?? new Date());
	first.setHours(0, 0, 0, 0);
	return oldest.getTime() <= first.getTime();
}

/** A date field's value for a day ("2026-11-09") */
export const isoDay = dayKey;
