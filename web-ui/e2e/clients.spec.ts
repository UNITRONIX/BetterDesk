/**
 * Clients and enrollment pages, once per role: each page opens for exactly
 * the roles its route lets in (the others see the "no access" page instead
 * of failing requests), every visible action matches the permissions, and
 * axe finds nothing in the page or in the sheet and dialogs it opens.
 * Nothing is saved: dialogs and sheets are closed with Cancel or Escape.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];
const ADMIN_ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin'];

async function permissions(page: Page): Promise<string[]> {
	return page.evaluate(async () => {
		const res = await fetch('/api/console/bootstrap', { headers: { Accept: 'application/json' } });
		const boot = (await res.json()) as { permissions: string[]; isSuperAdmin: boolean };
		return boot.isSuperAdmin ? ['*'] : boot.permissions;
	});
}

const has = (perms: string[], p: string) => perms.includes('*') || perms.includes(p);

async function expectNoAccess(page: Page) {
	await expect(page.getByRole('heading', { level: 1, name: /access/i })).toBeVisible();
	await expectNoAxeViolations(page);
}

for (const role of ROLES) {
	test.describe(`clients and enrollment as ${role}`, () => {
		test.use({ role });

		test('enrollment requests', async ({ page }) => {
			await page.goto(`${UI}/registrations`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const perms = await permissions(page);
			if (!has(perms, 'enrollment.approve')) return expectNoAccess(page);

			const table = page.locator('.registrations-table');
			await expect(table.locator('tbody tr').first()).toBeVisible();
			await expect(page.getByRole('searchbox')).toBeVisible();
			await expectNoAxeViolations(page);

			// All requests, then the first row's sheet: facts, and the approve form for a waiting one
			await page.getByRole('button', { name: 'All', exact: true }).click();
			const first = table.locator('tbody tr[data-key]').first();
			if ((await first.count()) === 0) return;
			const waiting = (await first.getAttribute('class'))?.includes('is-pending');
			await first.locator('.row-open').click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expect(sheet.locator('.facts').first()).toContainText(/\d/);
			if (waiting) await expect(sheet.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			// The row menu: Copy ID always; Delete record only with enrollment.manage on decided LAN requests
			await first.getByRole('button', { name: /^Actions:/ }).click();
			const menu = page.getByRole('menu');
			await expect(menu.locator('.act-copy')).toBeVisible();
			if (!has(perms, 'enrollment.manage')) await expect(menu.locator('.act-delete')).toHaveCount(0);
			await page.keyboard.press('Escape');

			// Reject asks first, in a dialog
			if (waiting) {
				await first.locator('.act-reject').click();
				const dialog = page.getByRole('dialog');
				await expect(dialog).toBeVisible();
				await expectNoAxeViolations(page);
				await dialog.getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog).toBeHidden();
			}
		});

		test('client setup', async ({ page }) => {
			await page.goto(`${UI}/keys`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const perms = await permissions(page);
			// Every signed-in role reads the values (the route needs only a session)
			await expect(page.locator('.keys-facts').first().locator('.value-field').first()).toBeVisible();
			await expect(page.getByRole('img', { name: /QR/i })).toBeVisible();
			await expectNoAxeViolations(page);

			await page.locator('.keys-scripts summary').click();
			await expect(page.locator('.keys-scripts .api-key')).not.toHaveText('…');
			await expect(page.locator('.show-api-key')).toHaveCount(has(perms, 'server.keys') ? 1 : 0);
			// Next steps: each link needs its page's permission
			const next = page.locator('[aria-labelledby="keys-next-title"]');
			await expect(next.getByRole('link', { name: 'Device tokens' })).toHaveCount(
				has(perms, 'enrollment.manage') ? 1 : 0
			);
			await expect(next.getByRole('link', { name: 'Pairing codes' })).toHaveCount(
				has(perms, 'enrollment.approve') ? 1 : 0
			);
			await expectNoAxeViolations(page);
		});

		test('device tokens', async ({ page }) => {
			await page.goto(`${UI}/tokens`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const perms = await permissions(page);
			if (!has(perms, 'enrollment.manage')) return expectNoAccess(page);

			await expect(page.getByRole('radiogroup')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.locator('.act-create').click();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			// Name is required: the dialog stays and says so
			await dialog.locator('.token-save').click();
			await expect(dialog.locator('[aria-invalid="true"]')).toBeFocused();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(dialog).toBeHidden();
			await expect(page.locator('.act-create')).toBeFocused();

			await page.locator('.act-bulk').click();
			await expect(dialog).toBeVisible();
			await expectNoAxeViolations(page);
			await dialog.getByRole('button', { name: 'Cancel' }).click();
		});

		test('pairing codes', async ({ page }) => {
			await page.goto(`${UI}/pairing`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const perms = await permissions(page);
			if (!has(perms, 'enrollment.approve')) return expectNoAccess(page);
			await expect(page.locator('.pairing-generate')).toBeVisible();
			await expect(page.getByRole('table')).toBeVisible();
			await expectNoAxeViolations(page);
		});

		test('support agents', async ({ page }) => {
			await page.goto(`${UI}/agents`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			if (!ADMIN_ROLES.includes(role)) return expectNoAccess(page);
			const perms = await permissions(page);
			await expect(page.locator('.agents-import')).toHaveCount(has(perms, 'enrollment.manage') ? 1 : 0);
			await expect(page.getByRole('link', { name: 'Open the download page' })).toHaveAttribute(
				'target',
				'_blank'
			);
			await expect(page.locator('main').getByRole('link', { name: 'Client app branding' })).toHaveCount(
				has(perms, 'branding.edit') ? 1 : 0
			);
			await expectNoAxeViolations(page);
		});

		test('client app branding', async ({ page }) => {
			await page.goto(`${UI}/client-branding`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const perms = await permissions(page);
			if (!has(perms, 'branding.edit')) return expectNoAccess(page);
			const name = page.getByLabel('Company name');
			await expect(name).not.toHaveValue('');
			// The preview follows the form; the save bar says there are changes
			const before = await name.inputValue();
			await name.fill('Preview Test');
			await expect(page.locator('.cb-pv-name')).toHaveText('Preview Test');
			await expect(page.locator('.save-bar')).toContainText('Unsaved');
			await expectNoAxeViolations(page);
			await name.fill(before);
			await expect(page.locator('.save-bar')).not.toContainText('Unsaved');
		});
	});
}
