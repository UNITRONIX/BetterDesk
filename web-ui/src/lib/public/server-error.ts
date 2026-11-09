/**
 * Error pages the server decided on (web-nodejs/lib/webUi.js
 * sendErrorPage). The server sends the app page for the address with the
 * error status and <meta name="bd-error" content="403|404|500"> (plus
 * data-title and data-message for a 403 that has its own words); the app
 * then shows the error page at that address, for the address the page was
 * loaded with only (src/hooks.ts).
 */

export interface ServerError {
	status: 403 | 404 | 500;
	title: string;
	message: string;
}

export function serverError(doc: Document | undefined): ServerError | null {
	const meta = doc?.querySelector('meta[name="bd-error"]');
	const code = Number(meta?.getAttribute('content'));
	if (!meta || (code !== 403 && code !== 404 && code !== 500)) return null;
	return {
		status: code,
		title: meta.getAttribute('data-title') ?? '',
		message: meta.getAttribute('data-message') ?? ''
	};
}

/**
 * The route path to show instead of `href`'s own, or undefined. `first` is
 * the address the page was loaded with; later navigations route normally.
 */
export function errorReroute(
	href: string,
	first: string,
	marked: ServerError | null,
	base: string
): string | undefined {
	if (!marked || href !== first) return undefined;
	return `${base}/error/${marked.status}`;
}
