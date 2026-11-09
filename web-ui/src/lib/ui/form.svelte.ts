/**
 * The form helper every form in the console uses (settings forms, sheets,
 * dialogs). It keeps the values people edit, knows whether they differ from
 * what was loaded (dirty), holds field errors and the status line, and runs
 * the save once at a time.
 *
 *   const form = createForm({
 *       initial: { name: device.name, port: 21116 },
 *       validate: (v) => ({ port: v.port > 65535 ? t('x.port_range') : undefined }),
 *       submit: (v) => api.saveDevice(id, v)          // may return the saved values
 *   });
 *
 *   <form id={form.id} onsubmit={form.onsubmit} novalidate>
 *       <Field label={t('x.name')} error={form.errors.name}>
 *           {#snippet children(f)}<Input {...f} bind:value={form.values.name} />{/snippet}
 *       </Field>
 *       <SaveBar {form} label={t('x.save')} />
 *   </form>
 *
 * Enter in a field saves: the form's submit button (SaveBar's, or a sheet
 * footer button with form={form.id}) is the default button. A failed save
 * keeps the changes and says why; a refused field is marked on the field.
 * An error goes away as soon as that field's value changes.
 *
 * Leaving with unsaved changes: `$effect(() => warnOnLeave(() => form.dirty))`
 * covers closing the tab; for in-app links use beforeNavigate with form.dirty.
 */

import { tick } from 'svelte';
import { ApiError } from '#lib/api/client.ts';
import { tf } from '#lib/i18n/i18n.svelte.ts';

export type FormState = 'idle' | 'saving' | 'saved' | 'error';

export interface FormStatus {
	state: FormState;
	/** Text for the status line: what was saved or why it failed */
	message: string;
}

export type FieldErrors<T> = { [K in keyof T & string]?: string | undefined };

export interface FormOptions<T extends object> {
	/** The form element's id when links or scripts already point at one ("ldap-form"); generated otherwise */
	id?: string;
	initial: T;
	/** Messages for refused fields; return nothing or no messages to allow the save */
	validate?: (values: T) => FieldErrors<T> | null | undefined;
	/**
	 * Saves the values. Return the values as saved (when the server changes
	 * them) or nothing. Throw a FormError, or an ApiError, to refuse.
	 */
	submit: (values: T) => Promise<T | undefined> | Promise<void> | T | undefined;
	/** Status text after a save (default "Saved") */
	savedMessage?: string;
}

/**
 * Thrown from submit to show a message; with a field, the message goes on
 * that field. An ApiError whose body has `field` lands on that field too.
 */
export class FormError extends Error {
	readonly field: string | null;
	constructor(message: string, field?: string) {
		super(message);
		this.name = 'FormError';
		this.field = field ?? null;
	}
}

interface StoredError {
	message: string;
	/** The field's value when the error was set; the error shows while it is unchanged */
	value: unknown;
}

let seq = 0;

/** Deep equality for form values (primitives, arrays, plain objects) */
function same(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => same(v, b[i]));
	}
	const protoA = Object.getPrototypeOf(a) as unknown;
	if (protoA !== Object.prototype && protoA !== null) return false;
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	const ra = a as Record<string, unknown>;
	const rb = b as Record<string, unknown>;
	return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && same(ra[k], rb[k]));
}

function fieldOf(err: unknown): string | null {
	if (err instanceof FormError) return err.field;
	if (err instanceof ApiError && err.data && typeof err.data === 'object') {
		const field = (err.data as { field?: unknown }).field;
		return typeof field === 'string' && field ? field : null;
	}
	return null;
}

export class Form<T extends object> {
	/** The form element's id: for a submit button outside the form (form={form.id}) */
	readonly id: string;
	/** The values the page binds to */
	values = $state() as T;
	status = $state<FormStatus>({ state: 'idle', message: '' });

	#initial = $state.raw() as T;
	#errors = $state<Record<string, StoredError>>({});
	#pending = false;
	#validate: FormOptions<T>['validate'];
	#submit: FormOptions<T>['submit'];
	#savedMessage: string | undefined;

	/** True while the values differ from what was loaded or last saved */
	readonly dirty = $derived(!same(this.values, this.#initial));
	readonly busy = $derived(this.status.state === 'saving');

	/** Message per refused field; one disappears when that field changes */
	readonly errors = $derived.by(() => {
		const out: Record<string, string> = {};
		const values = this.values as Record<string, unknown>;
		for (const [field, e] of Object.entries(this.#errors)) {
			if (!(field in values) || same(values[field], e.value)) out[field] = e.message;
		}
		return out as FieldErrors<T>;
	});

	constructor(opts: FormOptions<T>) {
		this.id = opts.id ?? `form-${++seq}`;
		this.#validate = opts.validate;
		this.#submit = opts.submit;
		this.#savedMessage = opts.savedMessage;
		this.#initial = $state.snapshot(opts.initial) as T;
		this.values = $state.snapshot(opts.initial) as T;
	}

	/** For <form onsubmit>: stops the page load and saves */
	onsubmit = (e: SubmitEvent): void => {
		e.preventDefault();
		void this.submit();
	};

	/** Validates and saves. Resolves true when saved; a second call while saving does nothing. */
	async submit(): Promise<boolean> {
		if (this.#pending) return false;
		const values = $state.snapshot(this.values) as T;
		const refused = Object.entries(this.#validate?.(values) ?? {}).filter(
			(e): e is [string, string] => typeof e[1] === 'string' && e[1] !== ''
		);
		this.#errors = {};
		if (refused.length) {
			for (const [field, message] of refused) this.#store(field, message);
			await this.#focusInvalid();
			return false;
		}
		this.#pending = true;
		this.status = { state: 'saving', message: tf('ui_form.saving', 'Saving…') };
		try {
			const saved = await this.#submit(values);
			// What was sent is the new baseline; edits made while saving stay dirty
			this.#initial = $state.snapshot(saved ?? values) as T;
			if (saved) this.values = $state.snapshot(saved) as T;
			this.status = { state: 'saved', message: this.#savedMessage ?? tf('ui_form.saved', 'Saved') };
			return true;
		} catch (err) {
			const failed = tf('ui_form.save_failed', 'Could not save. Your changes are still here.');
			const field = fieldOf(err);
			const plain = err instanceof ApiError || err instanceof FormError ? err.message : '';
			if (field && field in (this.values as Record<string, unknown>) && plain) {
				this.#store(field, plain);
				this.status = { state: 'error', message: failed };
				await this.#focusInvalid();
			} else {
				this.status = { state: 'error', message: plain || failed };
			}
			return false;
		} finally {
			this.#pending = false;
		}
	}

	/**
	 * Back to the loaded values (discard changes), or to new ones (after
	 * loading again). Clears errors and the status line.
	 */
	reset(next?: T): void {
		const base = next ?? this.#initial;
		this.#initial = $state.snapshot(base) as T;
		this.values = $state.snapshot(base) as T;
		this.#errors = {};
		this.status = { state: 'idle', message: '' };
	}

	/** Mark a field as refused (a check the page does itself, a server answer) */
	setError(field: keyof T & string, message: string): void {
		this.#store(field, message);
	}

	clearErrors(): void {
		this.#errors = {};
	}

	#store(field: string, message: string): void {
		const value = (this.values as Record<string, unknown>)[field];
		this.#errors[field] = { message, value: $state.snapshot(value) };
	}

	async #focusInvalid(): Promise<void> {
		if (typeof document === 'undefined') return;
		await tick();
		const form = document.getElementById(this.id);
		const field = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
		field?.focus();
	}
}

export function createForm<T extends object>(opts: FormOptions<T>): Form<T> {
	return new Form(opts);
}

/**
 * Asks before the tab closes or reloads while isDirty() is true. Returns
 * the function that removes the guard, so it fits an $effect.
 */
export function warnOnLeave(isDirty: () => boolean): () => void {
	const onBeforeUnload = (e: BeforeUnloadEvent) => {
		if (!isDirty()) return;
		e.preventDefault();
		// Older browsers need returnValue set to show the prompt
		e.returnValue = '';
	};
	window.addEventListener('beforeunload', onBeforeUnload);
	return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
