/** What a Menu gives its items (MenuItem), and which elements are items */

import { getContext, setContext } from 'svelte';

export interface MenuContext {
	/** Close the menu; returnFocus puts focus back on the button that opened it */
	close(returnFocus: boolean): void;
}

const KEY = Symbol('menu');

export function setMenu(menu: MenuContext): void {
	setContext(KEY, menu);
}

export function getMenu(): MenuContext | undefined {
	return getContext<MenuContext | undefined>(KEY);
}

export const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/** Items that arrow keys and typeahead reach (disabled ones are skipped) */
export function menuItems(menu: HTMLElement): HTMLElement[] {
	return Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)).filter(
		(el) => !el.matches(':disabled, [aria-disabled="true"]')
	);
}
