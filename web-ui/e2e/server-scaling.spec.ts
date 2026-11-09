/**
 * Relay servers (/scaling) and the capacity test (/server-attestation), once
 * per role. Relay servers need server.config, the capacity test
 * server.attestation; other roles get one sentence and no requests. An
 * admin adds a relay server and a rule (switched off) and removes both
 * again; axe runs on the page, both sheets and the confirm dialog. The
 * capacity test is not run (it loads the server for minutes); its badge
 * settings open and their preview follows the fields.
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
	test.describe(`relay servers and capacity test as ${role}`, () => {
		test.use({ role });

		test('relay servers follow server.config', async ({ page }) => {
			const calls: string[] = [];
			page.on('request', (r) => {
				if (r.url().includes('/api/panel/scaling/')) calls.push(r.url());
			});
			await page.goto(`${UI}/scaling`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			if (!(await allowed(page, 'server.config'))) {
				await expect(page.locator('.relay-add')).toHaveCount(0);
				expect(calls).toEqual([]);
				await expectNoAxeViolations(page);
				return;
			}
			await expect(page.locator('#panel-relays')).toBeVisible();
			await expect(page.locator('#panel-diagram svg, #panel-diagram .state')).toBeVisible({
				timeout: 15_000
			});
			await expectNoAxeViolations(page);
			if (role !== 'admin') return;

			// Add a relay server, then a rule that is off, then remove both
			const name = `e2e relay ${Date.now()}`;
			await page.locator('.relay-add').click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expectNoAxeViolations(page);
			await sheet.getByLabel('Name', { exact: true }).fill(name);
			await sheet.getByLabel('Address', { exact: true }).fill('relay-e2e.example.com:21117');
			await sheet.getByLabel('Address', { exact: true }).press('Enter');
			await expect(sheet).toBeHidden();
			const row = page.locator('#panel-relays tbody tr', { hasText: name });
			await expect(row).toHaveCount(1);

			await page.locator('.rule-add').click();
			await expect(sheet).toBeVisible();
			await sheet.getByLabel('Rule name').fill(`${name} rule`);
			await sheet.getByLabel('Value', { exact: true }).fill('10.99.0.0/16');
			await sheet.locator('.rule-enabled input').uncheck();
			await expectNoAxeViolations(page);
			await sheet.locator('.rule-save').click();
			await expect(sheet).toBeHidden();
			const rule = page.locator('#panel-rules tbody tr', { hasText: `${name} rule` });
			await expect(rule).toContainText('Disabled');

			await rule.locator('.rule-delete').click();
			await expectNoAxeViolations(page);
			await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
			await expect(rule).toHaveCount(0);
			await row.locator('.relay-delete').click();
			await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
			await expect(row).toHaveCount(0);
		});

		test('the capacity test follows server.attestation', async ({ page }) => {
			const calls: string[] = [];
			page.on('request', (r) => {
				if (r.url().includes('/api/server-attestation/')) calls.push(r.url());
			});
			await page.goto(`${UI}/server-attestation`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			if (!(await allowed(page, 'server.attestation'))) {
				await expect(page.locator('.sa-run')).toHaveCount(0);
				expect(calls).toEqual([]);
				return;
			}
			await expect(page.locator('.sa-run')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.getByText('Sign-in page badge').click();
			const tooltip = page.getByLabel('Tooltip', { exact: true });
			await tooltip.fill('Tested by e2e');
			await expect(page.locator('.badge')).toHaveAttribute('title', 'Tested by e2e');
			await expectNoAxeViolations(page);
			await tooltip.fill('');
		});
	});
}
