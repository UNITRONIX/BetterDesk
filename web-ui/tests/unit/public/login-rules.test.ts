import { afterEach, describe, expect, test } from 'vitest';
import { ApiError, clientMessages } from '../../../src/lib/api/client.ts';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import { fingerprintOf } from '../../../src/lib/public/fingerprint.ts';
import {
	autoStartsSso,
	codeDigits,
	oidcErrorText,
	readLoginQuery,
	signInErrorText,
	hasNotices,
	withoutNotices
} from '../../../src/lib/public/login.ts';
import { safeReturnPath } from '../../../src/lib/public/returnUrl.ts';

afterEach(() => setStrings('en', 'ltr', {}));

describe('return path (R3, same rules as web-nodejs/lib/returnUrl.js)', () => {
	test.each([
		['/devices?open=12345', '/devices?open=12345'],
		['/app/help-requests#7', '/app/help-requests#7'],
		['/remote/123456789', '/remote/123456789']
	])('follows %s', (raw, expected) => expect(safeReturnPath(raw)).toBe(expected));

	test.each([
		'https://evil.example/',
		'//evil.example',
		'/\\evil.example',
		'/\t/evil.example',
		'/..//evil.example',
		'/.%2e//evil.example',
		'/%5Cevil.example',
		'/devices%0d%0aX',
		'javascript:alert(1)',
		'/login',
		'/app/login?return=/x',
		'/remote/login',
		'/logout',
		'/api/auth/logout',
		'',
		'/' + 'a'.repeat(3000)
	])('refuses %s', (raw) => expect(safeReturnPath(raw)).toBeNull());

	test('refuses what is not a string', () => {
		expect(safeReturnPath(null)).toBeNull();
		expect(safeReturnPath(['/devices'])).toBeNull();
	});
});

describe('the address', () => {
	test('reads return, expired, error, autoLaunch and desktop', () => {
		expect(readLoginQuery('?return=%2Fdevices&expired=1&error=oidc_denied&autoLaunch=0&desktop=1')).toEqual({
			returnPath: '/devices',
			expired: true,
			oidcError: 'oidc_denied',
			autoLaunch: false,
			desktop: true
		});
		expect(readLoginQuery('')).toEqual({
			returnPath: null,
			expired: false,
			oidcError: null,
			autoLaunch: true,
			desktop: false
		});
	});

	test('an unsafe return and an error that is not an SSO code are dropped', () => {
		const q = readLoginQuery('?return=%2F%2Fevil.example&error=%3Cimg%3E');
		expect(q.returnPath).toBeNull();
		expect(q.oidcError).toBeNull();
	});

	test('the one-time notices leave the address, the rest stays', () => {
		expect(withoutNotices('http://x/app/login?expired=1&return=%2Fdevices&reason=session_idle#a').href).toBe(
			'http://x/app/login?return=%2Fdevices#a'
		);
		expect(withoutNotices('http://x/app/login?error=oidc_failed&autoLaunch=0').href).toBe(
			'http://x/app/login?autoLaunch=0'
		);
		expect(hasNotices('http://x/app/login?expired=1')).toBe(true);
		expect(hasNotices('http://x/app/login?return=%2Fdevices')).toBe(false);
	});
});

describe('Prefer SSO', () => {
	const on = { enabled: true, prefer_sso: true, local_bypass: false };
	const q = readLoginQuery('');

	test('starts single sign-on right away when the admin prefers it', () => {
		expect(autoStartsSso(on, q)).toBe(true);
	});

	test('not with ?autoLaunch=0, after an SSO error, on the local network, or on the desktop sign-in', () => {
		expect(autoStartsSso(on, readLoginQuery('?autoLaunch=0'))).toBe(false);
		expect(autoStartsSso(on, readLoginQuery('?error=oidc_failed'))).toBe(false);
		expect(autoStartsSso({ ...on, local_bypass: true }, q)).toBe(false);
		expect(autoStartsSso(on, readLoginQuery('?desktop=1'))).toBe(false);
		expect(autoStartsSso({ ...on, prefer_sso: false }, q)).toBe(false);
		expect(autoStartsSso({ ...on, enabled: false }, q)).toBe(false);
	});
});

describe('messages', () => {
	test('SSO errors use their own sentence when there is one', () => {
		setStrings('en', 'ltr', { auth: { oidc_denied: 'Denied.', oidc_error: 'SSO failed.' } });
		expect(oidcErrorText('oidc_denied')).toBe('Denied.');
		expect(oidcErrorText('oidc_unknown_thing')).toBe('SSO failed.');
	});

	test('too many attempts, no server, and the server message', () => {
		setStrings('en', 'ltr', { auth: { totp_rate_limited: 'Too many.', login_failed: 'Failed.' } });
		expect(signInErrorText(new ApiError('Too many login attempts', 429), 'auth.login_failed')).toBe(
			'Too many.'
		);
		expect(signInErrorText(new ApiError('x', 0), 'auth.login_failed')).toBe(clientMessages.network);
		expect(signInErrorText(new ApiError('Invalid username or password.', 401), 'auth.login_failed')).toBe(
			'Invalid username or password.'
		);
		expect(signInErrorText(new ApiError('', 500), 'auth.login_failed')).toBe('Failed.');
		expect(signInErrorText(new Error('boom'), 'auth.login_failed')).toBe('Failed.');
	});

	test('the code field keeps six digits', () => {
		expect(codeDigits('12 34-56 78')).toBe('123456');
		expect(codeDigits('abc')).toBe('');
	});
});

describe('fingerprint (public/js/login.js)', () => {
	test('is the old FNV-1a hash of the same values', () => {
		const parts = {
			userAgent: 'UA',
			language: 'de',
			screen: '1920x1080',
			timezoneOffset: -60,
			cpus: 8,
			platform: 'Win32'
		};
		// The old function, inlined, as the reference
		const joined = 'UA|de|1920x1080|-60|8|Win32';
		let h = 2166136261;
		for (let i = 0; i < joined.length; i++) {
			h ^= joined.charCodeAt(i);
			h = Math.imul(h, 16777619);
		}
		const hex = (n: number) => ('00000000' + (n >>> 0).toString(16)).slice(-8);
		expect(fingerprintOf(parts)).toBe(hex(h) + hex(h ^ joined.length));
		expect(fingerprintOf(parts)).toMatch(/^[0-9a-f]{16}$/);
		expect(fingerprintOf({ ...parts, language: 'en' })).not.toBe(fingerprintOf(parts));
	});
});
