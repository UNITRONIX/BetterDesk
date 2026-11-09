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
 * Pages the new console serves (path without query). Add a page here in the
 * commit that ports it.
 */
export const PORTED = new Set<string>(['/', '/devices']);

function pathOf(href: string): string {
	const cut = href.search(/[?#]/);
	return cut === -1 ? href : href.slice(0, cut);
}

export function isPorted(href: string): boolean {
	return PORTED.has(pathOf(href));
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
