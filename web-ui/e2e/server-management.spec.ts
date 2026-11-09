/**
 * Server management (/server-management?tab=...), once per role: the four
 * views open for roles with server.config and say "no permission" (without
 * asking the server for anything) to the others; the file browser opens a
 * folder and a file; services, terminal and overview render; axe finds
 * nothing in each view, the row menu or the editor sheet.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

async function allowed(page: Page, permission: string): Promise<boolean> {
	return page.evaluate(async (p) => {
		const r = await fetch('/api/console/bootstrap', { headers: { Accept: 'application/json' } });
		const boot = (await r.json()) as { permissions: string[]; isSuperAdmin: boolean };
		return boot.isSuperAdmin || boot.permissions.includes(p);
	}, permission);
}

for (const role of ROLES) {
	test.describe(`server management as ${role}`, () => {
		test.use({ role });

		test('each view follows server.config', async ({ page }) => {
			const calls: string[] = [];
			page.on('request', (r) => {
				if (r.url().includes('/api/server-management/')) calls.push(r.url());
			});
			await page.goto(`${UI}/server-management?tab=overview`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const may = await allowed(page, 'server.config');
			if (role === 'operator' || role === 'viewer' || role === 'global_admin') expect(may).toBe(false);
			if (!may) {
				await expect(page.locator('.no-access')).toBeVisible();
				expect(calls).toEqual([]);
				await expectNoAxeViolations(page);
				return;
			}
			// Overview: the servers and the machine
			await expect(page.locator('.sm-hbbs')).toContainText(/\S/);
			await expect(page.locator('.facts').first()).toBeVisible({ timeout: 15_000 });
			await expectNoAxeViolations(page);

			// Files: a folder, the row menu, a file in the editor sheet
			await page.goto(`${UI}/server-management?tab=files`);
			const rows = page.locator('.files-table tbody tr[data-key]');
			await expect(rows.first()).toBeVisible({ timeout: 15_000 });
			await expectNoAxeViolations(page);
			await rows
				.first()
				.getByRole('button', { name: /^Actions for/ })
				.click();
			await expect(page.getByRole('menu')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			const file = page.locator('.files-table tbody tr.type-file').first();
			if (await file.count()) {
				await file.locator('.row-open').click();
				const sheet = page.getByRole('dialog');
				await expect(sheet).toBeVisible();
				await expect(sheet.locator('textarea')).toBeVisible();
				await expectNoAxeViolations(page);
				await sheet.getByRole('button', { name: 'Close', exact: true }).first().click();
				await expect(sheet).toBeHidden();
			}

			// Services: a list or the one sentence for a machine without services
			await page.goto(`${UI}/server-management?tab=services`);
			await expect(page.locator('.services-refresh')).toBeVisible();
			await expect(page.locator('main')).toContainText(/service/i);
			await expectNoAxeViolations(page);

			// Terminal: the status line and Disconnect
			await page.goto(`${UI}/server-management?tab=terminal`);
			await expect(page.locator('.terminal-status')).toBeVisible();
			await expect(page.locator('.term-disconnect')).toBeVisible();
			await expectNoAxeViolations(page);
		});
	});
}
