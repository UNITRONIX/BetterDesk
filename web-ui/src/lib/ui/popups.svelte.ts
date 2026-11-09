/**
 * Only one popup is open at a time (menus, dropdowns, the search palette,
 * the notification list, the account menu). Opening one closes the other.
 * Dialogs and sheets are not popups; a menu inside a sheet still closes
 * any other menu.
 */

type Closer = () => void;

let current: { id: symbol; close: Closer } | null = null;

/** Call when a popup opens. Returns the function to call when it closes. */
export function openPopup(close: Closer): () => void {
	const id = Symbol('popup');
	if (current) {
		const prev = current;
		current = null;
		prev.close();
	}
	current = { id, close };
	return () => {
		if (current?.id === id) current = null;
	};
}

/** Close whatever popup is open (route change, Escape at page level) */
export function closePopups(): void {
	if (!current) return;
	const prev = current;
	current = null;
	prev.close();
}
