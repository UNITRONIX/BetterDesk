import { beforeEach, describe, expect, test } from 'vitest';
import { setStrings, t, tf, plural, has, i18n } from '../../src/lib/i18n/i18n.svelte.ts';
import {
	formatBytes,
	formatDate,
	formatDuration,
	formatNumber,
	formatPercent,
	formatRelative,
	parseDate
} from '../../src/lib/i18n/format.ts';

const EN = {
	common: { cancel: 'Cancel', copy_value: 'Copy {value}' },
	devices: { count: '{count} devices, {online} online' },
	time: {
		just_now: 'just now',
		minutes_ago: '{count} minutes ago',
		hours_ago: '{count}h ago',
		days_ago: '{count}d ago'
	}
};

beforeEach(() => setStrings('en', 'ltr', EN));

describe('t', () => {
	test('reads nested keys and fills placeholders', () => {
		expect(t('common.cancel')).toBe('Cancel');
		expect(t('devices.count', { count: 6, online: 3 })).toBe('6 devices, 3 online');
	});
	test('unknown keys come back as the key, missing params stay as placeholders', () => {
		expect(t('nope.missing')).toBe('nope.missing');
		expect(t('common.copy_value')).toBe('Copy {value}');
		expect(t('common')).toBe('common');
	});
	test('prototype keys never resolve', () => {
		expect(t('__proto__.toString')).toBe('__proto__.toString');
		expect(t('constructor')).toBe('constructor');
		expect(has('common.__proto__')).toBe(false);
	});
	test('tf falls back to English text for keys not loaded yet', () => {
		expect(tf('new.key', 'Copy {value}', { value: 'x' })).toBe('Copy x');
		expect(tf('common.cancel', 'Abort')).toBe('Cancel');
	});
	test('switching strings sets lang and dir on <html>', () => {
		setStrings('ar', 'rtl', { common: { cancel: 'إلغاء' } });
		expect(document.documentElement.dir).toBe('rtl');
		expect(document.documentElement.lang).toBe('ar');
		expect(t('common.cancel')).toBe('إلغاء');
		expect(i18n.lang).toBe('ar');
	});
	test('plural picks one or other', () => {
		expect(plural(1, { one: '1 item', other: '{count} items' })).toBe('1 item');
		expect(plural(3, { one: '1 item', other: '{count} items' })).toBe('3 items');
		expect(plural(0, { other: '{count} items' })).toBe('0 items');
	});
});

describe('dates', () => {
	test('SQLite timestamps are UTC; empty and zero dates are none', () => {
		expect(parseDate('2026-11-08 17:05:28')?.toISOString()).toBe('2026-11-08T17:05:28.000Z');
		expect(parseDate('')).toBeNull();
		expect(parseDate(0)).toBeNull();
		expect(parseDate('0001-01-01T00:00:00Z')).toBeNull();
		expect(parseDate('garbage')).toBeNull();
		expect(formatDate(null)).toBe('-');
		expect(formatDate(null, {}, 'Never')).toBe('Never');
	});
	test('relative time up to a week, then the date', () => {
		const now = Date.parse('2026-11-09T12:00:00Z');
		expect(formatRelative('2026-11-09T11:59:30Z', '-', now)).toBe('just now');
		expect(formatRelative('2026-11-09T11:55:00Z', '-', now)).toBe('5 minutes ago');
		expect(formatRelative('2026-11-09T09:00:00Z', '-', now)).toBe('3h ago');
		expect(formatRelative('2026-11-07T12:00:00Z', '-', now)).toBe('2d ago');
		expect(formatRelative('2026-10-01T12:00:00Z', '-', now)).toBe(formatDate('2026-10-01T12:00:00Z'));
	});
});

describe('numbers', () => {
	test('format like the old helpers', () => {
		expect(formatNumber(12345)).toBe('12,345');
		expect(formatNumber('')).toBe('');
		expect(formatBytes(152)).toBe('152 B');
		expect(formatBytes(1610612736)).toBe('1.5 GB');
		expect(formatBytes(-1)).toBe('');
		expect(formatDuration(183600)).toBe('2d 3h');
		expect(formatDuration(340)).toBe('5m 40s');
		expect(formatDuration(96120, { largest: 'hour' })).toBe('26h 42m');
		expect(formatDuration(0)).toBe('0s');
		expect(formatPercent(62)).toBe('62%');
		expect(formatPercent(0.625, { fraction: true, digits: 1 })).toBe('62.5%');
	});
	test('follow the console language', () => {
		setStrings('de', 'ltr', EN);
		expect(formatNumber(12345.5)).toBe('12.345,5');
	});
});
