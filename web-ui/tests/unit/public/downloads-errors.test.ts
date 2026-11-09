import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import {
	detectComputer,
	installerTitle,
	matchingIndex,
	safeDownloadUrl
} from '../../../src/lib/public/detect.ts';
import { errorReroute, serverError } from '../../../src/lib/public/server-error.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));

const ErrorView = (await import('../../../src/lib/public/ErrorView.svelte')).default;

afterEach(() => {
	cleanup();
	setStrings('en', 'ltr', {});
	document.head.querySelectorAll('meta[name="bd-error"]').forEach((m) => m.remove());
});

const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const WIN_ARM = 'Mozilla/5.0 (Windows NT 10.0; ARM64) AppleWebKit/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/131.0';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

describe('the installer for this computer', () => {
	test('reads the system and processor from the user agent; phones get none', () => {
		expect(detectComputer(WIN)).toEqual({ platform: 'windows', arch: 'x64' });
		expect(detectComputer(WIN_ARM)).toEqual({ platform: 'windows', arch: 'arm64' });
		expect(detectComputer(MAC)).toEqual({ platform: 'macos' });
		expect(detectComputer(LINUX, true)).toEqual({ platform: 'linux', arch: 'x64', format: 'portable' });
		expect(detectComputer(ANDROID)).toBeNull();
		expect(detectComputer(IPAD)).toBeNull();
	});

	test('the first installer that fits; the bundle page also wants the portable build', () => {
		const list = [
			{ platform: 'linux', arch: 'x64', format: 'portable' },
			{ platform: 'windows', arch: 'arm64', format: 'portable' },
			{ platform: 'windows', arch: 'x64', format: 'msi' },
			{ platform: 'windows', arch: 'x64', format: 'portable' },
			{ platform: 'macos', arch: 'universal', format: 'dmg' }
		];
		expect(matchingIndex(list, detectComputer(WIN))).toBe(2);
		expect(matchingIndex(list, detectComputer(WIN, true))).toBe(3);
		expect(matchingIndex(list, detectComputer(WIN_ARM))).toBe(1);
		expect(matchingIndex(list, detectComputer(MAC))).toBe(4);
		expect(matchingIndex(list, detectComputer(ANDROID))).toBe(-1);
	});

	test('titles and download addresses', () => {
		expect(installerTitle({ platform: 'windows', arch: 'x64', format: 'portable' }, () => 'portabel')).toBe(
			'Windows x64, portabel'
		);
		expect(installerTitle({ platform: 'macos', arch: '', format: '' }, (f) => f)).toBe('macOS');
		expect(safeDownloadUrl('https://panel.example/downloads/generic-agent/v1/a.exe')).toBe(
			'https://panel.example/downloads/generic-agent/v1/a.exe'
		);
		expect(safeDownloadUrl('/downloads/x.exe')).toBe('/downloads/x.exe');
		expect(safeDownloadUrl('javascript:alert(1)')).toBeNull();
		expect(safeDownloadUrl('//evil.example/x')).toBeNull();
	});
});

describe('error pages the server decided on', () => {
	function mark(attrs: Record<string, string>) {
		const meta = document.createElement('meta');
		meta.name = 'bd-error';
		for (const [k, v] of Object.entries(attrs)) meta.setAttribute(k, v);
		document.head.appendChild(meta);
	}

	test('reads the marker; anything else is no error', () => {
		expect(serverError(document)).toBeNull();
		mark({ content: '999' });
		expect(serverError(document)).toBeNull();
		document.head.querySelector('meta[name="bd-error"]')!.remove();
		mark({ content: '403', 'data-title': 'Link expired', 'data-message': 'Ask for a new one.' });
		expect(serverError(document)).toEqual({
			status: 403,
			title: 'Link expired',
			message: 'Ask for a new one.'
		});
	});

	test('only the address the page was loaded with shows the error page', () => {
		const marked = { status: 404 as const, title: '', message: '' };
		expect(errorReroute('http://x/app/devices/zz', 'http://x/app/devices/zz', marked, '/app')).toBe(
			'/app/error/404'
		);
		expect(errorReroute('http://x/app/devices', 'http://x/app/devices/zz', marked, '/app')).toBeUndefined();
		expect(errorReroute('http://x/app/devices', 'http://x/app/devices', null, '/app')).toBeUndefined();
		expect(errorReroute('http://x/zz', 'http://x/zz', marked, '')).toBe('/error/404');
	});
});

describe('the error page', () => {
	test('404 signed out: heading, sentence, the way to sign in, the console name', () => {
		setStrings('en', 'ltr', {
			errors: {
				not_found_title: 'Page not found',
				not_found_message: 'Check the address.',
				go_sign_in: 'Sign in'
			}
		});
		render(ErrorView, { status: 404, standalone: true, appName: 'Acme' });
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Page not found');
		expect(screen.getByText('Acme')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
	});

	test('403 signed in says who you are; a route message replaces the general one, the English default does not', () => {
		setStrings('en', 'ltr', {
			errors: {
				forbidden_title: 'No access',
				forbidden_message: 'Ask an admin.',
				signed_in_as: 'You are {user} as {role}.'
			},
			users: { role_operator: 'Operator' }
		});
		const user = { username: 'demo<b>', role: 'operator' };
		render(ErrorView, { status: 403, user, message: 'You do not have permission to access this resource' });
		expect(screen.getByText('Ask an admin.')).toBeInTheDocument();
		expect(screen.getByText('demo<b>').tagName).toBe('STRONG');
		expect(screen.getByText(/as Operator\./)).toBeInTheDocument();
		cleanup();
		render(ErrorView, { status: 403, user, title: 'Link expired', message: 'The guest link ended.' });
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Link expired');
		expect(screen.getByText('The guest link ended.')).toBeInTheDocument();
		expect(screen.queryByText('demo<b>')).toBeNull();
	});

	test('500: the log note and Try again first; details only when given', () => {
		setStrings('en', 'ltr', {
			errors: { try_again: 'Try again', server_error_log: 'See the log.', go_home: 'Overview' }
		});
		render(ErrorView, { status: 500, user: { username: 'a', role: 'admin' }, details: 'TypeError: x' });
		expect(screen.getByText('See the log.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Try again' })).toHaveClass('btn-primary');
		expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/');
		expect(screen.getByText('TypeError: x')).toBeInTheDocument();
	});
});
