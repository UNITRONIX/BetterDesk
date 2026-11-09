/**
 * The public pages (sign-in, desktop sign-in, download portal, bundle
 * download page, error pages), signed out unless a test says otherwise. No
 * test signs in through the form: the e2e accounts are shared, and failed
 * attempts count toward the login limiter. Two-factor is shown with a
 * mocked answer. axe at each step; console errors, CSP violations and
 * failed requests fail the test (allowed ones are listed).
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI } from './roles.ts';

/** A signed-out page that records problems like the fixture does */
async function visitor(
	browser: Browser,
	allow: RegExp[] = []
): Promise<{ ctx: BrowserContext; page: Page; problems: () => string[] }> {
	const ctx = await browser.newContext({ storageState: undefined });
	const page = await ctx.newPage();
	const list: string[] = [];
	await page.addInitScript(() => {
		document.addEventListener('securitypolicyviolation', (e) => {
			console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
		});
	});
	page.on('console', (m) => {
		if (m.type() === 'error') list.push('console: ' + m.text());
	});
	page.on('pageerror', (e) => list.push('pageerror: ' + e.message));
	page.on('response', (r) => {
		if (r.status() >= 400) list.push(`http ${r.status()}: ${r.url()}`);
	});
	return {
		ctx,
		page,
		problems: () => list.filter((p) => !allow.some((re) => re.test(p)))
	};
}

test.describe('sign-in page', () => {
	test('answers 200 without a session, through the old address too (healthcheck)', async ({ browser }) => {
		const ctx = await browser.newContext({ storageState: undefined });
		const direct = await ctx.request.get(`${UI}/login`, { maxRedirects: 0 });
		expect(direct.status()).toBe(200);
		const old = await ctx.request.get('/login');
		expect(old.status()).toBe(200);
		await ctx.close();
	});

	test('the form, its labels and the empty-field message', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		await page.goto(`${UI}/login?autoLaunch=0`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.locator('#username')).toBeFocused();
		await expectNoAxeViolations(page);
		await page.locator('form button[type="submit"]').click();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page.locator('#username')).toHaveAttribute('aria-invalid', 'true');
		await expectNoAxeViolations(page);
		// Show reveals the password
		const toggle = page.locator('.password-toggle');
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', 'true');
		await expect(page.locator('#password')).toHaveAttribute('type', 'text');
		expect(problems()).toEqual([]);
		await ctx.close();
	});

	test('a first visit does not say "session expired" (R4); ?expired=1 does, once', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		const res = await ctx.request.get(`${UI}/devices?open=1`, { maxRedirects: 0 });
		expect(res.status()).toBe(302);
		expect(res.headers()['location']).toBe(`/login?return=${encodeURIComponent(`${UI}/devices?open=1`)}`);
		await page.goto(`${UI}/login?expired=1&autoLaunch=0`);
		await expect(page.getByRole('status').first()).toBeVisible();
		await expect(page).not.toHaveURL(/expired=1/);
		expect(problems()).toEqual([]);
		await ctx.close();
	});

	test('two-factor step: code field focused, recovery code and back', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		await page.route('**/api/auth/login', (r) =>
			r.fulfill({
				status: 200,
				contentType: 'application/json',
				body: '{"success":true,"totpRequired":true}'
			})
		);
		await page.goto(`${UI}/login?autoLaunch=0`);
		await page.locator('#username').fill('nobody');
		await page.locator('#password').fill('x');
		await page.locator('#password').press('Enter');
		await expect(page.locator('#totp-code')).toBeFocused();
		await expectNoAxeViolations(page);
		await page.locator('.totp-links button').first().click();
		await expect(page.locator('#recovery-code')).toBeFocused();
		await page.locator('.totp-links button').last().click();
		await expect(page.locator('#password')).toBeFocused();
		expect(problems()).toEqual([]);
		await ctx.close();
	});

	test('the desktop sign-in lists no accounts (S4)', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		await page.goto(`${UI}/login?desktop=1`);
		await expect(page.locator('#username')).toBeVisible();
		await expect(page.locator('.dl-accounts, .dl-users')).toHaveCount(0);
		await expectNoAxeViolations(page);
		// The old page's HTML too
		const html = await (await ctx.request.get('/login?desktop=1')).text();
		expect(html).not.toMatch(/e2e_(admin|viewer|operator)|demo_ui_admin/);
		expect(problems()).toEqual([]);
		await ctx.close();
	});
});

test.describe('signed in', () => {
	test('the sign-in page sends you on to the return path (R3)', async ({ page }) => {
		await page.goto(`/login?return=${encodeURIComponent(`${UI}/devices`)}`);
		await expect(page).toHaveURL(new RegExp(`${UI}/devices$`));
	});

	test('an address the app has no page for: the 404 page inside the shell', async ({ page, problems }) => {
		await page.goto(`${UI}/no-such-page-here`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.locator('.error-page')).toBeVisible();
		await expect(page.getByRole('navigation').first()).toBeVisible();
		await expectNoAxeViolations(page);
		expect(problems.list).toEqual([]);
	});
});

test.describe('download pages', () => {
	test('portal: heading, the list or the reason it is empty', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		await page.goto(`${UI}/portal`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(page.locator('.dl-list, .state')).toBeVisible();
		await expectNoAxeViolations(page);
		expect(problems()).toEqual([]);
		await ctx.close();
	});

	test('an unknown bundle link shows the 404 page', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser, [
			/\/api\/d\/no-such-bundle\/page/,
			/status of 404/
		]);
		await page.goto(`${UI}/d/no-such-bundle`);
		await expect(page.locator('.error-page')).toBeVisible();
		await expect(page.getByRole('link', { name: /sign/i })).toHaveAttribute('href', '/login');
		await expectNoAxeViolations(page);
		expect(problems()).toEqual([]);
		await ctx.close();
	});

	test('a bundle page: rows, contact links only http(s), mailto and tel', async ({ browser }) => {
		const { ctx, page, problems } = await visitor(browser);
		await page.route('**/api/d/e2e-bundle/page', (r) =>
			r.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					data: {
						publicId: 'e2e-bundle',
						companyName: '<img src=x onerror="window.__pwned=1">Acme',
						shortText: '‮evil',
						logo: '',
						contact: { email: 'help@acme.example', phone: '+49 30 1', url: 'https://acme.example/' },
						accent: '#1d4ed8',
						background: '',
						showPoweredBy: true,
						product: { type: 'betterdesk-support', label: '', hidden: false },
						defaultLang: null,
						platforms: [
							{ platform: 'windows', arch: 'x64', format: 'portable', label: 'Windows x64', status: 'ready' },
							{ platform: 'linux', arch: 'x64', format: 'portable', label: 'Linux x64', status: 'failed' }
						]
					}
				})
			})
		);
		await page.goto(`${UI}/d/e2e-bundle`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('<img src=x');
		expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
		await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);
		await expect(page.locator('a[href^="tel:"]')).toHaveCount(1);
		await expect(page.locator('a[href="/api/d/e2e-bundle/download/windows/x64/portable"]')).toHaveCount(1);
		await expectNoAxeViolations(page);
		expect(problems()).toEqual([]);
		await ctx.close();
	});
});
