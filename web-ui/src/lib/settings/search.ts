/**
 * The settings search: finds a setting on any tab the person may open, by
 * its label, its section and its hints, in the console language. Same rules
 * as the old settings.js: at least two characters, every word must match,
 * label matches and the current tab first, eight results at most.
 */

import { SEARCH_INDEX, type IndexRow } from './search-index.ts';
import { TAB_TITLE, isTab, type TabId } from './tabs.ts';

export interface SearchHit {
	tab: TabId;
	/** Element id the result jumps to */
	id: string;
	label: string;
	/** "Tab › Section" */
	where: string;
}

export interface SearchContext {
	/** Translate a key */
	t: (key: string) => string;
	can: (permission: string) => boolean;
	current: TabId;
	/** The language the console shows, for lower-casing */
	locale?: string;
}

export const MIN_QUERY = 2;
export const MAX_HITS = 8;

const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/:$/, '').trim();

/** Rows a person with these permissions can reach */
export function visibleRows(
	can: (p: string) => boolean,
	rows: readonly IndexRow[] = SEARCH_INDEX
): IndexRow[] {
	return rows.filter((r) => isTab(r[0]) && (r[5] === '' || can(r[5])));
}

export function searchSettings(
	query: string,
	ctx: SearchContext,
	rows: readonly IndexRow[] = SEARCH_INDEX
): SearchHit[] {
	const lower = (s: string) => s.toLocaleLowerCase(ctx.locale);
	const q = lower(query.trim());
	if (q.length < MIN_QUERY) return [];
	const words = q.split(/\s+/).filter(Boolean);
	const seen = new Set<string>();
	const hits: { hit: SearchHit; score: number }[] = [];
	for (const row of visibleRows(ctx.can, rows)) {
		const [tabName, id, labelKey, sectionKey, hintKeys] = row;
		if (!isTab(tabName)) continue;
		const label = clean(ctx.t(labelKey));
		if (!label) continue;
		const once = `${tabName}#${id}#${label}`;
		if (seen.has(once)) continue;
		seen.add(once);
		const section = sectionKey ? clean(ctx.t(sectionKey)) : '';
		const hints = hintKeys.map((k) => ctx.t(k)).join(' ');
		const text = lower(`${label} ${section} ${hints}`);
		if (!words.every((w) => text.includes(w))) continue;
		const tabTitle = ctx.t(TAB_TITLE[tabName]);
		hits.push({
			hit: {
				tab: tabName,
				id,
				label,
				where: section && section !== label ? `${tabTitle} › ${section}` : tabTitle
			},
			score: (lower(label).includes(q) ? 0 : 1) + (tabName === ctx.current ? 0 : 0.5)
		});
	}
	// Stable: equal scores keep the order of the page
	return hits
		.map((h, i) => ({ ...h, i }))
		.sort((a, b) => a.score - b.score || a.i - b.i)
		.slice(0, MAX_HITS)
		.map((h) => h.hit);
}
