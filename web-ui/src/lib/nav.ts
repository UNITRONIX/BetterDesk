/**
 * Links inside the console. The console lives at the root, so a page's
 * address is its path (/devices, /settings?tab=auth); link() still puts the
 * base in front, so a build for another base links to its own pages.
 */

import { resolve } from '$app/paths';

/** The app's base path ('' at the root) */
export const base = resolve('').replace(/\/$/, '');

function pathOf(href: string): string {
	const cut = href.search(/[?#]/);
	return cut === -1 ? href : href.slice(0, cut);
}

/** A page's address with the base; query and hash kept, other links unchanged */
export function link(href: string): string {
	if (!href.startsWith('/') || href.startsWith('//')) return href;
	if (!base) return href;
	const p = pathOf(href);
	return base + (p === '/' ? '' : p) + href.slice(p.length);
}

/** The page's path for an app location (without the base) */
export function appPath(pathname: string): string {
	if (base && (pathname === base || pathname.startsWith(base + '/')))
		return pathname.slice(base.length) || '/';
	return pathname;
}
