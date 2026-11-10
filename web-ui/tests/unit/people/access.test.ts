/**
 * Panel access on /users: the catalog as the editor shows it, a policy as
 * editor values and back to what the server stores, and the sheet itself
 * for someone who may edit and for someone who may only look.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import * as v from 'valibot';
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { AccessCatalog, AccessPolicy } from '../../../src/lib/api/access.ts';
import { setStrings } from '../../../src/lib/i18n/i18n.svelte.ts';
import {
	aboveRole,
	catalogGroups,
	sectionLabelKeys,
	sourceKey,
	toDraft,
	toPayload,
	type Draft
} from '../../../src/lib/people/access.ts';
import { session } from '../../../src/lib/state/session.svelte.ts';
import { dismissAll } from '../../../src/lib/ui/toasts.svelte.ts';
import AccessSheet from '../../../src/routes/(console)/users/AccessSheet.svelte';

/** A small catalog shaped like the server's, with its duplicate toolkit entry */
const RAW_CATALOG = {
	groups: [
		{ key: 'core', label: 'Core' },
		{ key: 'operations', label: 'Operations' },
		{ key: 'commercialization', label: 'Commercialization' },
		{ key: 'empty', label: 'Nothing here' }
	],
	sections: [
		{ key: 'dashboard', label: 'Dashboard', group: 'core' },
		{ key: 'devices', label: 'Devices', group: 'core' },
		{ key: 'toolkit', label: 'Toolkit', group: 'operations' },
		{ key: 'tickets', label: 'Tickets', group: 'operations' },
		{ key: 'scaling', label: 'Scaling', group: 'commercialization' },
		{ key: 'toolkit', label: 'Toolkit', group: 'commercialization' }
	],
	features: [
		{ key: 'remote_control', label: 'Remote control', hardLock: false },
		{ key: 'terminal', label: 'Terminal', hardLock: null },
		{ key: 'client_actions', label: 'Client actions', hardLock: true }
	]
};
const catalog = v.parse(AccessCatalog, RAW_CATALOG);

describe('the catalog as the editor shows it', () => {
	test('a section listed twice shows once, in the group the server resolves (its last entry)', () => {
		const groups = catalogGroups(catalog);
		expect(groups.map((g) => [g.key, g.sections.map((s) => s.key)])).toEqual([
			['core', ['dashboard', 'devices']],
			['operations', ['tickets']],
			['commercialization', ['scaling', 'toolkit']]
		]);
	});

	test('empty and missing values from the server become plain defaults', () => {
		const c = v.parse(AccessCatalog, { groups: null, sections: [{ key: 'x', label: null, group: 7 }] });
		expect(c.groups).toEqual([]);
		expect(c.features).toEqual([]);
		expect(c.sections[0]).toMatchObject({ key: 'x', label: '', group: '7' });
		const p = v.parse(AccessPolicy, { sections: [{ resource_key: 'x', access_level: 'admin' }] });
		// An unknown level counts as none, and a policy without a result has an empty one
		expect(p.sections[0]?.access_level).toBe('none');
		expect(p.effective).toEqual({ sections: {}, features: {}, groups: [] });
		const f = v.parse(AccessCatalog, {
			features: [
				{ key: 'a', hardLock: 1 },
				{ key: 'b', hardLock: '0' }
			]
		});
		expect(f.features.map((x) => x.hardLock)).toEqual([true, false]);
	});

	test('sections are labelled with the console navigation names', () => {
		expect(sectionLabelKeys('dashboard')[0]).toBe('nav.dashboard');
		expect(sectionLabelKeys('strategies')[0]).toBe('devices.strategies_title');
		expect(sectionLabelKeys('files')[0]).toBe('nav.file_transfer');
		expect(sectionLabelKeys('something-new')).toEqual(['users.access_section_something-new']);
	});
});

describe('a policy as editor values and back', () => {
	const policy = v.parse(AccessPolicy, {
		sections: [
			{ resource_key: 'devices', access_level: 'read' },
			{ resource_key: 'group:operations', access_level: 'none' },
			{ resource_key: 'toolkit', access_level: 'write' }
		],
		features: [
			{ feature_key: 'terminal', enabled: false },
			{ feature_key: 'remote_control', enabled: 1 },
			// Hard-locked: always off, whatever an old row says
			{ feature_key: 'client_actions', enabled: true }
		]
	});

	test('overrides show as their level, everything else as inherit', () => {
		const d = toDraft(catalog, policy);
		expect(d.sections).toEqual({
			dashboard: 'inherit',
			devices: 'read',
			toolkit: 'write',
			tickets: 'inherit',
			scaling: 'inherit'
		});
		expect(d.groups).toEqual({
			core: 'inherit',
			operations: 'none',
			commercialization: 'inherit',
			empty: 'inherit'
		});
		expect(d.features).toEqual({ remote_control: 'on', terminal: 'off', client_actions: 'inherit' });
	});

	test('saving sends only the overrides, the group settings as group:<key>, and no hard-locked feature', () => {
		const d = toDraft(catalog, policy);
		d.sections.dashboard = 'write';
		d.groups.core = 'read';
		d.features.client_actions = 'on';
		expect(toPayload(catalog, d)).toEqual({
			sections: [
				{ resource_key: 'dashboard', access_level: 'write' },
				{ resource_key: 'devices', access_level: 'read' },
				{ resource_key: 'toolkit', access_level: 'write' },
				{ resource_key: 'group:core', access_level: 'read' },
				{ resource_key: 'group:operations', access_level: 'none' }
			],
			features: [
				{ feature_key: 'remote_control', enabled: true },
				{ feature_key: 'terminal', enabled: false }
			]
		});
	});

	test('what is saved reads back as the same editor values', () => {
		const d: Draft = toDraft(catalog, policy);
		d.sections.scaling = 'none';
		d.groups.commercialization = 'write';
		d.features.terminal = 'inherit';
		const saved = v.parse(AccessPolicy, toPayload(catalog, d));
		expect(toDraft(catalog, saved)).toEqual(d);
	});

	test('everything on inherit clears the policy', () => {
		expect(toPayload(catalog, toDraft(catalog, v.parse(AccessPolicy, {})))).toEqual({
			sections: [],
			features: []
		});
	});

	test('a setting above the role ceiling is flagged, inherit and equal levels are not', () => {
		expect(aboveRole('write', 'read')).toBe(true);
		expect(aboveRole('read', 'none')).toBe(true);
		expect(aboveRole('read', 'read')).toBe(false);
		expect(aboveRole('none', 'write')).toBe(false);
		expect(aboveRole('inherit', 'none')).toBe(false);
		expect(aboveRole('write', undefined)).toBe(false);
	});

	test('where a value comes from depends on whose policy it is', () => {
		expect(sourceKey('user', 'user')).toBe('users.access_source_user');
		expect(sourceKey('group', 'user')).toBe('users.access_source_group');
		expect(sourceKey('group', 'group')).toBe('users.access_source_group_own');
		expect(sourceKey('role', 'user')).toBe('users.access_source_role');
		expect(sourceKey('unset', 'group')).toBe('users.access_source_unset');
		expect(sourceKey('default', 'user')).toBe('users.access_source_default');
	});
});

describe('the panel access sheet', () => {
	interface Call {
		method: string;
		path: string;
		body: unknown;
	}
	let calls: Call[] = [];

	const userPolicy = {
		sections: [{ resource_key: 'devices', access_level: 'read' }],
		features: [],
		effective: {
			sections: {
				dashboard: { access: 'read', source: 'role', role_ceiling: 'read' },
				devices: { access: 'read', source: 'user', role_ceiling: 'write' },
				tickets: { access: 'none', source: 'group', role_ceiling: 'read' },
				scaling: { access: 'none', source: 'role', role_ceiling: 'none' },
				toolkit: { access: 'read', source: 'role', role_ceiling: 'read' }
			},
			features: {
				remote_control: { enabled: true, source: 'default', hard_lock: false },
				terminal: { enabled: false, source: 'group', hard_lock: false },
				client_actions: { enabled: false, source: 'default', hard_lock: true }
			},
			groups: [{ guid: 'g1', name: 'Helpdesk' }]
		}
	};

	beforeAll(() => {
		setStrings('en', 'ltr', {
			users: {
				access_none: 'None',
				access_read: 'Read',
				access_write: 'Full',
				access_now: 'Now: {level}, {source}',
				access_now_role: 'Now: {level}, {source}. Role limit: {limit}',
				access_source_user: 'set for this person',
				access_source_group: 'from a group',
				access_source_role: 'from the role',
				access_source_default: 'default'
			},
			nav: { dashboard: 'Overview' },
			actions: { save: 'Save', cancel: 'Cancel', close: 'Close' }
		} as never);
	});

	beforeEach(() => {
		calls = [];
		session.user = { id: 1, username: 'demo', role: 'admin', preferredLanguage: null, avatarVersion: null };
		vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
			const url = new URL(input, location.origin);
			const method = init.method ?? 'GET';
			const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
			calls.push({ method, path: url.pathname, body });
			let data: unknown = userPolicy;
			if (url.pathname === '/api/panel/access/catalog') data = RAW_CATALOG;
			else if (method === 'PUT') {
				const b = body as { sections: unknown[]; features: unknown[] };
				data = {
					...b,
					effective: {
						...userPolicy.effective,
						sections: {
							...userPolicy.effective.sections,
							dashboard: { access: 'read', source: 'user', role_ceiling: 'read' }
						}
					}
				};
			}
			const payload = { success: true, data };
			return {
				ok: true,
				status: 200,
				redirected: false,
				url: url.href,
				headers: new Headers({ 'content-type': 'application/json' }),
				json: async () => payload,
				text: async () => JSON.stringify(payload)
			} as unknown as Response;
		});
	});

	afterEach(() => {
		cleanup();
		dismissAll();
		vi.unstubAllGlobals();
		session.permissions = [];
		session.user = null;
	});

	const row = (key: string) => document.querySelector(`[data-access="${key}"]`) as HTMLElement;
	const feature = (key: string) => document.querySelector(`[data-feature="${key}"]`) as HTMLElement;

	test('with user.edit: every section, group setting and open feature has a control, and Save sends the policy', async () => {
		session.permissions = ['user.view', 'user.edit'];
		const user = userEvent.setup();
		render(AccessSheet, {
			subject: { kind: 'user', id: 7 },
			name: 'anna',
			role: 'operator',
			onclose: () => {}
		});
		await waitFor(() => expect(row('devices')).not.toBeNull());
		expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([
			'GET /api/panel/access/catalog',
			'GET /api/panel/access/users/7'
		]);
		// Once loaded, focus is on the first setting, not lost with the loading state
		await waitFor(() => expect(within(row('group:core')).getByRole('combobox')).toHaveFocus());
		expect(document.querySelector('.sheet-body')).not.toHaveAttribute('tabindex');
		expect(screen.getByText('users.access_policy_hint')).toBeInTheDocument();

		// What applies now and where it comes from, under each section
		expect(
			within(row('devices')).getByText('Now: Read, set for this person. Role limit: Full')
		).toBeInTheDocument();
		expect(within(row('dashboard')).getByText('Now: Read, from the role')).toBeInTheDocument();
		expect(within(row('devices')).getByRole('combobox')).toHaveValue('read');
		expect(within(row('dashboard')).getByRole('combobox')).toHaveValue('inherit');
		expect(row('group:core')).not.toBeNull();
		// Sections carry the navigation's names
		expect(within(row('dashboard')).getByText('Overview')).toBeInTheDocument();
		// The person's groups are listed
		expect(screen.getByText('Helpdesk')).toBeInTheDocument();
		// Hard-locked: shown as off, no control
		expect(within(feature('client_actions')).queryByRole('combobox')).toBeNull();
		expect(within(feature('client_actions')).getByText('Always off')).toBeInTheDocument();
		expect(within(feature('terminal')).getByRole('combobox')).toHaveValue('inherit');

		// Above the role ceiling: a warning that the role still limits it
		await user.selectOptions(within(row('dashboard')).getByRole('combobox'), 'write');
		const warning = within(row('dashboard')).getByText(/that limit still applies/);
		expect(within(row('dashboard')).getByRole('combobox').getAttribute('aria-describedby')).toContain(
			warning.id
		);
		await user.selectOptions(within(row('group:operations')).getByRole('combobox'), 'none');
		await user.selectOptions(within(feature('terminal')).getByRole('combobox'), 'on');

		await user.click(screen.getByRole('button', { name: 'Save' }));
		await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
		const put = calls.find((c) => c.method === 'PUT') as Call;
		expect(put.path).toBe('/api/panel/access/users/7');
		expect(put.body).toEqual({
			sections: [
				{ resource_key: 'dashboard', access_level: 'write' },
				{ resource_key: 'devices', access_level: 'read' },
				{ resource_key: 'group:operations', access_level: 'none' }
			],
			features: [{ feature_key: 'terminal', enabled: true }]
		});
		// The answer replaces what applies now
		await waitFor(() =>
			expect(within(row('dashboard')).getByText('Now: Read, set for this person')).toBeInTheDocument()
		);
	});

	test('with only user.view: what applies now, without controls or Save', async () => {
		session.permissions = ['user.view'];
		render(AccessSheet, { subject: { kind: 'group', guid: 'g1' }, name: 'Helpdesk', onclose: () => {} });
		await waitFor(() => expect(row('devices')).not.toBeNull());
		expect(calls.map((c) => c.path)).toContain('/api/panel/access/groups/g1');
		expect(screen.queryAllByRole('combobox')).toEqual([]);
		expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
		const footer = document.querySelector('.sheet-footer') as HTMLElement;
		expect(
			within(footer)
				.getAllByRole('button')
				.map((b) => b.textContent?.trim())
		).toEqual(['Close']);
		// "Choose ..." is for those who can choose
		expect(screen.queryByText('users.access_policy_hint')).toBeNull();
		// Nothing in the list takes focus, so the list itself can be scrolled with the keyboard
		const region = screen.getByRole('region', { name: 'Panel access for Helpdesk' });
		expect(region).toHaveAttribute('tabindex', '0');
		expect(region).toContainElement(row('devices'));
		// No group shortcut rows when nothing can be changed
		expect(row('group:core')).toBeNull();
		// A group has no role, so no role limit
		expect(within(row('devices')).getByText('Now: Read, set for this person')).toBeInTheDocument();
	});

	test('editing your own account warns that you can lock yourself out', async () => {
		session.permissions = ['user.view', 'user.edit'];
		render(AccessSheet, { subject: { kind: 'user', id: 1 }, name: 'demo', onclose: () => {} });
		await waitFor(() => expect(row('devices')).not.toBeNull());
		expect(screen.getByText(/apply to your own account/)).toBeInTheDocument();
		cleanup();
		render(AccessSheet, { subject: { kind: 'user', id: 7 }, name: 'anna', onclose: () => {} });
		await waitFor(() => expect(row('devices')).not.toBeNull());
		expect(screen.queryByText(/apply to your own account/)).toBeNull();
	});
});
