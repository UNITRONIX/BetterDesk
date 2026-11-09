/**
 * Dialogs from code: `if (await confirm({ title, message, confirmLabel, danger: true })) ...`,
 * `const name = await prompt({ title, label, value })` (null when cancelled),
 * `await alert({ title, message })`. DialogHost (mounted once by the shell)
 * shows them. Each one is a Dialog, so the layer rules apply: one opened
 * while a sheet is open sits on top of it and Escape closes only the
 * dialog; a new one replaces an open dialog, which then answers as
 * cancelled.
 *
 * Labels come translated from the page; Cancel and Confirm have defaults.
 */

export interface ConfirmOptions {
	title: string;
	message?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** A meaning from ICONS before the confirm label */
	confirmIcon?: string;
	/** The answer destroys something: the button is red */
	danger?: boolean;
}

export interface PromptOptions {
	title: string;
	label: string;
	message?: string;
	value?: string;
	placeholder?: string;
	hint?: string;
	type?: 'text' | 'email' | 'url' | 'number' | 'password';
	required?: boolean;
	confirmLabel?: string;
	cancelLabel?: string;
}

export interface AlertOptions {
	title: string;
	message: string;
	okLabel?: string;
}

export type DialogRequest =
	| { id: number; kind: 'confirm'; options: ConfirmOptions; settle: (answer: boolean) => void }
	| { id: number; kind: 'prompt'; options: PromptOptions; settle: (answer: string | null) => void }
	| { id: number; kind: 'alert'; options: AlertOptions; settle: (answer: undefined) => void };

class DialogRequests {
	items = $state.raw<DialogRequest[]>([]);
}

/** What DialogHost renders, the newest last */
export const dialogRequests = new DialogRequests();

let nextId = 1;

function open<T>(make: (id: number, settle: (answer: T) => void) => DialogRequest): Promise<T> {
	return new Promise<T>((resolve) => {
		const id = nextId++;
		let done = false;
		const settle = (answer: T) => {
			if (done) return;
			done = true;
			dialogRequests.items = dialogRequests.items.filter((d) => d.id !== id);
			resolve(answer);
		};
		dialogRequests.items = [...dialogRequests.items, make(id, settle)];
	});
}

/** Ask a yes/no question. Resolves true for the confirm button, false otherwise. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
	return open<boolean>((id, settle) => ({ id, kind: 'confirm', options, settle }));
}

/** Ask for one value. Resolves the text, or null when cancelled. */
export function prompt(options: PromptOptions): Promise<string | null> {
	return open<string | null>((id, settle) => ({ id, kind: 'prompt', options, settle }));
}

/** Tell something that needs an OK. Resolves when closed. */
export function alert(options: AlertOptions): Promise<void> {
	return open<undefined>((id, settle) => ({ id, kind: 'alert', options, settle }));
}

/** Close every dialog from code as cancelled (route change) */
export function closeDialogs(): void {
	for (const d of dialogRequests.items) {
		if (d.kind === 'confirm') d.settle(false);
		else if (d.kind === 'prompt') d.settle(null);
		else d.settle(undefined);
	}
}
