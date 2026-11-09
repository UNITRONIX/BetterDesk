/**
 * Canvas tools, once per role: the flow builder (/cdap-studio, operator,
 * admin and super_admin only, DECISIONS R5) and Fleet tasks (/fleet,
 * org.manage_devices). Each page opens for exactly the roles the server
 * lets through, a hidden page's writes fail on the server too, the main
 * tasks work, and axe finds nothing in the page, its menus, sheets and
 * dialogs. The flow a test saves is deleted again.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];
const STUDIO_ROLES: Role[] = ['admin', 'super_admin', 'operator'];

async function boot(page: Page): Promise<{ permissions: string[]; superAdmin: boolean; csrf: string }> {
	return page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		const b = await r.json();
		return {
			permissions: b.permissions as string[],
			superAdmin: !!b.isSuperAdmin,
			csrf: b.csrfToken as string
		};
	});
}

/** A request from the page with the session and CSRF token; resolves the status */
async function call(page: Page, method: string, path: string, csrf: string, body?: unknown): Promise<number> {
	return page.evaluate(
		async ({ method, path, csrf, body }) => {
			const r = await fetch(path, {
				method,
				credentials: 'same-origin',
				headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			return r.status;
		},
		{ method, path, csrf, body }
	);
}

for (const role of ROLES) {
	test.describe(`canvas tools as ${role}`, () => {
		// The checks that hidden actions fail on the server answer 403 on purpose (and the browser
		// logs a line for each). One pattern, not several: test.use reads [value, options] when an
		// array's second item is an object, and a RegExp is one.
		test.use({
			role,
			allowProblems: [
				/^(?:http 403: POST .*\/api\/cdap-studio\/flows|http 403: GET .*\/api\/panel\/fleet\/availability|console: Failed to load resource: the server responded with a status of 403 \(Forbidden\))$/
			]
		});

		test('flow builder: open for operator, admin and super admin; template, test run, save, delete', async ({
			page
		}) => {
			await page.goto(`${UI}/cdap-studio`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const allowed = STUDIO_ROLES.includes(role);
			if (!allowed) {
				await expect(page.locator('.no-access')).toBeVisible();
				await expect(page.getByRole('toolbar')).toHaveCount(0);
				await expectNoAxeViolations(page);
				// The page is hidden because the server refuses its writes
				const { csrf } = await boot(page);
				expect(await call(page, 'POST', '/api/cdap-studio/flows', csrf, { name: 'x', flow_json: '{}' })).toBe(
					403
				);
				return;
			}
			await expectNoAxeViolations(page);

			await page.getByRole('button', { name: 'Browse templates' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.getByRole('dialog').locator('.list-row.is-link').first().click();
			await expect(page.locator('.node')).toHaveCount(4);
			await expectNoAxeViolations(page);

			await page.getByRole('button', { name: 'More' }).click();
			await expect(page.getByRole('menu')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');

			// A test run on a flow never saved asks for a name first, then runs
			const name = `e2e ${role} flow`;
			await page.getByRole('button', { name: 'Test run' }).click();
			const save = page.getByRole('dialog');
			await expect(save.getByText('A test run needs a saved flow')).toBeVisible();
			await expectNoAxeViolations(page);
			await save.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
			await save.getByRole('button', { name: 'Save flow' }).click();
			await expect(page.locator('#studio-log-body')).toContainText(
				'Test run finished: 4 nodes, 3 connections'
			);

			// A node selected: its settings, keyboard first
			await page.locator('.node').nth(1).focus();
			await page.keyboard.press('Enter');
			await expect(page.locator('.inspector').getByRole('button', { name: 'Delete node' })).toBeVisible();
			await expectNoAxeViolations(page);

			await page.getByRole('button', { name: 'Deploy' }).click();
			await expect(page.locator('.statusbar')).toContainText('Deployed');

			await page.getByRole('button', { name: 'Open flow' }).click();
			const row = page.locator('.flow-row', { hasText: name });
			await expect(row).toBeVisible();
			await expectNoAxeViolations(page);
			await row.getByRole('button', { name: 'Delete' }).click();
			await expectNoAxeViolations(page);
			await page.getByRole('dialog').last().getByRole('button', { name: 'Delete' }).click();
			await expect(page.locator('.flow-row', { hasText: name })).toHaveCount(0);
		});

		test('fleet: needs org.manage_devices; forms open, a workflow is laid out', async ({ page }) => {
			await page.goto(`${UI}/fleet`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const p = await boot(page);
			const allowed = p.superAdmin || p.permissions.includes('org.manage_devices');
			if (!allowed) {
				await expect(page.locator('.no-access')).toBeVisible();
				await expectNoAxeViolations(page);
				const status = await page.evaluate(async () => {
					const r = await fetch('/api/panel/fleet/availability', { headers: { Accept: 'application/json' } });
					return r.status;
				});
				expect(status).toBe(403);
				return;
			}
			await expect(page.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
			await expectNoAxeViolations(page);
			const unavailable = await page.locator('#fleet-unavailable').isVisible();

			await page.getByRole('button', { name: 'Add resource' }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet.getByRole('textbox', { name: 'Name', exact: true })).toBeVisible();
			if (unavailable) await expect(sheet.getByRole('button', { name: 'Add resource' })).toBeDisabled();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');

			await page.getByRole('tab', { name: 'Tasks' }).click();
			await expect(page).toHaveURL(/tab=tasks/);
			await page.getByRole('button', { name: 'Create task' }).click();
			await page.getByRole('dialog').getByRole('combobox', { name: 'Schedule' }).selectOption('cron');
			await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Cron expression' })).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');

			await page.getByRole('tab', { name: 'Workflows' }).click();
			await page.getByRole('button', { name: 'New workflow' }).click();
			await page.locator('.palette-step', { hasText: 'Run script' }).click();
			await expect(page.locator('.node')).toHaveCount(2);
			await expect(page.locator('.props')).toBeVisible();
			await expectNoAxeViolations(page);
			if (unavailable) await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();

			// Switching tabs keeps the workflow on the canvas
			await page.getByRole('tab', { name: 'Compliance' }).click();
			await expectNoAxeViolations(page);
			await page.getByRole('tab', { name: 'Workflows' }).click();
			await expect(page.locator('.node')).toHaveCount(2);
		});
	});
}
