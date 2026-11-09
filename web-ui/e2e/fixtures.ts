import { test as base, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { authFile, type Role } from './roles.ts';

/**
 * Every test fails on a console error, an uncaught exception, a CSP
 * violation, a failed request or an HTTP error response, unless the test
 * lists it in `allowProblems` (for tests that mock failures on purpose).
 */
type Problems = { list: string[]; allow: RegExp[] };

export const test = base.extend<{ problems: Problems; role: Role; allowProblems: RegExp[] }>({
	role: ['admin', { option: true }],
	allowProblems: [[], { option: true }],
	storageState: async ({ role }, use, info) => {
		const available: string[] = fs.existsSync('e2e/.auth/available.json')
			? JSON.parse(fs.readFileSync('e2e/.auth/available.json', 'utf8'))
			: [];
		info.skip(!available.includes(role), `no e2e session for ${role}`);
		await use(authFile(role));
	},
	problems: [
		async ({ page, allowProblems }, use) => {
			const problems: Problems = { list: [], allow: allowProblems };
			await page.addInitScript(() => {
				document.addEventListener('securitypolicyviolation', (e) => {
					console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
				});
			});
			page.on('console', (m) => {
				if (m.type() === 'error') problems.list.push('console: ' + m.text());
			});
			page.on('pageerror', (e) => problems.list.push('pageerror: ' + e.message));
			page.on('requestfailed', (r) => {
				const err = r.failure()?.errorText ?? '';
				// Navigations away and closed sockets abort requests; they are not failures
				if (/ERR_ABORTED|NS_BINDING_ABORTED|aborted/i.test(err)) return;
				problems.list.push(`failed: ${r.method()} ${r.url()} ${err}`);
			});
			page.on('response', (r) => {
				if (r.status() >= 400) problems.list.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
			});
			await use(problems);
			const left = problems.list.filter((p) => !problems.allow.some((re) => re.test(p)));
			expect(left, 'console errors, CSP violations or failed requests').toEqual([]);
		},
		{ auto: true }
	]
});

export { expect };

/** axe with the WCAG 2.1 AA rules; returns nothing, fails the test on any violation */
export async function expectNoAxeViolations(page: Page, include?: string): Promise<void> {
	let builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
	if (include) builder = builder.include(include);
	const result = await builder.analyze();
	const summary = result.violations.map(
		(v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
	);
	expect(summary, 'axe violations').toEqual([]);
}
