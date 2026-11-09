/**
 * Accessibility panel settings (public/js/accessibility.js): same storage
 * key, defaults, limits and profiles, so the old pages and the new console
 * share them. /console-boot.js applies the stored settings before first
 * paint with the same rules; this module keeps <html> in step afterwards.
 * The effects themselves are in styles/a11y.css (data-a11y-* attributes
 * and --bd-a11y-* variables on <html>); A11yEffects.svelte draws the
 * colour filters and the reading guide.
 */

import { PREF, readPref, writePref } from '#lib/util/storage.ts';

export const STORAGE_KEY = PREF.a11y;

export const CONTRASTS = ['normal', 'high-dark', 'high-light', 'yellow-black'] as const;
export const FILTERS = ['none', 'protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const;
export const PROFILES = ['lowVision', 'dyslexia', 'motionSafe', 'colorAssist'] as const;

export type Contrast = (typeof CONTRASTS)[number];
export type ColorFilter = (typeof FILTERS)[number];
export type Profile = (typeof PROFILES)[number];

export interface A11ySettings {
	fontScale: number;
	lineHeight: number;
	letterSpacing: number;
	wordSpacing: number;
	saturation: number;
	contrast: Contrast;
	colorFilter: ColorFilter;
	activeProfile: Profile | '';
	readableFont: boolean;
	dyslexiaFont: boolean;
	underlineLinks: boolean;
	highlightLinks: boolean;
	highlightHeadings: boolean;
	strongFocus: boolean;
	largeCursor: boolean;
	reduceMotion: boolean;
	pauseAnimations: boolean;
	readingGuide: boolean;
	readingMask: boolean;
	hideMedia: boolean;
}

export type RangeKey = 'fontScale' | 'lineHeight' | 'letterSpacing' | 'wordSpacing' | 'saturation';
export type FlagKey = {
	[K in keyof A11ySettings]: A11ySettings[K] extends boolean ? K : never;
}[keyof A11ySettings];

export const DEFAULTS: Readonly<A11ySettings> = Object.freeze({
	fontScale: 100,
	lineHeight: 1.5,
	letterSpacing: 0,
	wordSpacing: 0,
	saturation: 100,
	contrast: 'normal',
	colorFilter: 'none',
	activeProfile: '',
	readableFont: false,
	dyslexiaFont: false,
	underlineLinks: false,
	highlightLinks: false,
	highlightHeadings: false,
	strongFocus: false,
	largeCursor: false,
	reduceMotion: false,
	pauseAnimations: false,
	readingGuide: false,
	readingMask: false,
	hideMedia: false
});

/** Slider limits and steps (min, max, step), as in the old panel */
export const RANGES: Readonly<Record<RangeKey, readonly [number, number, number]>> = {
	fontScale: [90, 160, 5],
	lineHeight: [1.2, 2.1, 0.05],
	letterSpacing: [0, 0.14, 0.005],
	wordSpacing: [0, 0.22, 0.01],
	saturation: [0, 180, 5]
};

export const FLAG_KEYS: readonly FlagKey[] = [
	'readableFont',
	'dyslexiaFont',
	'underlineLinks',
	'highlightLinks',
	'highlightHeadings',
	'strongFocus',
	'largeCursor',
	'reduceMotion',
	'pauseAnimations',
	'readingGuide',
	'readingMask',
	'hideMedia'
];

/** data-a11y-* attribute (camel case for dataset) for each flag */
const FLAG_ATTR: Readonly<Record<FlagKey, string>> = {
	readableFont: 'a11yReadableFont',
	dyslexiaFont: 'a11yDyslexia',
	underlineLinks: 'a11yUnderlineLinks',
	highlightLinks: 'a11yHighlightLinks',
	highlightHeadings: 'a11yHighlightHeadings',
	strongFocus: 'a11yStrongFocus',
	largeCursor: 'a11yLargeCursor',
	reduceMotion: 'a11yReduceMotion',
	pauseAnimations: 'a11yPauseAnimations',
	readingGuide: 'a11yReadingGuide',
	readingMask: 'a11yReadingMask',
	hideMedia: 'a11yHideMedia'
};

/** Number(value) clamped, the default when it is not a finite number (null counts as 0, as in accessibility.js) */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

function pick<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
	return (list as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

/** Clean settings from storage or a control: numbers clamped, unknown values back to the default */
export function sanitize(candidate: unknown): A11ySettings {
	const src = candidate && typeof candidate === 'object' ? (candidate as Record<string, unknown>) : {};
	const clean: A11ySettings = { ...DEFAULTS };
	for (const key of Object.keys(RANGES) as RangeKey[]) {
		const [min, max] = RANGES[key];
		clean[key] = clampNumber(src[key], min, max, DEFAULTS[key]);
	}
	clean.contrast = pick(CONTRASTS, src.contrast, DEFAULTS.contrast);
	clean.colorFilter = pick(FILTERS, src.colorFilter, DEFAULTS.colorFilter);
	clean.activeProfile = pick<Profile | ''>(PROFILES, src.activeProfile, '');
	for (const key of FLAG_KEYS) clean[key] = src[key] === true;
	return clean;
}

export function isDefault(s: A11ySettings): boolean {
	return (Object.keys(DEFAULTS) as (keyof A11ySettings)[]).every((k) => s[k] === DEFAULTS[k]);
}

/** What a profile turns on (choosing the active one again resets everything) */
export function profileSettings(current: A11ySettings, profile: Profile): A11ySettings {
	const next: A11ySettings = { ...current, activeProfile: profile };
	switch (profile) {
		case 'lowVision':
			return {
				...next,
				fontScale: 130,
				lineHeight: 1.75,
				contrast: 'high-dark',
				underlineLinks: true,
				highlightLinks: true,
				strongFocus: true,
				largeCursor: true
			};
		case 'dyslexia':
			return {
				...next,
				fontScale: 112,
				lineHeight: 1.85,
				letterSpacing: 0.045,
				wordSpacing: 0.09,
				readableFont: true,
				dyslexiaFont: true,
				underlineLinks: true
			};
		case 'motionSafe':
			return { ...next, reduceMotion: true, pauseAnimations: true, readingGuide: true, strongFocus: true };
		case 'colorAssist':
			return {
				...next,
				colorFilter: 'deuteranopia',
				saturation: 125,
				underlineLinks: true,
				highlightLinks: true,
				highlightHeadings: true
			};
	}
}

/** CSS filter for the colour vision filter and saturation, or '' for none */
export function visualFilter(s: A11ySettings): string {
	const filters: string[] = [];
	if (s.colorFilter !== 'none') filters.push(`url(#bd-a11y-${s.colorFilter})`);
	if (s.saturation !== 100) filters.push(`saturate(${s.saturation}%)`);
	return filters.join(' ');
}

/** Put the settings on <html>, as accessibility.js applySettings() does */
export function applyToRoot(s: A11ySettings, root: HTMLElement = document.documentElement): void {
	root.style.setProperty('--bd-a11y-font-scale', String(s.fontScale / 100));
	root.style.setProperty('--bd-a11y-line-height', String(s.lineHeight));
	root.style.setProperty('--bd-a11y-letter-spacing', `${s.letterSpacing}em`);
	root.style.setProperty('--bd-a11y-word-spacing', `${s.wordSpacing}em`);
	root.dataset.a11yActive = String(!isDefault(s));
	root.dataset.a11yFontScaled = String(s.fontScale !== DEFAULTS.fontScale);
	root.dataset.a11yContrast = s.contrast;
	for (const key of FLAG_KEYS) root.dataset[FLAG_ATTR[key]] = String(s[key]);
	const filter = visualFilter(s);
	root.dataset.a11yFiltered = String(filter !== '');
	root.style.setProperty('--bd-a11y-visual-filter', filter || 'none');
}

export function load(): A11ySettings {
	try {
		return sanitize(JSON.parse(readPref(STORAGE_KEY) ?? '{}'));
	} catch {
		return { ...DEFAULTS };
	}
}

class A11yState {
	settings = $state<A11ySettings>({ ...DEFAULTS });
	/** The panel is open */
	open = $state(false);
}

export const a11y = new A11yState();

let started = false;

/** Read the stored settings and apply them (once, at start) */
export function initA11y(): void {
	a11y.settings = load();
	applyToRoot(a11y.settings);
	if (started) return;
	started = true;
	// Another tab changed them
	window.addEventListener('storage', (e) => {
		if (e.key !== STORAGE_KEY) return;
		a11y.settings = load();
		applyToRoot(a11y.settings);
	});
}

/** Change settings (a control or a profile): clean, save, apply right away */
export function saveA11y(next: unknown): A11ySettings {
	const clean = sanitize(next);
	a11y.settings = clean;
	writePref(STORAGE_KEY, JSON.stringify(clean));
	applyToRoot(clean);
	return clean;
}

/** One control changed: the profile no longer describes the settings */
export function setA11y<K extends keyof A11ySettings>(key: K, value: A11ySettings[K]): void {
	saveA11y({ ...a11y.settings, activeProfile: '', [key]: value });
}

/** Choose a profile; choosing the active one again goes back to the defaults */
export function chooseProfile(profile: Profile): void {
	if (a11y.settings.activeProfile === profile) resetA11y();
	else saveA11y(profileSettings(a11y.settings, profile));
}

export function resetA11y(): void {
	a11y.settings = { ...DEFAULTS };
	writePref(STORAGE_KEY, null);
	applyToRoot(a11y.settings);
}
