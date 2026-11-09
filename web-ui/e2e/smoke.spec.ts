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

test.describe('an address the console does not know', () => {
	// The address itself answers 404; one pattern (an array's second item would be read as options)
	test.use({ role: 'admin', allowProblems: [/\/no-such-page$|status of 404 \(Not Found\)/] });
	test('shows the not-found page once, without reloading', async ({ page }) => {
		let loads = 0;
		page.on('load', () => loads++);
		await page.goto(`${UI}/no-such-page`);
		await expect(page.locator('h1').first()).toBeVisible({ timeout: 20_000 });
		// A build whose start code reads the app version too early reloads here forever
		await page.waitForTimeout(2000);
		expect(loads).toBe(1);
	});
});
