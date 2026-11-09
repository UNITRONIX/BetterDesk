/**
 * Time zones tab: the zone list, what a zone means right now, and the
 * billing period in that zone (old settings.js fillTimezoneSelect,
 * renderBillingPeriod). No DOM.
 */

/** UTC offset of a zone now, "UTC+01:00" ("UTC" for UTC itself); '' for a name the browser doesn't know */
export function zoneOffset(zone: string, at: Date = new Date()): string {
	if (!zone) return '';
	try {
		const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
			.formatToParts(at)
			.find((p) => p.type === 'timeZoneName');
		return (part?.value ?? '').replace(/^GMT/, 'UTC') || 'UTC';
	} catch {
		return '';
	}
}

/** Every zone the browser knows */
export function knownZones(): string[] {
	try {
		return Intl.supportedValuesOf('timeZone');
	} catch {
		return [];
	}
}

/**
 * The picker's zones: what the browser knows, the server's list, the saved
 * zone and UTC, without names the browser can't use. Names without a
 * region (UTC) first, then by name, so each region's zones are together.
 */
export function zoneChoices(
	saved: string,
	common: readonly string[],
	known: readonly string[] = knownZones()
): string[] {
	const all = [...new Set([...known, ...common, saved, 'UTC'].filter(Boolean))].filter((z) => zoneOffset(z));
	const plain = all.filter((z) => !z.includes('/')).sort();
	const regional = all.filter((z) => z.includes('/')).sort();
	return [...plain, ...regional];
}

/** "Europe/Berlin (UTC+01:00)" */
export function zoneLabel(zone: string, at: Date = new Date()): string {
	return `${zone.replace(/_/g, ' ')} (${zoneOffset(zone, at)})`;
}

/** The custom name wins when there is one (old resolveSelectedTimezone) */
export function chosenZone(custom: string, picked: string): string {
	return custom.trim() || picked || 'UTC';
}

export interface ZoneNow {
	offset: string;
	/** Weekday and time there, in the console language */
	time: string;
	/** First and last day of the current billing month */
	start: string;
	end: string;
	/** First day of the next billing month */
	next: string;
}

/**
 * What the zone means now: the offset and local time, and the calendar
 * month there (the billing period). Null for an unknown zone.
 */
export function zoneNow(zone: string, locale: string | undefined, now: Date = new Date()): ZoneNow | null {
	const offset = zoneOffset(zone, now);
	if (!offset) return null;
	const time = new Intl.DateTimeFormat(locale, {
		timeZone: zone,
		weekday: 'long',
		hour: '2-digit',
		minute: '2-digit'
	}).format(now);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		year: 'numeric',
		month: 'numeric'
	}).formatToParts(now);
	const year = Number(parts.find((p) => p.type === 'year')?.value);
	const month = Number(parts.find((p) => p.type === 'month')?.value);
	// Calendar dates in that zone, written as plain dates (no shift)
	const day = (y: number, m: number, d: number) =>
		new Intl.DateTimeFormat(locale, {
			timeZone: 'UTC',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		}).format(new Date(Date.UTC(y, m - 1, d, 12)));
	const lastDay = new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
	const ny = month === 12 ? year + 1 : year;
	const nm = month === 12 ? 1 : month + 1;
	return {
		offset,
		time,
		start: day(year, month, 1),
		end: day(year, month, lastDay),
		next: day(ny, nm, 1)
	};
}

/** Server error codes and the keys that say them as sentences */
export const TIME_ERRORS: Readonly<
	Record<string, { key: string; field: 'billing_timezone' | 'ntp_servers' | 'max_skew_ms' }>
> = {
	invalid_billing_timezone: { key: 'settings.time.error_timezone', field: 'billing_timezone' },
	invalid_ntp_servers: { key: 'settings.time.error_servers', field: 'ntp_servers' },
	invalid_max_skew: { key: 'settings.time.error_skew', field: 'max_skew_ms' }
};

/** The form's own check before saving: the server's rule (billingClockConfigService validateSettings) */
export function skewValid(ms: number): boolean {
	return Number.isFinite(ms) && ms > 0 && ms <= 600000;
}

/** At least one time server; the server checks each name */
export function serversGiven(list: string): boolean {
	return list.split(',').some((s) => s.trim() !== '');
}
