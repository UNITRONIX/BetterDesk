import { render, screen, cleanup } from '@testing-library/svelte';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import { session, type User } from '../../../src/lib/state/session.svelte.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));

beforeEach(() =>
	setStrings('de', 'ltr', {
		errors: {
			forbidden_title: 'Zugriff verweigert',
			forbidden_message: 'Sie haben keine Berechtigung für diese Seite.',
			// The name comes after the role in this sentence
			signed_in_as: 'Rolle {role}, angemeldet als {user}.',
			go_home: 'Zur Übersicht'
		},
		users: { role_viewer: 'Betrachter' }
	})
);
afterEach(() => {
	cleanup();
	session.user = null;
});

async function show(user: Partial<User>) {
	session.user = { id: 3, username: 'demo_viewer', role: 'viewer', ...user } as User;
	const NoAccess = (await import('../../../src/lib/shell/NoAccess.svelte')).default;
	render(NoAccess);
}

test('says the page is refused, who is signed in with which role, and links to the overview', async () => {
	await show({});
	expect(screen.getByRole('heading', { level: 1, name: 'Zugriff verweigert' })).toBeInTheDocument();
	expect(screen.getByText('Sie haben keine Berechtigung für diese Seite.')).toBeInTheDocument();
	const line = screen.getByText(
		(_, el) => el?.tagName === 'P' && /^Rolle Betrachter, angemeldet als/.test(el.textContent ?? '')
	);
	expect(line.textContent).toBe('Rolle Betrachter, angemeldet als demo_viewer.');
	expect(line.querySelector('strong')?.textContent).toBe('demo_viewer');
	// The overview
	expect(screen.getByRole('link', { name: 'Zur Übersicht' })).toHaveAttribute('href', '/app');
});

test('a role without a translated name is shown in words', async () => {
	await show({ role: 'guest_issuer' });
	expect(screen.getByText(/Rolle guest issuer, angemeldet als/)).toBeInTheDocument();
});

test('a user name is text, never markup', async () => {
	await show({ username: '<img src=x onerror=alert(1)>' });
	expect(document.querySelector('img')).toBeNull();
	expect(screen.getByText('<img src=x onerror=alert(1)>').tagName).toBe('STRONG');
});
