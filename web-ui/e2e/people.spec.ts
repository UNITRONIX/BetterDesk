/**
 * People and activity pages, once per role: each page offers exactly the
 * actions the role's permissions (or the server's role checks) allow, a
 * role that may not open a page gets the "no access" page and no failed
 * request, the URL keeps the page's state, and axe finds nothing in the
 * page or in the opened menus, sheets and dialogs. Every hidden write is
 * also refused by the server (403). Only the admin run changes data: it
 * saves panel access for e2e_viewer (settings that change nothing for that
 * role) and for a user group it creates, and puts both back afterwards.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

interface Who {
	role: string;
	permissions: string[];
	isSuperAdmin: boolean;
	csrf: string;
}

async function who(page: Page): Promise<Who> {
	return page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		const b = await r.json();
		return { role: b.user.role, permissions: b.permissions, isSuperAdmin: b.isSuperAdmin, csrf: b.csrfToken };
	});
}

/**
 * A write the page hides must fail on the server too. Sent through the
 * context's request client (same cookies, not the page), so the expected
 * 403 is not one of the page's failed requests; the body is empty, so the
 * request is refused before any validation and changes nothing.
 */
async function refused(
	page: Page,
	csrf: string,
	method: 'POST' | 'PUT' | 'DELETE',
	path: string
): Promise<number> {
	return (await send(page, csrf, method, path, method === 'DELETE' ? undefined : {})).status();
}

/** A request with the page's session, outside the page (see refused) */
function send(page: Page, csrf: string, method: string, path: string, body?: unknown) {
	return page.request.fetch(path, {
		method,
		headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
		data: body === undefined ? undefined : JSON.stringify(body)
	});
}

const noAccess = (page: Page) =>
	page.getByRole('heading', { level: 1, name: "You don't have access to this page" });

for (const role of ROLES) {
	test.describe(`people pages as ${role}`, () => {
		test.use({ role });

		test('users: actions follow user.create, user.edit, user.delete; ?search= and #user-groups', async ({
			page
		}) => {
			await page.goto(`${UI}/users`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			if (!can('user.view')) {
				await expect(noAccess(page)).toBeVisible();
				await expectNoAxeViolations(page);
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();
			const rows = page.locator('.users-table tbody tr[data-index]');
			await expect(rows.first()).toBeVisible();
			const assigns = me.isSuperAdmin || me.role === 'global_admin';
			await expect(page.locator('.page-actions .add-user')).toHaveCount(
				can('user.create') && assigns ? 1 : 0
			);
			await expect(page.locator('#user-groups .add-group')).toHaveCount(can('user.edit') ? 1 : 0);
			await expectNoAxeViolations(page);

			// Search narrows the list and is kept in the address
			await page.getByRole('searchbox', { name: 'Search users' }).fill('e2e_viewer');
			await expect(rows).toHaveCount(1);
			await expect(page).toHaveURL(/[?&]search=e2e_viewer/);

			// The row's actions
			const row = rows.first();
			await row.getByRole('button', { name: 'More actions for e2e_viewer' }).click();
			const menu = page.getByRole('menu');
			await expect(menu.locator('.act-edit')).toHaveCount(can('user.edit') ? 1 : 0);
			await expect(menu.locator('.act-delete')).toHaveCount(can('user.delete') ? 1 : 0);
			await expect(menu.locator('.act-orgs')).toHaveCount(1);
			await expect(menu.locator('.act-access')).toHaveCount(1);
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();

			// A click on the row: the edit sheet, or the organizations sheet without user.edit
			await row.locator('.row-open').click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expect(sheet).toContainText(can('user.edit') ? 'Edit e2e_viewer' : 'e2e_viewer');
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			if (!can('user.create')) expect(await refused(page, me.csrf, 'POST', '/api/users')).toBe(403);
			if (!can('user.edit')) expect(await refused(page, me.csrf, 'POST', '/api/panel/user-groups')).toBe(403);

			await page.goto(`${UI}/users#user-groups`);
			await expect(page.locator('#user-groups')).toBeInViewport();
		});

		test('users: panel access is read-only with user.view, editable with user.edit, absent without', async ({
			page
		}) => {
			await page.goto(`${UI}/users`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			if (!can('user.view')) {
				await expect(noAccess(page)).toBeVisible();
				await expect(page.locator('.access-sheet')).toHaveCount(0);
				expect((await page.request.get('/api/panel/access/catalog')).status()).toBe(403);
				expect(await refused(page, me.csrf, 'PUT', '/api/panel/access/users/1')).toBe(403);
				return;
			}
			// The good practice card is gone (upstream dropped it)
			await expect(page.getByText('Good practice for accounts')).toHaveCount(0);

			const rows = page.locator('.users-table tbody tr[data-index]');
			const sheet = page.getByRole('dialog');
			const section = (key: string) => sheet.locator(`[data-access="${key}"]`);
			const feature = (key: string) => sheet.locator(`[data-feature="${key}"]`);
			const openFor = async (menuLabel: string) => {
				await page.getByRole('button', { name: menuLabel }).click();
				await page.getByRole('menu').locator('.act-access').click();
				await expect(section('devices')).toBeVisible();
			};
			const searchViewer = async () => {
				await page.getByRole('searchbox', { name: 'Search users' }).fill('e2e_viewer');
				await expect(rows).toHaveCount(1);
			};
			await searchViewer();

			if (!can('user.edit')) {
				await openFor('More actions for e2e_viewer');
				await expect(sheet).toContainText('Panel access for e2e_viewer');
				await expect(section('devices')).toContainText('Now:');
				await expect(sheet.getByRole('combobox')).toHaveCount(0);
				await expect(sheet.locator('[data-access^="group:"]')).toHaveCount(0);
				await expect(sheet.locator('.sheet-footer button')).toHaveText(['Close']);
				await expect(feature('client_actions')).toContainText('Always off');
				await expectNoAxeViolations(page);
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
				expect(await refused(page, me.csrf, 'PUT', '/api/panel/access/users/1')).toBe(403);
				return;
			}

			test.slow(me.role === 'admin', 'two save and reload round trips');
			if (me.role !== 'admin') {
				// Editable, but only the admin run saves, so parallel runs never write the same policy
				await openFor('More actions for e2e_viewer');
				await expect(section('group:core').getByRole('combobox')).toBeVisible();
				await expect(section('devices').getByRole('combobox')).toBeVisible();
				await expect(feature('tunnel').getByRole('combobox')).toBeVisible();
				await expect(feature('client_actions').getByRole('combobox')).toHaveCount(0);
				await expect(feature('client_actions')).toContainText('Always off');
				await expectNoAxeViolations(page);
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
				return;
			}

			// A user: settings that change nothing for e2e_viewer, whose role already gives none there
			const [loaded] = await Promise.all([
				page.waitForResponse(
					(r) => /\/api\/panel\/access\/users\/\d+$/.test(r.url()) && r.request().method() === 'GET'
				),
				openFor('More actions for e2e_viewer')
			]);
			const userPath = new URL(loaded.url()).pathname;
			const before = (await loaded.json()).data as { sections: unknown[]; features: unknown[] };
			try {
				await section('users').getByRole('combobox').selectOption('none');
				await section('group:system').getByRole('combobox').selectOption('none');
				await feature('privacy_mode').getByRole('combobox').selectOption('off');
				await expectNoAxeViolations(page);
				await sheet.getByRole('button', { name: 'Save' }).click();
				await expect(sheet).toContainText('Panel access saved.');
				await expect(section('users')).toContainText('Now: None, set for this person');
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();

				await page.reload();
				await searchViewer();
				await openFor('More actions for e2e_viewer');
				await expect(section('users').getByRole('combobox')).toHaveValue('none');
				await expect(section('group:system').getByRole('combobox')).toHaveValue('none');
				await expect(feature('privacy_mode').getByRole('combobox')).toHaveValue('off');
				await expect(section('devices').getByRole('combobox')).toHaveValue('inherit');
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
			} finally {
				const r = await send(page, me.csrf, 'PUT', userPath, {
					sections: before.sections,
					features: before.features
				});
				expect(r.status()).toBe(200);
			}

			// A user group: a new one without members, removed afterwards
			const name = `e2e access ${Date.now()}`;
			const created = await send(page, me.csrf, 'POST', '/api/panel/user-groups', { name });
			expect(created.status()).toBe(200);
			const guid = ((await created.json()).data.group as { guid: string }).guid;
			try {
				await page.goto(`${UI}/users#user-groups`);
				await openFor(`More actions for ${name}`);
				await expect(sheet).toContainText(`Panel access for ${name}`);
				await section('reports').getByRole('combobox').selectOption('read');
				await section('group:security').getByRole('combobox').selectOption('none');
				await feature('tunnel').getByRole('combobox').selectOption('off');
				await sheet.getByRole('button', { name: 'Save' }).click();
				await expect(sheet).toContainText('Panel access saved.');
				await expect(section('reports')).toContainText('Now: Read, set for this group');
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();

				await page.reload();
				await openFor(`More actions for ${name}`);
				await expect(section('reports').getByRole('combobox')).toHaveValue('read');
				await expect(section('group:security').getByRole('combobox')).toHaveValue('none');
				await expect(feature('tunnel').getByRole('combobox')).toHaveValue('off');
				await expect(section('devices').getByRole('combobox')).toHaveValue('inherit');
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
			} finally {
				// Deleting the group removes its policy too
				expect((await send(page, me.csrf, 'DELETE', `/api/panel/user-groups/${guid}`)).status()).toBe(200);
			}
		});

		test('organizations: create, edit and delete by org.*; the detail tabs follow the hash', async ({
			page
		}) => {
			await page.goto(`${UI}/organizations`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			await expect(page.getByRole('heading', { level: 1, name: 'Organizations' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Create organization' })).toHaveCount(
				can('org.create') ? 1 : 0
			);
			const rows = page.locator('.org-table tbody tr[data-index]');
			await expect(rows.first()).toBeVisible();
			await expect(rows.first().getByRole('button', { name: /Actions for/ })).toHaveCount(
				can('org.edit') || can('org.delete') ? 1 : 0
			);
			await expectNoAxeViolations(page);
			if (!can('org.create')) expect(await refused(page, me.csrf, 'POST', '/api/panel/org')).toBe(403);

			// One click on the row opens the organization
			await rows.first().locator('td').nth(1).click();
			await expect(page).toHaveURL(/\/organizations\/[^/]+$/);
			await expect(page.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
			await expect(page.getByRole('button', { name: 'Add user' })).toHaveCount(
				can('org.manage_users') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(
				can('org.edit') ? 1 : 0
			);
			if (!(can('org.manage_users') && can('user.view')))
				await expect(page.getByText('Your role cannot see this.').first()).toBeVisible();
			await expectNoAxeViolations(page);

			await page.getByRole('tab', { name: 'Devices' }).click();
			await expect(page).toHaveURL(/#devices$/);
			await expect(page.getByRole('button', { name: 'Assign device' })).toHaveCount(
				can('org.manage_devices') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: 'Create device group' })).toHaveCount(
				can('device.edit') ? 1 : 0
			);
			// R11: a device opens in the device list's panel
			const device = page.locator('a[href*="/devices?open="]').first();
			if (await device.count()) await expect(device).toHaveAttribute('href', /\/devices\?open=/);
			await expectNoAxeViolations(page);

			await page.getByRole('tab', { name: 'Address book' }).click();
			await expect(page.getByRole('button', { name: 'Save address book' })).toHaveCount(
				can('org.edit') ? 1 : 0
			);
			await page.getByRole('tab', { name: 'Settings' }).click();
			await expect(page.getByRole('button', { name: 'Save settings' })).toHaveCount(can('org.edit') ? 1 : 0);
			await expect(page.getByRole('button', { name: 'Delete organization…' })).toHaveCount(
				can('org.delete') ? 1 : 0
			);
			await expectNoAxeViolations(page);

			// The old #invitations opens the tab it is on
			await page.goto(page.url().replace(/#.*$/, '') + '#invitations');
			await expect(page.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
		});

		test('permissions: super admins only, ?role= follows the picker', async ({ page }) => {
			await page.goto(`${UI}/permissions?role=viewer`);
			const me = await who(page);
			if (!me.isSuperAdmin) {
				await expect(noAccess(page)).toBeVisible();
				expect(await refused(page, me.csrf, 'POST', '/api/panel/role-permissions')).toBe(403);
				return;
			}
			await expect(page.getByRole('combobox', { name: 'Role' })).toHaveValue('viewer');
			await expect(page.getByRole('switch').or(page.getByRole('checkbox')).first()).toBeVisible();
			await expectNoAxeViolations(page);
			await page.getByRole('combobox', { name: 'Role' }).selectOption('operator');
			await expect(page).toHaveURL(/[?&]role=operator/);
		});

		// Three tests: with axe at every step one would run past the 30 s test timeout
		test('security and audit: audit.view; ?tab=, ?q= and ?type= in the URL', async ({ page }) => {
			await page.goto(`${UI}/security-audit?tab=audit&q=login&type=signins`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			if (!can('audit.view')) {
				await expect(noAccess(page)).toBeVisible();
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Security and audit' })).toBeVisible();
			await expect(page.getByRole('searchbox')).toHaveValue('login');
			await expectNoAxeViolations(page);
			for (const [tab, name] of [
				['events', 'Server events'],
				['overview', 'Security checks'],
				['hardening', 'Hardening'],
				['sessions', 'Your sessions']
			] as const) {
				await page.getByRole('tab', { name }).click();
				await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`));
				await expect(page).not.toHaveURL(/[?&]q=/);
				await expectNoAxeViolations(page);
			}
			// The old name of the Hardening tab
			await page.goto(`${UI}/security-audit?tab=vulnerabilities`);
			await expect(page.getByRole('heading', { level: 1, name: 'Security and audit' })).toBeVisible();
			await expect(page.getByRole('tab', { name: 'Hardening' })).toHaveAttribute('aria-selected', 'true');
		});

		test('app usage: audit.view', async ({ page }) => {
			await page.goto(`${UI}/activity`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			if (!can('audit.view')) {
				await expect(noAccess(page)).toBeVisible();
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'App usage' })).toBeVisible();
			await expectNoAxeViolations(page);
		});

		test('reports: audit.view; save only for super_admin, admin and global_admin', async ({ page }) => {
			await page.goto(`${UI}/reports`);
			const me = await who(page);
			const can = (p: string) => me.isSuperAdmin || me.permissions.includes(p);
			if (!can('audit.view')) {
				await expect(noAccess(page)).toBeVisible();
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
			await page.getByRole('button', { name: 'Generate' }).first().click();
			const preview = page.locator('.preview');
			await expect(preview).toBeVisible();
			const manages = ['admin', 'super_admin', 'global_admin'].includes(me.role);
			await expect(preview.getByRole('button', { name: 'Save report' })).toHaveCount(manages ? 1 : 0);
			await expectNoAxeViolations(page);
			if (!manages) expect(await refused(page, me.csrf, 'POST', '/api/reports/save')).toBe(403);
		});
	});
}
