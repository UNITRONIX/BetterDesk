import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { session, type User } from '../../../src/lib/state/session.svelte.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));

afterEach(() => {
	cleanup();
	session.user = null;
});

test('Change password and Two-factor sign-in open their own parts of the Sign-in tab', async () => {
	session.user = { id: 7, username: 'demo_ui_admin', role: 'admin' } as User;
	const AccountMenu = (await import('../../../src/lib/shell/AccountMenu.svelte')).default;
	render(AccountMenu);
	await userEvent.click(screen.getByRole('button', { name: /demo_ui_admin/ }));
	// The settings host jumps to #<id> and reveals it; both ids are on the Sign-in tab
	expect(screen.getByRole('menuitem', { name: 'auth.change_password' }).getAttribute('href')).toMatch(
		/\/settings\?tab=auth#account-password$/
	);
	expect(screen.getByRole('menuitem', { name: 'nav.account_2fa' }).getAttribute('href')).toMatch(
		/\/settings\?tab=auth#auth-panel-totp$/
	);
});
