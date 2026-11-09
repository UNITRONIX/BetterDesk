import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet, flushSync } from 'svelte';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api/client.ts';
import { createForm, FormError } from '../../../src/lib/ui/form.svelte.ts';
import Field from '../../../src/lib/ui/Field.svelte';
import Input from '../../../src/lib/ui/Input.svelte';
import Select from '../../../src/lib/ui/Select.svelte';
import Checkbox from '../../../src/lib/ui/Checkbox.svelte';
import Radio from '../../../src/lib/ui/Radio.svelte';
import Textarea from '../../../src/lib/ui/Textarea.svelte';
import FilePicker from '../../../src/lib/ui/FilePicker.svelte';
import Toolbar from '../../../src/lib/ui/Toolbar.svelte';
import Switch from '../../../src/lib/ui/Switch.svelte';
import ChoiceList from '../../../src/lib/ui/ChoiceList.svelte';
import SegmentedFilter from '../../../src/lib/ui/SegmentedFilter.svelte';
import SearchField from '../../../src/lib/ui/SearchField.svelte';
import ShowWhen, { showWhenControl } from '../../../src/lib/ui/ShowWhen.svelte';
import SaveBar from '../../../src/lib/ui/SaveBar.svelte';
import FormStatus from '../../../src/lib/ui/FormStatus.svelte';
import FormSection from '../../../src/lib/ui/FormSection.svelte';
import DangerZone from '../../../src/lib/ui/DangerZone.svelte';
import ColorField from '../../../src/lib/ui/ColorField.svelte';
import CountLine from '../../../src/lib/ui/CountLine.svelte';
import FormFixture from './fixtures/FormFixture.svelte';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

/** A save that waits until the test lets it finish */
function deferred<T = void>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('Field', () => {
	test('the label names the control, the hint and effect describe it', () => {
		render(FormFixture, { submit: vi.fn() });
		const name = screen.getByLabelText('Name');
		expect(name).toHaveClass('form-input');
		expect(name).toHaveAccessibleDescription('How it appears in the device list.');
		expect(name).not.toHaveAttribute('aria-invalid');
		const port = screen.getByLabelText('Port');
		expect(port).toHaveClass('is-short');
		expect(port).toHaveAccessibleDescription('After a restart');
		expect(screen.getByText('After a restart')).toHaveClass('field-effect', 'is-restart');
	});

	test('an error sets aria-invalid and the message describes the field', () => {
		const { component } = render(FormFixture, { submit: vi.fn() });
		component.form.setError('name', 'Use at most 64 characters.');
		flushSync();
		const name = screen.getByLabelText('Name');
		expect(name).toHaveAttribute('aria-invalid', 'true');
		const ids = name.getAttribute('aria-describedby')!.split(' ');
		const message = screen.getByText('Use at most 64 characters.');
		expect(ids).toContain(message.id);
		expect(name).toHaveAccessibleDescription('Use at most 64 characters. How it appears in the device list.');
	});

	test('the snippet gets the id the label points at', () => {
		const children = createRawSnippet((f: () => { id: string; describedby: string | undefined }) => ({
			render: () => `<input id="${f().id}" aria-describedby="${f().describedby}">`
		}));
		render(Field, { label: 'Host', hint: 'A name or an address.', id: 'host', children });
		const input = screen.getByLabelText('Host');
		expect(input.id).toBe('host');
		expect(input).toHaveAccessibleDescription('A name or an address.');
	});
});

describe('controls', () => {
	test('Select binds typed values and passes the field wiring', async () => {
		const options = [
			{ value: 10, label: '10' },
			{ value: 20, label: '20' },
			{ value: 50, label: '50', disabled: true }
		];
		render(Select, {
			options,
			value: 20,
			id: 's',
			invalid: true,
			describedby: 'x',
			'aria-label': 'Page size'
		});
		const select = screen.getByRole('combobox', { name: 'Page size' });
		expect(select).toHaveValue('20');
		expect(select).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByRole('option', { name: '50' })).toBeDisabled();
	});

	test('Checkbox: label on one line, hint as description, Space toggles', async () => {
		const onchange = vi.fn();
		render(Checkbox, { label: 'Require two-factor sign-in', hint: 'Everyone sets up an app.', onchange });
		const box = screen.getByRole('checkbox', { name: 'Require two-factor sign-in' });
		expect(box).toHaveAccessibleDescription('Everyone sets up an app.');
		expect(box.closest('label')).toHaveClass('check-field');
		box.focus();
		await userEvent.keyboard(' ');
		expect(box).toBeChecked();
		expect(onchange).toHaveBeenCalledTimes(1);
	});

	test('Switch is a plain checkbox with the toggle-switch class and no switch role', () => {
		render(Switch, { label: 'Allow file transfer', checked: true });
		const box = screen.getByRole('checkbox', { name: 'Allow file transfer' });
		expect(box).toBeChecked();
		expect(box).toHaveClass('toggle-switch');
		expect(screen.queryByRole('switch')).toBeNull();
	});

	test('SearchField is a named search box with a decorative icon', () => {
		render(SearchField, { label: 'Search devices', small: true });
		const box = screen.getByRole('searchbox', { name: 'Search devices' });
		expect(box).toHaveAttribute('type', 'search');
		expect(box).toHaveClass('is-small');
		expect(box.parentElement?.querySelector('.material-icons')).toHaveAttribute('aria-hidden', 'true');
	});

	test('ColorField: the swatch and the hex field edit one value', async () => {
		render(ColorField, { value: '#00677a', label: 'Accent colour', hexLabel: 'Accent colour as hex' });
		const hex = screen.getByRole('textbox', { name: 'Accent colour as hex' });
		const swatch = screen.getByLabelText('Accent colour') as HTMLInputElement;
		expect(swatch.value).toBe('#00677a');
		await userEvent.clear(hex);
		await userEvent.type(hex, '#abc');
		expect(swatch.value).toBe('#aabbcc');
	});
});

describe('ShowWhen', () => {
	test('stays in the DOM, hidden, until the choice is on; the controller says so', async () => {
		render(FormFixture, { submit: vi.fn() });
		const proxy = screen.getByRole('checkbox', { name: 'Use a proxy' });
		const block = document.getElementById('proxy-fields')!;
		expect(proxy).toHaveAttribute('aria-controls', 'proxy-fields');
		expect(proxy).toHaveAttribute('aria-expanded', 'false');
		expect(block).toHaveAttribute('hidden');
		expect(screen.getByLabelText('Proxy host')).not.toBeVisible();

		await userEvent.click(proxy);
		expect(proxy).toHaveAttribute('aria-expanded', 'true');
		expect(block).not.toHaveAttribute('hidden');
		expect(screen.getByLabelText('Proxy host')).toBeVisible();
	});

	test('the helper leaves out aria-expanded for selects and radios', () => {
		expect(showWhenControl('x', true)).toEqual({ 'aria-controls': 'x', 'aria-expanded': true });
		expect(showWhenControl('x', true, { expanded: false })).toEqual({ 'aria-controls': 'x' });
	});

	test('renders its content with the id', () => {
		render(ShowWhen, { id: 'b', when: true, children: text('Inside') });
		expect(screen.getByText('Inside').closest('#b')).not.toHaveAttribute('hidden');
	});
});

describe('SegmentedFilter', () => {
	const options = [
		{ value: 'all', label: 'All (6)' },
		{ value: 'online', label: 'Online (3)' },
		{ value: 'offline', label: 'Offline (3)' }
	];

	test('a named group of pressed buttons', () => {
		render(SegmentedFilter, { label: 'Status', options, value: 'all' });
		const group = screen.getByRole('group', { name: 'Status' });
		const buttons = within(group).getAllByRole('button');
		expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
		expect(within(group).getByRole('button', { name: 'Online (3)' })).toHaveAttribute('type', 'button');
	});

	test('Tab reaches each button; Space and Enter pick one', async () => {
		const onchange = vi.fn();
		render(SegmentedFilter, { label: 'Status', options, value: 'all', onchange });
		const [all, online, offline] = screen.getAllByRole('button');
		await userEvent.tab();
		expect(all).toHaveFocus();
		await userEvent.tab();
		expect(online).toHaveFocus();
		await userEvent.keyboard(' ');
		expect(online).toHaveAttribute('aria-pressed', 'true');
		expect(all).toHaveAttribute('aria-pressed', 'false');
		await userEvent.tab();
		expect(offline).toHaveFocus();
		await userEvent.keyboard('{Enter}');
		expect(offline).toHaveAttribute('aria-pressed', 'true');
		expect(online).toHaveAttribute('aria-pressed', 'false');
		expect(onchange.mock.calls).toEqual([['online'], ['offline']]);
	});
});

describe('ChoiceList', () => {
	const choices = [
		{ value: 'approval', title: 'Approval', description: 'New devices wait until someone approves them.' },
		{ value: 'open', title: 'Open', description: 'Any device can join without approval.' }
	];

	test('the radiogroup is a wrapper around the list; each radio has a name and a description', () => {
		render(ChoiceList, { label: 'Enrollment mode', choices, value: 'approval' });
		const group = screen.getByRole('radiogroup', { name: 'Enrollment mode' });
		expect(group.tagName).toBe('DIV');
		expect(within(group).getByRole('list')).toHaveClass('choice-list');
		const approval = within(group).getByRole('radio', { name: 'Approval' });
		expect(approval).toBeChecked();
		expect(approval).toHaveAccessibleDescription('New devices wait until someone approves them.');
		expect(within(group).getByRole('radio', { name: 'Open' })).not.toBeChecked();
	});

	test('arrow keys move the selection and the bound value', async () => {
		const { component } = render(FormFixture, { submit: vi.fn() });
		screen.getByRole('radio', { name: 'Approval' }).focus();
		await userEvent.keyboard('{ArrowDown}');
		const open = screen.getByRole('radio', { name: 'Open' });
		expect(open).toBeChecked();
		expect(open).toHaveFocus();
		expect(component.form.values.mode).toBe('open');
		expect(component.form.dirty).toBe(true);
	});

	test('onchange reports the picked value', async () => {
		const onchange = vi.fn();
		render(ChoiceList, { label: 'Enrollment mode', choices, value: 'approval', onchange });
		await userEvent.click(screen.getByRole('radio', { name: 'Open' }));
		expect(onchange).toHaveBeenLastCalledWith('open', true);
	});

	test('checkboxes keep a list of selected values', async () => {
		const onchange = vi.fn();
		render(ChoiceList, { type: 'checkbox', label: 'Notify', choices, selected: ['open'], onchange });
		expect(screen.getByRole('group', { name: 'Notify' })).toBeInTheDocument();
		await userEvent.click(screen.getByRole('checkbox', { name: 'Approval' }));
		expect(screen.getByRole('checkbox', { name: 'Approval' })).toBeChecked();
		expect(screen.getByRole('checkbox', { name: 'Open' })).toBeChecked();
	});
});

describe('SaveBar', () => {
	test('with one save bar on the page, its button is always primary', async () => {
		const { rerender } = render(SaveBar, { label: 'Save', dirty: false });
		const button = screen.getByRole('button', { name: 'Save' });
		expect(button).toHaveClass('btn-primary');
		await rerender({ label: 'Save', dirty: true });
		expect(button).toHaveClass('btn-primary');
	});

	test('with several, a save button is primary only while there are unsaved changes', async () => {
		render(SaveBar, { label: 'Save other settings', dirty: false });
		const { rerender } = render(SaveBar, { label: 'Save', dirty: false });
		const button = screen.getByRole('button', { name: 'Save' });
		expect(button).toHaveAttribute('type', 'submit');
		expect(button).not.toHaveClass('btn-primary');
		expect(button.closest('.save-bar')).not.toHaveClass('is-dirty');

		await rerender({ label: 'Save', dirty: true });
		expect(button).toHaveClass('btn-primary');
		expect(button.closest('.save-bar')).toHaveClass('is-dirty');
		expect(screen.getByText('Unsaved changes')).toHaveAttribute('aria-live', 'polite');
		expect(screen.getByRole('button', { name: 'Save other settings' })).not.toHaveClass('btn-primary');
	});

	test('a failed save keeps the button primary and shows why', async () => {
		render(SaveBar, { label: 'Save other settings', dirty: false });
		render(SaveBar, {
			label: 'Save',
			dirty: true,
			status: { state: 'error', message: 'The server is offline.' }
		});
		expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('btn-primary');
		expect(screen.getByText('The server is offline.')).toHaveClass('save-status', 'is-error');
	});

	test('editing a form makes its save primary; saving makes it plain again', async () => {
		render(SaveBar, { label: 'Save other settings', dirty: false });
		render(FormFixture, { submit: vi.fn() });
		const save = screen.getByRole('button', { name: 'Save' });
		expect(save).not.toHaveClass('btn-primary');
		await userEvent.type(screen.getByLabelText('Name'), ' 2');
		expect(save).toHaveClass('btn-primary');
		await userEvent.click(save);
		expect(save).not.toHaveClass('btn-primary');
		expect(screen.getByText('Saved')).toHaveClass('is-ok');
	});
});

describe('FormStatus, FormSection, DangerZone, CountLine', () => {
	test('FormStatus is a live status with a tone', () => {
		render(FormStatus, { message: 'Reached 10.0.9.14.', tone: 'ok' });
		expect(screen.getByRole('status')).toHaveTextContent('Reached 10.0.9.14.');
		expect(screen.getByRole('status')).toHaveClass('form-status', 'is-ok');
	});

	test('FormSection is a region named by its h3', () => {
		render(FormSection, { title: 'Connection', children: text('Fields') });
		const section = screen.getByRole('region', { name: 'Connection' });
		expect(within(section).getByRole('heading', { level: 3, name: 'Connection' })).toHaveClass(
			'form-section-title'
		);
	});

	test('DangerZone rows: title, consequence describing a quiet danger button', async () => {
		const onclick = vi.fn();
		render(DangerZone, {
			title: 'Reset',
			rows: [
				{
					title: 'Regenerate server key',
					consequence: 'Every client stops connecting until it gets the new key.',
					action: 'Regenerate…',
					onclick
				}
			]
		});
		expect(screen.getByRole('region', { name: 'Reset' })).toHaveClass('danger-zone');
		const button = screen.getByRole('button', { name: 'Regenerate…' });
		expect(button).toHaveClass('btn-danger-quiet');
		expect(button).toHaveAccessibleDescription('Every client stops connecting until it gets the new key.');
		await userEvent.click(button);
		expect(onclick).toHaveBeenCalledTimes(1);
	});

	test('CountLine puts the numbers in strong and keeps the words as text', () => {
		render(CountLine, { text: '{count} devices, {online} online <b>', values: { count: 6, online: 3 } });
		const line = document.querySelector('.count-line')!;
		expect(line).toHaveTextContent('6 devices, 3 online <b>');
		expect([...line.querySelectorAll('strong')].map((s) => s.textContent)).toEqual(['6', '3']);
		expect(line.querySelector('b')).toBeNull();
	});
});

describe('form helper', () => {
	const initial = { name: 'a', port: 1, tags: ['x'] };

	test('dirty follows the values, also back to the start', () => {
		const form = createForm({ initial, submit: vi.fn() });
		expect(form.dirty).toBe(false);
		form.values.name = 'b';
		expect(form.dirty).toBe(true);
		form.values.name = 'a';
		expect(form.dirty).toBe(false);
		form.values.tags.push('y');
		expect(form.dirty).toBe(true);
		form.reset();
		expect(form.dirty).toBe(false);
		expect(form.values.tags).toEqual(['x']);
	});

	test('validation blocks the save and marks the fields', async () => {
		const submit = vi.fn();
		const form = createForm({
			initial,
			validate: (v) => ({ port: v.port > 65535 ? 'Use a port from 1 to 65535.' : undefined }),
			submit
		});
		form.values.port = 70000;
		expect(await form.submit()).toBe(false);
		expect(submit).not.toHaveBeenCalled();
		expect(form.errors.port).toBe('Use a port from 1 to 65535.');
		// The message goes away once the value changes
		form.values.port = 70001;
		expect(form.errors.port).toBeUndefined();
		form.values.port = 21116;
		expect(await form.submit()).toBe(true);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	test('a second submit while saving sends nothing', async () => {
		const d = deferred();
		const submit = vi.fn(() => d.promise);
		const form = createForm({ initial, submit });
		form.values.name = 'b';
		const first = form.submit();
		const second = form.submit();
		expect(form.busy).toBe(true);
		expect(form.status.state).toBe('saving');
		d.resolve();
		expect(await first).toBe(true);
		expect(await second).toBe(false);
		expect(submit).toHaveBeenCalledTimes(1);
	});

	test('after a save the saved values are the new start', async () => {
		const submit = vi.fn((v: typeof initial) => ({ ...v, name: v.name.trim() }));
		const form = createForm({ initial, submit });
		form.values.name = ' b ';
		await form.submit();
		expect(submit).toHaveBeenCalledWith({ name: ' b ', port: 1, tags: ['x'] });
		expect(form.values.name).toBe('b');
		expect(form.dirty).toBe(false);
		expect(form.status).toEqual({ state: 'saved', message: 'Saved' });
		form.values.name = 'a';
		expect(form.dirty).toBe(true);
	});

	test('edits made while saving stay unsaved', async () => {
		const d = deferred();
		const form = createForm({ initial, submit: () => d.promise });
		form.values.name = 'b';
		const done = form.submit();
		form.values.name = 'c';
		d.resolve();
		await done;
		expect(form.values.name).toBe('c');
		expect(form.dirty).toBe(true);
	});

	test('a server error that names a field lands on that field', async () => {
		const form = createForm({
			initial,
			submit: () => {
				throw new FormError('That name is taken.', 'name');
			}
		});
		form.values.name = 'b';
		expect(await form.submit()).toBe(false);
		expect(form.errors.name).toBe('That name is taken.');
		expect(form.status.state).toBe('error');
		expect(form.dirty).toBe(true);
	});

	test('an ApiError with a field in its body lands on that field, others go to the status line', async () => {
		let err: unknown = new ApiError('Use a port from 1 to 65535.', 400, { data: { field: 'port' } });
		const form = createForm({
			initial,
			submit: () => {
				throw err;
			}
		});
		await form.submit();
		expect(form.errors.port).toBe('Use a port from 1 to 65535.');
		err = new ApiError('The server is offline.', 0);
		await form.submit();
		expect(form.status).toEqual({ state: 'error', message: 'The server is offline.' });
		expect(form.errors.port).toBeUndefined();
		err = new TypeError('x is undefined');
		await form.submit();
		expect(form.status.message).toBe('Could not save. Your changes are still here.');
	});
});

describe('form in the page', () => {
	test('Enter in a field saves once, also when pressed twice', async () => {
		const d = deferred();
		const submit = vi.fn(() => d.promise);
		render(FormFixture, { submit });
		const name = screen.getByLabelText('Name');
		await userEvent.type(name, ' 2{Enter}{Enter}');
		expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true');
		d.resolve();
		await vi.waitFor(() => expect(screen.getByText('Saved')).toBeInTheDocument());
		expect(submit).toHaveBeenCalledTimes(1);
		expect(submit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Reception PC 2' }));
	});

	test('a refused field is marked and gets focus', async () => {
		render(FormFixture, {
			submit: () => {
				throw new FormError('That name is taken.', 'name');
			}
		});
		await userEvent.click(screen.getByRole('button', { name: 'Save' }));
		const name = screen.getByLabelText('Name');
		await vi.waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
		expect(name).toHaveFocus();
		expect(name).toHaveAccessibleDescription(/That name is taken\./);
		expect(screen.getByText('Could not save. Your changes are still here.')).toHaveClass('is-error');
	});
});

describe('Input', () => {
	test('maps the field wiring to ARIA', () => {
		render(Input, { 'aria-label': 'Host', invalid: true, describedby: 'h', width: 'host' });
		const input = screen.getByRole('textbox', { name: 'Host' });
		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input).toHaveAttribute('aria-describedby', 'h');
		expect(input).toHaveClass('form-input', 'is-host');
	});
});

describe('Radio, Textarea, FilePicker, Toolbar', () => {
	test('Radio: checked from the group, hint as description', () => {
		render(Radio, { label: 'Open', value: 'open', group: 'open', name: 'm', hint: 'Any device can join.' });
		const radio = screen.getByRole('radio', { name: 'Open' });
		expect(radio).toBeChecked();
		expect(radio).toHaveAccessibleDescription('Any device can join.');
	});

	test('Textarea and FilePicker take the field wiring', () => {
		render(Textarea, { 'aria-label': 'Note', invalid: true, describedby: 'n' });
		expect(screen.getByRole('textbox', { name: 'Note' })).toHaveAttribute('aria-invalid', 'true');
		const { container } = render(FilePicker, { id: 'logo', describedby: 'h', accept: 'image/png' });
		const file = container.querySelector('input')!;
		expect(file).toHaveAttribute('type', 'file');
		expect(file).toHaveAttribute('aria-describedby', 'h');
	});

	test('Toolbar puts the search first and the end actions last', () => {
		const { container } = render(Toolbar, {
			search: text('Search'),
			children: text('Filters'),
			end: text('Export')
		});
		const parts = [...container.querySelector('.toolbar')!.children];
		expect(parts[0]).toHaveClass('toolbar-search');
		expect(parts[0]).toHaveTextContent('Search');
		expect(parts[1]).toHaveTextContent('Filters');
		expect(parts[2]).toHaveClass('toolbar-end');
		expect(parts[2]).toHaveTextContent('Export');
	});
});
