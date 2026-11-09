/**
 * What a page tells the shell, and what the shell tells pages.
 *
 * Title: the document title is "<page> - <app name>" (as the old layout)
 * and the breadcrumb ends with the page. Both default to the page's entry
 * in the navigation; a page that is not in it, or wants another name,
 * calls setPageTitle() (reset on every navigation).
 *
 * Refresh: the top bar's Refresh button sends the window event
 * "app:refresh", as the old one did. Pages reload their data with
 *   $effect(() => onRefresh(load));
 */

class PageInfo {
	title = $state<string | null>(null);
}

export const pageInfo = new PageInfo();

export function setPageTitle(title: string | null): void {
	pageInfo.title = title;
}

export const REFRESH_EVENT = 'app:refresh';

/** Ask the page to reload its data */
export function requestRefresh(): void {
	window.dispatchEvent(new CustomEvent(REFRESH_EVENT));
}

/** Call fn on Refresh (and after an approval elsewhere); returns the function that stops it */
export function onRefresh(fn: () => void): () => void {
	const handler = () => fn();
	window.addEventListener(REFRESH_EVENT, handler);
	return () => window.removeEventListener(REFRESH_EVENT, handler);
}

/** The console runs inside a Desktop Mode window (?embed=1): no shell around the page */
export const embedded: boolean = typeof location !== 'undefined' && /[?&]embed=1(&|$)/.test(location.search);
