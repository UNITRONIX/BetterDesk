/**
 * Settings: the tab host (?tab=, old #<tab> and #<id> links, the search)
 * and the tabs General, Appearance and Sign-in, once per role. Each role
 * sees exactly the parts its permissions allow (server.config,
 * branding.edit), and axe finds nothing at each step. Nothing is saved.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

async function permissions(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		const boot = (await r.json()) as { permissions: string[]; isSuperAdmin: boolean };
		return boot.isSuperAdmin ? ['server.config', 'branding.edit', ...boot.permissions] : boot.permissions;
	});
}

const h1 = (page: Page) => page.getByRole('heading', { level: 1 });

for (const role of ROLES) {
	test.describe(`settings as ${role}`, () => {
		test.use({ role });

		test('General, Appearance and Sign-in show what the role may change', async ({ page }) => {
			await page.goto(`${UI}/settings`);
			await expect(h1(page)).toHaveText('General');
			const perms = await permissions(page);
			const config = perms.includes('server.config');
			const branding = perms.includes('branding.edit');

			await expect(page.locator('#server-info')).toBeVisible();
			await expect(page.locator('#public-server-id')).toHaveCount(config ? 1 : 0);
			await expect(page.locator('#general-form')).toHaveCount(config ? 1 : 0);
			if (config) await expect(page.locator('#mesh-settings-panel .state, #mesh-body').first()).toBeVisible();
			await expectNoAxeViolations(page);

			await page.goto(`${UI}/settings?tab=branding`);
			await expect(h1(page)).toHaveText('Appearance');
			await expect(page.locator('#branding-theme')).toBeVisible();
			const fieldset = page.locator('fieldset.settings-fieldset').first();
			if (branding) await expect(fieldset).toBeEnabled();
			else await expect(fieldset).toBeDisabled();
			await expect(page.locator('#branding-profiles')).toHaveCount(branding ? 1 : 0);
			await expect(page.locator('#branding-import-export')).toHaveCount(branding ? 1 : 0);
			await expect(page.getByRole('button', { name: /Reset appearance/ })).toHaveCount(branding ? 1 : 0);
			await expectNoAxeViolations(page);

			await page.goto(`${UI}/settings?tab=auth`);
			await expect(h1(page)).toHaveText('Sign-in');
			await expect(page.locator('#current-password')).toBeVisible();
			await expect(page.locator('#auth-panel-totp')).toBeVisible();
			for (const id of [
				'#enrollment-settings-section',
				'#client-sessions-form',
				'#ldap-form',
				'#oidc-form'
			]) {
				await expect(page.locator(id)).toHaveCount(config ? 1 : 0);
			}
			await expectNoAxeViolations(page);

			// The server tabs: open with server.config, one sentence otherwise
			await page.goto(`${UI}/settings?tab=backup`);
			if (config)
				await expect(page.getByText('Only administrators can see and change these settings.')).toHaveCount(0);
			else
				await expect(page.getByText('Only administrators can see and change these settings.')).toBeVisible();
		});

		test('the search finds only what the role can reach', async ({ page }) => {
			await page.goto(`${UI}/settings`);
			await expect(h1(page)).toBeVisible();
			const config = (await permissions(page)).includes('server.config');
			const search = page.getByRole('searchbox', { name: 'Search all settings' });
			await search.fill('ldap');
			const results = page.locator('#settings-search-results .list-row');
			if (config) await expect(results.first()).toBeVisible();
			else {
				await expect(page.locator('#settings-search-results')).toContainText('ldap');
				await expect(results).toHaveCount(0);
			}
			await search.fill('password');
			await expect(results.first()).toBeVisible();
			await expectNoAxeViolations(page);
			await search.press('Enter');
			await expect(page).toHaveURL(/[?&]tab=auth#/);
			await expect(search).toHaveValue('');
		});
	});
}

test.describe('settings links and search (admin)', () => {
	test.use({ role: 'admin' });

	test('old #<tab> and #server links become ?tab=; an unknown tab is General', async ({ page }) => {
		await page.goto(`${UI}/settings#branding`);
		await expect(page).toHaveURL(new RegExp(`${UI}/settings\\?tab=branding$`));
		await expect(h1(page)).toHaveText('Appearance');
		await page.goto(`${UI}/settings?tab=auth#server`);
		await expect(page).toHaveURL(new RegExp(`${UI}/settings$`));
		await page.goto(`${UI}/settings?tab=nonsense`);
		await expect(page).toHaveURL(new RegExp(`${UI}/settings$`));
		await expect(h1(page)).toHaveText('General');
	});

	test('#<id> on another tab switches there and shows the hidden field with a note', async ({ page }) => {
		await page.goto(`${UI}/settings#ldap-host`);
		await expect(page).toHaveURL(/\?tab=auth#ldap-host$/);
		const note = page.locator('#ldap-config-fields-note');
		await expect(note).toBeVisible();
		await expect(note).toContainText('LDAP');
		await expect(page.locator('#ldap-host')).toBeVisible();
		await expect(page.locator('#ldap-enabled')).toBeFocused();
		await expect(page.locator('#ldap-enabled')).not.toBeChecked();
		await expectNoAxeViolations(page);
	});

	test('a closed disclosure opens for its field', async ({ page }) => {
		await page.goto(`${UI}/settings?tab=branding#custom-css`);
		await expect(page.locator('#custom-css')).toBeVisible();
	});

	test('leaving a tab with unsaved changes asks first', async ({ page }) => {
		await page.goto(`${UI}/settings`);
		const field = page.locator('#public-server-id');
		await expect(field).toBeVisible();
		await page
			.waitForResponse((r) => r.url().includes('/api/settings/public-endpoints'))
			.catch(() => undefined);
		await field.fill('changed.example.com');
		await expect(page.locator('.save-bar.is-dirty')).toBeVisible();
		await page.getByRole('link', { name: 'Appearance' }).first().click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expectNoAxeViolations(page);
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(page).toHaveURL(new RegExp(`${UI}/settings$`));
		await expect(field).toHaveValue('changed.example.com');
	});

	test('mesh group menu and add dialog, then cancel', async ({ page }) => {
		await page.goto(`${UI}/settings#mesh-settings-panel`);
		const add = page.locator('#mesh-group-add');
		test.skip((await page.locator('#mesh-state').count()) > 0, 'MeshCentral is off on this server');
		await add.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();
		await expectNoAxeViolations(page);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(add).toBeFocused();
	});
});
