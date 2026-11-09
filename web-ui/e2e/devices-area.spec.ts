/**
 * The overview, Inventory, Network monitoring and Platform support, once per
 * role: every action shows exactly when the role's permissions allow it
 * (the server checks the same permissions), the main tasks work, and axe
 * finds nothing on the page or in the dialogs, sheets and menus it opens.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

interface Boot {
	permissions: string[];
	isSuperAdmin: boolean;
	nav: { pages: { page: string }[] }[];
}

async function boot(page: Page): Promise<{ can: (p: string) => boolean; nav: Set<string> }> {
	const b = await page.evaluate(
		async () =>
			(await (
				await fetch('/api/console/bootstrap', {
					credentials: 'same-origin',
					headers: { Accept: 'application/json' }
				})
			).json()) as Boot
	);
	return {
		can: (p: string) => b.isSuperAdmin || b.permissions.includes(p),
		nav: new Set(b.nav.flatMap((s) => s.pages.map((x) => x.page)))
	};
}

/** The page itself, without the shell (the sidebar has its own "More" and page links) */
const main = (page: Page) => page.locator('#main-content');

for (const role of ROLES) {
	test.describe(`devices area as ${role}`, () => {
		test.use({ role });

		test('overview: parts and actions follow the permissions', async ({ page }) => {
			await page.goto(`${UI}/`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const { can, nav } = await boot(page);
			await expect(main(page).getByRole('heading', { name: /Client setup/ })).toBeVisible();
			// Devices are found with the top bar's search; the page has none of its own
			await expect(main(page).getByRole('search')).toHaveCount(0);
			await expect(page.locator('.devices-now')).toHaveCount(can('device.view') ? 1 : 0);
			// Agents pair with a one-time code; the QR scanner opens from that dialog
			await expect(main(page).getByRole('button', { name: 'Pair with code' })).toHaveCount(
				can('enrollment.approve') ? 1 : 0
			);
			await expect(main(page).getByRole('button', { name: 'Activate support agent' })).toHaveCount(0);
			await expect(main(page).getByRole('link', { name: 'Open server status' })).toHaveCount(
				nav.has('server-management:overview') ? 1 : 0
			);
			await expect(main(page).getByRole('link', { name: /^Support agents/ })).toHaveCount(
				nav.has('agents') ? 1 : 0
			);
			await expect(main(page).getByRole('link', { name: 'Server key and QR code' })).toHaveCount(
				nav.has('keys') ? 1 : 0
			);
			await expect(main(page).getByRole('heading', { name: 'Trends' })).toHaveCount(
				can('audit.view') ? 1 : 0
			);
			await expectNoAxeViolations(page);

			// More: copy the deploy string, or open the Windows install script
			await main(page).getByRole('button', { name: 'More', exact: true }).click();
			await expect(page.getByRole('menu')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.getByRole('menuitem', { name: /Windows install script/ }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expect(sheet.locator('pre')).toContainText('$ServerHost');
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			// The configuration as a QR code
			await main(page).getByRole('button', { name: 'Show QR' }).click();
			await expect(page.getByRole('dialog').getByRole('img')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');

			// Pair with code opens the pairing dialog; Escape closes it and focus goes back
			if (can('enrollment.approve')) {
				const pair = main(page).getByRole('button', { name: 'Pair with code' });
				await pair.click();
				const dialog = page.getByRole('dialog', { name: 'Pairing code' });
				await expect(dialog).toBeVisible();
				await page.keyboard.press('Escape');
				await expect(dialog).toBeHidden();
				await expect(pair).toBeFocused();
			}
		});

		test('overview: ?activateAgent=1 pairs an agent with a one-time code, only for enrollment.approve', async ({
			page
		}) => {
			await page.goto(`${UI}/?activateAgent=1`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const { can } = await boot(page);
			const dialog = page.getByRole('dialog', { name: 'Pairing code' });
			if (!can('enrollment.approve')) {
				await page.waitForTimeout(500);
				await expect(page.getByRole('dialog')).toHaveCount(0);
				return;
			}
			await expect(page).toHaveTitle(/^Pair agent/);
			await expect(dialog).toBeVisible();
			// The client address is filled in; the label is optional
			await expect(dialog.getByLabel('Server address')).not.toHaveValue('');
			await expectNoAxeViolations(page);

			// A code, shown once with the address and how long it works
			await dialog.getByLabel('Label (optional)').fill('e2e devices area');
			const created = page.waitForResponse(
				(r) => r.request().method() === 'POST' && r.url().endsWith('/api/panel/pairing/codes')
			);
			await dialog.getByRole('button', { name: 'Create code' }).click();
			const answer = (await (await created).json()) as { id?: string | number; code?: string };
			try {
				expect(answer.code).toBeTruthy();
				await expect(dialog.getByText(String(answer.code))).toBeVisible();
				await expect(dialog.getByText(/more minutes, works once/)).toBeVisible();
				await expect(dialog.getByRole('button', { name: 'Copy Pairing code' })).toBeVisible();
				await expectNoAxeViolations(page);
			} finally {
				// The code is only for this test: revoke it again
				await page.evaluate(async (id) => {
					const boot = (await (
						await fetch('/api/console/bootstrap', { headers: { Accept: 'application/json' } })
					).json()) as {
						csrfToken: string;
					};
					await fetch(`/api/panel/pairing/codes/${encodeURIComponent(String(id))}`, {
						method: 'DELETE',
						headers: { 'X-CSRF-Token': boot.csrfToken, Accept: 'application/json' }
					});
				}, answer.id);
			}

			// The agent's QR code can still be read: the scanner replaces the dialog
			await dialog.getByRole('button', { name: 'Scan agent QR' }).click();
			const scanner = page.getByRole('dialog', { name: 'Scan agent QR' });
			await expect(scanner).toBeVisible();
			await expect(dialog).toBeHidden();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(scanner).toBeHidden();
		});

		test('inventory: a row opens the device on Hardware', async ({ page }) => {
			await page.goto(`${UI}/inventory`);
			const { can } = await boot(page);
			test.skip(!can('device.view'), 'no device.view');
			const rows = page.locator('.inventory-page tbody .row-open');
			await expect(rows.first()).toBeVisible();
			await expectNoAxeViolations(page);
			await rows.first().click();
			const panel = page.getByRole('dialog');
			await expect(panel.getByRole('tab', { name: 'Hardware', selected: true })).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(panel).toBeHidden();
			await expect(rows.first()).toBeFocused();
		});

		test('network: add, edit, delete and check follow the permissions', async ({ page }) => {
			await page.goto(`${UI}/network`);
			const { can } = await boot(page);
			test.skip(!can('device.view'), 'no device.view');
			await expect(main(page).getByRole('heading', { name: 'Automatic checks' })).toBeVisible();
			await expect(main(page).getByRole('button', { name: 'Add target' })).toHaveCount(
				can('server.config') ? 1 : 0
			);
			await expect(page.locator('.monitor-bar button')).toHaveCount(can('server.config') ? 1 : 0);
			await expect(main(page).getByRole('link', { name: 'Network tools' })).toHaveCount(
				can('device.connect') ? 1 : 0
			);
			await expectNoAxeViolations(page);
			if (can('server.config')) {
				await main(page).getByRole('button', { name: 'Add target' }).click();
				const sheet = page.getByRole('dialog');
				await expect(sheet).toBeVisible();
				// Nothing typed: refused at the fields, nothing sent
				await sheet.getByRole('button', { name: 'Add target' }).click();
				await expect(sheet.locator('[aria-invalid="true"]')).toHaveCount(2);
				await expectNoAxeViolations(page);
				await page.keyboard.press('Escape');
				await expect(sheet).toBeHidden();
			}
			const rows = page.locator('.network-page tbody tr:has(.row-open)');
			if (await rows.count()) {
				await expect(rows.first().locator('.check-btn')).toHaveCount(can('device.connect') ? 1 : 0);
				await rows
					.first()
					.getByRole('button', { name: /^Actions for/ })
					.click();
				const menu = page.getByRole('menu');
				await expect(menu.getByRole('menuitem', { name: 'Check history' })).toBeVisible();
				await expect(menu.getByRole('menuitem', { name: 'Edit' })).toHaveCount(can('server.config') ? 1 : 0);
				await expect(menu.getByRole('menuitem', { name: 'Delete target' })).toHaveCount(
					can('server.config') ? 1 : 0
				);
				await page.keyboard.press('Escape');
				// A row click opens its history
				await rows.first().locator('.row-open').click();
				await expect(page.getByRole('dialog')).toBeVisible();
				await expectNoAxeViolations(page);
				await page.keyboard.press('Escape');
			}
		});

		test('platform support: tabs follow ?tab=', async ({ page }) => {
			await page.goto(`${UI}/cross-platform?tab=protocols`);
			const { can } = await boot(page);
			test.skip(!can('device.view'), 'no device.view');
			await expect(main(page).getByRole('tab', { name: 'Protocols', selected: true })).toBeVisible();
			await expectNoAxeViolations(page);
			await main(page).getByRole('tab', { name: 'Your devices' }).click();
			await expect(page).toHaveURL(/tab=distribution/);
			await expect(main(page).getByRole('heading', { name: 'Operating systems' })).toBeVisible();
			await expectNoAxeViolations(page);
			await main(page).getByRole('tab', { name: 'Limitations' }).press('Home');
			await expect(main(page).getByRole('tab', { name: 'Features', selected: true })).toBeVisible();
			await expect(page).toHaveURL(/tab=matrix/);
			await expectNoAxeViolations(page);
		});
	});
}
