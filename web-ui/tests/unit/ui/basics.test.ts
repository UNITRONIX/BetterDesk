import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { createRawSnippet } from 'svelte';
import { describe, expect, test, vi } from 'vitest';
import Button from '../../../src/lib/ui/Button.svelte';
import IconButton from '../../../src/lib/ui/IconButton.svelte';
import Status from '../../../src/lib/ui/Status.svelte';
import { openPopup, closePopups } from '../../../src/lib/ui/popups.svelte.ts';

const text = (s: string) => createRawSnippet(() => ({ render: () => `<span>${s}</span>` }));

describe('Button', () => {
	test('variants map to the design system classes and default to type=button', () => {
		render(Button, { variant: 'primary', size: 'sm', icon: 'add', children: text('Add') });
		const b = screen.getByRole('button', { name: /add/i });
		expect(b).toHaveClass('btn', 'btn-primary', 'btn-sm');
		expect(b).toHaveAttribute('type', 'button');
		expect(b.querySelector('.material-icons')?.textContent).toBe('add');
	});
	test('busy blocks clicks (double-submit guard)', async () => {
		const onclick = vi.fn();
		render(Button, { busy: true, onclick, children: text('Save') });
		await userEvent.click(screen.getByRole('button'));
		expect(onclick).not.toHaveBeenCalled();
		expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
	});
	test('href renders a link', () => {
		render(Button, { href: '/devices', children: text('Devices') });
		expect(screen.getByRole('link')).toHaveAttribute('href', '/devices');
	});
});

describe('IconButton', () => {
	test('has an accessible name and a decorative glyph', () => {
		render(IconButton, { icon: 'close', label: 'Close' });
		const b = screen.getByRole('button', { name: 'Close' });
		expect(b.querySelector('.material-icons')).toHaveAttribute('aria-hidden', 'true');
	});
});

describe('Status', () => {
	test('maps words to tones and renders the label as text', () => {
		render(Status, { tone: 'banned', label: '<img src=x onerror=alert(1)>' });
		const s = screen.getByText('<img src=x onerror=alert(1)>');
		expect(s).toHaveClass('status', 'is-danger');
		expect(document.querySelector('img')).toBeNull();
	});
});

describe('one popup at a time', () => {
	test('opening a popup closes the previous one', () => {
		const a = vi.fn();
		const b = vi.fn();
		openPopup(a);
		const releaseB = openPopup(b);
		expect(a).toHaveBeenCalledTimes(1);
		expect(b).not.toHaveBeenCalled();
		releaseB();
		closePopups();
		expect(b).not.toHaveBeenCalled();
	});
});
