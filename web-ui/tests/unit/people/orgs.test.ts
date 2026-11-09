import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import {
	AddressBook,
	Contract,
	listPeerCredentials,
	OrgUser,
	Organization
} from '../../../src/lib/api/orgs.ts';
import {
	bookJson,
	bookPayload,
	checkBookJson,
	importDevices,
	openInvitations,
	orgContracts,
	orgRoleLabel,
	parseBook,
	readSessionSettings,
	sessionSettingRows,
	SETTING_DEFAULTS,
	slugify
} from '../../../src/lib/people/orgs.ts';

const t = (key: string) => ({ 'organizations.role_user': 'Member' })[key] ?? key;

describe('organization basics', () => {
	test('a name suggests a slug: lowercase, hyphens, at most 64 characters', () => {
		expect(slugify('Harbor Logistics GmbH')).toBe('harbor-logistics-gmbh');
		expect(slugify('  --Ärzte & Co.--  ')).toBe('rzte-co');
		expect(slugify('x'.repeat(80))).toHaveLength(64);
	});

	test('roles inside an organization: "user" reads as Member, unknown roles as they are', () => {
		expect(orgRoleLabel('user', t)).toBe('Member');
		expect(orgRoleLabel('auditor', t)).toBe('auditor');
		expect(orgRoleLabel('', t)).toBe('');
	});

	test('open invitations leave out used and expired ones', () => {
		const now = Date.parse('2026-11-09T12:00:00Z');
		const list = [
			{ id: '1', token: 'a', email: '', role: 'user', expires_at: '2026-11-10T00:00:00Z', used_at: null },
			{ id: '2', token: 'b', email: '', role: 'user', expires_at: '2026-11-08T00:00:00Z', used_at: null },
			{
				id: '3',
				token: 'c',
				email: '',
				role: 'user',
				expires_at: '2026-11-10T00:00:00Z',
				used_at: '2026-11-09T10:00:00Z'
			},
			// Go's zero time means "not used"
			{
				id: '4',
				token: 'd',
				email: '',
				role: 'user',
				expires_at: '2026-11-11T00:00:00Z',
				used_at: '0001-01-01T00:00:00Z'
			}
		];
		expect(openInvitations(list, now)).toBe(2);
	});

	test('support packages: the organization itself or one of its device groups', () => {
		const all = [
			{ target_type: 'org', target_key: 'o1' },
			{ target_type: 'org', target_key: 'other', org_id: 'o1' },
			{ target_type: 'org', target_key: 'o2' },
			{ target_type: 'device_group', target_key: 'g1' },
			{ target_type: 'device_group', target_key: 'g9' }
		].map((c) => v.parse(Contract, c));
		expect(orgContracts(all, 'o1', ['g1']).map((c) => c.target_key)).toEqual(['o1', 'other', 'g1']);
	});

	test('Go answers parse with ids as text and missing text as empty', () => {
		expect(v.parse(Organization, { id: 7, name: 'Lab', slug: null })).toMatchObject({
			id: '7',
			slug: '',
			logo_url: ''
		});
		expect(v.parse(OrgUser, { id: 'u1', username: 'x', role: 'owner', last_login: null })).toMatchObject({
			display_name: '',
			email: ''
		});
		expect(v.parse(AddressBook, { data: '{}', enabled: null }).enabled).toBe(true);
		expect(v.parse(AddressBook, { data: '{}', enabled: false }).enabled).toBe(false);
	});
});

describe('stored connection settings', () => {
	test('missing keys take the defaults; stored text becomes values', () => {
		expect(readSessionSettings([])).toEqual(SETTING_DEFAULTS);
		expect(
			readSessionSettings([
				{ key: 'connection_policy', value: 'attended' },
				{ key: 'allow_file_transfer', value: 'false' },
				{ key: 'allow_clipboard', value: 'yes' },
				{ key: 'max_session_duration_min', value: '45' },
				{ key: 'policy_security', value: '{}' }
			])
		).toEqual({
			connection_policy: 'attended',
			allow_file_transfer: false,
			allow_clipboard: true,
			max_session_duration_min: 45
		});
	});

	test('saving writes the four keys as the server stores them, and reads back the same', () => {
		const s = {
			connection_policy: 'ask_always',
			allow_file_transfer: false,
			allow_clipboard: true,
			max_session_duration_min: 0
		};
		const rows = sessionSettingRows(s);
		expect(rows).toEqual([
			['connection_policy', 'ask_always'],
			['allow_file_transfer', 'false'],
			['allow_clipboard', 'true'],
			['max_session_duration_min', '0']
		]);
		expect(readSessionSettings(rows.map(([key, value]) => ({ key, value })))).toEqual(s);
	});
});

describe('shared address book', () => {
	test('the stored book reads from JSON text or an object; nothing is an empty book', () => {
		expect(parseBook(null)).toEqual({ peers: [], tags: [] });
		expect(parseBook('{}')).toEqual({ peers: [], tags: [] });
		expect(parseBook('{"peers":[{"id":" 123 ","alias":"Office","tags":["a"]}],"tags":["Office"]}')).toEqual({
			peers: [{ id: '123', alias: 'Office', tags: ['a'] }],
			tags: ['Office']
		});
		expect(parseBook({ peers: [{ id: 5 }] }).peers[0]).toEqual({ id: '5', alias: '', tags: [] });
		expect(() => parseBook('{not json')).toThrow();
	});

	test('saving drops contacts without an ID and leaves out empty alias and tags', () => {
		const payload = bookPayload({
			peers: [
				{ id: ' 1 ', alias: '', tags: [] },
				{ id: '', alias: 'nameless', tags: [] },
				{ id: '2', alias: ' PC ', tags: ['x'] }
			],
			tags: ['Office']
		});
		expect(payload).toEqual({
			peers: [{ id: '1' }, { id: '2', alias: 'PC', tags: ['x'] }],
			tags: ['Office']
		});
		expect(JSON.parse(bookJson({ peers: [{ id: '1', alias: '', tags: [] }], tags: [] }))).toEqual({
			peers: [{ id: '1' }],
			tags: []
		});
	});

	test('the JSON editor refuses what the server would store wrongly', () => {
		expect(checkBookJson('{oops')).toEqual({ error: 'invalid_json' });
		expect(checkBookJson('[1,2]')).toEqual({ error: 'invalid_json' });
		expect(checkBookJson('{"peers":{}}')).toEqual({ error: 'peers_array' });
		expect(checkBookJson('{"tags":"a"}')).toEqual({ error: 'tags_array' });
		const ok = checkBookJson('{"peers":[{"id":"1"}],"extra":true}');
		expect('book' in ok && ok.book.peers[0]?.id).toBe('1');
		// The JSON is saved as written, extra keys included
		expect('payload' in ok && (ok.payload as { extra: boolean }).extra).toBe(true);
		expect(checkBookJson('')).toMatchObject({ book: { peers: [], tags: [] } });
	});

	test('preset passwords: only contacts the server marks as set, never an empty ID', async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					credentials: [
						{ peer_id: ' 1 ', password_set: true },
						{ peer_id: '2', password_set: false },
						{ peer_id: '3' },
						{ peer_id: ' ' }
					]
				}),
				{ headers: { 'content-type': 'application/json' } }
			)) as typeof fetch;
		try {
			expect([...(await listPeerCredentials('o1'))].sort()).toEqual(['1', '3']);
		} finally {
			globalThis.fetch = realFetch;
		}
	});

	test("adding the organization's devices skips the ones already in the book", () => {
		const { book, added } = importDevices({ peers: [{ id: '1', alias: 'x', tags: [] }], tags: ['t'] }, [
			{ device_id: '1' },
			{ device_id: '2', department: 'Sales' },
			{ device_id: '3', location: 'Hall' },
			{ device_id: '2' },
			{ device_id: ' ' }
		]);
		expect(added).toBe(2);
		expect(book.peers.map((p) => [p.id, p.alias])).toEqual([
			['1', 'x'],
			['2', 'Sales'],
			['3', 'Hall']
		]);
		expect(book.tags).toEqual(['t']);
	});
});
