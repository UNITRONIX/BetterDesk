/**
 * The remote client, once per role: the dashboard (/remote), the viewer
 * (/remote/<id>) with the dev mock device, the remote sign-in and the
 * guest page. Each offers what the role's permissions allow (device.connect
 * for the dashboard and the viewer), the main tasks work, and axe finds
 * nothing in the page, its menus, sheets and dialogs.
 *
 * The viewer tests need the console running with BD_DEV_MOCK_REMOTE=1 (the
 * dev compose file sets it); without it they are skipped, and the mock
 * must not load (checked below).
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];
const MOCK_DEVICE = '900100012';

async function canConnect(page: Page): Promise<boolean> {
	return page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		const b = await r.json();
		return !!b.isSuperAdmin || (b.permissions as string[]).includes('device.connect');
	});
}

async function mockOn(page: Page): Promise<boolean> {
	const r = await page.request.get('/dev/mock-remote.js');
	return r.status() === 200;
}

for (const role of ROLES) {
	test.describe(`remote client as ${role}`, () => {
		// Roles without device.connect: the viewer's data endpoint is the one that decides (guests too)
		test.use({
			role,
			// One RegExp: Playwright reads [value, object] as [value, options]
			allowProblems: [
				/http 403: GET .*\/api\/remote\/viewer\/|console: Failed to load resource: the server responded with a status of 403/
			]
		});

		test('dashboard: the device list and Connect need device.connect', async ({ page }) => {
			await page.goto(`${UI}/remote`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			if (!(await canConnect(page))) {
				// No request the server would refuse: the page says so at once
				await expect(page.locator('.desk-quick')).toHaveCount(0);
				await expectNoAxeViolations(page);
				return;
			}
			await expect(page.getByRole('button', { name: /^Connect to / }).first()).toBeVisible();
			await expectNoAxeViolations(page);
			// Filters, status, view
			await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Online' }).click();
			await page
				.getByRole('group', { name: 'View' })
				.getByRole('button', { name: 'Grid', exact: true })
				.click();
			await expect(page.locator('.book-grid')).toBeVisible();
			await expectNoAxeViolations(page);
			// Quick connect checks the ID first
			await page.getByLabel('Device ID', { exact: true }).fill('ab');
			await page.getByRole('button', { name: 'Connect', exact: true }).click();
			await expect(page.locator('.quick-status.is-error')).toBeVisible();
		});

		test('viewer: connects to the mock device, controls, menus, sheets and the New connection dialog', async ({
			page
		}) => {
			test.skip(!(await mockOn(page)), 'the console runs without BD_DEV_MOCK_REMOTE=1');
			await page.goto(`${UI}/devices`);
			if (!(await canConnect(page))) {
				await page.goto(`${UI}/remote/${MOCK_DEVICE}?mock=1`);
				await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
				await expect(page.locator('.session-panel')).toHaveCount(0);
				return;
			}
			await page.goto(`${UI}/remote/${MOCK_DEVICE}?mock=1`);
			await expect(page.locator('.session-panel.streaming')).toBeVisible({ timeout: 60_000 });
			await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(/Connected/);
			await expectNoAxeViolations(page, '.session-bar');
			// F8 leaves the screen for the controls
			await page.locator('.session-canvas').focus();
			await page.keyboard.press('F8');
			const controls = page.getByRole('group', { name: 'Session controls' });
			await expect(controls).toBeVisible();
			for (const name of ['Actions', 'Display']) {
				await controls.getByRole('button', { name, exact: true }).click();
				await expect(page.getByRole('menu')).toBeVisible();
				await expectNoAxeViolations(page, '.session-bar, .controls, [role="menu"]');
				await page.keyboard.press('Escape');
				await expect(page.getByRole('menu')).toHaveCount(0);
				await expect(controls.getByRole('button', { name, exact: true })).toBeFocused();
			}
			await controls.getByRole('button', { name: 'Session info', exact: true }).click();
			await expect(page.locator('.rd-sheet')).toBeVisible();
			await expectNoAxeViolations(page, '.rd-sheet');
			await page.locator('.rd-sheet').getByRole('button', { name: 'Close session info' }).click();
			await expect(controls.getByRole('button', { name: 'Session info', exact: true })).toBeFocused();
			await page.getByRole('button', { name: 'New connection' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expect(page.getByRole('button', { name: /^Connect to / }).first()).toBeVisible();
			await expectNoAxeViolations(page, '[role="dialog"]');
			await page.keyboard.press('Escape');
			await expect(page.getByRole('dialog')).toHaveCount(0);
			// Disconnect: the session ended by you, Reconnect has focus
			await page.keyboard.press('F8');
			await controls.getByRole('button', { name: 'Disconnect', exact: true }).click();
			await expect(page.locator('.overlay-status')).toHaveText(/You ended the session/);
			await expectNoAxeViolations(page, '.session-panel');
		});

		test('viewer: a failed connection says why, with details', async ({ page }) => {
			test.skip(!(await mockOn(page)), 'the console runs without BD_DEV_MOCK_REMOTE=1');
			await page.goto(`${UI}/devices`);
			test.skip(!(await canConnect(page)), 'needs device.connect');
			await page.goto(`${UI}/remote/${MOCK_DEVICE}?mock=1&scenario=fail-relay`);
			await expect(page.locator('.overlay-status')).toHaveText(/closed before/, { timeout: 60_000 });
			await expect(page.getByRole('button', { name: 'Reconnect' })).toBeFocused();
			await page.locator('.rd-state-details > summary').click();
			await expect(page.locator('.rd-state-details dl')).toContainText('1005');
			await expectNoAxeViolations(page);
		});

		test('viewer: password prompt of the mock device', async ({ page }) => {
			test.skip(!(await mockOn(page)), 'the console runs without BD_DEV_MOCK_REMOTE=1');
			await page.goto(`${UI}/devices`);
			test.skip(!(await canConnect(page)), 'needs device.connect');
			await page.goto(`${UI}/remote/${MOCK_DEVICE}?mock=1&scenario=password`);
			const pw = page.getByLabel('Device password', { exact: true });
			await expect(pw).toBeFocused({ timeout: 60_000 });
			// "Remember the password" starts off (S5)
			await expect(page.getByLabel('Remember the password in this browser')).not.toBeChecked();
			await expectNoAxeViolations(page);
			await pw.fill('wrong');
			await page.keyboard.press('Enter');
			await expect(page.locator('.login-error')).toBeVisible();
			await pw.fill('demo');
			await page.keyboard.press('Enter');
			await expect(page.locator('.session-panel.streaming')).toBeVisible();
		});
	});
}

test.describe('remote client pages without a session', () => {
	test.use({
		storageState: { cookies: [], origins: [] },
		// The page asks; the server answers 401 (no session) and 400 (no guest token)
		allowProblems: [
			/http 401: GET .*\/api\/remote\/viewer\/|http 400: GET .*\/api\/remote\/guest-info|console: Failed to load resource: the server responded with a status of 40[01]/
		]
	});

	test('the viewer sends signed-out people to the remote sign-in with the way back', async ({ page }) => {
		await page.goto(`${UI}/remote/${MOCK_DEVICE}?panel=files`);
		await expect(page).toHaveURL(/\/remote\/login\?return=/);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.getByLabel('Remember me')).not.toBeChecked();
		await expectNoAxeViolations(page);
	});

	test('a guest page without a token says the link is invalid', async ({ page }) => {
		await page.goto(`${UI}/remote/guest`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Invalid guest link/);
		await expectNoAxeViolations(page);
	});

	test('the dev mock script is not served unless the flag is on', async ({ page }) => {
		const r = await page.request.get('/dev/mock-remote.js');
		if (r.status() === 200) {
			expect(await r.text()).toContain('MockRemoteSession');
		} else {
			expect(r.status()).toBe(404);
		}
	});
});
