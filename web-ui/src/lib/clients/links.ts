/**
 * Links that leave the console (GitHub releases, the public download page)
 * open in a new tab, as on the old pages. ListRow has no target, so this
 * attachment sets it on the rows inside: `<div {@attach externalLinks}>`.
 * Shared change asked for: a `target`/external prop on ListRow.
 */

/** Pages outside the console that open in a new tab */
const OUTSIDE = /^(https?:\/\/|\/portal(?:[/?#]|$)|\/d\/)/;

export function isOutside(href: string | null | undefined): boolean {
	return OUTSIDE.test(String(href ?? ''));
}

export function externalLinks(node: HTMLElement): () => void {
	const apply = () => {
		for (const a of node.querySelectorAll<HTMLAnchorElement>('a[href]')) {
			if (!isOutside(a.getAttribute('href'))) continue;
			a.target = '_blank';
			a.rel = 'noopener noreferrer';
		}
	};
	apply();
	const mo = new MutationObserver(apply);
	mo.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
	return () => mo.disconnect();
}
