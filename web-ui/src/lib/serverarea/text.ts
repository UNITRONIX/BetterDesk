/**
 * A translated sentence with one part that is not text (a link, a <time>):
 * "Restarts of the server are listed in {link}." The sentence is translated
 * with a marker for that part and split around it, so the page renders
 *   {before}<a ...>Security audit</a>{after}
 * and the words around the link stay in the translation's order.
 */

import { t, tf, type Params } from '#lib/i18n/i18n.svelte.ts';

const MARK = '\u0001';

export function around(key: string, slot: string, params: Params = {}, fallback?: string): [string, string] {
	const all = { ...params, [slot]: MARK };
	const text = fallback === undefined ? t(key, all) : tf(key, fallback, all);
	const at = text.indexOf(MARK);
	if (at === -1) return [text, ''];
	return [text.slice(0, at), text.slice(at + MARK.length)];
}
