/**
 * Dates, numbers, sizes and durations in the console language. Same output
 * as the old Utils.format* helpers.
 */

import { i18n, t } from './i18n.svelte.ts';

/* ── Dates ─────────────────────────────────────────────────────────── */

/**
 * API timestamp to Date, or null when there is no real date. SQLite writes
 * "2026-11-08 17:05:28" (UTC, no zone); those are read as UTC. Empty values,
 * 0 and Go's zero time count as no date.
 */
export function parseDate(value: unknown): Date | null {
	if (value === null || value === undefined || value === '' || value === 0) return null;
	let date: Date;
	if (value instanceof Date) date = value;
	else if (typeof value === 'number') date = new Date(value);
	else {
		let text = String(value).trim();
		if (!text) return null;
		if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) text = text.replace(' ', 'T') + 'Z';
		date = new Date(text);
	}
	if (isNaN(date.getTime()) || date.getUTCFullYear() < 1971) return null;
	return date;
}

const DEFAULT_DATE: Intl.DateTimeFormatOptions = {
	year: 'numeric',
	month: 'short',
	day: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
};

/* Building an Intl formatter is slow next to using one, and a long list
   formats thousands of values: keep one per language and options. */
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();

/** The fields that make toLocaleString show only what was asked for */
const DATE_FIELDS = [
	'weekday',
	'era',
	'year',
	'month',
	'day',
	'dayPeriod',
	'hour',
	'minute',
	'second',
	'fractionalSecondDigits',
	'dateStyle',
	'timeStyle'
] as const;

function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale ?? ''}|${JSON.stringify(options)}`;
	let fmt = dateFormats.get(key);
	if (!fmt) {
		// Same output as Date#toLocaleString: with no field given it shows date and time
		const asked = DATE_FIELDS.some((k) => options[k] !== undefined);
		const opts = asked
			? options
			: ({
					...options,
					year: 'numeric',
					month: 'numeric',
					day: 'numeric',
					hour: 'numeric',
					minute: 'numeric',
					second: 'numeric'
				} as const);
		fmt = new Intl.DateTimeFormat(locale, opts);
		dateFormats.set(key, fmt);
	}
	return fmt;
}

export function formatDate(value: unknown, format: Intl.DateTimeFormatOptions = {}, empty = '-'): string {
	const date = parseDate(value);
	if (!date) return empty;
	return dateFormat(i18n.locale, { ...DEFAULT_DATE, ...format }).format(date);
}

/** "just now", "5 minutes ago" ... up to a week, then the date */
export function formatRelative(value: unknown, empty = '-', now: number = Date.now()): string {
	const date = parseDate(value);
	if (!date) return empty;
	const seconds = Math.floor((now - date.getTime()) / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	const days = Math.floor(hours / 24);
	if (seconds < 60) return t('time.just_now');
	if (minutes < 60) return t('time.minutes_ago', { count: minutes });
	if (hours < 24) return t('time.hours_ago', { count: hours });
	if (days < 7) return t('time.days_ago', { count: days });
	return formatDate(date);
}

/* ── Numbers ───────────────────────────────────────────────────────── */

function isBlank(value: unknown): boolean {
	return value === null || value === undefined || value === '';
}

export function formatNumber(value: unknown, options: Intl.NumberFormatOptions = {}): string {
	const n = Number(value);
	if (isBlank(value) || !Number.isFinite(n)) return '';
	const locale = i18n.locale;
	const key = `${locale ?? ''}|${JSON.stringify(options)}`;
	let fmt = numberFormats.get(key);
	if (!fmt) {
		fmt = new Intl.NumberFormat(locale, options);
		numberFormats.set(key, fmt);
	}
	return fmt.format(n);
}

/** Bytes as B, kB, MB, GB, TB with one decimal: "1.5 GB" */
export function formatBytes(bytes: unknown): string {
	const n = Number(bytes);
	if (isBlank(bytes) || !Number.isFinite(n) || n < 0) return '';
	const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'];
	let i = 0;
	let val = n;
	while (val >= 1024 && i < units.length - 1) {
		val /= 1024;
		i++;
	}
	if (i === 0) return `${formatNumber(val, { maximumFractionDigits: 0 })} B`;
	return formatNumber(val, { style: 'unit', unit: units[i], unitDisplay: 'short', maximumFractionDigits: 1 });
}

/** Seconds as the two largest units: "2d 3h", "5m 40s". largest: 'hour' counts hours, not days. */
export function formatDuration(seconds: unknown, options: { largest?: 'hour' } = {}): string {
	let s = Math.round(Number(seconds));
	if (isBlank(seconds) || !Number.isFinite(s) || s < 0) return '';
	const units: [string, number][] = (
		[
			['day', 86400],
			['hour', 3600],
			['minute', 60],
			['second', 1]
		] as [string, number][]
	).filter(([unit]) => !(options.largest === 'hour' && unit === 'day'));
	const parts = units.map(([unit, size]) => {
		const k = Math.floor(s / size);
		s -= k * size;
		return [unit, k] as const;
	});
	const start = parts.findIndex(([, k]) => k > 0);
	if (start === -1) return formatNumber(0, { style: 'unit', unit: 'second', unitDisplay: 'narrow' });
	return parts
		.slice(start, start + 2)
		.filter(([, k]) => k > 0)
		.map(([unit, k]) => formatNumber(k, { style: 'unit', unit, unitDisplay: 'narrow' }))
		.join(' ');
}

/** Percent of 0..100 (fraction: value is 0..1) */
export function formatPercent(value: unknown, options: { fraction?: boolean; digits?: number } = {}): string {
	const n = Number(value);
	if (isBlank(value) || !Number.isFinite(n)) return '';
	return formatNumber(options.fraction ? n : n / 100, {
		style: 'percent',
		maximumFractionDigits: options.digits ?? 0
	});
}
