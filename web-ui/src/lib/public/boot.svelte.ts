/**
 * Start a page outside the console (sign-in, download pages, error pages):
 * strings and theme, no session. /console-boot.js has already put the
 * language, direction, theme and accessibility modes on <html> before the
 * first paint, and started the strings request (it skips the session
 * request on these paths).
 */

import { clientMessages } from '#lib/api/client.ts';
import { has, setStrings, t } from '#lib/i18n/i18n.svelte.ts';
import { initTheme } from '#lib/state/theme.svelte.ts';

type Palette = Record<string, string> | null;
type Strings = Parameters<typeof setStrings>[2];

interface PublicBoot {
	lang?: string;
	dir?: 'ltr' | 'rtl';
	themeMode?: string;
	palettes?: { light: Palette; dark: Palette };
	stringsUrl?: string;
	strings?: Promise<Response>;
	session?: Promise<Response>;
}

class PublicState {
	ready = $state(false);
	failed = $state(false);
}

export const publicPage = new PublicState();

let themed = false;

async function loadStrings(boot: PublicBoot | undefined, lang: string): Promise<Strings> {
	// A response body can be read once: take the early request, so Try again asks again
	const early = boot?.strings;
	if (boot) boot.strings = undefined;
	const res = await (early ??
		fetch(boot?.stringsUrl ?? `/api/console/strings/${encodeURIComponent(lang)}`, {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		}));
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return (await res.json()) as Strings;
}

/** Load the strings and follow the theme; `publicPage.failed` when the strings didn't come */
export async function startPublic(): Promise<void> {
	const boot = (window as unknown as { __BD_BOOT__?: PublicBoot }).__BD_BOOT__;
	const root = document.documentElement;
	const lang = boot?.lang ?? root.lang ?? 'en';
	const dir = boot?.dir ?? (root.dir === 'rtl' ? 'rtl' : 'ltr');
	publicPage.failed = false;
	if (!themed) initTheme(boot?.themeMode ?? 'system', boot?.palettes ?? { light: null, dark: null });
	themed = true;
	try {
		setStrings(lang, dir, await loadStrings(boot, lang));
	} catch {
		publicPage.failed = true;
		return;
	}
	if (has('errors.no_permission')) clientMessages.permission = t('errors.no_permission');
	if (has('errors.network')) clientMessages.network = t('errors.network');
	publicPage.ready = true;
}

/**
 * /console-boot.js asks for the session on paths outside the public ones; a
 * page that turns out to be public after all (an error page for someone not
 * signed in) reads and drops that answer, so the request ends.
 */
export function dropEarlySession(): void {
	const boot = (window as unknown as { __BD_BOOT__?: PublicBoot }).__BD_BOOT__;
	const early = boot?.session;
	if (!boot || !early) return;
	boot.session = undefined;
	void early.then((r) => r.text()).catch(() => {});
}
