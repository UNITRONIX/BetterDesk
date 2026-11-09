import { test, expect } from './fixtures.ts';
import { UI } from './roles.ts';

test.describe('security headers and CSRF', () => {
	test('the console page has a strict script policy', async ({ request }) => {
		const res = await request.get(`${UI}/devices`, { maxRedirects: 0 });
		expect(res.status()).toBe(200);
		const csp = res.headers()['content-security-policy'] ?? '';
		const directive = (name: string) =>
			csp
				.split(';')
				.map((d) => d.trim())
				.find((d) => d.startsWith(name + ' ')) ?? '';
		expect(directive('script-src')).toMatch(/^script-src 'self'( 'sha256-[^']+')+$/);
		expect(csp).not.toMatch(/unsafe-eval/);
		expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
		expect(directive('connect-src')).toBe("connect-src 'self'");
		expect(directive('object-src')).toBe("object-src 'none'");
	});

	test('signed-out visitors go to the login page with a return path', async ({ browser }) => {
		const ctx = await browser.newContext({ storageState: undefined });
		const res = await ctx.request.get(`${UI}/devices?open=1`, { maxRedirects: 0 });
		expect(res.status()).toBe(302);
		// A first visit (no session cookie) isn't told its session expired (R4)
		expect(res.headers()['location']).toBe('/login?return=' + encodeURIComponent(`${UI}/devices?open=1`));
		await ctx.close();
	});

	test('a change without the CSRF token is refused', async ({ page, problems }) => {
		// The refused request shows as an HTTP 403 and, in Chromium, as a console error
		problems.allow.push(/http 403: POST .*\/ban$/, /status of 403/);
		await page.goto(`${UI}/devices`);
		const status = await page.evaluate(async () => {
			const r = await fetch('/api/devices/000000000/ban', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			return r.status;
		});
		expect(status).toBe(403);
	});
});
