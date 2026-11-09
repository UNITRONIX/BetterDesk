/**
 * The open device in the URL of the device list (/devices?open=<id>).
 *
 * - A link or bookmark with ?open=<id> opens that device's panel.
 * - Opening a device from the list adds a history entry with ?open=<id>,
 *   so Back closes the panel and Forward opens it again.
 * - Closing the panel goes back over the entry the list added, or, when the
 *   page was opened with ?open= (no entry of ours to go back over), takes
 *   the parameter out of the URL in place.
 * - Another device while one is open (an ID change, a link inside the
 *   panel) replaces the entry instead of adding one.
 *
 * The page calls urlToPanel when the URL changes and panelToUrl when the
 * open device changes; each returns what to do. Pure, unit tested in
 * tests/unit/devices-url.test.ts.
 */

export const OPEN_PARAM = 'open';

export type PanelStep = { do: 'open'; id: string } | { do: 'close' } | null;
export type UrlStep =
	{ do: 'push'; id: string } | { do: 'replace'; id: string | null } | { do: 'back' } | null;

/** The URL changed (link, Back, Forward): what the panel should do */
export function urlToPanel(urlOpen: string | null, panelId: string | null): PanelStep {
	if (urlOpen && urlOpen !== panelId) return { do: 'open', id: urlOpen };
	if (!urlOpen && panelId) return { do: 'close' };
	return null;
}

/**
 * The open device changed: what the URL should do. `pushed` is true when
 * the current history entry is one the list added (it carries our state).
 */
export function panelToUrl(urlOpen: string | null, panelId: string | null, pushed: boolean): UrlStep {
	if (panelId === urlOpen) return null;
	if (panelId) return urlOpen ? { do: 'replace', id: panelId } : { do: 'push', id: panelId };
	return pushed ? { do: 'back' } : { do: 'replace', id: null };
}

/** The URL with ?open= set to id (or removed), every other parameter kept */
export function withOpen(url: { readonly href: string }, id: string | null): URL {
	const next = new URL(url.href);
	if (id) next.searchParams.set(OPEN_PARAM, id);
	else next.searchParams.delete(OPEN_PARAM);
	return next;
}
