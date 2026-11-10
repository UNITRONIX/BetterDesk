/**
 * The panel access editor without a DOM: the catalog as groups of
 * sections, a policy as the values the editor shows, and back to what the
 * server stores. "inherit" means no override: the user falls back to their
 * own group setting, their groups and their role; a group simply has no
 * setting there.
 */

import type { AccessCatalog, AccessLevel, AccessPolicy, AccessPolicyInput } from '#lib/api/access.ts';
import { ACCESS_LEVELS } from '#lib/api/access.ts';

export type Choice = AccessLevel | 'inherit';
export type FeatureChoice = 'inherit' | 'on' | 'off';

export interface CatalogGroup {
	key: string;
	label: string;
	sections: { key: string; label: string }[];
}

/**
 * Catalog groups with their sections, in catalog order. A section key the
 * catalog lists twice is shown once, in the group of its last entry: that
 * is the entry the server resolves (its role limit and its group setting).
 * Groups without sections are left out.
 */
export function catalogGroups(catalog: AccessCatalog): CatalogGroup[] {
	const lastGroup = new Map<string, string>();
	for (const s of catalog.sections) lastGroup.set(s.key, s.group);
	const placed = new Set<string>();
	return catalog.groups
		.map((g) => {
			const sections: CatalogGroup['sections'] = [];
			for (const s of catalog.sections) {
				if (s.group !== g.key || lastGroup.get(s.key) !== g.key || placed.has(s.key)) continue;
				placed.add(s.key);
				sections.push({ key: s.key, label: s.label });
			}
			return { key: g.key, label: g.label, sections };
		})
		.filter((g) => g.sections.length);
}

export interface Draft {
	/** Per section key */
	sections: Record<string, Choice>;
	/** Per catalog group key (the "group:<key>" shortcut) */
	groups: Record<string, Choice>;
	/** Per client feature key */
	features: Record<string, FeatureChoice>;
}

const isLevel = (v: string): v is AccessLevel => (ACCESS_LEVELS as readonly string[]).includes(v);

/** What the editor starts with: every override the subject has, inherit for the rest */
export function toDraft(catalog: AccessCatalog, policy: Pick<AccessPolicy, 'sections' | 'features'>): Draft {
	const sectionRows = new Map(policy.sections.map((r) => [r.resource_key, r.access_level]));
	const featureRows = new Map(policy.features.map((r) => [r.feature_key, r.enabled]));
	const draft: Draft = { sections: {}, groups: {}, features: {} };
	for (const s of catalog.sections) {
		const v = sectionRows.get(s.key);
		draft.sections[s.key] = v && isLevel(v) ? v : 'inherit';
	}
	for (const g of catalog.groups) {
		const v = sectionRows.get(`group:${g.key}`);
		draft.groups[g.key] = v && isLevel(v) ? v : 'inherit';
	}
	for (const f of catalog.features) {
		const v = featureRows.get(f.key);
		draft.features[f.key] = f.hardLock || v === undefined ? 'inherit' : v ? 'on' : 'off';
	}
	return draft;
}

/** The overrides to store: inherit is left out, and so are hard-locked features (always off) */
export function toPayload(catalog: AccessCatalog, draft: Draft): AccessPolicyInput {
	const sections: AccessPolicyInput['sections'] = [];
	const seen = new Set<string>();
	for (const s of catalog.sections) {
		const v = draft.sections[s.key];
		if (seen.has(s.key) || !v || v === 'inherit') continue;
		seen.add(s.key);
		sections.push({ resource_key: s.key, access_level: v });
	}
	for (const g of catalog.groups) {
		const v = draft.groups[g.key];
		if (v && v !== 'inherit') sections.push({ resource_key: `group:${g.key}`, access_level: v });
	}
	const features: AccessPolicyInput['features'] = [];
	for (const f of catalog.features) {
		const v = draft.features[f.key];
		if (f.hardLock || !v || v === 'inherit') continue;
		features.push({ feature_key: f.key, enabled: v === 'on' });
	}
	return { sections, features };
}

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 };

/** A setting above what the role allows: the role's limit still applies on the server */
export function aboveRole(choice: Choice, roleCeiling: AccessLevel | undefined): boolean {
	if (choice === 'inherit' || !roleCeiling) return false;
	return RANK[choice] > RANK[roleCeiling];
}

/** String key for where a value comes from */
export function sourceKey(source: string, subject: 'user' | 'group'): string {
	if (source === 'user') return 'users.access_source_user';
	if (source === 'group')
		return subject === 'group' ? 'users.access_source_group_own' : 'users.access_source_group';
	if (source === 'role') return 'users.access_source_role';
	if (source === 'unset') return 'users.access_source_unset';
	return 'users.access_source_default';
}

export const LEVEL_KEYS: Record<AccessLevel, string> = {
	none: 'users.access_none',
	read: 'users.access_read',
	write: 'users.access_write'
};

/**
 * Section labels: the console's own name for each page, so the editor uses
 * the words of the navigation. Sections not listed here fall back to
 * users.access_section_<key>, then to the catalog's English label.
 */
export const SECTION_LABEL_KEYS: Record<string, string> = {
	dashboard: 'nav.dashboard',
	devices: 'nav.devices',
	registrations: 'nav.registrations',
	remote: 'nav.remote',
	users: 'nav.users',
	organizations: 'nav.organizations',
	folders: 'folders.title',
	strategies: 'devices.strategies_title',
	guests: 'guest_access.title',
	tickets: 'nav.tickets',
	'help-requests': 'nav.help_requests',
	cdap: 'nav.cdap',
	fleet: 'nav.fleet',
	chat: 'nav.chat',
	activity: 'nav.activity',
	automation: 'nav.automation',
	files: 'nav.file_transfer',
	network: 'nav.network',
	dataguard: 'nav.dataguard',
	reports: 'nav.reports',
	agents: 'nav.agents',
	toolkit: 'nav.toolkit',
	commercialization: 'nav.commercialization',
	scaling: 'nav.scaling',
	'cross-platform': 'nav.cross_platform',
	'security-audit': 'nav.security_audit',
	languages: 'nav.languages',
	'resource-control': 'nav.resource_control',
	system: 'nav.system',
	permissions: 'nav.permissions',
	'server-management': 'nav.server_management',
	settings: 'nav.settings',
	'server-attestation': 'nav.server_attestation'
};

/** The string keys to try for a section's label, best first */
export function sectionLabelKeys(key: string): string[] {
	const own = SECTION_LABEL_KEYS[key];
	return own ? [own, `users.access_section_${key}`] : [`users.access_section_${key}`];
}
