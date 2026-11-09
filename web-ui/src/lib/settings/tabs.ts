/**
 * The settings tabs and the rules for their URLs (no DOM, unit tested).
 *
 * Each tab is a sub-page: /settings?tab=<name> (General without a tab).
 * An unknown tab is General. Old links used #<tab> and #server; those
 * become ?tab=. #<element-id> points at one setting, also on another tab.
 */

import { SEARCH_INDEX, TAB_IDS } from './search-index.ts';

export const TABS = [
	'general',
	'branding',
	'auth',
	'backup',
	'updates',
	'email',
	'time',
	'advanced'
] as const;
export type TabId = (typeof TABS)[number];

/** Tabs only people with server.config may open */
export const ADMIN_TABS: readonly TabId[] = ['backup', 'updates', 'email', 'time', 'advanced'];

/** The tab's name: page title, breadcrumb and search results */
export const TAB_TITLE: Readonly<Record<TabId, string>> = {
	general: 'settings.tab_general',
	branding: 'settings.tab_branding',
	auth: 'settings.tab_auth',
	backup: 'settings.tab_backup',
	updates: 'updates.tab_title',
	email: 'settings.tab_email',
	time: 'settings.tab_time',
	advanced: 'settings.tab_advanced'
};

/** The sentence under the title; General and Sign-in say less to people who can't change the server */
export function tabDescKey(tab: TabId, canServerConfig: boolean): string {
	if (tab === 'general')
		return canServerConfig ? 'settings.page.general_desc' : 'settings.page.general_desc_viewer';
	if (tab === 'auth') return canServerConfig ? 'settings.page.auth_desc' : 'settings.page.auth_desc_viewer';
	return `settings.page.${tab}_desc`;
}

export function isTab(name: string | null | undefined): name is TabId {
	return !!name && (TABS as readonly string[]).includes(name);
}

/** ?tab= value to a tab: case does not matter, anything else is General */
export function parseTab(raw: string | null | undefined): TabId {
	const name = String(raw ?? '').toLowerCase();
	return isTab(name) ? name : 'general';
}

export function tabAllowed(tab: TabId, canServerConfig: boolean): boolean {
	return canServerConfig || !ADMIN_TABS.includes(tab);
}

/** An old #<tab> or #server link: the tab it means, or null for anything else */
export function hashTab(hash: string): TabId | null {
	const name = decodeHash(hash);
	if (name === 'server') return 'general';
	return isTab(name) ? name : null;
}

/** "#public-endpoints" → "public-endpoints" (decoded; a broken escape stays as it is) */
export function decodeHash(hash: string): string {
	const raw = hash.replace(/^#/, '');
	try {
		return decodeURIComponent(raw);
	} catch {
		return raw;
	}
}

let idTab: Map<string, TabId> | null = null;

/** The tab that holds an element id, or null when no tab has it */
export function tabOfId(id: string): TabId | null {
	if (!idTab) {
		idTab = new Map();
		for (const [tab, ids] of Object.entries(TAB_IDS)) {
			if (!isTab(tab)) continue;
			for (const one of ids.split(' ')) if (one) idTab.set(one, tab);
		}
		for (const row of SEARCH_INDEX) if (isTab(row[0]) && !idTab.has(row[1])) idTab.set(row[1], row[0]);
	}
	return idTab.get(id) ?? null;
}

/** The query string for a tab: General has none, as in the old links */
export function tabSearch(tab: TabId, rest?: URLSearchParams): string {
	const q = new URLSearchParams(rest);
	if (tab === 'general') q.delete('tab');
	else q.set('tab', tab);
	const s = q.toString();
	return s ? `?${s}` : '';
}
