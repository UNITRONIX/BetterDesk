/**
 * Billing (/commercialization), once per role: the page needs billing.view;
 * New package, Assign package and the row menus need billing.manage; Write
 * report billing.reports; Export billing.export. Deep links: ?tab=reports
 * is the sessions view, ?settings=1 opens the billing settings. axe on both
 * views, the month preview, the session details and the report dialog. An
 * admin creates a package and deletes it again.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

async function perms(page: Page): Promise<(p: string) => boolean> {
	const boot = await page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', { headers: { Accept: 'application/json' } });
		return (await r.json()) as { permissions: string[]; isSuperAdmin: boolean };
	});
	return (p) => boot.isSuperAdmin || boot.permissions.includes(p);
}

for (const role of ROLES) {
	test.describe(`billing as ${role}`, () => {
		test.use({ role });

		test('packages follow billing.view and billing.manage', async ({ page }) => {
			await page.goto(`${UI}/commercialization?tab=packages`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const can = await perms(page);
			if (!can('billing.view')) {
				await expect(page.locator('.package-new')).toHaveCount(0);
				return;
			}
			await expect(page.locator('.package-new')).toHaveCount(can('billing.manage') ? 1 : 0);
			await expect(page.locator('.contract-new')).toHaveCount(can('billing.manage') ? 1 : 0);
			const pkg = page.locator('.packages-table tbody tr[data-key]').first();
			await expect(pkg).toBeVisible({ timeout: 15_000 });
			await expect(pkg.getByRole('button', { name: /^Actions for/ })).toHaveCount(
				can('billing.manage') ? 1 : 0
			);
			await expectNoAxeViolations(page);

			// The month preview from a click on the row
			await pkg.locator('.row-open').click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expect(sheet.locator('.facts')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			// ?settings=1 opens the billing settings
			await page.goto(`${UI}/commercialization?settings=1`);
			await expect(page.locator('#billing-settings-panel details')).toHaveAttribute('open', '');
			await expect(page.locator('#billing-settings-panel .save-bar')).toHaveCount(
				can('billing.manage') ? 1 : 0
			);
			await expectNoAxeViolations(page);

			if (role !== 'admin') return;
			const name = `e2e package ${Date.now()}`;
			await page.locator('.package-new').click();
			await expect(sheet).toBeVisible();
			await expectNoAxeViolations(page);
			await sheet.getByLabel('Name', { exact: true }).fill(name);
			await sheet.locator('.package-save').click();
			await expect(sheet).toBeHidden();
			const row = page.locator('.packages-table tbody tr', { hasText: name });
			await expect(row).toHaveCount(1);
			await row.getByRole('button', { name: /^Actions for/ }).click();
			await page.getByRole('menu').locator('.act-delete').click();
			await page.getByRole('dialog').getByRole('button', { name: 'Delete package' }).click();
			await expect(row).toHaveCount(0);
		});

		test('sessions follow billing.reports and billing.export', async ({ page }) => {
			await page.goto(`${UI}/commercialization?tab=reports`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const can = await perms(page);
			if (!can('billing.view')) return;
			await expect(page).toHaveURL(/tab=reports/);
			await expect(page.locator('.sessions-refresh')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Export' })).toHaveCount(can('billing.export') ? 1 : 0);
			const rows = page.locator('.sessions-table tbody tr[data-key]');
			await expect(rows.first()).toBeVisible({ timeout: 15_000 });
			if (!can('billing.reports')) await expect(page.locator('.write-report')).toHaveCount(0);
			await expectNoAxeViolations(page);

			await rows.first().locator('.session-details').click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');

			const write = page.locator('.write-report').first();
			if (can('billing.reports') && (await write.count())) {
				await write.click();
				const dialog = page.getByRole('dialog');
				await expect(dialog.locator('textarea')).toBeVisible();
				await expectNoAxeViolations(page);
				await dialog.getByRole('button', { name: 'Cancel' }).click();
				await expect(dialog).toBeHidden();
			}
		});
	});
}
