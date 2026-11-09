/**
 * Follow a link() from code (a row click): inside the new console with the
 * router, to a page still in the old console with a full load. The router
 * refuses paths outside its base.
 */
import { goto } from '$app/navigation';
import { base } from '#lib/nav.ts';

export function go(href: string): void {
	if (!base || href === base || href.startsWith(base + '/') || href.startsWith(base + '?')) {
		// href comes from link(), which already adds the base
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		void goto(href);
	} else {
		location.assign(href);
	}
}
