import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import { ROLES, authFile, type Role } from './roles.ts';

/**
 * Sign in each e2e account once and keep its session for the tests. Each
 * account allows one session, so tests never sign in themselves.
 * Accounts missing on the server are skipped; tests for that role skip too.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
	// A file keeps the password out of a container's settings (docker inspect shows environment variables)
	const file = process.env.E2E_PASSWORD_FILE;
	const password = process.env.E2E_PASSWORD || (file ? fs.readFileSync(file, 'utf8').trim() : '');
	if (!password) throw new Error('Set E2E_PASSWORD_FILE (a file with the password) or E2E_PASSWORD');
	const baseURL = config.projects[0]?.use.baseURL ?? 'http://host.docker.internal:5000';
	fs.mkdirSync('e2e/.auth', { recursive: true });
	const browser = await chromium.launch();
	const available: Role[] = [];
	for (const [role, username] of Object.entries(ROLES) as [Role, string][]) {
		const ctx = await browser.newContext({ baseURL });
		const page = await ctx.newPage();
		// Reuse a still valid session
		if (fs.existsSync(authFile(role))) {
			const reuse = await browser.newContext({ baseURL, storageState: authFile(role) });
			const r = await reuse.request.get('/api/console/bootstrap', {
				headers: { Accept: 'application/json' }
			});
			await reuse.close();
			if (r.ok()) {
				available.push(role);
				await ctx.close();
				continue;
			}
		}
		await page.goto('/login?autoLaunch=0');
		await page.fill('#username', username);
		await page.fill('#password', password);
		await Promise.all([
			page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 }).catch(() => null),
			page.press('#password', 'Enter')
		]);
		if (!new URL(page.url()).pathname.startsWith('/login')) {
			await ctx.storageState({ path: authFile(role) });
			available.push(role);
		} else if (fs.existsSync(authFile(role))) {
			fs.rmSync(authFile(role));
		}
		await ctx.close();
	}
	await browser.close();
	fs.writeFileSync('e2e/.auth/available.json', JSON.stringify(available));
}
