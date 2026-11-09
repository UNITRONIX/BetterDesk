import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running console (the dev container, or the
 * production image in CI). BD_URL is the console's origin; the app is at its
 * root, or under BD_UI_BASE for a build made for another base.
 * The e2e accounts share one password (see e2e/roles.ts): E2E_PASSWORD_FILE
 * names a file that holds it (in a container, a read-only mount), or
 * E2E_PASSWORD has it (CI secrets).
 */
export default defineConfig({
	testDir: 'e2e',
	timeout: 30_000,
	expect: { timeout: 5_000 },
	fullyParallel: true,
	workers: process.env.CI ? 2 : 3,
	retries: 0,
	// The performance budgets measure time, so they run alone (PERF=1, see e2e/perf.spec.ts),
	// never beside other specs that load the same machine
	grepInvert: process.env.PERF ? undefined : /@perf/,
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
