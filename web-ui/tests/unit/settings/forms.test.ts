/**
 * The logic behind Settings › General, Sign-in and Appearance: what the
 * forms load from the server and send back (lib/settings/general.ts,
 * signin.ts, appearance.ts).
 */
import * as v from 'valibot';
import { ConnectionMode } from '#lib/api/settings.ts';
import {
	COLOR_KEYS,
	DEFAULT_SLIDES,
	MAX_SLIDES,
	BG_MAX,
	BG_TYPES,
	brandingFromServer,
	brandingPayload,
	fileProblem,
	fontStack,
	moveSlide,
	paletteColors,
	textOn
} from '#lib/settings/appearance.ts';
import { connectionFacts, savedLine, splitHostPort } from '#lib/settings/general.ts';
import {
	ldapFromServer,
	ldapPayload,
	oidcFromServer,
	oidcPayload,
	passwordRules,
	suggestedRedirect,
	validOidcRedirect
} from '#lib/settings/signin.ts';

describe('General', () => {
	const conn = (o: Record<string, unknown>) => connectionFacts(v.parse(ConnectionMode, o));

	test('the strategy can be saved only when the console found the service settings', () => {
		expect(conn({ mode: 'relay_only', source: 'systemd' }).writable).toBe(true);
		expect(conn({ mode: 'relay_only', source: 'defaults' }).writable).toBe(false);
		expect(conn({ mode: 'p2p_first', deployment: 'docker' }).writable).toBe(true);
		expect(conn({ mode: 'p2p_first' }).writable).toBe(false);
		expect(conn({ mode: 'p2p_first', source: 'env', writable: false }).writable).toBe(false);
	});

	test('missing values get the old defaults', () => {
		expect(conn({ mode: 'weird', source: 'env' }).settings).toEqual({
			mode: 'p2p_first',
			p2p_fallback_ms: 2000,
			same_nat_relay: true,
			allow_shared_nat_initiator: false,
			logged_in_only_initiator: false,
			operator_only_outbound: false
		});
		expect(conn({ mode: 'p2p_first', p2p_fallback_ms: 0, same_nat_relay: false }).settings).toMatchObject({
			p2p_fallback_ms: 0,
			same_nat_relay: false
		});
	});

	test('what the running server uses', () => {
		expect(
			conn({ mode: 'p2p_first', runtime: { always_use_relay: true, p2p_fallback_ms: 1500 } }).runtime
		).toEqual({
			relayOnly: true,
			ms: '1500'
		});
		expect(conn({ mode: 'p2p_first', runtime: {} }).runtime).toEqual({ relayOnly: false, ms: '-' });
		expect(conn({ mode: 'p2p_first' }).runtime).toBeNull();
	});

	test('addresses for the diagram', () => {
		expect(splitHostPort('remote.example.com', 21116)).toEqual({ host: 'remote.example.com', port: 21116 });
		expect(splitHostPort('remote.example.com:3000', 21116)).toEqual({
			host: 'remote.example.com',
			port: 3000
		});
		expect(splitHostPort('https://api.example.com:21114/x', 1)).toEqual({
			host: 'api.example.com',
			port: 21114
		});
		expect(splitHostPort('[2001:db8::1]:21117', 1)).toEqual({ host: '2001:db8::1', port: 21117 });
		expect(splitHostPort('2001:db8::1', 9)).toEqual({ host: '2001:db8::1', port: 9 });
		expect(splitHostPort('  ', 21117)).toEqual({ host: '', port: 21117 });
	});

	test('the saved line names the saved parts, or nothing', () => {
		expect(savedLine(['A', 'B'], (p) => `Saved: ${p}.`)).toBe('Saved: A, B.');
		expect(savedLine([], (p) => `Saved: ${p}.`)).toBe('');
	});
});

describe('Sign-in', () => {
	test('password rules tick off one by one', () => {
		const met = (pw: string) =>
			passwordRules(pw)
				.filter((r) => r.met)
				.map((r) => r.id);
		expect(met('')).toEqual([]);
		expect(met('abc')).toEqual(['lowercase']);
		expect(met('Abcdefg1')).toEqual(['length', 'uppercase', 'lowercase', 'number']);
		expect(met('ABCDEFGH')).toEqual(['length', 'uppercase']);
	});

	test('the SSO redirect must end in a callback path', () => {
		expect(validOidcRedirect('https://desk.example.com/api/auth/oidc/callback')).toBe(true);
		expect(validOidcRedirect('http://10.0.0.5:5000/api/oidc/callback/')).toBe(true);
		expect(validOidcRedirect('https://desk.example.com/')).toBe(false);
		expect(validOidcRedirect('javascript:alert(1)//api/auth/oidc/callback')).toBe(false);
		expect(validOidcRedirect('ftp://x/api/auth/oidc/callback')).toBe(false);
		expect(validOidcRedirect('')).toBe(false);
		expect(suggestedRedirect('https://desk.example.com/')).toBe(
			'https://desk.example.com/api/auth/oidc/callback'
		);
	});

	test('LDAP: defaults in, trimmed text and numbers out', () => {
		const v0 = ldapFromServer({});
		expect(v0.port).toBe(389);
		expect(v0.conn_timeout_sec).toBe(10);
		expect(v0.default_role).toBe('viewer');
		const out = ldapPayload({
			...v0,
			host: '  ldap.example.com ',
			port: null,
			conn_timeout_sec: 0,
			enabled: true
		});
		expect(out.host).toBe('ldap.example.com');
		expect(out.port).toBe(389);
		expect(out.conn_timeout_sec).toBe(10);
		expect(out.enabled).toBe(true);
		expect(ldapFromServer({ port: '636', enabled: 1 })).toMatchObject({ port: 636, enabled: true });
	});

	test('OIDC: defaults in, the console address when the panel URL is empty', () => {
		const v0 = oidcFromServer({ auto_discovery: false, allow_signup: false }, 'https://desk.example.com');
		expect(v0.panel_url).toBe('https://desk.example.com');
		expect(v0.scopes).toBe('openid profile email');
		expect(v0.claim_username).toBe('preferred_username');
		expect(v0.auto_discovery).toBe(false);
		expect(v0.allow_signup).toBe(false);
		expect(oidcFromServer({}, 'x').auto_discovery).toBe(true);
		expect(oidcPayload({ ...v0, panel_url: '  ' }, 'https://o').panel_url).toBe('https://o');
	});
});

describe('Appearance', () => {
	test('what the form starts with when the server has nothing', () => {
		const v0 = brandingFromServer({});
		expect(v0.themeMode).toBe('system');
		expect(v0.logoType).toBe('default');
		expect(v0.logoIcon).toBe('dns');
		expect(v0.loginPromoMode).toBe('slides');
		expect(v0.loginSlides).toEqual(DEFAULT_SLIDES);
		expect(v0.glassEnabled).toBe(true);
		expect(v0.showPoweredBy).toBe(true);
		expect(Object.keys(v0.colors).sort()).toEqual([...COLOR_KEYS].sort());
	});

	test('stored values: auto is dark, "false" switches are off, unknown kinds fall back', () => {
		const v0 = brandingFromServer({
			themeMode: 'auto',
			glassEnabled: 'false',
			showPoweredBy: 'false',
			bgType: 'video',
			loginBgType: 'none',
			bgBlur: '12',
			loginSlides: [{ title: 'Hi', overlay: '30' }]
		});
		expect(v0.themeMode).toBe('dark');
		expect(v0.glassEnabled).toBe(false);
		expect(v0.showPoweredBy).toBe(false);
		expect(v0.bgType).toBe('none');
		expect(v0.loginBgType).toBe('none');
		expect(v0.bgBlur).toBe(12);
		expect(v0.loginSlides).toEqual([
			{ id: 'slide-1', slideKey: '', imageUrl: '', title: 'Hi', body: '', overlay: 30 }
		]);
	});

	test('sent back as the old page sent it', () => {
		const v0 = brandingFromServer({ colors: { bgPrimary: '#112233', textPrimary: 'red', accentBlue: '' } });
		const out = brandingPayload({
			...v0,
			appName: '',
			bgBlur: 4,
			glassEnabled: false,
			bgColor: '  #000000 '
		});
		expect(out.colors).toEqual({ bgPrimary: '#112233' });
		expect(out.appName).toBe('BetterDesk');
		expect(out.bgBlur).toBe('4');
		expect(out.glassEnabled).toBe('false');
		expect(out.showPoweredBy).toBe('true');
		expect(out.bgColor).toBe('#000000');
		expect((out.loginSlides as { order: number; overlay: string }[])[1]).toMatchObject({
			order: 1,
			overlay: '45'
		});
	});

	test('at most ten slides are sent', () => {
		const many = Array.from({ length: 12 }, (_x, i) => ({ ...DEFAULT_SLIDES[0]!, id: `s${i}` }));
		const out = brandingPayload({ ...brandingFromServer({}), loginSlides: many });
		expect((out.loginSlides as unknown[]).length).toBe(MAX_SLIDES);
	});

	test('moving slides', () => {
		const s = DEFAULT_SLIDES.map((x) => ({ ...x }));
		expect(moveSlide(s, 0, 1).map((x) => x.id)).toEqual(['remote', 'free', 'secure', 'platforms']);
		expect(moveSlide(s, 0, -1).map((x) => x.id)).toEqual(['free', 'remote', 'secure', 'platforms']);
		expect(moveSlide(s, 3, 1).map((x) => x.id)).toEqual(['free', 'remote', 'secure', 'platforms']);
	});

	test('palette colours for the custom fields, only the ones it has', () => {
		expect(paletteColors({ bgPrimary: '#000000', accentBlueHover: '#111111', textPrimary: '' })).toEqual({
			bgPrimary: '#000000'
		});
		expect(paletteColors(null)).toEqual({});
	});

	test('preview helpers', () => {
		expect(textOn('#ffffff')).toBe('#000000');
		expect(textOn('#0d1117')).toBe('#ffffff');
		expect(textOn('nope')).toBe('');
		expect(fontStack('Inter')).toBe('"Inter", var(--font)');
		expect(fontStack('a"; } body { x')).toBe('"a  body  x", var(--font)');
		expect(fontStack('  ')).toBe('');
	});

	test('pictures over 8 MB or of another type are refused before upload', () => {
		expect(fileProblem({ size: BG_MAX + 1, type: 'image/png' }, BG_TYPES, BG_MAX)).toBe('size');
		expect(fileProblem({ size: 10, type: 'image/svg+xml' }, BG_TYPES, BG_MAX)).toBe('type');
		expect(fileProblem({ size: 10, type: 'image/webp' }, BG_TYPES, BG_MAX)).toBeNull();
	});
});
