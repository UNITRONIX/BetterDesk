/**
 * Translations page: the status of a language, the rows of its texts next
 * to English, the search and the missing texts by area (old
 * public/js/languages.js). No DOM.
 */

import type { LanguageRow, Missing, Texts } from '#lib/api/languages.ts';

/** How many texts are drawn at once; the search narrows the rest */
export const SHOW_LIMIT = 200;

export type Tone = 'good' | 'waiting' | 'warning' | 'danger';

/** Complete and reference good, review waiting, missing texts warning, unreadable danger */
export function languageStatus(
	lang: Pick<LanguageRow, 'error' | 'is_reference' | 'missing_keys' | 'needs_review'>
): {
	tone: Tone;
	key: string;
} {
	if (lang.error) return { tone: 'danger', key: 'languages.status_error' };
	if (lang.is_reference) return { tone: 'good', key: 'languages.status_reference' };
	if ((lang.missing_keys ?? 0) > 0) return { tone: 'warning', key: 'languages.status_incomplete' };
	if (lang.needs_review) return { tone: 'waiting', key: 'languages.status_review' };
	return { tone: 'good', key: 'languages.status_complete' };
}

/** "Needs review" under another status (an incomplete language can need a review too) */
export function showsReviewNote(
	lang: Pick<LanguageRow, 'error' | 'is_reference' | 'missing_keys' | 'needs_review'>
): boolean {
	return !!lang.needs_review && !lang.is_reference && languageStatus(lang).tone !== 'waiting';
}

export function clampCoverage(coverage: number | null | undefined): number {
	return Math.max(0, Math.min(100, Number(coverage) || 0));
}

/** The language's name in the console language ("Deutsch" is "German" for an English console) */
export function languageName(code: string, fallback: string, uiLang: string): string {
	try {
		const n = new Intl.DisplayNames([uiLang || 'en'], { type: 'language' }).of(code);
		if (n && n !== code) return n.charAt(0).toLocaleUpperCase(uiLang || 'en') + n.slice(1);
	} catch {
		/* unknown code or no DisplayNames */
	}
	return fallback || code;
}

/** #de, #zh-TW: a language code in the address opens that language */
export function codeFromHash(hash: string): string | null {
	let code = hash.replace(/^#/, '');
	try {
		code = decodeURIComponent(code);
	} catch {
		return null;
	}
	return /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(code) ? code : null;
}

export function flatten(tree: Texts, prefix = '', out: Map<string, string> = new Map()): Map<string, string> {
	for (const [k, value] of Object.entries(tree)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (value && typeof value === 'object' && !Array.isArray(value)) flatten(value, key, out);
		else out.set(key, value === null || value === undefined ? '' : String(value));
	}
	return out;
}

export interface TextRow {
	key: string;
	en: string;
	value: string;
	missing: boolean;
}

const isMeta = (key: string) => key === 'meta' || key.startsWith('meta.') || key.startsWith('_meta');

/**
 * One row per English text: the language's text, or marked missing. The
 * merged texts fill missing keys with English, so the missing list decides.
 */
export function buildRows(en: Texts, own: Texts | null, missing: Missing | null): TextRow[] {
	const enMap = flatten(en);
	const ownMap = own ? flatten(own) : enMap;
	const missingList = missing?.missing ?? [];
	const missingSet = new Set(missingList.map((m) => m.key));
	const rows: TextRow[] = [];
	for (const [key, enValue] of enMap) {
		if (isMeta(key)) continue;
		const isMissing = missingSet.has(key);
		rows.push({ key, en: enValue, value: isMissing ? '' : (ownMap.get(key) ?? ''), missing: isMissing });
	}
	for (const m of missingList) {
		if (!enMap.has(m.key)) rows.push({ key: m.key, en: m.en_value ?? '', value: '', missing: true });
	}
	return rows;
}

export type TextFilter = 'all' | 'missing';

/** Key, English text or the language's text contain the search (any case) */
export function filterRows(rows: readonly TextRow[], filter: TextFilter, query: string): TextRow[] {
	const q = query.trim().toLowerCase();
	return rows.filter((r) => {
		if (filter === 'missing' && !r.missing) return false;
		if (!q) return true;
		return (
			r.key.toLowerCase().includes(q) || r.en.toLowerCase().includes(q) || r.value.toLowerCase().includes(q)
		);
	});
}

/** Missing texts per area (the first part of the key), most first */
export function missingAreas(rows: readonly TextRow[]): { area: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const r of rows) {
		if (!r.missing) continue;
		const area = r.key.split('.')[0] ?? r.key;
		counts.set(area, (counts.get(area) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([area, count]) => ({ area, count }))
		.sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}
