/**
 * Copy to the clipboard with the console's feedback: a tick on the button
 * for 1.5 s and a toast (copied, or how to copy by hand when it failed).
 * Used by ValueCopy, ValueField and CodeBlock.
 */

import { tf } from '#lib/i18n/i18n.svelte.ts';
import { toast } from './toasts.svelte.ts';

export const COPIED_MS = 1500;

/** Write text to the clipboard; falls back to a hidden textarea where the API is missing */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		const area = document.createElement('textarea');
		area.value = text;
		area.setAttribute('readonly', '');
		area.style.position = 'fixed';
		area.style.opacity = '0';
		document.body.appendChild(area);
		area.select();
		try {
			return document.execCommand('copy');
		} catch {
			return false;
		} finally {
			area.remove();
		}
	}
}

/** Copy state of one button: `copied` is true for 1.5 s after a successful copy */
export class Copier {
	copied = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;

	async copy(text: string): Promise<boolean> {
		const ok = await copyText(text);
		if (ok) {
			this.copied = true;
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => (this.copied = false), COPIED_MS);
			toast.success(tf('common.copied', 'Copied to clipboard'));
		} else {
			toast.error(tf('common.copy_failed', 'Could not copy. Select the text and copy it yourself.'));
		}
		return ok;
	}

	/** Call when the component goes away */
	dispose(): void {
		clearTimeout(this.#timer);
	}
}
