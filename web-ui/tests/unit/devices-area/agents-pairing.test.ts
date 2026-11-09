/**
 * Support agents page, step 3: agents pair with a one-time code now. The
 * step is plain text (agents.step3 has no {page} placeholder any more), and
 * "Pair with code" opens the overview's pairing dialog, for the people who
 * may create codes (enrollment.approve).
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), pushState: vi.fn(), replaceState: vi.fn() }));
vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/app/agents') } }));

import Page from '../../../src/routes/(console)/agents/+page.svelte';
import { session } from '../../../src/lib/state/session.svelte.ts';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';

const STEP3 =
	'Open Pair with code, generate a one-time code, and enter it in the agent together with this server’s address.';

beforeEach(() => {
	setStrings('en', 'ltr', {
		agents: { step3: STEP3, pair_activate: 'Pair with code' }
	} as unknown as Parameters<typeof setStrings>[2]);
	vi.stubGlobal('fetch', async (input: string) => {
		const url = new URL(input, location.origin);
		const data = url.pathname.includes('releases') ? { success: true, releases: [] } : { success: true };
		return {
			ok: true,
			status: 200,
			redirected: false,
			url: url.href,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => data,
			text: async () => JSON.stringify(data)
		} as unknown as Response;
	});
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	setStrings('en', 'ltr', {});
});

function as(permissions: string[]) {
	session.isSuperAdmin = false;
	session.permissions = permissions;
	session.user = { id: 1, username: 'demo', role: 'admin', preferredLanguage: null, avatarVersion: null };
}

describe('pairing on the support agents page', () => {
	test('step 3 is the sentence as written, without a link or a leftover placeholder', () => {
		as(['enrollment.approve']);
		render(Page);
		const step = screen.getByText(STEP3);
		expect(step.closest('li')?.textContent?.trim()).toBe(STEP3);
		expect(step.closest('li')?.querySelector('a')).toBeNull();
		expect(document.body.textContent).not.toContain('{page}');
		expect(screen.queryByRole('link', { name: 'nav.activate_agent' })).toBeNull();
	});

	test('Pair with code opens the pairing dialog on the overview', () => {
		as(['enrollment.approve']);
		render(Page);
		const pair = screen.getByRole('link', { name: 'Pair with code' });
		expect(pair).toHaveAttribute('href', '/app?activateAgent=1');
		expect(pair.querySelector('.material-symbols-outlined, .material-icons')?.textContent).toBe('pin');
	});

	test('without enrollment.approve there is no way to create a code from here', () => {
		as(['enrollment.manage']);
		render(Page);
		expect(screen.queryByRole('link', { name: 'Pair with code' })).toBeNull();
		expect(screen.getByText(STEP3)).toBeInTheDocument();
	});
});
