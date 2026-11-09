/**
 * Links inside the console. Old URLs stay the contract (/devices,
 * /settings?tab=auth); link() puts the app's base in front while the new
 * console runs under /app next to the old one. External links, the old
 * pages that are not ported yet and server downloads pass through as they are.
 */

import { resolve } from '$app/paths';

/** The app's base path ('/app' now, '' after switch-over) */
export const base = resolve('/').replace(/\/$/, '');

/** Paths that belong to Express, not to the app (downloads, the old viewer) */
const SERVER_PATHS = /^\/(api|downloads|d\/|remote(\/|$)|logout|uploads|css|fonts|img)/;

export function link(path: string): string {
	if (!path.startsWith('/') || path.startsWith('//') || SERVER_PATHS.test(path)) return path;
	return base + (path === '/' && base ? '' : path);
}

/** The old URL for the current app location (strips the base) */
export function appPath(pathname: string): string {
	if (base && (pathname === base || pathname.startsWith(base + '/')))
		return pathname.slice(base.length) || '/';
	return pathname;
}
