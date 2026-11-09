/**
 * The sidebar, breadcrumb and bottom bar, worked out from the navigation the
 * server sent (bootstrap `nav`, from web-nodejs/lib/consoleNav.js). Pure
 * functions, so the rules stay the same as the old sidebar
 * (views/partials/ux35-sidebar.ejs) and can be tested without a DOM.
 *
 * The shell never adds or hides pages: what the server sent is what the
 * person may open.
 */

import type { NavPage, NavSection } from '#lib/api/console.ts';

/** Pages that are the current one for another page's URL (consoleNav alsoActiveFor) */
const ALSO_ACTIVE: Readonly<Record<string, string>> = { generator: 'agents' };

/**
 * The page key for a URL (old path plus query), as lib/consoleNav.js
 * pageKey() makes it: settings, server-management and commercialization
 * split by tab, /?activateAgent=1 is its own page.
 */
export function pageKey(path: string, search: { get(name: string): string | null } | string = ''): string {
	const q = typeof search === 'string' ? new URLSearchParams(search) : search;
	const first = path.replace(/^\/+/, '').split('/')[0] ?? '';
	const tab = q.get('tab') ?? '';
	if (first === '') return q.get('activateAgent') === '1' ? 'activate-agent' : 'dashboard';
	if (first === 'settings') return 'settings:' + (tab || 'general');
	if (first === 'server-management') return 'server-management:' + (tab || 'overview');
	if (first === 'commercialization') {
		const t = tab || 'packages';
		return 'commercialization:' + (t === 'sessions' || t === 'reports' ? 'sessions' : 'packages');
	}
	return ALSO_ACTIVE[first] ?? first;
}

export interface NavGroupHeading {
	kind: 'group';
	text: string;
}
export interface NavLinkItem {
	kind: 'page';
	page: NavPage;
	active: boolean;
}
export type NavRow = NavGroupHeading | NavLinkItem;

export interface NavModelSection {
	id: string;
	icon: string;
	text: string;
	/** The current page is in this section */
	active: boolean;
	/** Pages shown all the time */
	core: NavLinkItem[];
	/** Pages under "More", with a heading where the group changes */
	more: NavRow[];
	/** Number of pages under "More" */
	moreCount: number;
	/** The current page is under "More" */
	moreActive: boolean;
}

export interface NavModel {
	sections: NavModelSection[];
	activeSection: NavModelSection | null;
	activePage: NavPage | null;
}

/**
 * Pages used every day stay visible; the rest sit under "More". A section
 * with no core page, or only one extra, shows everything (same rule as the
 * old sidebar). Group headings only in the "More" list, where the group
 * changes.
 */
export function buildNavModel(nav: readonly NavSection[], key: string): NavModel {
	let activeSection: NavModelSection | null = null;
	let activePage: NavPage | null = null;
	const sections = nav
		.filter((s) => s.pages.length > 0)
		.map((s) => {
			const items: NavLinkItem[] = s.pages.map((page) => ({ kind: 'page', page, active: page.page === key }));
			let core = items.filter((i) => i.page.core);
			let rest = items.filter((i) => !i.page.core);
			if (!core.length || rest.length <= 1) {
				core = items;
				rest = [];
			}
			const more: NavRow[] = [];
			let lastGroup = '';
			for (const item of rest) {
				if (item.page.group && item.page.group !== lastGroup) {
					lastGroup = item.page.group;
					more.push({ kind: 'group', text: item.page.group });
				}
				more.push(item);
			}
			const section: NavModelSection = {
				id: s.id,
				icon: s.icon,
				text: s.text,
				active: items.some((i) => i.active),
				core,
				more,
				moreCount: rest.length,
				moreActive: rest.some((i) => i.active)
			};
			const hit = items.find((i) => i.active);
			if (hit) {
				activeSection = section;
				activePage = hit.page;
			}
			return section;
		});
	return { sections, activeSection, activePage };
}

/** Breadcrumb: section, then page (or the page's own title when it is not in the navigation) */
export function breadcrumb(model: NavModel, title?: string | null): string[] {
	const out: string[] = [];
	if (model.activeSection) out.push(model.activeSection.text);
	const last = title || model.activePage?.text;
	if (last && out.at(-1) !== last) out.push(last);
	return out;
}

/** Every page with its section, for the global search */
export interface SearchPage {
	text: string;
	href: string;
	section: string;
	group: string;
	keywords: string;
	external: boolean;
}

export function searchPages(nav: readonly NavSection[]): SearchPage[] {
	return nav.flatMap((s) =>
		s.pages.map((p) => ({
			text: p.text,
			href: p.href,
			section: s.text,
			group: p.group,
			keywords: p.keywords,
			external: p.external
		}))
	);
}

/** Bottom bar on phones (views/partials/mobile-bottom-nav.ejs), built from the pages the server sent */
export interface BottomItem {
	id: 'home' | 'devices' | 'remote' | 'chat';
	href: string;
	icon: string;
	labelKey: string;
	active: boolean;
}

const BOTTOM: readonly { id: BottomItem['id']; page: string; icon: string; labelKey: string }[] = [
	{ id: 'home', page: 'dashboard', icon: 'home', labelKey: 'mobile_nav.home' },
	{ id: 'devices', page: 'devices', icon: 'devices', labelKey: 'mobile_nav.devices' },
	{ id: 'remote', page: 'remote', icon: 'desktop_windows', labelKey: 'mobile_nav.remote' },
	{ id: 'chat', page: 'chat', icon: 'chat', labelKey: 'mobile_nav.chat' }
];

export function bottomItems(nav: readonly NavSection[], key: string): BottomItem[] {
	const pages = new Map(nav.flatMap((s) => s.pages).map((p) => [p.page, p]));
	return BOTTOM.flatMap((b) => {
		const p = pages.get(b.page);
		return p ? [{ id: b.id, href: p.href, icon: b.icon, labelKey: b.labelKey, active: key === b.page }] : [];
	});
}

/* ── Remembered sidebar state (same keys and meaning as the old shell) ── */

/** localStorage: { sectionId: true } for "More" lists left open */
export const MORE_KEY = 'bd_nav_more_open';
/** sessionStorage: { sectionId: true (closed) | false (open) } for sections other than the current one */
export const COLLAPSED_KEY = 'bd_nav_sections_collapsed';
/** sessionStorage: the nav's scroll position */
export const SCROLL_KEY = 'bd_ux35_sidebar_scroll';

/** Width of the docked sidebar (public/js/ux35-shell.js) */
export const WIDTH_KEY = 'bd_ux35_sidebar_width';
export const WIDTH_MIN = 200;
export const WIDTH_MAX = 320;
export const WIDTH_DEFAULT = 232;
export const WIDTH_STEP = 10;

export function clampWidth(px: number): number {
	return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(px)));
}

/** A saved width, or null when there is none or it is not a number */
export function parseWidth(raw: string | null): number | null {
	const n = parseInt(raw ?? '', 10);
	return Number.isFinite(n) ? clampWidth(n) : null;
}

/** Read a { key: boolean } map; anything else gives {} */
export function readFlags(storage: Pick<Storage, 'getItem'> | null, key: string): Record<string, boolean> {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(key) ?? '{}');
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		const out: Record<string, boolean> = {};
		for (const [k, v] of Object.entries(parsed)) if (typeof v === 'boolean') out[k] = v;
		return out;
	} catch {
		return {};
	}
}

export function writeFlags(
	storage: Pick<Storage, 'setItem'> | null,
	key: string,
	flags: Record<string, boolean>
): void {
	try {
		storage?.setItem(key, JSON.stringify(flags));
	} catch {
		/* storage blocked: still works for this page */
	}
}

/**
 * Whether a section's page list is open. The current section is open
 * unless it was closed since this page opened (`closedHere`, not stored);
 * other sections are closed unless they were opened in this tab.
 */
export function sectionOpen(
	section: Pick<NavModelSection, 'id' | 'active'>,
	collapsed: Record<string, boolean>,
	closedHere: ReadonlySet<string>
): boolean {
	if (section.active) return !closedHere.has(section.id);
	return collapsed[section.id] === false;
}

/**
 * Whether a section's "More" list is open: a choice made since this page
 * opened wins, then "the current page is in it", then the stored choice.
 */
export function moreOpen(
	section: Pick<NavModelSection, 'id' | 'moreActive'>,
	stored: Record<string, boolean>,
	here: Readonly<Record<string, boolean>>
): boolean {
	const now = here[section.id];
	if (now !== undefined) return now;
	return section.moreActive || stored[section.id] === true;
}
