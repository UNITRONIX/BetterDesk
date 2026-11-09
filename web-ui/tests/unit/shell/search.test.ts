import { render, screen, cleanup } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import adminNav from '../../fixtures/nav-admin.json';
import type { NavSection } from '../../../src/lib/api/console.ts';
import { searchPages } from '../../../src/lib/shell/nav-model.ts';
import {
	MAX_PAGES,
	groupResults,
	isSearchShortcut,
	norm,
	searchAll,
	type SearchDevice
} from '../../../src/lib/shell/search.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));
const goto = vi.fn().mockResolvedValue(undefined);
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => goto(...a) }));
vi.mock('#lib/api/devices.ts', () => ({
	listDevices: vi.fn().mockResolvedValue([
		{
			id: '900100001',
			hostname: 'demo-reception-01',
			platform: 'Windows 11 Pro',
			online: true,
			tags: ['office']
		}
	])
}));
vi.mock('../../../src/lib/shell/api.ts', () => ({
	listUsersForSearch: vi
		.fn()
		.mockResolvedValue([{ username: 'demo_operator', email: 'op@example.com', role: 'operator' }])
}));

const pages = searchPages(adminNav as NavSection[]);
const devices: SearchDevice[] = [
	{
		id: '900100001',
		hostname: 'demo-reception-01',
		platform: 'Windows 11 Pro',
		online: true,
		tags: ['office']
	},
	{ id: '900100002', hostname: 'büro-pc', note: 'Printer on floor 2', online: false },
	{ id: '900100003', display_name: 'Lager', hostname: 'lager-01', banned: true, tags: 'warehouse, scanner' }
];

describe('searchAll', () => {
	test('finds pages by their keywords and earlier names', () => {
		const titles = (q: string) => searchAll(q, { pages }).map((r) => r.title);
		expect(titles('2fa')).toEqual(['Sign-in']);
		expect(titles('dlp')).toEqual(['Data loss prevention']);
		expect(titles('ssh')).toEqual(['Terminal']);
	});

	test('every word must match somewhere; case and accents do not matter', () => {
		expect(searchAll('settings backup', { pages }).map((r) => r.title)).toEqual(['Backup']);
		expect(searchAll('BURO', { pages: [], devices }).map((r) => r.id)).toEqual(['900100002']);
		expect(norm('Geräte')).toBe('gerate');
		expect(searchAll('settings nothing-like-this', { pages })).toEqual([]);
		expect(searchAll('   ', { pages })).toEqual([]);
	});

	test('titles that start with the first word come first, at most six pages', () => {
		const r = searchAll('set', { pages });
		expect(r).toHaveLength(MAX_PAGES);
		const s = searchAll('agents', { pages }).map((x) => x.title);
		expect(s[0]).toBe('Support agents');
	});

	test('devices match ID, names, tags and note, and link to the device', () => {
		const r = searchAll('floor', { pages: [], devices });
		expect(r).toEqual([
			expect.objectContaining({
				kind: 'device',
				title: 'büro-pc',
				state: 'offline',
				href: '/devices?search=900100002&open=900100002'
			})
		]);
		expect(searchAll('scanner', { pages: [], devices })[0]).toMatchObject({
			title: 'Lager',
			state: 'banned'
		});
		expect(searchAll('office', { pages: [], devices })[0]).toMatchObject({ state: 'online' });
	});

	test('people match name, email and role', () => {
		const users = [{ username: 'demo_viewer', email: 'viewer@example.com', role: 'viewer' }];
		expect(searchAll('example viewer', { pages: [], users })).toEqual([
			expect.objectContaining({ kind: 'user', href: '/users?search=demo_viewer' })
		]);
	});

	test('groups keep the order and the result index', () => {
		const r = searchAll('demo', {
			pages: [],
			devices,
			users: [{ username: 'demo_x', email: '', role: '' }]
		});
		const g = groupResults(r);
		expect(g.map((x) => x.kind)).toEqual(['device', 'user']);
		expect(g[1]!.items[0]!.index).toBe(1);
	});
});

describe('isSearchShortcut', () => {
	const input = document.createElement('input');
	const div = document.createElement('div');
	const key = (k: string, extra: Partial<KeyboardEvent> = {}, target: EventTarget = div) =>
		({ key: k, ctrlKey: false, metaKey: false, altKey: false, target, ...extra }) as KeyboardEvent;

	test('Ctrl+K and Cmd+K anywhere, also in a field', () => {
		expect(isSearchShortcut(key('k', { ctrlKey: true }))).toBe(true);
		expect(isSearchShortcut(key('K', { metaKey: true }, input))).toBe(true);
		expect(isSearchShortcut(key('k'))).toBe(false);
	});

	test('"/" only outside fields and without modifiers', () => {
		expect(isSearchShortcut(key('/'))).toBe(true);
		expect(isSearchShortcut(key('/', {}, input))).toBe(false);
		expect(isSearchShortcut(key('/', { altKey: true }))).toBe(false);
		const editable = document.createElement('div');
		editable.setAttribute('contenteditable', 'true');
		expect(isSearchShortcut(key('/', {}, editable))).toBe(false);
	});
});

describe('SearchDialog', () => {
	beforeEach(async () => {
		const { session } = await import('../../../src/lib/state/session.svelte.ts');
		session.nav = adminNav as NavSection[];
		session.permissions = ['device.view', 'user.view'];
		goto.mockClear();
		// jsdom has no layout
		Element.prototype.scrollIntoView = vi.fn();
	});
	afterEach(() => cleanup());

	async function setup() {
		const SearchDialog = (await import('../../../src/lib/shell/SearchDialog.svelte')).default;
		const opener = document.createElement('button');
		document.body.appendChild(opener);
		opener.focus();
		const view = render(SearchDialog, { open: true });
		const user = userEvent.setup();
		const box = await screen.findByRole('combobox');
		return { view, user, box, opener };
	}

	test('focus starts in the field; arrows move the highlighted result', async () => {
		const { user, box } = await setup();
		expect(document.activeElement).toBe(box);
		await user.keyboard('settings');
		const options = screen.getAllByRole('option');
		expect(options.length).toBeGreaterThan(2);
		expect(box.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
		expect(options[0]).toHaveAttribute('aria-selected', 'true');
		await user.keyboard('{ArrowDown}{ArrowDown}');
		expect(box.getAttribute('aria-activedescendant')).toBe(options[2]!.id);
		await user.keyboard('{ArrowUp}');
		expect(box.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
		// Typing again starts at the first result
		await user.keyboard('{Backspace}');
		expect(box.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]!.id);
	});

	test('Enter opens a ported page inside the app; Escape closes and gives focus back', async () => {
		const { user, box, opener } = await setup();
		await user.keyboard('demo-reception');
		await screen.findByText('demo-reception-01');
		expect(box.getAttribute('aria-activedescendant')).toBeTruthy();
		await user.keyboard('{Enter}');
		expect(goto).toHaveBeenCalledWith('/app/devices?search=900100001&open=900100001');
		expect(screen.queryByRole('dialog')).toBeNull();

		const again = await setup();
		await again.user.keyboard('{Escape}');
		expect(screen.queryByRole('dialog')).toBeNull();
		expect(document.activeElement).toBe(again.opener);
		void opener;
	});

	test('Tab stays in the field', async () => {
		const { user, box } = await setup();
		await user.keyboard('{Tab}');
		expect(document.activeElement).toBe(box);
	});

	test('says what to type, how many results there are, or that nothing matched', async () => {
		const { user } = await setup();
		expect(screen.getByText('search.hint')).toBeInTheDocument();
		await user.keyboard('zzzz-nothing');
		expect(screen.getByText('search.no_results')).toBeInTheDocument();
	});
});
