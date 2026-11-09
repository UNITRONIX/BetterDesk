/**
 * Links inside the console. Old URLs stay the contract (/devices,
 * /settings?tab=auth). While the new console runs under /app next to the
 * old one, link() sends ported pages to /app/... and everything else to the
 * old page at its own URL. After switch-over the base is '' and every path
 * passes through unchanged.
 */

import { resolve } from '$app/paths';

/** The app's base path ('/app' now, '' after switch-over) */
export const base = resolve('').replace(/\/$/, '');

/**
 * Pages the new console serves: an old path, or "/path/*" for pages with an
 * id in the path (/organizations/7). Add a page in the commit that ports it.
 * Once a page switches over, web-nodejs/lib/portedPages.js lists it too and
 * the server redirects its old URL here.
 */
export const PORTED: readonly string[] = [
	'/devices',
	'/help-requests',
	'/tickets',
	'/chat',
	'/toolkit',
	'/settings',
	'/languages',
	'/users',
	'/organizations',
	'/organizations/*',
	'/permissions',
	'/security-audit',
	'/activity',
	'/reports',
	'/policies',
	'/policies/*',
	'/automation',
	'/dataguard',
	'/resource-control',
	'/attestation',
	'/',
	'/inventory',
	'/network',
	'/cross-platform'
];

/** Whether a path (no query) is one of the entries */
export function matchesPorted(list: readonly string[], path: string): boolean {
	return list.some((entry) =>
		entry.endsWith('/*')
			? path.length > entry.length - 1 && path.startsWith(entry.slice(0, -1))
			: path === entry
	);
}

function pathOf(href: string): string {
	const cut = href.search(/[?#]/);
	return cut === -1 ? href : href.slice(0, cut);
}

export function isPorted(href: string): boolean {
	return matchesPorted(PORTED, pathOf(href));
}

export function link(href: string): string {
	if (!href.startsWith('/') || href.startsWith('//')) return href;
	if (!base || !isPorted(href)) return href;
	const p = pathOf(href);
	return base + (p === '/' ? '' : p) + href.slice(p.length);
}

/** The old URL for the current app location (strips the base) */
export function appPath(pathname: string): string {
	if (base && (pathname === base || pathname.startsWith(base + '/')))
		return pathname.slice(base.length) || '/';
	return pathname;
}
