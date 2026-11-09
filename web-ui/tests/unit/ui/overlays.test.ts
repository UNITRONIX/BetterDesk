import { render, screen, within, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, flushSync, tick } from 'svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import Harness from './OverlaysHarness.svelte';
import DialogHost from '../../../src/lib/ui/DialogHost.svelte';
import ToastHost from '../../../src/lib/ui/ToastHost.svelte';
import Tabs from '../../../src/lib/ui/Tabs.svelte';
import Pagination from '../../../src/lib/ui/Pagination.svelte';
import Disclosure from '../../../src/lib/ui/Disclosure.svelte';
import Notice from '../../../src/lib/ui/Notice.svelte';
import States from '../../../src/lib/ui/States.svelte';
import { confirm, prompt } from '../../../src/lib/ui/dialogs.svelte.ts';
import { toast, dismissAll } from '../../../src/lib/ui/toasts.svelte.ts';
import { openLayers } from '../../../src/lib/ui/layers.ts';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<p>${s}</p>` }));

afterEach(() => {
	cleanup();
	dismissAll();
	vi.useRealTimers();
});

describe('Menu', () => {
	function setup() {
		const onselect = vi.fn();
		render(Harness, { scene: 'menus', onselect });
		const trigger = screen.getByRole('button', { name: 'Actions' });
		return { onselect, trigger, user: userEvent.setup() };
	}

	test('Enter opens the menu on the first item; the button says so', async () => {
		const { trigger, user } = setup();
		expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		trigger.focus();
		await user.keyboard('{Enter}');
		const menu = screen.getByRole('menu');
		expect(trigger).toHaveAttribute('aria-expanded', 'true');
		expect(trigger).toHaveAttribute('aria-controls', menu.id);
		expect(menu).toHaveAttribute('aria-labelledby', trigger.id);
		expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /edit/i }));
	});

	test('ArrowUp opens on the last item, ArrowDown on the first', async () => {
		const { trigger, user } = setup();
		trigger.focus();
		await user.keyboard('{ArrowUp}');
		expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /delete/i }));
		await user.keyboard('{Escape}');
		await user.keyboard('{ArrowDown}');
		expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: /edit/i }));
	});

	test('arrow keys move, skip disabled items and wrap; Home and End jump', async () => {
		const { trigger, user } = setup();
		trigger.focus();
		await user.keyboard('{Enter}');
		const name = () => document.activeElement?.querySelector('.menu-item-label')?.textContent;
		await user.keyboard('{ArrowDown}');
		expect(name()).toBe('Tags');
		await user.keyboard('{ArrowDown}');
		expect(name()).toBe('Move to folder'); // Archive is disabled
		await user.keyboard('{End}');
		expect(name()).toBe('Delete…');
		await user.keyboard('{ArrowDown}');
		expect(name()).toBe('Edit');
		await user.keyboard('{ArrowUp}');
		expect(name()).toBe('Delete…');
		await user.keyboard('{Home}');
		expect(name()).toBe('Edit');
	});

	test('a letter moves to the next item starting with it', async () => {
		const { trigger, user } = setup();
		trigger.focus();
		await user.keyboard('{Enter}');
		const name = () => document.activeElement?.querySelector('.menu-item-label')?.textContent;
		await user.keyboard('m');
		expect(name()).toBe('Move to folder');
		await user.keyboard('d');
		expect(name()).toBe('Delete…');
		await user.keyboard('p');
		expect(name()).toBe('Platform');
		// the icon's ligature text ("edit", "sell") does not count
		await user.keyboard('s');
		expect(name()).toBe('Platform');
	});

	test('Escape closes and returns focus to the button; Tab closes', async () => {
		const { trigger, user } = setup();
		trigger.focus();
		await user.keyboard('{Enter}');
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(document.activeElement).toBe(trigger);
		await user.keyboard('{Enter}');
		await user.keyboard('{Tab}');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	test('opening a second menu closes the first, also without a click', async () => {
		const { trigger, user } = setup();
		await user.click(trigger);
		expect(screen.getAllByRole('menu')).toHaveLength(1);
		const kebab = screen.getByRole('button', { name: 'Row actions' });
		expect(kebab).toHaveClass('icon-btn');
		// opened from code or the keyboard: no pointer press outside the first menu
		kebab.focus();
		await user.keyboard('{ArrowDown}');
		const menus = screen.getAllByRole('menu');
		expect(menus).toHaveLength(1);
		expect(within(menus[0]!).getByText('Connect')).toBeInTheDocument();
		expect(trigger).toHaveAttribute('aria-expanded', 'false');
		expect(menus[0]).toHaveClass('menu-end');
	});

	test('a click outside closes without taking focus', async () => {
		const { trigger, user } = setup();
		await user.click(trigger);
		const after = screen.getByRole('button', { name: 'After' });
		await user.click(after);
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(after);
	});

	test('a click on the open button closes the menu', async () => {
		const { trigger, user } = setup();
		await user.click(trigger);
		await user.click(trigger);
		expect(screen.queryByRole('menu')).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	test('choosing an item closes the menu and focuses the button before it runs', async () => {
		const { trigger, user, onselect } = setup();
		onselect.mockImplementation(() => expect(document.activeElement).toBe(trigger));
		await user.click(trigger);
		await user.click(screen.getByRole('menuitem', { name: /tags/i }));
		expect(onselect).toHaveBeenCalledWith('tags');
		expect(screen.queryByRole('menu')).toBeNull();
	});

	test('a disabled item does nothing', async () => {
		const { trigger, user, onselect } = setup();
		await user.click(trigger);
		const archive = screen.getByRole('menuitem', { name: /archive/i });
		expect(archive).toBeDisabled();
		await user.click(archive);
		expect(onselect).not.toHaveBeenCalled();
	});

	test('a checkbox item toggles and leaves the menu open', async () => {
		const { trigger, user, onselect } = setup();
		await user.click(trigger);
		const item = screen.getByRole('menuitemcheckbox', { name: /platform/i });
		expect(item).toHaveAttribute('aria-checked', 'true');
		await user.click(item);
		expect(onselect).toHaveBeenCalledWith('platform:false');
		expect(screen.getByRole('menuitemcheckbox', { name: /platform/i })).toHaveAttribute(
			'aria-checked',
			'false'
		);
		expect(screen.getByRole('menu')).toBeInTheDocument();
	});

	test('a checkbox item draws its box and is named by its label alone', async () => {
		// The icon font has no checkbox symbols: a ligature name would show as text
		const { trigger, user } = setup();
		await user.click(trigger);
		const item = screen.getByRole('menuitemcheckbox', { name: /platform/i });
		expect(item.textContent?.trim()).toBe('Platform');
		expect(item.querySelector('.menu-check')).toHaveAttribute('aria-hidden', 'true');
	});

	test('a radio item marks the one chosen, closes the menu and returns focus', async () => {
		const onselect = vi.fn();
		render(Harness, { scene: 'radio', onselect });
		const user = userEvent.setup();
		const trigger = screen.getByRole('button', { name: 'Language' });
		await user.click(trigger);
		const en = screen.getByRole('menuitemradio', { name: /English/ });
		const de = screen.getByRole('menuitemradio', { name: /Deutsch/ });
		expect(en).toHaveAttribute('aria-checked', 'true');
		expect(de).toHaveAttribute('aria-checked', 'false');
		expect(de).toHaveAttribute('lang', 'de');
		expect(de.querySelector('.flag')?.textContent).toBe('de');
		await user.click(de);
		expect(onselect).toHaveBeenCalledWith('de');
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
		expect(trigger).toHaveFocus();
		await user.click(trigger);
		expect(screen.getByRole('menuitemradio', { name: /Deutsch/ })).toHaveAttribute('aria-checked', 'true');
	});

	test('scrolling a long menu keeps its height (and so its scroll); scrolling the page places it again', async () => {
		// Placing clears max-height first, which puts a scrolled menu back to the top
		const { trigger, user } = setup();
		await user.click(trigger);
		const menu = screen.getByRole('menu');
		menu.style.maxHeight = '123px';
		menu.dispatchEvent(new Event('scroll'));
		expect(menu.style.maxHeight).toBe('123px');
		document.dispatchEvent(new Event('scroll'));
		expect(menu.style.maxHeight).toBe('');
	});
});

describe('Dialog', () => {
	async function open(blocking = false) {
		const user = userEvent.setup();
		render(Harness, { scene: 'dialog', blocking });
		const opener = screen.getByRole('button', { name: 'Open' });
		await user.click(opener);
		return { user, opener, dialog: screen.getByRole('dialog') };
	}

	test('is modal, labelled by its title and described by its message; focus on the first field', async () => {
		const { dialog } = await open();
		expect(dialog).toHaveAttribute('aria-modal', 'true');
		expect(dialog).toHaveAccessibleName('Rename tag');
		expect(dialog).toHaveAccessibleDescription('The new name shows on every device.');
		expect(document.activeElement).toBe(screen.getByLabelText('Name'));
		// hangs off <body>, outside the page's container
		expect(dialog.closest('body > .modal-overlay')).not.toBeNull();
	});

	test('Tab and Shift+Tab stay inside', async () => {
		const { user } = await open();
		const close = screen.getByRole('button', { name: 'Close' });
		const rename = screen.getByRole('button', { name: 'Rename' });
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
		await user.tab();
		expect(document.activeElement).toBe(rename);
		await user.tab();
		expect(document.activeElement).toBe(close);
		await user.tab({ shift: true });
		expect(document.activeElement).toBe(rename);
	});

	test('Escape closes it and focus returns to the opener', async () => {
		const { user, opener } = await open();
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
		expect(openLayers()).toBe(0);
	});

	test('a click on the dimmed page closes it, a click inside does not', async () => {
		const { user, dialog, opener } = await open();
		await user.click(dialog);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		await user.click(dialog.parentElement!);
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	test('a blocking dialog ignores Escape and the dimmed page and has no close button', async () => {
		const { user, dialog } = await open(true);
		expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
		await user.keyboard('{Escape}');
		await user.click(dialog.parentElement!);
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Rename' }));
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});

describe('confirm() and prompt()', () => {
	test('confirm resolves true for the answer and false for Cancel and Escape', async () => {
		const user = userEvent.setup();
		render(DialogHost);
		const yes = confirm({
			title: 'Delete device?',
			message: 'It leaves the list.',
			confirmLabel: 'Delete',
			danger: true
		});
		await tick();
		const answer = screen.getByRole('button', { name: 'Delete' });
		expect(answer).toHaveClass('btn-danger');
		// focus on the safe answer
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
		await user.click(answer);
		await expect(yes).resolves.toBe(true);
		expect(screen.queryByRole('dialog')).toBeNull();

		const no = confirm({ title: 'Delete device?' });
		await tick();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		await expect(no).resolves.toBe(false);

		const esc = confirm({ title: 'Delete device?' });
		await tick();
		await user.keyboard('{Escape}');
		await expect(esc).resolves.toBe(false);
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	test('a second confirm replaces the first, which answers false', async () => {
		render(DialogHost);
		const first = confirm({ title: 'First?' });
		await tick();
		const second = confirm({ title: 'Second?' });
		await tick();
		await expect(first).resolves.toBe(false);
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		expect(screen.getByRole('dialog')).toHaveAccessibleName('Second?');
		await userEvent.keyboard('{Escape}');
		await expect(second).resolves.toBe(false);
	});

	test('prompt resolves the typed value on Enter and null on Cancel', async () => {
		const user = userEvent.setup();
		render(DialogHost);
		const named = prompt({ title: 'New folder', label: 'Folder name', value: 'Ber' });
		await tick();
		const field = screen.getByLabelText('Folder name');
		expect(document.activeElement).toBe(field);
		await user.type(field, 'lin{Enter}');
		await expect(named).resolves.toBe('Berlin');

		const cancelled = prompt({ title: 'New folder', label: 'Folder name' });
		await tick();
		await user.click(screen.getByRole('button', { name: 'Cancel' }));
		await expect(cancelled).resolves.toBeNull();
	});
});

describe('Sheet', () => {
	async function open() {
		const user = userEvent.setup();
		const onanswer = vi.fn();
		const onselect = vi.fn();
		render(Harness, { scene: 'sheet', onanswer, onselect });
		const opener = screen.getByRole('button', { name: 'Edit target' });
		await user.click(opener);
		return { user, onanswer, onselect, opener, sheet: screen.getByRole('dialog') };
	}

	test('is a modal panel with title and subtitle; focus on the first field', async () => {
		const { sheet } = await open();
		expect(sheet).toHaveClass('sheet');
		expect(sheet).toHaveAttribute('aria-modal', 'true');
		expect(sheet).toHaveAccessibleName('Edit target');
		expect(sheet).toHaveAccessibleDescription('A computer without the client.');
		expect(document.activeElement).toBe(screen.getByLabelText('Host'));
	});

	test('the status line says what the last action did', async () => {
		const { user, sheet } = await open();
		const line = within(sheet).getByRole('status');
		expect(line).toHaveTextContent('');
		await user.click(screen.getByRole('button', { name: 'Test connection' }));
		expect(line).toHaveTextContent('Reached 10.0.9.14 on port 3389.');
		expect(line).toHaveClass('is-ok');
	});

	test('a confirm on top closes alone on Escape; the sheet stays and gets focus back', async () => {
		const { user, onanswer, opener } = await open();
		const del = screen.getByRole('button', { name: 'Delete…' });
		await user.click(del);
		expect(screen.getAllByRole('dialog')).toHaveLength(2);
		const top = screen.getByRole('dialog', { name: 'Delete target?' });
		// the dialog hangs after the sheet in <body>
		expect(top.closest('.modal-overlay')?.previousElementSibling).toHaveClass('sheet-layer');
		await user.keyboard('{Escape}');
		expect(onanswer).toHaveBeenCalledWith(false);
		expect(screen.getAllByRole('dialog')).toHaveLength(1);
		expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit target');
		expect(document.activeElement).toBe(del);
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});

	test('Escape in a menu inside the sheet closes only the menu', async () => {
		const { user } = await open();
		const more = screen.getByRole('button', { name: 'More' });
		await user.click(more);
		expect(screen.getByRole('menu')).toBeInTheDocument();
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('menu')).toBeNull();
		expect(screen.getByRole('dialog')).toBeInTheDocument();
		expect(document.activeElement).toBe(more);
	});

	test('another sheet replaces the open one; closing it returns focus to the first opener', async () => {
		const user = userEvent.setup();
		render(Harness, { scene: 'sheets' });
		const opener = screen.getByRole('button', { name: 'Open first' });
		await user.click(opener);
		await user.click(screen.getByRole('button', { name: 'Open second' }));
		const sheets = screen.getAllByRole('dialog');
		expect(sheets).toHaveLength(1);
		expect(sheets[0]).toHaveAccessibleName('Second');
		expect(sheets[0]).toHaveClass('is-wide');
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(opener);
	});
});

describe('toasts', () => {
	test('messages are text, in a polite region; errors in an assertive one', () => {
		render(ToastHost);
		toast.success('<img src=x onerror=alert(1)>');
		toast.error('Could not save.');
		flushSync();
		expect(document.querySelector('img')).toBeNull();
		const polite = screen.getByRole('status');
		expect(polite).toHaveAttribute('aria-live', 'polite');
		expect(within(polite).getByText('<img src=x onerror=alert(1)>').closest('.toast')).toHaveClass('success');
		const alert = screen.getByRole('alert');
		expect(within(alert).getByText('Could not save.')).toBeInTheDocument();
	});

	test('go away by themselves, errors later; the close button closes one', async () => {
		vi.useFakeTimers();
		render(ToastHost);
		toast.info('Saved.');
		toast.error('Failed.');
		flushSync();
		vi.advanceTimersByTime(5000);
		flushSync();
		expect(screen.queryByText('Saved.')).toBeNull();
		expect(screen.getByText('Failed.')).toBeInTheDocument();
		vi.advanceTimersByTime(3000);
		flushSync();
		expect(screen.queryByText('Failed.')).toBeNull();

		toast.show({ message: 'Stays.', duration: 0 });
		flushSync();
		vi.advanceTimersByTime(60000);
		flushSync();
		screen.getByRole('button', { name: 'Close' }).click();
		flushSync();
		expect(screen.queryByText('Stays.')).toBeNull();
	});

	test('at most three on screen, the same message is not repeated', () => {
		render(ToastHost);
		for (const m of ['One', 'Two', 'Three', 'Four', 'Four']) toast.info(m);
		flushSync();
		expect(document.querySelectorAll('.toast')).toHaveLength(3);
		expect(screen.queryByText('One')).toBeNull();
		expect(screen.getAllByText('Four')).toHaveLength(1);
	});
});

describe('Tabs', () => {
	const tabs = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'hardware', label: 'Hardware' },
		{ id: 'logs', label: 'Logs', disabled: true },
		{ id: 'metrics', label: 'Metrics' }
	];
	const panel = createRawSnippet((id: () => string) => ({ render: () => `<p>Panel ${id()}</p>` }));

	test('arrow keys, Home and End move the selection with one tab stop', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(Tabs, { tabs, label: 'Device', onchange, children: panel });
		const tab = (name: string) => screen.getByRole('tab', { name });
		expect(screen.getByRole('tablist')).toHaveAccessibleName('Device');
		expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
		expect(tab('Overview')).toHaveAttribute('tabindex', '0');
		expect(tab('Hardware')).toHaveAttribute('tabindex', '-1');
		tab('Overview').focus();
		await user.keyboard('{ArrowRight}');
		expect(tab('Hardware')).toHaveAttribute('aria-selected', 'true');
		expect(tab('Overview')).toHaveAttribute('aria-selected', 'false');
		expect(document.activeElement).toBe(tab('Hardware'));
		expect(onchange).toHaveBeenLastCalledWith('hardware');
		await user.keyboard('{ArrowRight}');
		expect(document.activeElement).toBe(tab('Metrics')); // Logs is disabled
		await user.keyboard('{ArrowRight}');
		expect(document.activeElement).toBe(tab('Overview'));
		await user.keyboard('{End}');
		expect(tab('Metrics')).toHaveAttribute('aria-selected', 'true');
		await user.keyboard('{Home}');
		expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
		const tabpanel = screen.getByRole('tabpanel');
		expect(tab('Overview')).toHaveAttribute('aria-controls', tabpanel.id);
		expect(tabpanel).toHaveAccessibleName('Overview');
		expect(tabpanel).toHaveTextContent('Panel overview');
	});
});

describe('Pagination', () => {
	test('marks the current page, builds the summary and moves pages', async () => {
		const user = userEvent.setup();
		const onchange = vi.fn();
		render(Pagination, { page: 1, total: 312, pageSize: 25, onchange });
		expect(screen.getByText('Showing 1–25 of 312')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
		expect(screen.getByRole('button', { name: 'Page 13' })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: 'Page 5' })).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Next page' }));
		expect(onchange).toHaveBeenCalledWith(2);
		expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByText('Showing 26–50 of 312')).toBeInTheDocument();
	});
});

describe('Disclosure, Notice, States', () => {
	test('a disclosure starts closed with its heading in the summary', async () => {
		render(Disclosure, { title: 'Advanced', meta: '3 rules', children: text('Inside') });
		const details = document.querySelector('details')!;
		expect(details.open).toBe(false);
		expect(screen.getByRole('heading', { level: 2, name: 'Advanced' }).closest('summary')).not.toBeNull();
		await userEvent.click(screen.getByText('Advanced'));
		expect(details.open).toBe(true);
	});

	test('a disclosure takes an id, so a link can jump to it', () => {
		render(Disclosure, { id: 'ldap-attrs', title: 'Attributes', children: text('Inside') });
		expect(document.querySelector('details')).toHaveAttribute('id', 'ldap-attrs');
	});

	test('ontoggle gets the state after the toggle (a loader runs on opening)', async () => {
		const ontoggle = vi.fn();
		render(Disclosure, { title: 'For scripts', ontoggle, children: text('Inside') });
		await userEvent.click(screen.getByText('For scripts'));
		await vi.waitFor(() => expect(ontoggle).toHaveBeenLastCalledWith(true));
		await userEvent.click(screen.getByText('For scripts'));
		await vi.waitFor(() => expect(ontoggle).toHaveBeenLastCalledWith(false));
	});

	test('a notice shows its tone as a class and its message as text', () => {
		render(Notice, { tone: 'danger', message: '<b>x</b>' });
		expect(screen.getByText('<b>x</b>').closest('.notice')).toHaveClass('is-danger');
	});

	test('an error state has a retry button; a table state is a spanning cell', async () => {
		const onretry = vi.fn();
		render(States, { kind: 'error', message: 'Could not load devices.', onretry });
		expect(screen.getByRole('alert')).toHaveTextContent('Could not load devices.');
		await userEvent.click(screen.getByRole('button', { name: /retry/i }));
		expect(onretry).toHaveBeenCalled();
		cleanup();
		const table = document.createElement('table');
		const tbody = table.appendChild(document.createElement('tbody'));
		document.body.appendChild(table);
		render(States, { target: tbody, props: { kind: 'empty', message: 'No devices.', colspan: 4 } });
		const cell = screen.getByRole('cell');
		expect(cell).toHaveClass('state-cell');
		expect(cell).toHaveAttribute('colspan', '4');
		table.remove();
	});
});
