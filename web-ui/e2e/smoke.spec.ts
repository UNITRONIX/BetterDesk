import { test, expect } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

for (const role of ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'] as Role[]) {
	test.describe(`as ${role}`, () => {
		test.use({ role });
		test('the console starts', async ({ page }) => {
			await page.goto(`${UI}/`);
			await expect(page.locator('h1').first()).toBeVisible();
		});
	});
}
