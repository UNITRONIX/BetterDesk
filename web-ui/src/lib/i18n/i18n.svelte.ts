/**
 * Strings and formatting in the console language.
 *
 * Strings are the same JSON files as the old console (web-nodejs/lang),
 * merged over English on the server, so a missing key shows English, and
 * an unknown key shows the key itself (as the old console did).
 * `t('devices.count', { count: 3 })` replaces {count}.
 *
 * Reading `t()` in markup subscribes to the language: switching languages
 * re-renders every string without a reload.
 */

import { readPref, writePref, PREF } from '#lib/util/storage.ts';

type Strings = { [k: string]: string | Strings };
export type Params = Record<string, string | number>;

export interface Language {
	code: string;
	name: string;
	native: string;
	flag: string;
	rtl: boolean;
}

/** Whether the browser formats dates for a language (asked once per language; the locale getter runs for every formatted value) */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a cache, nothing renders from it
const supported = new Map<string, boolean>();

class I18n {
	strings = $state.raw<Strings>({});
	lang = $state('en');
	dir = $state<'ltr' | 'rtl'>('ltr');
	available = $state.raw<Language[]>([]);

	/** Locale for Intl, or undefined to use the browser's when the console language isn't supported */
	get locale(): string | undefined {
		const lang = this.lang;
		if (!supported.has(lang)) {
			let ok = false;
			try {
				ok = Intl.DateTimeFormat.supportedLocalesOf([lang]).length > 0;
			} catch {
				/* not a valid language tag */
			}
			supported.set(lang, ok);
		}
		return supported.get(lang) ? lang : undefined;
	}
}

export const i18n = new I18n();

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

function lookup(strings: Strings, key: string): string | undefined {
	let cur: string | Strings | undefined = strings;
	for (const part of key.split('.')) {
		if (UNSAFE.has(part) || cur === undefined || typeof cur === 'string') return undefined;
		cur = Object.prototype.hasOwnProperty.call(cur, part) ? cur[part] : undefined;
	}
	return typeof cur === 'string' ? cur : undefined;
}

function interpolate(text: string, params?: Params): string {
	if (!params) return text;
	return text.replace(/\{(\w+)\}/g, (m, name: string) =>
		params[name] !== undefined ? String(params[name]) : m
	);
}

/** Translate a key. Unknown keys come back as the key. */
export function t(key: string, params?: Params): string {
	const value = lookup(i18n.strings, key);
	return value === undefined ? key : interpolate(value, params);
}

/** Translate with an English fallback for keys added after the last restart */
export function tf(key: string, fallback: string, params?: Params): string {
	const value = lookup(i18n.strings, key);
	return interpolate(value ?? fallback, params);
}

/** True when the key exists in the loaded strings */
export function has(key: string): boolean {
	return lookup(i18n.strings, key) !== undefined;
}

/** The old console's plural helper: { one: '1 item', other: '{count} items' } */
export function plural(count: number, forms: { one?: string; other: string }): string {
	const form = count === 1 && forms.one !== undefined ? forms.one : forms.other;
	return form.replace('{count}', new Intl.NumberFormat(i18n.locale).format(count));
}

export function setStrings(lang: string, dir: 'ltr' | 'rtl', strings: Strings, available?: Language[]): void {
	i18n.strings = strings;
	i18n.lang = lang;
	i18n.dir = dir;
	if (available) i18n.available = available;
	document.documentElement.lang = lang;
	document.documentElement.dir = dir;
}

/**
 * Switch the console language: load the strings, store the choice on the
 * account (POST /api/i18n/set/:code, which also sets the cookie), and
 * re-render. No reload.
 */
export async function switchLanguage(code: string, save: (code: string) => Promise<unknown>): Promise<void> {
	const lang = i18n.available.find((l) => l.code === code);
	if (!lang) throw new Error('Unsupported language');
	const res = await fetch(`/api/console/strings/${encodeURIComponent(code)}`, {
		credentials: 'same-origin',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const strings = (await res.json()) as Strings;
	await save(code);
	writePref(PREF.lang, code);
	setStrings(code, lang.rtl ? 'rtl' : 'ltr', strings);
}

export function savedLanguage(): string | null {
	return readPref(PREF.lang);
}
