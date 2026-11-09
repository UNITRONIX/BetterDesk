/**
 * Jumping to one setting (lib/settings/reveal.ts): closed disclosures
 * open, a block that is off is shown with a note naming its switch, focus
 * goes to that switch, and the note goes when the switch changes.
 */
import { tick } from 'svelte';
import {
	clearAllReveals,
	findTarget,
	highlight,
	onControlChange,
	revealFor,
	whenPresent
} from '#lib/settings/reveal.ts';

function page(html: string) {
	document.body.innerHTML = html;
}

afterEach(() => {
	clearAllReveals();
	document.body.innerHTML = '';
});

describe('showing a setting that is hidden', () => {
	test('opens the disclosures around it', () => {
		page(`<details id="outer"><summary>a</summary><details id="inner"><summary>b</summary>
			<div class="form-group"><input id="target"></div></details></details>`);
		revealFor(document.getElementById('target')!);
		expect((document.getElementById('outer') as HTMLDetailsElement).open).toBe(true);
		expect((document.getElementById('inner') as HTMLDetailsElement).open).toBe(true);
	});

	test('shows a block that is off, with a note that names the switch, and returns the switch', async () => {
		page(`<label class="check-field"><input type="checkbox" id="ldap-enabled" aria-controls="ldap-config-fields">
				<span class="check-label">Turn on LDAP sign-in</span></label>
			<div class="show-when" id="ldap-config-fields" hidden><div class="form-group"><input id="ldap-host"></div></div>`);
		const control = revealFor(document.getElementById('ldap-host')!);
		await tick();
		const group = document.getElementById('ldap-config-fields')!;
		expect(group.hidden).toBe(false);
		expect(control?.id).toBe('ldap-enabled');
		const note = document.getElementById('ldap-config-fields-note');
		expect(note?.textContent).toContain('Shown when "Turn on LDAP sign-in" is on.');
		expect(group.firstElementChild).toBe(note);
		expect(document.getElementById('ldap-enabled')!.getAttribute('aria-describedby')).toBe(
			'ldap-config-fields-note'
		);
	});

	test('the note goes when that switch changes; other switches leave it', async () => {
		page(`<input type="checkbox" id="other">
			<label><input type="checkbox" id="sw" aria-controls="grp"><span class="check-label">Sw</span></label>
			<div class="show-when" id="grp" hidden><input id="f"></div>`);
		revealFor(document.getElementById('f')!);
		await tick();
		onControlChange(document.getElementById('other'));
		expect(document.getElementById('grp-note')).not.toBeNull();
		onControlChange(document.getElementById('sw'));
		await tick();
		expect(document.getElementById('grp-note')).toBeNull();
		expect(document.getElementById('sw')!.hasAttribute('aria-describedby')).toBe(false);
		expect(document.getElementById('grp')!.dataset.revealed).toBeUndefined();
	});

	test('a block shown for some choices names them; a block shown while a switch is off says so', async () => {
		page(`<div role="radiogroup">
				<label class="choice"><input type="radio" name="bg" value="none"><span class="choice-title">None</span></label>
				<label class="choice"><input type="radio" name="bg" value="color" aria-controls="panel fx"><span class="choice-title">Colour</span></label>
				<label class="choice"><input type="radio" name="bg" value="image" aria-controls="fx"><span class="choice-title">Picture</span></label>
			</div>
			<div class="show-when" id="fx" hidden><input id="blur"></div>
			<label><input type="checkbox" id="direct" aria-controls="search"><span class="check-label">Direct bind</span></label>
			<div class="show-when when-off" id="search" hidden><input id="bind-dn"></div>`);
		revealFor(document.getElementById('blur')!);
		revealFor(document.getElementById('bind-dn')!);
		await tick();
		expect(document.getElementById('fx-note')?.textContent).toContain('Shown only for: Colour, Picture.');
		expect(document.getElementById('search-note')?.textContent).toContain('Shown when "Direct bind" is off.');
	});

	test('a visible target changes nothing', () => {
		page(`<div class="show-when" id="g"><input id="x"></div>`);
		expect(revealFor(document.getElementById('x')!)).toBeNull();
		expect(document.getElementById('g-note')).toBeNull();
	});
});

describe('jumping there', () => {
	test('outlines the block for a moment and focuses the field', () => {
		vi.useFakeTimers();
		page(
			`<section class="section" id="s"><div class="form-group"><label for="f">F</label><input id="f"></div></section>`
		);
		Element.prototype.scrollIntoView = vi.fn();
		const field = document.getElementById('f')!;
		// jsdom lays nothing out; a field on screen has a box
		field.getClientRects = () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList;
		highlight(field);
		const block = document.querySelector('.form-group')!;
		expect(block.classList.contains('is-found')).toBe(true);
		expect(document.activeElement?.id).toBe('f');
		vi.advanceTimersByTime(2500);
		expect(block.classList.contains('is-found')).toBe(false);
		vi.useRealTimers();
	});

	test('waits for a tab to draw the element, and gives up when told to', async () => {
		page('');
		const ctrl = new AbortController();
		const found = whenPresent('late', ctrl.signal, 2000);
		const el = document.createElement('div');
		el.id = 'late';
		document.body.append(el);
		await expect(found).resolves.toBe(el);
		const stop = new AbortController();
		const never = whenPresent('never', stop.signal, 2000);
		stop.abort();
		await expect(never).resolves.toBeNull();
	});
});

describe('old ids without an element of their own', () => {
	test('a radio, a facts value or a swatch points at what stands for it now', () => {
		page(`<input type="radio" name="connection-mode" value="relay_only">
			<section id="server-info"><dl class="facts"></dl></section><input id="bg-color">`);
		expect(findTarget('conn-mode-relay')).toBe(document.querySelector('input[value="relay_only"]'));
		expect(findTarget('db-path')).toBe(document.querySelector('#server-info .facts'));
		expect(findTarget('bg-color-picker')?.id).toBe('bg-color');
		expect(findTarget('nothing')).toBeNull();
		expect(findTarget('__proto__')).toBeNull();
	});

	test('the update channel ids from the search index find their radios', () => {
		page(`<fieldset id="update-channel-select">
			<input type="radio" name="update-channel" value="stable">
			<input type="radio" name="update-channel" value="development"></fieldset>`);
		expect(findTarget('update-channel-stable')).toBe(document.querySelector('input[value="stable"]'));
		expect(findTarget('update-channel-development')).toBe(
			document.querySelector('input[value="development"]')
		);
	});
});
