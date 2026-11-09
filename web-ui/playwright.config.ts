import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running console (the dev container, or the
 * production image in CI). BD_URL is the console's origin; the app is under
 * BD_UI_BASE (default /app while old and new run side by side).
 * E2E_PASSWORD is the shared password of the e2e accounts (see e2e/roles.ts).
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: true,
	workers: process.env.CI ? 2 : 3,
	retries: 0,
	reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: process.env.BD_URL ?? 'http://host.docker.internal:5000',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
		{ name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } }
	]
});
