/**
 * Focus helpers for dialogs and sheets: what can take focus, where focus
 * starts, and keeping Tab inside.
 */

const CANDIDATES = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled]):not([type="hidden"])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'summary',
	'[contenteditable="true"]',
	'[tabindex]'
].join(',');

const FIELDS = 'input, select, textarea, [contenteditable="true"]';

function shown(el: HTMLElement): boolean {
	if (el.closest('[hidden], [inert]')) return false;
	// Inside a closed <details> only the summary shows; checkVisibility also
	// covers display: none (jsdom has no layout and may lack it)
	return typeof el.checkVisibility === 'function' ? el.checkVisibility() : true;
}

/** Elements in `root` that Tab reaches, in document order. One radio per group. */
export function focusables(root: HTMLElement): HTMLElement[] {
	const list = Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(
		(el) => el.tabIndex >= 0 && shown(el)
	);
	return list.filter((el) => {
		if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true;
		const group = list.filter(
			(o): o is HTMLInputElement =>
				o instanceof HTMLInputElement && o.type === 'radio' && o.name === el.name && o.form === el.form
		);
		const checked = group.find((o) => o.checked);
		return checked ? checked === el : group[0] === el;
	});
}

/**
 * Where focus starts in a dialog or sheet: an element marked
 * data-autofocus, else the first field in the body, else the safest footer
 * button (the first that is neither the answer nor destructive, usually
 * Cancel), else the first thing Tab reaches, else the window itself.
 */
export function focusInitial(root: HTMLElement): void {
	const list = focusables(root);
	const marked = list.find((el) => el.matches('[data-autofocus]'));
	const body = root.querySelector<HTMLElement>('.modal-body, .sheet-body');
	const field = body ? list.find((el) => body.contains(el) && el.matches(FIELDS)) : undefined;
	const footer = list.filter((el) => el.closest('.modal-footer, .sheet-footer') && el.matches('button'));
	const safe = footer.find((el) => !el.matches('.btn-danger, .btn-primary')) ?? footer[0];
	const target = marked ?? field ?? safe ?? list[0] ?? root;
	target.focus();
}

/** Keydown handler body: Tab and Shift+Tab cycle inside `root` */
export function trapTab(root: HTMLElement, event: KeyboardEvent): void {
	if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
	const list = focusables(root);
	event.preventDefault();
	const n = list.length;
	if (!n) {
		root.focus();
		return;
	}
	const active = document.activeElement;
	const back = event.shiftKey;
	let i = active instanceof HTMLElement ? list.indexOf(active) : -1;
	let next: HTMLElement | undefined;
	if (i >= 0) {
		next = list[(i + (back ? -1 : 1) + n) % n];
	} else {
		// Focus is on something outside the tab order (the window itself, a
		// menu item): go to its neighbours in document order
		i = active
			? list.findIndex((el) => active.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)
			: 0;
		if (back) next = i <= 0 ? list[n - 1] : list[i - 1];
		else next = i === -1 ? list[0] : list[i];
	}
	(next ?? root).focus();
}
