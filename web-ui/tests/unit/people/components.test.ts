import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, test } from 'vitest';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import DetailsText from '../../../src/lib/people/DetailsText.svelte';
import PasswordField from '../../../src/lib/people/PasswordField.svelte';

beforeAll(() => {
	setStrings('en', 'ltr', {
		users: {
			strength_line: 'Strength: {strength}.',
			strength_weak: 'weak',
			strength_medium: 'medium',
			strength_strong: 'strong',
			password_weak_hint: 'Use a longer password.',
			show_password: 'Show password',
			role_operator: 'Remote operator'
		},
		actions: { show_value: 'Show' },
		errors: {
			forbidden_title: "You don't have access to this page",
			forbidden_message: 'Your role does not include this page.',
			signed_in_as: 'You are signed in as {user} with the role {role}.',
			go_home: 'Go to the overview'
		}
	} as never);
});

describe('PasswordField', () => {
	test('says how strong the password is while it is typed, and nothing when empty', async () => {
		render(PasswordField, { label: 'Password', hint: 'At least 8 characters', value: '' });
		const input = screen.getByLabelText('Password');
		const line = document.querySelector('.strength') as HTMLElement;
		expect(line.textContent).toBe('');
		await userEvent.type(input, 'abcdefgh');
		expect(line.textContent).toBe('Strength: weak. Use a longer password.');
		await userEvent.clear(input);
		await userEvent.type(input, 'Correct-Horse-9');
		expect(line.textContent).toBe('Strength: strong.');
		// The field is described by the hint and by the strength line
		expect(input.getAttribute('aria-describedby')).toContain(line.id);
	});

	test('Show reveals the password and says so with aria-pressed', async () => {
		render(PasswordField, { label: 'New password', hint: 'Leave empty', value: 'secret' });
		const input = screen.getByLabelText('New password') as HTMLInputElement;
		const show = screen.getByRole('button', { name: 'Show password' });
		expect(input.type).toBe('password');
		expect(show).toHaveAttribute('aria-pressed', 'false');
		await userEvent.click(show);
		expect(input.type).toBe('text');
		expect(show).toHaveAttribute('aria-pressed', 'true');
	});
});

describe('DetailsText', () => {
	test('short details are plain text, long ones are cut after two lines', () => {
		const { container, unmount } = render(DetailsText, { text: 'Changed SMTP host' });
		expect(container.textContent).toBe('Changed SMTP host');
		expect(container.querySelector('.is-clamped')).toBeNull();
		unmount();
		const long = 'User logged in; ua=' + 'Mozilla/5.0 '.repeat(20);
		const r = render(DetailsText, { text: long });
		expect(r.container.querySelector('.is-clamped')?.textContent).toBe(long);
	});

	test('no details: the empty mark', () => {
		const { container } = render(DetailsText, { text: '' });
		expect(container.querySelector('.value-empty')).not.toBeNull();
	});
});
