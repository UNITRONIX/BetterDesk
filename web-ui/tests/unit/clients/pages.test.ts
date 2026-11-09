/**
 * The logic of Client setup, Device tokens, Pairing codes, Support agents
 * and Client app branding (lib/clients/*.ts): warnings, next steps, token
 * status and filters, the pairing countdown, release errors, the branding
 * colours, logo checks and save body, and the links that leave the console.
 */
import { afterEach, describe, expect, test } from 'vitest';
import type { DeviceToken } from '#lib/api/tokens.ts';
import { fill, isAdminRole, releaseError } from '#lib/clients/agents.ts';
import {
	brandingPayload,
	buttonColors,
	checkLogo,
	expandHex,
	isHex,
	logoFromDataUrl,
	logoSrc,
	savedAt,
	type BrandingValues
} from '#lib/clients/branding.ts';
import {
	CLIENT_HOST_KEY,
	isLocalHost,
	nextSteps,
	splitHostPort,
	storedClientHost,
	warnings
} from '#lib/clients/keys.ts';
import { externalLinks, isOutside } from '#lib/clients/links.ts';
import { codeExpired, endsAt, remaining } from '#lib/clients/pairing.ts';
import { around } from '#lib/clients/text.ts';
import {
	bulkCountOk,
	bulkUsesValue,
	copyAllText,
	countTokens,
	filterTokens,
	tokenMenu,
	tokenStatus,
	usesValue
} from '#lib/clients/tokens.ts';

describe('client setup', () => {
	afterEach(() => sessionStorage.clear());

	test('local addresses are the ones others cannot reach', () => {
		for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '::1', '[::1]', '0.0.0.0', ' LocalHost '])
			expect(isLocalHost(h), h).toBe(true);
		for (const h of ['10.0.0.5', 'rd.example.org', '', null]) expect(isLocalHost(h), String(h)).toBe(false);
	});

	test('one warning at a time: the values warning wins over the phone one', () => {
		expect(warnings('127.0.0.1', true)).toEqual({ local: true, qr: false });
		expect(warnings('host.local', true)).toEqual({ local: false, qr: true });
		expect(warnings('rd.example.org', false)).toEqual({ local: false, qr: false });
	});

	test('host and port for the diagram', () => {
		expect(splitHostPort('rd.example.org:21116', 1)).toEqual({ host: 'rd.example.org', port: 21116 });
		expect(splitHostPort('[fe80::1]:9000', 1)).toEqual({ host: 'fe80::1', port: 9000 });
		expect(splitHostPort('[fe80::1]', 21117)).toEqual({ host: 'fe80::1', port: 21117 });
		expect(splitHostPort('rd.example.org', 21117)).toEqual({ host: 'rd.example.org', port: 21117 });
	});

	test('the overview override for this tab goes to the server as ?host=', () => {
		expect(storedClientHost()).toBe('');
		sessionStorage.setItem(CLIENT_HOST_KEY, ' 10.0.0.2 ');
		expect(storedClientHost()).toBe('10.0.0.2');
	});

	test('next steps follow the mode and the permissions', () => {
		const all = { approve: true, manage: true };
		expect(nextSteps('managed', all)).toEqual(['registrations', 'tokens', 'pairing', 'devices']);
		expect(nextSteps(null, all)).toEqual(['registrations', 'tokens', 'pairing', 'devices']);
		expect(nextSteps('open', all)).toEqual(['tokens', 'pairing', 'devices']);
		expect(nextSteps('locked', all)).toEqual(['tokens', 'pairing', 'devices']);
		expect(nextSteps(null, { approve: false, manage: true })).toEqual(['tokens', 'devices']);
		expect(nextSteps(null, { approve: true, manage: false })).toEqual([
			'registrations',
			'pairing',
			'devices'
		]);
		expect(nextSteps(null, { approve: false, manage: false })).toEqual(['devices']);
	});
});

const token = (over: Partial<DeviceToken> = {}): DeviceToken => ({
	id: '1',
	name: 'Office',
	token_prefix: 'abcd1234',
	status: 'pending',
	max_uses: 1,
	use_count: 0,
	peer_id: '',
	note: '',
	expires_at: '',
	created_at: '2026-11-01T00:00:00Z',
	created_by: 'anna',
	...over
});

describe('device tokens', () => {
	const NOW = Date.parse('2026-11-09T12:00:00Z');

	test('one status per token', () => {
		expect(tokenStatus(token(), NOW)).toMatchObject({
			key: 'pending',
			tone: 'waiting',
			label: 'status_pending'
		});
		expect(tokenStatus(token({ status: 'active', use_count: 0, max_uses: 3 }), NOW)).toMatchObject({
			key: 'active',
			tone: 'good',
			label: 'status_used'
		});
		expect(tokenStatus(token({ status: 'active', use_count: 3, max_uses: 3 }), NOW)).toMatchObject({
			key: 'active',
			tone: 'neutral',
			label: 'status_used_up'
		});
		expect(tokenStatus(token({ status: 'active', use_count: 9, max_uses: 0 }), NOW).label).toBe(
			'status_used'
		);
		expect(tokenStatus(token({ status: 'revoked' }), NOW).key).toBe('revoked');
		expect(tokenStatus(token({ status: 'expired' }), NOW).key).toBe('expired');
		// Waiting past its expiry: expired, even before the server says so
		expect(tokenStatus(token({ expires_at: '2026-11-08T00:00:00Z' }), NOW).key).toBe('expired');
		expect(tokenStatus(token({ expires_at: '2026-11-10T00:00:00Z' }), NOW).key).toBe('pending');
	});

	test('filters: expired tokens sit with "not used yet"; search looks in name, prefix, device and note', () => {
		const list = [
			token({ id: 'a', name: 'Lab' }),
			token({ id: 'b', status: 'expired' }),
			token({ id: 'c', status: 'active', peer_id: '900100001' }),
			token({ id: 'd', status: 'revoked', note: 'old batch' })
		];
		const ids = (f: Parameters<typeof filterTokens>[1], q = '') =>
			filterTokens(list, f, q, NOW).map((x) => x.id);
		expect(ids('all')).toEqual(['a', 'b', 'c', 'd']);
		expect(ids('pending')).toEqual(['a', 'b']);
		expect(ids('active')).toEqual(['c']);
		expect(ids('revoked')).toEqual(['d']);
		expect(ids('all', 'lab')).toEqual(['a']);
		expect(ids('all', '9001')).toEqual(['c']);
		expect(ids('all', 'BATCH')).toEqual(['d']);
		expect(ids('all', 'ABCD12')).toEqual(['a', 'b', 'c', 'd']);
		expect(countTokens(list, NOW)).toEqual({ pending: 1, active: 1, expired: 1, revoked: 1 });
	});

	test('revoked tokens have no row menu', () => {
		expect(tokenMenu(token())).toBe(true);
		expect(tokenMenu(token({ status: 'revoked' }))).toBe(false);
	});

	test('uses allowed: 0 is no limit, only an empty or invalid field is 1; bulk needs 1 or more', () => {
		expect(usesValue('0')).toBe(0);
		expect(usesValue('5')).toBe(5);
		expect(usesValue('')).toBe(1);
		expect(usesValue('-3')).toBe(1);
		expect(usesValue('abc')).toBe(1);
		expect(bulkUsesValue('0')).toBe(1);
		expect(bulkUsesValue('4')).toBe(4);
	});

	test('bulk count between 1 and 100; Copy all puts one token per line', () => {
		expect(bulkCountOk('1')).toBe(true);
		expect(bulkCountOk('100')).toBe(true);
		expect(bulkCountOk('0')).toBe(false);
		expect(bulkCountOk('101')).toBe(false);
		expect(bulkCountOk('')).toBe(false);
		expect(
			copyAllText([
				{ name: 'D-1', token: 'x' },
				{ name: 'D-2', token: 'y' }
			])
		).toBe('D-1\tx\nD-2\ty');
	});
});

describe('pairing codes', () => {
	test('time left in whole minutes, counted down', () => {
		expect(remaining(600)).toEqual({ kind: 'minutes', count: 10 });
		expect(remaining(61)).toEqual({ kind: 'minutes', count: 2 });
		expect(remaining(60)).toEqual({ kind: 'minutes', count: 1 });
		expect(remaining(59)).toEqual({ kind: 'under_minute' });
		expect(remaining(0)).toEqual({ kind: 'expired' });
		expect(remaining(-5)).toEqual({ kind: 'expired' });
	});

	test('a new code ends after the server time, or ten minutes', () => {
		expect(endsAt(120, 1000)).toBe(121_000);
		expect(endsAt(null, 0)).toBe(600_000);
		expect(endsAt(0, 0)).toBe(600_000);
	});

	test('a listed code is expired once its time has passed', () => {
		const now = Date.parse('2026-11-09T12:00:00Z');
		expect(codeExpired('2026-11-09T11:59:00Z', now)).toBe(true);
		expect(codeExpired('2026-11-09T12:05:00Z', now)).toBe(false);
		expect(codeExpired('', now)).toBe(false);
	});
});

describe('support agents', () => {
	const strings: Record<string, string> = {
		'generator.errors.generic_agent_release_not_found': 'No release.',
		'generator.errors.generic_agent_release_list_failed': 'Could not list (HTTP {{detail}}).',
		'generator.errors.generic_agent_release_timeout': 'Timed out.'
	};
	const lookup = (k: string) => strings[k];

	test('codes become sentences, with the detail in place or in brackets', () => {
		expect(releaseError('generic_agent_release_not_found', lookup, 'F')).toBe('No release.');
		expect(releaseError('generic_agent_release_list_failed:403', lookup, 'F')).toBe(
			'Could not list (HTTP 403).'
		);
		expect(releaseError('generic_agent_release_timeout:asset.zip', lookup, 'F')).toBe(
			'Timed out. (asset.zip)'
		);
		expect(releaseError('something else broke', lookup, 'F')).toBe('F');
		expect(releaseError('unknown_code', lookup, 'F')).toBe('F');
		expect(releaseError('', lookup, 'F')).toBe('F');
	});

	test('the page is for the four admin roles', () => {
		for (const r of ['super_admin', 'admin', 'global_admin', 'server_admin'])
			expect(isAdminRole(r)).toBe(true);
		for (const r of ['operator', 'viewer', 'guest_issuer', '', null]) expect(isAdminRole(r)).toBe(false);
	});

	test('{{name}} placeholders', () => {
		expect(fill('Imported {{tag}}.', { tag: 'support-v1.2' })).toBe('Imported support-v1.2.');
		expect(fill('{{count}} installers, {{x}}', { count: '4' })).toBe('4 installers, {{x}}');
		expect(around('Last saved {date}', '{date}')).toEqual(['Last saved ', '']);
		expect(around('no token', '{date}')).toEqual(['no token', '']);
	});
});

describe('client app branding', () => {
	test('accent colours', () => {
		expect(isHex('#4f6ef7')).toBe(true);
		expect(isHex('#abc')).toBe(true);
		expect(isHex('4f6ef7')).toBe(false);
		expect(isHex('#4f6ef')).toBe(false);
		expect(expandHex('#ABC')).toBe('#aabbcc');
	});

	test('the preview button reads: black text on light accents, white on dark ones', () => {
		expect(buttonColors('#ffff00')).toEqual({ background: '#ffff00', text: '#000000' });
		expect(buttonColors('#1e293b')).toEqual({ background: '#1e293b', text: '#ffffff' });
		// Not a colour yet: the default accent
		expect(buttonColors('#12').background).toBe('#4f6ef7');
	});

	test('logo files: 512 KiB at most, PNG, JPEG or WebP', () => {
		expect(checkLogo({ size: 1000, type: 'image/png' })).toBeNull();
		expect(checkLogo({ size: 512 * 1024, type: 'image/webp' })).toBeNull();
		expect(checkLogo({ size: 512 * 1024 + 1, type: 'image/png' })).toBe('too_large');
		expect(checkLogo({ size: 0, type: 'image/png' })).toBe('too_large');
		expect(checkLogo({ size: 10, type: 'image/svg+xml' })).toBe('invalid');
		expect(logoFromDataUrl('data:image/jpg;base64,AAAA', 'image/jpg')).toEqual({
			mime: 'image/jpeg',
			data_base64: 'AAAA'
		});
	});

	test('a logo shows from its data or a path on this server, never from elsewhere', () => {
		expect(logoSrc({ mime: 'image/png', data_base64: 'AA' })).toBe('data:image/png;base64,AA');
		expect(logoSrc({ mime: 'image/svg+xml', data_base64: 'AA' })).toBe('');
		expect(logoSrc({ url: '/api/branding/logo' })).toBe('/api/branding/logo');
		expect(logoSrc({ url: 'https://evil.example/x.png' })).toBe('');
		expect(logoSrc({ url: '//evil.example/x.png' })).toBe('');
		expect(logoSrc(null)).toBe('');
	});

	test('the save sends trimmed text and the logo as it is now', () => {
		const base: BrandingValues = {
			company_name: ' Acme ',
			support_contact: '',
			phone: ' 1 ',
			email: '',
			website: '',
			accent_color: '#4f6ef7',
			logo: { mime: 'image/png', data_base64: 'AA', url: '' },
			clearLogo: false
		};
		const out = brandingPayload(base);
		expect(out.company_name).toBe('Acme');
		expect(out.phone).toBe('1');
		expect(out.logo).toEqual({ mime: 'image/png', data_base64: 'AA' });
		expect(out.clear_logo).toBeUndefined();
		const cleared = brandingPayload({ ...base, logo: null, clearLogo: true });
		expect(cleared.clear_logo).toBe(true);
		expect(cleared.logo).toBeUndefined();
		expect(brandingPayload({ ...base, logo: null }).logo).toBeUndefined();
	});

	test('"Last saved" only for a real save time', () => {
		expect(savedAt('1794162401572')?.getTime()).toBe(1794162401572);
		expect(savedAt('')).toBeNull();
		expect(savedAt('3')).toBeNull();
	});
});

describe('links that leave the console', () => {
	test('download page, agent pages and other sites open in a new tab; console pages do not', () => {
		expect(isOutside('/portal')).toBe(true);
		expect(isOutside('/portal?x=1')).toBe(true);
		expect(isOutside('/d/acme')).toBe(true);
		expect(isOutside('https://github.com/x')).toBe(true);
		expect(isOutside('/portals')).toBe(false);
		expect(isOutside('/app/devices')).toBe(false);
		expect(isOutside('/tokens')).toBe(false);
	});

	test('the attachment sets target and rel, also on rows added later', async () => {
		const box = document.createElement('div');
		box.innerHTML = '<a href="/portal">p</a><a href="/app/tokens">t</a>';
		const stop = externalLinks(box);
		const [portal, inside] = Array.from(box.querySelectorAll('a'));
		expect(portal?.target).toBe('_blank');
		expect(portal?.rel).toBe('noopener noreferrer');
		expect(inside?.target).toBe('');
		const later = document.createElement('a');
		later.href = 'https://github.com/x';
		later.setAttribute('href', 'https://github.com/x');
		box.append(later);
		await new Promise((r) => setTimeout(r, 0));
		expect(later.target).toBe('_blank');
		stop();
	});
});
