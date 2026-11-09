/**
 * The Rules pages, once per role: Policies, Alerts and automation, USB and
 * drive access, Data loss prevention and Device identity. Each page opens
 * for exactly the roles the server lets in (the others get the 403 text),
 * shows the actions the role's permissions allow, and every action it hides
 * also fails on the server. axe at each step. Nothing is saved: sheets and
 * dialogs are opened and cancelled.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];
/** requireAdmin in middleware/auth.js */
const ADMIN_ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin'];

interface Boot {
	permissions: string[];
	isSuperAdmin: boolean;
	csrfToken: string;
}

async function boot(page: Page): Promise<Boot> {
	const r = await page.request.get('/api/console/bootstrap', { headers: { Accept: 'application/json' } });
	return (await r.json()) as Boot;
}

/** A write the page hides, sent anyway: the server must refuse it (outside the page, so it is no page error) */
async function refused(
	page: Page,
	b: Boot,
	method: 'post' | 'put',
	path: string,
	data: unknown
): Promise<number> {
	const r = await page.request.fetch(path, {
		method,
		data,
		headers: { Accept: 'application/json', 'X-CSRF-Token': b.csrfToken }
	});
	return r.status();
}

const forbidden = (page: Page) =>
	page.getByRole('heading', { level: 1, name: "You don't have access to this page" });

for (const role of ROLES) {
	test.describe(`rules pages as ${role}`, () => {
		test.use({
			role,
			// Opening a device's USB rules asks for them; the server answers 404 while it can't store them (BUGS.md P5)
			allowProblems: [/http 404: GET .*\/api\/panel\/resource-control\/policies\//]
		});

		test('policies', async ({ page }) => {
			const b = await boot(page);
			await page.goto(`${UI}/policies`);
			if (!ADMIN_ROLES.includes(role)) {
				await expect(forbidden(page)).toBeVisible();
				await expectNoAxeViolations(page);
				expect(await refused(page, b, 'put', '/api/panel/policies/x/connection', {})).toBe(403);
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Policies' })).toBeVisible();
			const orgs = page.locator('.org-list a');
			await expect(orgs.first()).toBeVisible();
			await expectNoAxeViolations(page);
			// One click opens an organization and puts it in the address, replacing the entry
			await orgs.first().click();
			await expect(page).toHaveURL(new RegExp(`${UI}/policies/[^/]+$`));
			await expect(page.locator('#pol-connection-title')).toBeVisible();
			await expect(page.getByRole('button', { name: 'Save policies' })).toBeVisible();
			await expectNoAxeViolations(page);
			// A change marks the form; a refused number says why and keeps the change
			const minutes = page.getByLabel('Longest session (minutes)');
			await minutes.fill('5000');
			await expect(page.locator('.save-bar')).toContainText('Unsaved changes');
			await page.getByRole('button', { name: 'Save policies' }).click();
			await expect(minutes).toHaveAttribute('aria-invalid', 'true');
			await expectNoAxeViolations(page);
		});

		test('alerts and automation', async ({ page }) => {
			const b = await boot(page);
			const allowed = b.isSuperAdmin || b.permissions.includes('server.config');
			const automation: string[] = [];
			page.on('request', (r) => {
				if (new URL(r.url()).pathname.startsWith('/api/automation')) automation.push(r.url());
			});
			await page.goto(`${UI}/automation`);
			if (!allowed) {
				// Command payloads and results come from scripts run on devices: server.config only
				await expect(forbidden(page)).toBeVisible();
				await expectNoAxeViolations(page);
				expect(automation, 'the page asks for nothing without server.config').toEqual([]);
				const read = async (path: string) =>
					(await page.request.get(path, { headers: { Accept: 'application/json' } })).status();
				expect(await read('/api/automation/rules')).toBe(403);
				expect(await read('/api/automation/alerts')).toBe(403);
				expect(await read('/api/automation/commands')).toBe(403);
				expect(await refused(page, b, 'post', '/api/automation/alerts/1/ack', {})).toBe(403);
				expect(
					await refused(page, b, 'post', '/api/automation/rules', { name: 'x', condition_type: 'custom' })
				).toBe(403);
				expect(
					await refused(page, b, 'post', '/api/automation/commands', { device_id: 'x', payload: 'x' })
				).toBe(403);
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Alerts and automation' })).toBeVisible();
			await expect(page.getByRole('tab', { name: 'Alert rules' })).toHaveAttribute('aria-selected', 'true');
			await expectNoAxeViolations(page);
			await page.getByRole('button', { name: 'Create rule' }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			// Custom rules have no comparison or threshold
			await sheet.getByLabel('Condition').selectOption('custom');
			await expect(sheet.getByLabel('Threshold')).toBeHidden();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
			// The tab is in the address
			await page.getByRole('tab', { name: 'Remote commands' }).click();
			await expect(page).toHaveURL(/[?&]tab=commands/);
			await expect(page.getByRole('button', { name: 'Send command' })).toBeVisible();
			await page.getByRole('tab', { name: 'Alert history' }).click();
			await expect(page).toHaveURL(/[?&]tab=alerts/);
			await expectNoAxeViolations(page);
			await page.reload();
			await expect(page.getByRole('tab', { name: 'Alert history' })).toHaveAttribute('aria-selected', 'true');
		});

		test('data loss prevention', async ({ page }) => {
			const b = await boot(page);
			const allowed = b.isSuperAdmin || b.permissions.includes('server.config');
			await page.goto(`${UI}/dataguard`);
			if (!allowed) {
				await expect(forbidden(page)).toBeVisible();
				await expectNoAxeViolations(page);
				expect(await refused(page, b, 'post', '/api/dataguard/policies', { name: 'x' })).toBe(403);
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'Data loss prevention' })).toBeVisible();
			await page.getByRole('button', { name: 'Create policy' }).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			await expectNoAxeViolations(page);
			await sheet.getByRole('button', { name: 'Cancel' }).click();
			await expect(sheet).toBeHidden();
			const events = b.isSuperAdmin || b.permissions.includes('audit.view');
			await expect(page.getByRole('tab', { name: 'Events' })).toHaveCount(events ? 1 : 0);
			if (events) {
				await page.getByRole('tab', { name: 'Events' }).click();
				await expect(page).toHaveURL(/[?&]tab=events/);
				await expectNoAxeViolations(page);
			}
		});

		test('USB and drive access', async ({ page }) => {
			const b = await boot(page);
			const allowed = b.isSuperAdmin || b.permissions.includes('server.config');
			await page.goto(`${UI}/resource-control`);
			if (!allowed) {
				await expect(forbidden(page)).toBeVisible();
				await expectNoAxeViolations(page);
				const r = await page.request.get('/api/panel/resource-control/devices', {
					headers: { Accept: 'application/json' }
				});
				expect(r.status()).toBe(403);
				return;
			}
			await expect(page.getByRole('heading', { level: 1, name: 'USB and drive access' })).toBeVisible();
			const rows = page.locator('tbody tr[data-key]');
			await expect(rows.first()).toBeVisible();
			await expectNoAxeViolations(page);
			// A click anywhere on the row opens the device's rules
			await rows.first().locator('td').nth(1).click();
			const sheet = page.getByRole('dialog');
			await expect(sheet).toBeVisible();
			// Every kind of rule under its own heading, one Save for all
			await expect(sheet.locator('h3.form-section-title')).toHaveCount(5);
			// The allowed USB devices only apply to "Only listed devices"
			const policy = sheet.getByLabel('USB storage', { exact: true });
			await policy.selectOption('whitelist');
			await expect(sheet.getByLabel('Allowed USB devices')).toBeVisible();
			await policy.selectOption('allowed');
			await expect(sheet.getByLabel('Allowed USB devices')).toBeHidden();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();
		});

		test('device identity', async ({ page }) => {
			const b = await boot(page);
			await page.goto(`${UI}/attestation`);
			if (!ADMIN_ROLES.includes(role)) {
				await expect(forbidden(page)).toBeVisible();
				await expectNoAxeViolations(page);
				const r = await page.request.get('/api/panel/attestation', {
					headers: { Accept: 'application/json' }
				});
				expect(r.status()).toBe(403);
				return;
			}
			expect(b.csrfToken).toBeTruthy();
			await expect(page.getByRole('heading', { level: 1, name: 'Device identity' })).toBeVisible();
			// The server can't receive fingerprints yet: the page says so instead of an empty table
			await expect(page.locator('.att-empty')).toBeVisible();
			await expectNoAxeViolations(page);
		});
	});
}
