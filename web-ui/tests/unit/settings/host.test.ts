/**
 * The settings page host without a DOM: tabs in the URL, old links, the
 * search across tabs (lib/settings/tabs.ts, search.ts, search-index.ts).
 */
import { SEARCH_INDEX, TAB_IDS, type IndexRow } from '#lib/settings/search-index.ts';
import { MAX_HITS, searchSettings, visibleRows } from '#lib/settings/search.ts';
import {
	ADMIN_TABS,
	TABS,
	decodeHash,
	hashTab,
	parseTab,
	tabAllowed,
	tabDescKey,
	tabOfId,
	tabSearch
} from '#lib/settings/tabs.ts';

describe('settings tabs in the URL', () => {
	test('?tab= picks the tab, any case; anything else is General', () => {
		expect(parseTab('branding')).toBe('branding');
		expect(parseTab('AUTH')).toBe('auth');
		expect(parseTab('nope')).toBe('general');
		expect(parseTab('')).toBe('general');
		expect(parseTab(null)).toBe('general');
		expect(parseTab('__proto__')).toBe('general');
	});

	test('the five server tabs need server.config; General, Appearance and Sign-in are for everyone', () => {
		expect([...ADMIN_TABS].sort()).toEqual(['advanced', 'backup', 'email', 'time', 'updates']);
		for (const tab of TABS) expect(tabAllowed(tab, true)).toBe(true);
		expect(tabAllowed('general', false)).toBe(true);
		expect(tabAllowed('branding', false)).toBe(true);
		expect(tabAllowed('auth', false)).toBe(true);
		expect(tabAllowed('backup', false)).toBe(false);
		expect(tabAllowed('advanced', false)).toBe(false);
	});

	test('General has no ?tab=, the others keep the old names', () => {
		expect(tabSearch('general')).toBe('');
		expect(tabSearch('branding')).toBe('?tab=branding');
		expect(tabSearch('general', new URLSearchParams('tab=auth&x=1'))).toBe('?x=1');
	});

	test('General and Sign-in say less to people who cannot change the server', () => {
		expect(tabDescKey('general', true)).toBe('settings.page.general_desc');
		expect(tabDescKey('general', false)).toBe('settings.page.general_desc_viewer');
		expect(tabDescKey('auth', false)).toBe('settings.page.auth_desc_viewer');
		expect(tabDescKey('branding', false)).toBe('settings.page.branding_desc');
	});
});

describe('old links into settings', () => {
	test('#<tab> and #server are tabs; an element id is not', () => {
		expect(hashTab('#branding')).toBe('branding');
		expect(hashTab('#server')).toBe('general');
		expect(hashTab('#public-endpoints')).toBeNull();
		expect(hashTab('')).toBeNull();
	});

	test('a broken escape in the hash is kept as it is', () => {
		expect(decodeHash('#a%20b')).toBe('a b');
		expect(decodeHash('#%E0%A4%A')).toBe('%E0%A4%A');
	});

	test('an element id leads to the tab that holds it', () => {
		// Links the old console has: dashboard, keys and scaling point at General
		expect(tabOfId('public-endpoints')).toBe('general');
		expect(tabOfId('account-password')).toBe('auth');
		expect(tabOfId('auth-panel-totp')).toBe('auth');
		expect(tabOfId('ldap-host')).toBe('auth');
		expect(tabOfId('branding-css')).toBe('branding');
		expect(tabOfId('color-accentBlue')).toBe('branding');
		expect(tabOfId('scheduled-backup-enabled')).toBe('backup');
		expect(tabOfId('nothing-like-this')).toBeNull();
	});

	test('every index row points at an id of its own tab', () => {
		for (const [tab, id] of SEARCH_INDEX) {
			expect(TAB_IDS[tab]?.split(' ')).toContain(id);
		}
	});
});

// A tiny translation table: label, section and hint keys of a few rows
const EN: Record<string, string> = {
	'settings.tab_general': 'General',
	'settings.tab_auth': 'Sign-in',
	'settings.tab_branding': 'Appearance',
	'settings.public_endpoints_title': 'Public client endpoints',
	'settings.public_endpoints_server_id': 'Public ID server',
	'settings.general.endpoint_id_hint': 'Host name or IP address of the ID server',
	'settings.server_info': 'Server information',
	'settings.general.server_version': 'Server version',
	'settings.change_password': 'Password',
	'settings.current_password': 'Current password',
	'settings.ldap_title': 'LDAP / Active Directory',
	'settings.ldap_host': 'Server address',
	'branding.footer_title': 'Footer',
	'branding.footer_text': 'Footer text:'
};
const t = (k: string) => EN[k] ?? k;

const ROWS: IndexRow[] = [
	[
		'general',
		'public-server-id',
		'settings.public_endpoints_server_id',
		'settings.public_endpoints_title',
		['settings.general.endpoint_id_hint'],
		'server.config'
	],
	['general', 'go-server-version', 'settings.general.server_version', 'settings.server_info', [], ''],
	['auth', 'current-password', 'settings.current_password', 'settings.change_password', [], ''],
	['auth', 'ldap-host', 'settings.ldap_host', 'settings.ldap_title', [], 'server.config'],
	['auth', 'ldap-host', 'settings.ldap_host', 'settings.ldap_title', [], 'server.config'],
	['branding', 'footer-text', 'branding.footer_text', 'branding.footer_title', [], ''],
	['bogus', 'x', 'settings.ldap_host', '', [], '']
];

const admin = (p: string) => p === 'server.config' || p === 'branding.edit';
const viewer = () => false;

describe('settings search', () => {
	test('needs two characters', () => {
		expect(searchSettings('s', { t, can: admin, current: 'general' }, ROWS)).toEqual([]);
		expect(searchSettings('se', { t, can: admin, current: 'general' }, ROWS).length).toBeGreaterThan(0);
	});

	test('every word must match the label, the section or a hint', () => {
		const hits = searchSettings('server address ldap', { t, can: admin, current: 'general' }, ROWS);
		expect(hits.map((h) => h.id)).toEqual(['ldap-host']);
		// "host name" is only in the hint of the public ID server
		expect(searchSettings('host name', { t, can: admin, current: 'auth' }, ROWS).map((h) => h.id)).toEqual([
			'public-server-id'
		]);
	});

	test('people without server.config do not find what they cannot see', () => {
		expect(searchSettings('server', { t, can: viewer, current: 'general' }, ROWS).map((h) => h.id)).toEqual([
			'go-server-version'
		]);
		expect(visibleRows(viewer, ROWS).some((r) => r[5] !== '')).toBe(false);
	});

	test('label matches first, then the tab open now; the same row once; where it is', () => {
		const hits = searchSettings('server', { t, can: admin, current: 'auth' }, ROWS);
		// "Server address" (Sign-in, open) and "Server version" match by label, Public ID server too
		expect(hits[0]).toEqual({
			tab: 'auth',
			id: 'ldap-host',
			label: 'Server address',
			where: 'Sign-in › LDAP / Active Directory'
		});
		expect(hits.filter((h) => h.id === 'ldap-host')).toHaveLength(1);
		expect(hits.map((h) => h.id)).not.toContain('x');
	});

	test('a trailing colon goes from the label', () => {
		expect(searchSettings('footer text', { t, can: admin, current: 'general' }, ROWS)[0]?.label).toBe(
			'Footer text'
		);
	});

	test('at most eight results over the real index', () => {
		const hits = searchSettings('se', { t: (k) => k, can: admin, current: 'general' });
		expect(hits.length).toBe(MAX_HITS);
	});
});
