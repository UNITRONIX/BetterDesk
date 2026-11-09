/**
 * Start a remote client page without the console shell: the strings and
 * the theme from what /console-boot.js already started (or fetch them).
 * The remote pages have no console bootstrap of their own: the viewer
 * opens for guest links, which have no session (routes/console.routes.js
 * lists /remote as a public path, so no bootstrap request starts early).
 */

import { i18n, setStrings, type Language } from '#lib/i18n/i18n.svelte.ts';
import { initTheme } from '#lib/state/theme.svelte.ts';

interface BootWindow {
	__BD_BOOT__?: {
		lang: string;
		dir: 'ltr' | 'rtl';
		themeMode?: string;
		palettes?: { light: Record<string, string> | null; dark: Record<string, string> | null };
		stringsUrl: string;
		strings?: Promise<Response>;
	};
}

type Strings = Parameters<typeof setStrings>[2];

export async function startRemotePage(): Promise<void> {
	const boot = (window as unknown as BootWindow).__BD_BOOT__;
	const lang = boot?.lang || document.documentElement.lang || 'en';
	const dir = boot?.dir || (document.documentElement.dir === 'rtl' ? 'rtl' : 'ltr');
	// A response body can be read once: take the early request, so a retry asks again
	const early = boot?.strings;
	if (boot) boot.strings = undefined;
	const res = await (early ??
		fetch(boot?.stringsUrl ?? `/api/console/strings/${encodeURIComponent(lang)}`, {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		}));
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	setStrings(lang, dir, (await res.json()) as Strings);
	initTheme(boot?.themeMode || document.documentElement.getAttribute('data-theme-mode') || 'system', {
		light: boot?.palettes?.light ?? null,
		dark: boot?.palettes?.dark ?? null
	});
}

/** The languages a page offers (from its own endpoint), for the language picker */
export function setLanguages(list: Language[]): void {
	i18n.available = list;
}
