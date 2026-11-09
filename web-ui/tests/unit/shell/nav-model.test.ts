import { describe, expect, test } from 'vitest';
import adminNav from '../../fixtures/nav-admin.json';
import viewerNav from '../../fixtures/nav-viewer.json';
import type { NavSection } from '../../../src/lib/api/console.ts';
import {
	bottomItems,
	breadcrumb,
	buildNavModel,
	clampWidth,
	moreOpen,
	pageKey,
	parseWidth,
	readFlags,
	sectionOpen,
	searchPages,
	writeFlags,
	type NavRow
} from '../../../src/lib/shell/nav-model.ts';

const admin = adminNav as NavSection[];
const viewer = viewerNav as NavSection[];

const texts = (rows: NavRow[]) => rows.map((r) => (r.kind === 'group' ? `# ${r.text}` : r.page.text));

describe('pageKey (lib/consoleNav.js pageKey)', () => {
	test.each([
		['/', '', 'dashboard'],
		['/', '?activateAgent=1', 'activate-agent'],
		['/devices', '?open=900100001', 'devices'],
		['/devices/900100001', '', 'devices'],
		['/settings', '', 'settings:general'],
		['/settings', '?tab=auth', 'settings:auth'],
		['/server-management', '', 'server-management:overview'],
		['/server-management', '?tab=files', 'server-management:files'],
		['/commercialization', '', 'commercialization:packages'],
		['/commercialization', '?tab=reports', 'commercialization:sessions'],
		['/commercialization', '?tab=sessions', 'commercialization:sessions'],
		['/generator', '', 'agents'],
		['/help-requests', '', 'help-requests']
	])('%s%s is %s', (path, search, key) => {
		expect(pageKey(path, search)).toBe(key);
	});
});

describe('buildNavModel', () => {
	test('marks the current page and its section', () => {
		const m = buildNavModel(admin, pageKey('/settings', '?tab=auth'));
		expect(m.activePage?.href).toBe('/settings?tab=auth');
		expect(m.activeSection?.id).toBe('settings');
		const settings = m.sections.find((s) => s.id === 'settings')!;
		expect(settings.active).toBe(true);
		expect(settings.moreActive).toBe(true);
		expect(m.sections.filter((s) => s.active)).toHaveLength(1);
	});

	test('a page that is not in the navigation marks nothing', () => {
		const m = buildNavModel(admin, pageKey('/settings', '?tab=nope'));
		expect(m.activePage).toBeNull();
		expect(m.sections.some((s) => s.active || s.core.some((i) => i.active))).toBe(false);
	});

	test('core pages stay, the rest go under More in the server order', () => {
		const devices = buildNavModel(admin, 'devices').sections[0]!;
		expect(devices.core.map((i) => i.page.text)).toEqual([
			'Overview',
			'All devices',
			'Enrollment requests',
			'Remote desktop in browser'
		]);
		expect(texts(devices.more)).toEqual([
			'Activate support agent',
			'Inventory',
			'Network monitoring',
			'Fleet tasks',
			'Platform support',
			'IoT devices (CDAP)'
		]);
		expect(devices.moreCount).toBe(6);
	});

	test('a section with only one extra page shows everything, in order', () => {
		// Viewer: Activity has two core pages and one other (App usage)
		const activity = buildNavModel(viewer, 'reports').sections.find((s) => s.id === 'activity')!;
		expect(activity.core.map((i) => i.page.text)).toEqual(['Security and audit', 'App usage', 'Reports']);
		expect(activity.more).toEqual([]);
		expect(activity.moreCount).toBe(0);
	});

	test('a heading where the group changes, only in the More list', () => {
		const settings = buildNavModel(admin, 'devices').sections.find((s) => s.id === 'settings')!;
		expect(settings.core.map((i) => i.page.text)).toEqual(['General', 'Client setup', 'Server status']);
		const rows = texts(settings.more);
		expect(rows.filter((r) => r.startsWith('# '))).toEqual([
			'# Console',
			'# Clients and enrollment',
			'# Rules',
			'# Server',
			'# Billing',
			'# Developer tools'
		]);
		// Each heading comes right before the first page of its group, and once
		expect(rows.slice(0, 3)).toEqual(['# Console', 'Appearance', 'Sign-in']);
		expect(rows.indexOf('# Clients and enrollment')).toBe(rows.indexOf('Translations') + 1);
	});

	test('sections and pages are exactly what the server sent', () => {
		const m = buildNavModel(viewer, 'devices');
		const all = m.sections.flatMap((s) => [...s.core, ...s.more].filter((r) => r.kind === 'page'));
		expect(all).toHaveLength(viewer.flatMap((s) => s.pages).length);
		expect(m.sections.map((s) => s.id)).toEqual(viewer.map((s) => s.id));
	});
});

describe('breadcrumb', () => {
	test('section, then page', () => {
		expect(breadcrumb(buildNavModel(admin, 'devices'))).toEqual(['Devices', 'All devices']);
	});
	test('a page title replaces the page; no section when the page is not in the navigation', () => {
		expect(breadcrumb(buildNavModel(admin, 'devices'), 'demo-pc')).toEqual(['Devices', 'demo-pc']);
		expect(breadcrumb(buildNavModel(admin, 'nowhere'), 'Profile')).toEqual(['Profile']);
	});
});

describe('bottomItems', () => {
	test('Remote only when the person may use it (it was shown to everyone)', () => {
		expect(bottomItems(admin, 'devices').map((b) => b.id)).toEqual(['home', 'devices', 'remote', 'chat']);
		expect(bottomItems(viewer, 'devices').map((b) => b.id)).toEqual(['home', 'devices', 'chat']);
	});
	test('marks the current one', () => {
		expect(
			bottomItems(admin, 'chat')
				.filter((b) => b.active)
				.map((b) => b.id)
		).toEqual(['chat']);
	});
});

describe('searchPages', () => {
	test('every page with its section and group', () => {
		const pages = searchPages(admin);
		expect(pages).toHaveLength(admin.flatMap((s) => s.pages).length);
		expect(pages.find((p) => p.href === '/settings?tab=auth')).toMatchObject({
			section: 'Settings',
			group: 'Console',
			keywords: expect.stringContaining('2fa')
		});
	});
});

describe('remembered state', () => {
	test('the current section is open unless closed on this page; others follow this tab', () => {
		const here = new Set<string>();
		expect(sectionOpen({ id: 'devices', active: true }, {}, here)).toBe(true);
		expect(sectionOpen({ id: 'devices', active: true }, { devices: true }, here)).toBe(true);
		expect(sectionOpen({ id: 'devices', active: true }, {}, new Set(['devices']))).toBe(false);
		expect(sectionOpen({ id: 'support', active: false }, {}, here)).toBe(false);
		expect(sectionOpen({ id: 'support', active: false }, { support: false }, here)).toBe(true);
		expect(sectionOpen({ id: 'support', active: false }, { support: true }, here)).toBe(false);
	});

	test('More is open for the current page, a stored choice, or a choice made here', () => {
		expect(moreOpen({ id: 'devices', moreActive: false }, {}, {})).toBe(false);
		expect(moreOpen({ id: 'devices', moreActive: true }, {}, {})).toBe(true);
		expect(moreOpen({ id: 'devices', moreActive: false }, { devices: true }, {})).toBe(true);
		expect(moreOpen({ id: 'devices', moreActive: true }, {}, { devices: false })).toBe(false);
	});

	test('flags read and write the old JSON, ignore junk and survive blocked storage', () => {
		const store = new Map<string, string>();
		const storage = {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v)
		};
		writeFlags(storage, 'bd_nav_more_open', { devices: true, settings: false });
		expect(store.get('bd_nav_more_open')).toBe('{"devices":true,"settings":false}');
		expect(readFlags(storage, 'bd_nav_more_open')).toEqual({ devices: true, settings: false });
		store.set('x', '{"a":true,"b":"yes","c":1}');
		expect(readFlags(storage, 'x')).toEqual({ a: true });
		store.set('y', 'not json');
		expect(readFlags(storage, 'y')).toEqual({});
		store.set('z', '[true]');
		expect(readFlags(storage, 'z')).toEqual({});
		const blocked = {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		};
		expect(readFlags(blocked, 'k')).toEqual({});
		expect(() => writeFlags(blocked, 'k', { a: true })).not.toThrow();
	});

	test('width stays within 200 to 320 px', () => {
		expect(clampWidth(150)).toBe(200);
		expect(clampWidth(500)).toBe(320);
		expect(parseWidth('260')).toBe(260);
		expect(parseWidth('480')).toBe(320);
		expect(parseWidth('abc')).toBeNull();
		expect(parseWidth(null)).toBeNull();
	});
});
