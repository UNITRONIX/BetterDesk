/**
 * Theme: the console default (Settings › Appearance) or this browser's own
 * choice (light or dark, from the top bar). The choice never changes the
 * console-wide setting, so every role may use it. /console-boot.js applies
 * it before first paint; this module keeps it in step afterwards.
 */

import { readPref, writePref, PREF } from '#lib/util/storage.ts';

export type ThemeChoice = 'default' | 'light' | 'dark';
type Palette = Record<string, string> | null;

const VARS: Record<string, string> = {
	bgPrimary: '--bg-primary',
	bgSecondary: '--bg-secondary',
	bgTertiary: '--bg-tertiary',
	bgElevated: '--bg-elevated',
	textPrimary: '--text-primary',
	textSecondary: '--text-secondary',
	accentBlue: '--accent-blue',
	accentBlueHover: '--accent-blue-hover',
	accentBlueMuted: '--accent-blue-muted',
	accentGreen: '--accent-green',
	accentGreenHover: '--accent-green-hover',
	accentGreenMuted: '--accent-green-muted',
	accentRed: '--accent-red',
	accentRedHover: '--accent-red-hover',
	accentRedMuted: '--accent-red-muted',
	accentYellow: '--accent-yellow',
	accentYellowHover: '--accent-yellow-hover',
	accentYellowMuted: '--accent-yellow-muted',
	accentPurple: '--accent-purple',
	accentPurpleHover: '--accent-purple-hover',
	accentPurpleMuted: '--accent-purple-muted',
	borderPrimary: '--border-primary',
	borderSecondary: '--border-secondary'
};

class Theme {
	choice = $state<ThemeChoice>('default');
	/** What is shown now */
	shown = $state<'light' | 'dark'>('light');
	consoleMode = $state('system');
	palettes: { light: Palette; dark: Palette } = { light: null, dark: null };
}

export const theme = new Theme();

let mq: MediaQueryList | null = null;

function readChoice(): ThemeChoice {
	const v = readPref(PREF.theme);
	return v === 'light' || v === 'dark' ? v : 'default';
}

function systemDark(): boolean {
	return !!mq?.matches;
}

function clearInline(root: HTMLElement): void {
	for (const name of Object.values(VARS)) root.style.removeProperty(name);
}

/** Apply the current choice to <html> */
export function applyTheme(): void {
	const root = document.documentElement;
	clearInline(root);
	let shown: 'light' | 'dark';
	if (theme.choice === 'default') {
		root.removeAttribute('data-theme-default');
		root.setAttribute('data-theme-mode', theme.consoleMode);
		shown =
			theme.consoleMode === 'dark'
				? 'dark'
				: theme.consoleMode === 'system' && systemDark()
					? 'dark'
					: 'light';
		root.style.colorScheme = '';
	} else {
		root.setAttribute('data-theme-default', theme.consoleMode);
		root.setAttribute('data-theme-mode', theme.choice);
		shown = theme.choice;
		const palette = theme.palettes[theme.choice];
		if (palette)
			for (const [k, name] of Object.entries(VARS)) if (palette[k]) root.style.setProperty(name, palette[k]);
		root.style.colorScheme = shown;
	}
	root.setAttribute('data-theme', shown);
	theme.shown = shown;
}

export function initTheme(consoleMode: string, palettes: { light: Palette; dark: Palette }): void {
	theme.consoleMode = consoleMode || 'system';
	theme.palettes = palettes;
	theme.choice = readChoice();
	if (!mq && typeof window.matchMedia === 'function') {
		mq = window.matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', () => {
			if (theme.choice === 'default' && theme.consoleMode === 'system') applyTheme();
		});
	}
	// Another tab changed the choice
	window.addEventListener('storage', (e) => {
		if (e.key === PREF.theme) {
			theme.choice = readChoice();
			applyTheme();
		}
	});
	applyTheme();
}

/** Top bar button: console default → light → dark → console default */
export function cycleTheme(): void {
	const next: ThemeChoice =
		theme.choice === 'default' ? 'light' : theme.choice === 'light' ? 'dark' : 'default';
	theme.choice = next;
	writePref(PREF.theme, next === 'default' ? null : next);
	applyTheme();
}
