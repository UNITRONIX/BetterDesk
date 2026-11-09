/**
 * Unsaved changes on the settings page. Each form on a tab registers a
 * check; the page asks before it is left (another tab, another page, the
 * browser closing) while any of them is dirty.
 *
 *   $effect(() => trackDirty(() => form.dirty));
 */

const checks = new Set<() => boolean>();

/** Register a check; returns the function that removes it (fits an $effect) */
export function trackDirty(isDirty: () => boolean): () => void {
	checks.add(isDirty);
	return () => {
		checks.delete(isDirty);
	};
}

export function anyDirty(): boolean {
	for (const check of checks) if (check()) return true;
	return false;
}
