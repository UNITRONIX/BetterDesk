/**
 * The device list and the device panel, once per role: the row menu and the
 * panel offer exactly what the role's permissions allow, search and ?open=
 * work, and axe finds nothing in the page, the open menu or the panel.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

interface ApiDevice {
	id: string;
	soft_deleted?: boolean;
	remote_target?: unknown;
}

/** The signed-in person's permissions and a plain device (not deleted, not an RDP/VNC target) they can see */
async function context(page: Page): Promise<{ permissions: string[]; deviceId: string }> {
	return page.evaluate(async () => {
		const get = async (url: string) =>
			(await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })).json();
		const boot = await get('/api/console/bootstrap');
		const list = await get('/api/devices');
		const devices = (list.data?.devices ?? []) as ApiDevice[];
		const plain = devices.find((d) => !d.soft_deleted && !d.remote_target);
		return { permissions: boot.permissions as string[], deviceId: plain?.id ?? '' };
	});
}

const rows = (page: Page) => page.locator('.devices-table tbody tr:has(.device-name)');

for (const role of ROLES) {
	test.describe(`devices as ${role}`, () => {
		test.use({ role });

		test('the row menu and the panel follow the permissions', async ({ page }) => {
			await page.goto(`${UI}/devices`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expect(rows(page).first()).toBeVisible();
			const { permissions, deviceId } = await context(page);
			expect(deviceId, 'the demo data has a device this role can see').not.toBe('');
			if (role === 'viewer') {
				expect(permissions).not.toContain('device.delete');
				expect(permissions).not.toContain('device.ban');
				expect(permissions).not.toContain('device.edit');
			}
			await expectNoAxeViolations(page);

			// Search narrows the list to that device
			await page.getByRole('searchbox').first().fill(deviceId);
			const row = rows(page).filter({ hasText: deviceId });
			await expect(row).toHaveCount(1);
			// The count line says the filter is applied (no re-render under the next click)
			await expect(page.locator('.list-head[role="status"]')).toContainText('1');

			// Row menu: exactly the actions the permissions allow
			await row.getByRole('button', { name: /^Actions:/ }).click();
			const menu = page.getByRole('menu');
			await expect(menu).toBeVisible();
			const offers = async (id: string) => (await menu.locator(`.act-${id}`).count()) > 0;
			expect(await offers('details')).toBe(true);
			expect(await offers('toggle-ban')).toBe(permissions.includes('device.ban'));
			expect(await offers('delete')).toBe(permissions.includes('device.delete'));
			expect(await offers('edit')).toBe(permissions.includes('device.edit'));
			expect(await offers('change-id')).toBe(permissions.includes('device.change_id'));
			expect(await offers('web-remote')).toBe(permissions.includes('device.connect'));
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(menu).toBeHidden();

			// The panel: opened by a click on the row, in the URL, closed by Escape
			await row.locator('.device-name').click();
			const panel = page.getByRole('dialog');
			await expect(panel).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`[?&]open=${deviceId}`));
			await expect(panel.getByRole('tablist')).toBeVisible();
			await expect(panel.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(
				permissions.includes('device.edit') ? 1 : 0
			);
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(panel).toBeHidden();
			await expect(page).not.toHaveURL(/[?&]open=/);
		});
	});
}

test.describe('devices links', () => {
	test.use({ role: 'operator' });

	test('a link with ?open= opens the device; Back closes it', async ({ page }) => {
		await page.goto(`${UI}/devices`);
		const { deviceId } = await context(page);
		await page.goto(`${UI}/devices?open=${deviceId}`);
		const panel = page.getByRole('dialog');
		await expect(panel).toBeVisible();
		await expect(panel).toContainText(deviceId);
		// Let the panel's fonts and styles finish loading: leaving cuts them off, which Firefox reports
		await page.waitForLoadState('networkidle');
		await page.goto(`${UI}/devices`);
		// Search first: in a long list the row may be far down
		await page.getByRole('searchbox').first().fill(deviceId);
		await rows(page).filter({ hasText: deviceId }).locator('.device-name').click();
		await expect(panel).toBeVisible();
		await page.goBack();
		await expect(panel).toBeHidden();
		await expect(page).toHaveURL(new RegExp(`${UI}/devices$`));
	});
});
