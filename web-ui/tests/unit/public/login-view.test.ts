import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { LoginPage } from '../../../src/lib/api/signin.ts';
import { readLoginQuery } from '../../../src/lib/public/login.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));

const LoginView = (await import('../../../src/lib/public/LoginView.svelte')).default;

function page(over: Partial<LoginPage> = {}, branding: Partial<LoginPage['branding']> = {}): LoginPage {
	return {
		success: true,
		csrfToken: 'tok',
		appName: 'BetterDesk',
		appVersion: '3.5.0',
		desktopMode: false,
		signedIn: false,
		branding: {
			logoType: 'default',
			logoSvg: '',
			logoUrl: '',
			logoText: '',
			logoTextAccent: '',
			loginTitle: '',
			loginSubtitle: '',
			loginPromoMode: 'classic',
			loginSlides: [],
			footerText: '',
			showPoweredBy: true,
			...branding
		},
		languages: [
			{ code: 'en', name: 'English', native: 'English', flag: '', rtl: false },
			{ code: 'de', name: 'German', native: 'Deutsch', flag: '', rtl: false }
		],
		attestation: null,
		...over
	};
}

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply[]>;
let sent: { url: string; body: Record<string, unknown> | null }[];

function reply(path: string, ...r: Reply[]) {
	replies[path] = [...(replies[path] ?? []), ...r];
}

beforeEach(() => {
	replies = {};
	sent = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			const url = new URL(input, 'http://localhost');
			sent.push({ url: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : null });
			const next = replies[url.pathname]?.shift() ?? { status: 404, body: { success: false } };
			return new Response(JSON.stringify(next.body), {
				status: next.status ?? 200,
				headers: { 'Content-Type': 'application/json' }
			});
		})
	);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.body.className = '';
});

const posted = (path: string) => sent.filter((s) => s.url.startsWith(path)).map((s) => s.body);

describe('sign-in', () => {
	test('a password sign-in goes to the return path (R3) and sends the fingerprint', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', { body: { success: true, redirect: '/devices?open=7' } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery('?return=%2Fdevices%3Fopen%3D7'), go });
		await userEvent.type(screen.getByLabelText('auth.username'), ' demo ');
		await userEvent.type(screen.getByLabelText('auth.password'), 'secret');
		await userEvent.click(screen.getByRole('button', { name: 'auth.login' }));
		await waitFor(() => expect(go).toHaveBeenCalledWith('/devices?open=7'));
		const body = posted('/api/auth/login')[0]!;
		expect(body).toMatchObject({
			username: 'demo',
			password: 'secret',
			remember: false,
			return: '/devices?open=7'
		});
		expect(body.clientFingerprint).toMatch(/^[0-9a-f]{16}$/);
	});

	test('the page does not follow an unsafe redirect from the server', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', { body: { success: true, redirect: '//evil.example' } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery(''), go });
		await userEvent.type(screen.getByLabelText('auth.username'), 'demo');
		await userEvent.type(screen.getByLabelText('auth.password'), 'secret{Enter}');
		await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
	});

	test('empty fields are named and nothing is sent', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		render(LoginView, { page: page(), query: readLoginQuery(''), go: vi.fn() });
		await userEvent.click(screen.getByRole('button', { name: 'auth.login' }));
		expect(screen.getByRole('alert')).toHaveTextContent('auth.fill_all_fields');
		expect(screen.getByLabelText('auth.username')).toHaveAttribute('aria-invalid', 'true');
		expect(screen.getByLabelText('auth.username')).toHaveFocus();
		expect(posted('/api/auth/login')).toHaveLength(0);
	});

	test('a wrong password shows the server message and selects the password', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', {
			status: 401,
			body: { success: false, error: 'Invalid username or password.' }
		});
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery(''), go });
		await userEvent.type(screen.getByLabelText('auth.username'), 'demo');
		await userEvent.type(screen.getByLabelText('auth.password'), 'wrong');
		await userEvent.click(screen.getByRole('button', { name: 'auth.login' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
		await waitFor(() => expect(screen.getByLabelText('auth.password')).toHaveFocus());
		expect(go).not.toHaveBeenCalled();
	});

	test('two-factor: the sixth digit sends the code, then the return path', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', { body: { success: true, totpRequired: true } });
		reply('/api/auth/totp/verify', { status: 401, body: { success: false, error: 'Invalid code.' } });
		reply('/api/auth/totp/verify', { body: { success: true, redirect: '/tickets' } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery('?return=%2Ftickets'), go });
		await userEvent.type(screen.getByLabelText('auth.username'), 'demo');
		await userEvent.type(screen.getByLabelText('auth.password'), 'secret{Enter}');
		const code = await screen.findByLabelText('auth.totp_code');
		await waitFor(() => expect(code).toHaveFocus());
		await userEvent.type(code, '12a345');
		// Five digits: nothing sent yet
		expect(posted('/api/auth/totp/verify')).toHaveLength(0);
		await userEvent.type(code, '6');
		expect(await screen.findByRole('alert')).toHaveTextContent('Invalid code.');
		expect(posted('/api/auth/totp/verify')[0]).toMatchObject({ code: '123456', return: '/tickets' });
		await waitFor(() => expect(screen.getByLabelText('auth.totp_code')).toHaveValue(''));
		await userEvent.type(screen.getByLabelText('auth.totp_code'), '654321');
		await waitFor(() => expect(go).toHaveBeenCalledWith('/tickets'));
	});

	test('two-factor: a recovery code instead, and back to the password', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', { body: { success: true, totpRequired: true } });
		reply('/api/auth/totp/verify', { body: { success: true } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery(''), go });
		await userEvent.type(screen.getByLabelText('auth.username'), 'demo');
		await userEvent.type(screen.getByLabelText('auth.password'), 'secret{Enter}');
		await userEvent.click(await screen.findByRole('button', { name: 'auth.totp_use_recovery' }));
		const rc = screen.getByLabelText('auth.totp_recovery_code');
		expect(rc).toHaveFocus();
		await userEvent.click(screen.getByRole('button', { name: 'auth.totp_verify' }));
		expect(screen.getByRole('alert')).toHaveTextContent('auth.totp_enter_recovery');
		await userEvent.type(rc, 'ABCD-1234{Enter}');
		await waitFor(() => expect(go).toHaveBeenCalledWith('/'));
		expect(posted('/api/auth/totp/verify')[0]).toMatchObject({ recoveryCode: 'ABCD-1234' });
	});

	test('back to the password step from two-factor', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		reply('/api/auth/login', { body: { success: true, totpRequired: true } });
		render(LoginView, { page: page(), query: readLoginQuery(''), go: vi.fn() });
		await userEvent.type(screen.getByLabelText('auth.username'), 'demo');
		await userEvent.type(screen.getByLabelText('auth.password'), 'secret{Enter}');
		await userEvent.click(await screen.findByRole('button', { name: 'auth.totp_back_to_login' }));
		await waitFor(() => expect(screen.getByLabelText('auth.password')).toHaveFocus());
	});

	test('Show reveals the password and says so', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		render(LoginView, { page: page(), query: readLoginQuery(''), go: vi.fn() });
		const toggle = screen.getByRole('button', { name: 'auth.show_password' });
		expect(screen.getByLabelText('auth.password')).toHaveAttribute('type', 'password');
		await userEvent.click(toggle);
		expect(toggle).toHaveAttribute('aria-pressed', 'true');
		expect(screen.getByLabelText('auth.password')).toHaveAttribute('type', 'text');
	});
});

describe('single sign-on', () => {
	test('the SSO button carries the return path', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: true, display_name: 'Keycloak' } });
		render(LoginView, { page: page(), query: readLoginQuery('?return=%2Fchat'), go: vi.fn() });
		const sso = await screen.findByRole('link', { name: 'auth.login_sso_with' });
		expect(sso).toHaveAttribute('href', '/api/auth/oidc/authorize?return_url=%2Fchat');
	});

	test('"Prefer SSO" leaves for the identity provider right away', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: true, prefer_sso: true, local_bypass: false } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery('?return=%2Fchat'), go });
		await waitFor(() => expect(go).toHaveBeenCalledWith('/api/auth/oidc/authorize?return_url=%2Fchat', true));
		expect(screen.queryByLabelText('auth.password')).toBeNull();
	});

	test('?autoLaunch=0 keeps the password form', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: true, prefer_sso: true } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery('?autoLaunch=0'), go });
		await screen.findByRole('link', { name: 'auth.login_sso' });
		expect(go).not.toHaveBeenCalled();
		expect(screen.getByLabelText('auth.password')).toBeInTheDocument();
	});

	test('?error=oidc_* shows the error and does not start again', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: true, prefer_sso: true } });
		const go = vi.fn();
		render(LoginView, { page: page(), query: readLoginQuery('?error=oidc_denied'), go });
		expect(screen.getByRole('alert')).toHaveTextContent('auth.oidc_error');
		await screen.findByRole('link', { name: 'auth.login_sso' });
		expect(go).not.toHaveBeenCalled();
	});
});

describe('notices, branding and the compact sign-in', () => {
	test('?expired=1 says the session ended; a first visit says nothing (R4)', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } }, { body: { enabled: false } });
		render(LoginView, { page: page(), query: readLoginQuery('?expired=1'), go: vi.fn() });
		expect(screen.getByRole('status')).toHaveTextContent('auth.session_expired');
		cleanup();
		render(LoginView, { page: page(), query: readLoginQuery(''), go: vi.fn() });
		expect(screen.queryByText('auth.session_expired')).toBeNull();
	});

	test('admin title, subtitle, footer and version; the wallpaper classes on <body>', () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		render(LoginView, {
			page: page({}, { loginTitle: 'Acme support', loginSubtitle: 'Staff only', footerText: '(c) Acme' }),
			query: readLoginQuery(''),
			go: vi.fn()
		});
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme support');
		expect(screen.getByText('Staff only')).toBeInTheDocument();
		expect(screen.getByText('(c) Acme')).toBeInTheDocument();
		expect(screen.getByText('BetterDesk 3.5.0')).toBeInTheDocument();
		expect(document.body).toHaveClass('login-page', 'login-layout-classic');
	});

	test('text from branding is text, never markup', () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		const evil = '<img src=x onerror="window.__pwned=1">';
		render(LoginView, {
			page: page({ appName: evil }, { logoType: 'text', logoText: evil, loginTitle: evil, footerText: evil }),
			query: readLoginQuery(''),
			go: vi.fn()
		});
		expect(document.querySelector('img[src="x"]')).toBeNull();
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(evil);
	});

	test('the desktop sign-in: no SSO, no Remember me, no promo, no account list (S4)', async () => {
		reply('/api/auth/oidc/status', { body: { enabled: true, prefer_sso: true } });
		const go = vi.fn();
		render(LoginView, {
			page: page({}, { loginPromoMode: 'single', loginTitle: 'Acme' }),
			query: readLoginQuery('?desktop=1'),
			go
		});
		expect(screen.queryByLabelText('auth.remember_me')).toBeNull();
		expect(screen.queryByRole('link', { name: /auth.login_sso/ })).toBeNull();
		expect(document.querySelector('.login-promo')).toBeNull();
		expect(screen.queryByText('desktop_login.accounts_title')).toBeNull();
		expect(document.body).toHaveClass('login-page', 'desktop-login');
		expect(sent.some((s) => s.url.startsWith('/api/auth/oidc/status'))).toBe(false);
		expect(go).not.toHaveBeenCalled();
	});

	test('the old desktop-mode cookie (desktopMode) also gives the compact sign-in', () => {
		render(LoginView, { page: page({ desktopMode: true }), query: readLoginQuery(''), go: vi.fn() });
		expect(screen.queryByLabelText('auth.remember_me')).toBeNull();
	});

	test('the capacity badge shows the tier after a test', () => {
		reply('/api/auth/oidc/status', { body: { enabled: false } });
		render(LoginView, {
			page: page({ attestation: { tier: 'platinum', brand: 'Acme', badgeTitle: 'Tested', tierLabel: '' } }),
			query: readLoginQuery(''),
			go: vi.fn()
		});
		const badge = document.querySelector('.bd-attest-badge')!;
		expect(badge).toHaveClass('bd-attest-tier-platinum');
		expect(badge).toHaveAttribute('title', 'Tested');
		expect(badge).toHaveTextContent('Acme');
	});
});
