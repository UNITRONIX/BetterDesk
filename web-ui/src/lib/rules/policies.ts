/**
 * The policy form without a DOM: the values each group shows (with the
 * old page's defaults for groups never saved), the body each group's PUT
 * sends, the number limits, and which groups changed. The Policies page
 * saves only changed groups, each to its own endpoint, so groups nobody
 * touched stay "Not set".
 */

import type { AuditEntry, Policies } from '#lib/api/policies.ts';

export const SECTIONS = ['connection', 'features', 'security', 'network', 'update'] as const;
export type Section = (typeof SECTIONS)[number];

/** Heading key per group (policies.<key>) */
export const SECTION_TITLE: Readonly<Record<Section, string>> = {
	connection: 'policies.connection_title',
	features: 'policies.features_title',
	security: 'policies.security_title',
	network: 'policies.network_title',
	update: 'policies.update_title'
};

export interface PolicyValues {
	connection: {
		mode: string;
		max_session_duration: number | null;
		idle_lock_timeout: number | null;
		wallpaper: string;
	};
	features: {
		allow_file_transfer: boolean;
		allow_clipboard: boolean;
		allow_audio: boolean;
		allow_recording: boolean;
	};
	security: {
		require_2fa: boolean;
		password_min_length: number | null;
		password_require_special: boolean;
		password_max_age_days: number | null;
		/** Comma-separated in the field, a list in the body */
		allowed_operators: string;
	};
	network: {
		block_direct_p2p: boolean;
		/** One per line in the field, a list in the body */
		allowed_relay_servers: string;
		ip_allowlist: string;
	};
	update: { auto_update: boolean; channel: string };
}

/** Whole-number fields and their limits (as the old page checked them) */
export const NUMBER_LIMITS = {
	'connection.max_session_duration': [0, 1440],
	'connection.idle_lock_timeout': [0, 120],
	'security.password_min_length': [6, 128],
	'security.password_max_age_days': [0, 365]
} as const satisfies Record<string, readonly [number, number]>;
export type NumberField = keyof typeof NUMBER_LIMITS;

type Raw = Record<string, unknown> | null | undefined;

/** Keep 0 when it was saved; the default only when the value is missing */
function num(v: unknown, fallback: number): number {
	if (v === undefined || v === null || v === '') return fallback;
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}
const str = (v: unknown, fallback: string): string => (typeof v === 'string' && v ? v : fallback);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : []);

/** The form values for a loaded organization (defaults where a group or field was never saved) */
export function valuesFrom(p: Partial<Record<Section, Raw>>): PolicyValues {
	const c = p.connection ?? {};
	const f = p.features ?? {};
	const s = p.security ?? {};
	const n = p.network ?? {};
	const u = p.update ?? {};
	return {
		connection: {
			mode: str(c.mode, 'attended'),
			max_session_duration: num(c.max_session_duration, 480),
			idle_lock_timeout: num(c.idle_lock_timeout, 15),
			wallpaper: str(c.wallpaper, 'show')
		},
		features: {
			allow_file_transfer: f.allow_file_transfer !== false,
			allow_clipboard: f.allow_clipboard !== false,
			allow_audio: !!f.allow_audio,
			allow_recording: f.allow_recording !== false
		},
		security: {
			require_2fa: s.require_2fa !== false,
			password_min_length: num(s.password_min_length, 12),
			password_require_special: s.password_require_special !== false,
			password_max_age_days: num(s.password_max_age_days, 90),
			allowed_operators: list(s.allowed_operators).join(', ')
		},
		network: {
			block_direct_p2p: !!n.block_direct_p2p,
			allowed_relay_servers: list(n.allowed_relay_servers).join('\n'),
			ip_allowlist: list(n.ip_allowlist).join('\n')
		},
		update: {
			auto_update: u.auto_update !== false,
			channel: str(u.channel, 'stable')
		}
	};
}

/** A group counts as set once it has been saved for the organization */
export function isSet(group: Raw): boolean {
	return !!group && typeof group === 'object' && Object.keys(group).length > 0;
}

export function setCount(p: Policies | null): number {
	return p ? SECTIONS.filter((s) => isSet(p[s])).length : 0;
}

const split = (text: string, sep: RegExp | string): string[] =>
	text
		.split(sep)
		.map((x) => x.trim())
		.filter(Boolean);

/** What PUT /api/panel/policies/:org/<group> gets (same fields as the old page) */
export function bodyFor(section: Section, v: PolicyValues): Record<string, unknown> {
	switch (section) {
		case 'connection':
			return { ...v.connection };
		case 'features':
			return { ...v.features };
		case 'security':
			return { ...v.security, allowed_operators: split(v.security.allowed_operators, ',') };
		case 'network':
			return {
				block_direct_p2p: v.network.block_direct_p2p,
				allowed_relay_servers: split(v.network.allowed_relay_servers, '\n'),
				ip_allowlist: split(v.network.ip_allowlist, '\n')
			};
		case 'update':
			return { ...v.update };
	}
}

/** Groups whose values differ from what was loaded */
export function changedSections(v: PolicyValues, loaded: PolicyValues): Section[] {
	return SECTIONS.filter((s) => JSON.stringify(v[s]) !== JSON.stringify(loaded[s]));
}

function valueOf(v: PolicyValues, field: NumberField): number | null {
	const [section, key] = field.split('.') as [Section, string];
	return (v[section] as Record<string, unknown>)[key] as number | null;
}

/** Whole numbers out of range in the given groups, in form order */
export function invalidNumbers(v: PolicyValues, sections: readonly Section[]): NumberField[] {
	return (Object.keys(NUMBER_LIMITS) as NumberField[]).filter((field) => {
		if (!sections.includes(field.split('.')[0] as Section)) return false;
		const [min, max] = NUMBER_LIMITS[field];
		const n = valueOf(v, field);
		return n === null || !Number.isInteger(n) || n < min || n > max;
	});
}

/** The group a change log line is about */
export function auditSection(e: AuditEntry): string {
	const fromDetails = e.details && typeof e.details.category === 'string' ? e.details.category : '';
	return fromDetails || e.section || e.category || '';
}

export function auditTime(e: AuditEntry): string {
	return e.timestamp || e.created_at || '';
}
