/**
 * USB and drive access without a DOM: the five kinds of rules, the values
 * the editor shows (defaults allow everything), the body each category's
 * save sends, which categories changed, the device list's search and the
 * "Rules followed" summary.
 */

import type { Compliance, RcDevice } from '#lib/api/resourceControl.ts';

export const RC_CATEGORIES = ['usb', 'optical', 'monitors', 'disks', 'quotas'] as const;
export type RcCategory = (typeof RC_CATEGORIES)[number];

/** Category name keys (resource_control.cat_<key>) and their save labels */
export const SAVE_LABEL: Readonly<Record<RcCategory, string>> = {
	usb: 'resource_control.save_usb',
	optical: 'resource_control.save_optical',
	monitors: 'resource_control.save_monitors',
	disks: 'resource_control.save_disks',
	quotas: 'resource_control.save_quotas'
};

export interface RcValues {
	usb: { storage_policy: string; whitelist: string; audit_log: boolean };
	optical: { policy: string; audit_log: boolean };
	monitors: { max_count: number | null; resolution: string; brightness: number; power_schedule: string };
	disks: {
		readonly: boolean;
		encryption_required: boolean;
		smart_monitoring: boolean;
		hidden_partitions: string;
	};
	quotas: {
		cpu_limit: number;
		ram_limit: number;
		bandwidth_limit: number | null;
		disk_quota: number | null;
		process_whitelist: string;
	};
}

type Raw = Record<string, unknown>;
const obj = (x: unknown): Raw => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Raw) : {});
const str = (x: unknown, d: string) => (typeof x === 'string' && x ? x : d);
const list = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);
/** As the old page: 0 and missing values fall back (brightness 0 shows 100) */
const numOr = (x: unknown, d: number) => {
	const n = Number(x);
	return x !== null && x !== undefined && x !== '' && Number.isFinite(n) && n ? n : d;
};

export function rcValuesFrom(policy: Raw | null): RcValues {
	const p = policy ?? {};
	const usb = obj(p.usb);
	const optical = obj(p.optical);
	const monitors = obj(p.monitors);
	const disks = obj(p.disks);
	const quotas = obj(p.quotas);
	return {
		usb: {
			storage_policy: str(usb.storage_policy, 'allowed'),
			whitelist: list(usb.whitelist).join('\n'),
			audit_log: usb.audit_log !== false
		},
		optical: { policy: str(optical.policy, 'allowed'), audit_log: optical.audit_log !== false },
		monitors: {
			max_count: numOr(monitors.max_count, 0),
			resolution: str(monitors.resolution, 'any'),
			brightness: numOr(monitors.brightness, 100),
			power_schedule: str(monitors.power_schedule, '')
		},
		disks: {
			readonly: !!disks.readonly,
			encryption_required: !!disks.encryption_required,
			smart_monitoring: !!disks.smart_monitoring,
			hidden_partitions: list(disks.hidden_partitions).join(', ')
		},
		quotas: {
			cpu_limit: numOr(quotas.cpu_limit, 100),
			ram_limit: numOr(quotas.ram_limit, 100),
			bandwidth_limit: numOr(quotas.bandwidth_limit, 0),
			disk_quota: numOr(quotas.disk_quota, 0),
			process_whitelist: list(quotas.process_whitelist).join('\n')
		}
	};
}

const lines = (s: string, sep: RegExp | string) =>
	s
		.split(sep)
		.map((x) => x.trim())
		.filter(Boolean);
/** A whole number of at least 0, or the fallback */
const int = (x: number | null, d: number) => {
	const n = Math.trunc(Number(x));
	return x !== null && Number.isFinite(n) && n >= 0 ? n : d;
};

/** What POST .../policies/:device/<category> gets (same fields as the old page) */
export function rcBody(category: RcCategory, v: RcValues): Raw {
	switch (category) {
		case 'usb':
			return {
				storage_policy: v.usb.storage_policy,
				whitelist: lines(v.usb.whitelist, '\n'),
				audit_log: v.usb.audit_log
			};
		case 'optical':
			return { policy: v.optical.policy, audit_log: v.optical.audit_log };
		case 'monitors':
			return {
				max_count: int(v.monitors.max_count, 0),
				resolution: v.monitors.resolution,
				brightness: int(v.monitors.brightness, 100),
				power_schedule: v.monitors.power_schedule.trim()
			};
		case 'disks':
			return {
				readonly: v.disks.readonly,
				encryption_required: v.disks.encryption_required,
				smart_monitoring: v.disks.smart_monitoring,
				hidden_partitions: lines(v.disks.hidden_partitions, ',')
			};
		case 'quotas':
			return {
				cpu_limit: int(v.quotas.cpu_limit, 100),
				ram_limit: int(v.quotas.ram_limit, 100),
				bandwidth_limit: int(v.quotas.bandwidth_limit, 0),
				disk_quota: int(v.quotas.disk_quota, 0),
				process_whitelist: lines(v.quotas.process_whitelist, '\n')
			};
	}
}

export function changedCategories(v: RcValues, loaded: RcValues): RcCategory[] {
	return RC_CATEGORIES.filter((c) => JSON.stringify(v[c]) !== JSON.stringify(loaded[c]));
}

export function isOnline(d: Pick<RcDevice, 'online' | 'status'>): boolean {
	return d.online === true || d.status.toLowerCase() === 'online';
}

export function filterRcDevices(list: readonly RcDevice[], query: string): RcDevice[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...list];
	return list.filter((d) => [d.id, d.hostname, d.platform].some((x) => x.toLowerCase().includes(q)));
}

/** "USB drives: followed, Disks: not followed", or null when the device reports nothing */
export function rulesSummary(resources: Raw | null, t: (key: string) => string): string | null {
	if (!resources) return null;
	const parts = RC_CATEGORIES.filter((k) => resources[k] && resources[k] !== 'na').map((k) => {
		const s = resources[k];
		const state = s === 'compliant' || s === 'partial' ? s : 'noncompliant';
		return `${t(`resource_control.cat_${k}`)}: ${t(`resource_control.rule_state_${state}`)}`;
	});
	return parts.length ? parts.join(', ') : null;
}

export interface ComplianceView {
	total: number;
	compliant: number;
	nonCompliant: number;
	none: number;
	/** Per category: label key and the value text */
	rows: { key: RcCategory | string; enforced: number; total: number; pct: number | null }[];
}

export function complianceView(d: Compliance): ComplianceView {
	const nonRaw = d.non_compliant ?? d.noncompliant;
	const rows: ComplianceView['rows'] = [];
	const cats = d.categories;
	if (Array.isArray(cats)) {
		for (const c of cats as Raw[])
			rows.push({ key: String(c.key ?? ''), enforced: 0, total: 0, pct: Number(c.pct) || 0 });
	} else {
		const o = obj(cats);
		for (const k of RC_CATEGORIES) {
			const c = obj(o[k]);
			rows.push({ key: k, enforced: Number(c.enforced) || 0, total: Number(c.total) || 0, pct: null });
		}
	}
	return {
		total: d.total_devices,
		compliant: d.compliant,
		nonCompliant: Number(nonRaw) || 0,
		none: d.no_policy,
		rows
	};
}
