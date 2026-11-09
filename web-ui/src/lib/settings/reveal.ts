/**
 * Showing one setting that a search result or a #<id> link points at,
 * without changing any setting (old settings.js revealForTarget and
 * highlightTarget):
 *
 * - closed disclosures around it open;
 * - a ShowWhen block that is off is shown anyway, with a note that names
 *   the switch or the choices it depends on ("Shown when "X" is on."),
 *   and focus goes to that switch, which the note describes. The note goes
 *   when that switch changes. A block with class "when-off" is shown while
 *   its switch is off, and its note says so;
 * - otherwise the field itself gets focus;
 * - the block is scrolled to the middle and outlined for a moment (the
 *   page styles .is-found).
 *
 * Works on any tab's markup: ShowWhen blocks are found by their class and
 * id, their switches by aria-controls.
 */

import { mount, unmount } from 'svelte';
import { tf } from '#lib/i18n/i18n.svelte.ts';
import Notice from '#lib/ui/Notice.svelte';

const FOUND_MS = 2400;
const BLOCK = '.form-group, .check-field, .choice, .facts, .settings-subgroup, .section, .danger-zone';

interface Revealed {
	note: ReturnType<typeof mount>;
	noteId: string;
	controls: HTMLElement[];
}

const revealed = new Map<HTMLElement, Revealed>();
let seq = 0;

function tokens(el: Element, attr: string): Set<string> {
	return new Set((el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean));
}

function setToken(el: Element, attr: string, token: string, add: boolean): void {
	const list = tokens(el, attr);
	if (add) list.add(token);
	else list.delete(token);
	if (list.size) el.setAttribute(attr, [...list].join(' '));
	else el.removeAttribute(attr);
}

/** The inputs that show or hide this block (aria-controls points at it) */
export function controlsOf(group: HTMLElement): HTMLInputElement[] {
	if (!group.id) return [];
	return [...document.querySelectorAll<HTMLInputElement>('input[aria-controls]')].filter((el) =>
		tokens(el, 'aria-controls').has(group.id)
	);
}

/** The visible name of a checkbox or radio */
export function controlLabel(input: HTMLInputElement): string {
	const label = input.closest('label');
	const named = label?.querySelector('.check-label, .choice-title')?.textContent ?? label?.textContent ?? '';
	return named.replace(/\s+/g, ' ').trim();
}

/** "Shown when "X" is on." / "… is off." / "Shown only for: A, B." */
export function noteFor(group: HTMLElement, controls: HTMLInputElement[]): string {
	const radios = controls.filter((c) => c.type === 'radio');
	if (radios.length) {
		const choices = radios.map(controlLabel).filter(Boolean).join(', ');
		return tf('settings.page.shown_when_only', 'Shown only for: {choices}.', { choices });
	}
	const name = controls[0] ? controlLabel(controls[0]) : '';
	return group.classList.contains('when-off')
		? tf('settings.page.shown_when_off', 'Shown when "{switch}" is off.', { switch: name })
		: tf('settings.page.shown_when_on', 'Shown when "{switch}" is on.', { switch: name });
}

/** Take the note away from a block shown for a search (its switch changed) */
export function clearReveal(group: HTMLElement): void {
	const r = revealed.get(group);
	if (!r) return;
	revealed.delete(group);
	delete group.dataset.revealed;
	for (const c of r.controls) setToken(c, 'aria-describedby', r.noteId, false);
	void unmount(r.note);
}

export function clearAllReveals(): void {
	for (const g of [...revealed.keys()]) clearReveal(g);
}

/** A switch changed: blocks it controls lose their note (and follow the switch again) */
export function onControlChange(target: EventTarget | null): void {
	if (!(target instanceof HTMLInputElement)) return;
	for (const [group, r] of revealed) if (r.controls.includes(target)) clearReveal(group);
}

/**
 * Open what hides the target. Returns the switch to focus (the one that
 * turns the outermost hidden block on), or null.
 */
export function revealFor(target: HTMLElement): HTMLElement | null {
	for (let d = target.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true;
	let focus: HTMLElement | null = null;
	for (
		let g = target.closest<HTMLElement>('.show-when');
		g;
		g = g.parentElement?.closest<HTMLElement>('.show-when') ?? null
	) {
		if (!g.hidden) continue;
		g.hidden = false;
		g.dataset.revealed = 'true';
		const controls = controlsOf(g);
		const noteId = `${g.id || `show-when-${++seq}`}-note`;
		const note = mount(Notice, {
			target: g,
			anchor: g.firstChild ?? undefined,
			props: { id: noteId, message: noteFor(g, controls), class: 'settings-reveal-note' }
		});
		for (const c of controls) setToken(c, 'aria-describedby', noteId, true);
		revealed.set(g, { note, noteId, controls });
		focus = controls.find((c) => !c.disabled) ?? focus;
	}
	return focus;
}

/** Scroll to the target's block, outline it for a moment, and focus the right control */
export function highlight(target: HTMLElement): void {
	const control = revealFor(target);
	const block = target.closest<HTMLElement>(BLOCK) ?? target;
	block.scrollIntoView({ block: 'center' });
	block.classList.add('is-found');
	setTimeout(() => block.classList.remove('is-found'), FOUND_MS);
	if (control) {
		control.focus({ preventScroll: true });
		return;
	}
	const field = target.matches('input, select, textarea')
		? target
		: block.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea');
	if (field && !(field as HTMLInputElement).disabled && field.getClientRects().length) {
		field.focus({ preventScroll: true });
	}
}

/**
 * Ids of the old page that have no element of their own now (a radio, a
 * value in a facts list, a colour swatch), and where they point instead.
 */
export const ID_ALIASES: Readonly<Record<string, string>> = {
	'conn-mode-p2p': 'input[name="connection-mode"][value="p2p_first"]',
	'conn-mode-relay': 'input[name="connection-mode"][value="relay_only"]',
	'device-scope-open': 'input[name="device_scope_mode"][value="open"]',
	'device-scope-restricted': 'input[name="device_scope_mode"][value="restricted"]',
	'update-channel-stable': 'input[name="update-channel"][value="stable"]',
	'update-channel-development': 'input[name="update-channel"][value="development"]',
	'mesh-status-enabled': '#mesh-body .facts',
	'mesh-agents-online': '#mesh-body .facts',
	'mesh-cert-state': '#mesh-body .facts',
	'go-server-version': '#server-info .facts',
	'db-path': '#server-info .facts',
	uptime: '#server-info .facts',
	'font-upload-name': '#font-source',
	'font-upload-file': '#font-source',
	'bg-color-picker': '#bg-color',
	'glass-color-picker': '#glass-color',
	'login-bg-color-picker': '#login-bg-color',
	'agent-bg-color-picker': '#agent-bg-color',
	'rdclient-bg-color-picker': '#rdclient-bg-color',
	'password-form': '#account-password'
};

/** The element an old id points at now */
export function findTarget(id: string): HTMLElement | null {
	const el = document.getElementById(id);
	if (el) return el;
	const alias = Object.prototype.hasOwnProperty.call(ID_ALIASES, id) ? ID_ALIASES[id] : undefined;
	return alias ? document.querySelector<HTMLElement>(alias) : null;
}

/**
 * Wait until an element with this id is on the page (a tab draws parts of
 * itself after its data arrives). Resolves null after `timeout` ms or when
 * `signal` aborts.
 */
export function whenPresent(id: string, signal: AbortSignal, timeout = 15000): Promise<HTMLElement | null> {
	return new Promise((resolve) => {
		const find = () => findTarget(id);
		const now = find();
		if (now) {
			resolve(now);
			return;
		}
		const done = (el: HTMLElement | null) => {
			observer.disconnect();
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
			resolve(el);
		};
		const abort = () => done(null);
		const observer = new MutationObserver(() => {
			const el = find();
			if (el) done(el);
		});
		observer.observe(document.body, { childList: true, subtree: true });
		const timer = setTimeout(() => done(find()), timeout);
		signal.addEventListener('abort', abort);
	});
}
