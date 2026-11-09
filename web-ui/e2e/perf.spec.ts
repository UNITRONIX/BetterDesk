/**
 * Performance budgets (rewrite brief section 7). Run on a production build:
 *   playwright test --grep @perf --project chromium
 * With PERF_DEVICES=5000 (and that many devices seeded) the large-list
 * checks run too. Numbers go to test-results/perf.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { test, expect } from './fixtures.ts';
import { UI } from './roles.ts';

const BUILD = process.env.BD_UI_BUILD ?? 'build';
const results: Record<string, unknown> = {};

// One measurement at a time: page loads running side by side slow each other down
test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
	fs.mkdirSync('test-results', { recursive: true });
	const file = 'test-results/perf.json';
	const old = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
	fs.writeFileSync(file, JSON.stringify({ ...old, ...results }, null, 2));
});

/** gzip size of a built file, from its URL path under the UI base */
function gzipSize(urlPath: string): number {
	const rel = urlPath.startsWith(UI + '/') ? urlPath.slice(UI.length + 1) : urlPath.replace(/^\//, '');
	const file = path.join(BUILD, rel);
	if (!fs.existsSync(file)) return 0;
	return zlib.gzipSync(fs.readFileSync(file)).length;
}

const observe = () => {
	const w = window as unknown as { __perf: { lcp: number; cls: number; long: number[] } };
	w.__perf = { lcp: 0, cls: 0, long: [] };
	new PerformanceObserver((l) => {
		for (const e of l.getEntries()) w.__perf.lcp = e.startTime;
	}).observe({ type: 'largest-contentful-paint', buffered: true });
	new PerformanceObserver((l) => {
		for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[])
			if (!e.hadRecentInput) w.__perf.cls += e.value;
	}).observe({ type: 'layout-shift', buffered: true });
	try {
		new PerformanceObserver((l) => {
			for (const e of l.getEntries()) w.__perf.long.push(e.duration);
		}).observe({ type: 'longtask', buffered: true });
	} catch {
		/* not in every browser */
	}
};

for (const page of ['/', '/devices']) {
	test(`@perf ${page}: LCP under 1 s, no layout shift over 0.02, JS within budget`, async ({ browser }) => {
		const ctx = await browser.newContext({
			storageState: 'e2e/.auth/admin.json',
			viewport: { width: 1440, height: 900 }
		});
		const p = await ctx.newPage();
		await p.addInitScript(observe);
		// SvelteKit preloads the page of a link under the pointer. A new page has the
		// pointer at the top left, on the logo link (the overview), so the overview's
		// code would count against this page. Move it to an empty spot of the top bar
		// once the navigation has committed, before the shell draws.
		await p.goto(UI + page, { waitUntil: 'commit' });
		await p.mouse.move(700, 24);
		await p.waitForLoadState('networkidle');
		await p.waitForTimeout(500);
		const m = await p.evaluate(() => {
			const w = window as unknown as { __perf: { lcp: number; cls: number } };
			const js = performance
				.getEntriesByType('resource')
				.filter((e) => e.name.endsWith('.js'))
				.map((e) => new URL(e.name).pathname);
			return { ...w.__perf, js };
		});
		const appJs = m.js.filter((u) => u.startsWith(UI + '/_ui/'));
		const gz = appJs.reduce((n, u) => n + gzipSize(u), 0);
		results[page] = {
			lcpMs: Math.round(m.lcp),
			cls: Number(m.cls.toFixed(4)),
			jsFiles: appJs.length,
			jsGzipKB: +(gz / 1024).toFixed(1)
		};
		await ctx.close();
		expect(m.lcp).toBeLessThan(1000);
		expect(m.cls).toBeLessThanOrEqual(0.02);
		if (page === '/devices') expect(gz / 1024).toBeLessThanOrEqual(150);
	});
}

test.describe('@perf 5,000 devices', () => {
	test.skip(!process.env.PERF_DEVICES, 'set PERF_DEVICES and seed the devices');

	test('first rows within 300 ms of the data, smooth scroll and typing', async ({ browser }) => {
		test.setTimeout(120_000);
		const ctx = await browser.newContext({
			storageState: 'e2e/.auth/admin.json',
			viewport: { width: 1440, height: 900 }
		});
		const p = await ctx.newPage();
		await p.addInitScript(observe);
		await p.addInitScript(() => {
			const w = window as unknown as { __rows: number };
			w.__rows = 0;
			new MutationObserver(() => {
				if (!w.__rows && document.querySelector('table tbody tr[aria-rowindex]'))
					w.__rows = performance.now();
			}).observe(document, { childList: true, subtree: true });
		});
		await p.goto(UI + '/devices', { waitUntil: 'networkidle' });
		const t = await p.evaluate(() => {
			const list = performance
				.getEntriesByType('resource')
				.find((e) => /\/api\/devices(\?|$)/.test(new URL(e.name).pathname + new URL(e.name).search)) as
				PerformanceResourceTiming | undefined;
			return {
				dataAt: list?.responseEnd ?? 0,
				rowsAt: (window as unknown as { __rows: number }).__rows,
				rows: document.querySelectorAll('table tbody tr[aria-rowindex]').length
			};
		});
		const firstRowsMs = Math.round(t.rowsAt - t.dataAt);

		// Scroll the list for three seconds
		await p.evaluate(() => ((window as unknown as { __perf: { long: number[] } }).__perf.long = []));
		await p.mouse.move(700, 500);
		for (let i = 0; i < 90; i++) {
			await p.mouse.wheel(0, 400);
			await p.waitForTimeout(33);
		}
		const scrollLong = await p.evaluate(() =>
			(window as unknown as { __perf: { long: number[] } }).__perf.long.slice()
		);

		// Type into the filter
		await p.evaluate(() => ((window as unknown as { __perf: { long: number[] } }).__perf.long = []));
		const box = p.getByRole('searchbox').first();
		await box.click();
		const text = 'perf-warehouse-01';
		await box.pressSequentially(text, { delay: 30 });
		const typed = await box.inputValue();
		const typeLong = await p.evaluate(() =>
			(window as unknown as { __perf: { long: number[] } }).__perf.long.slice()
		);

		results['devices-5000'] = {
			firstRowsMs,
			renderedRows: t.rows,
			scrollLongTasksOver50: scrollLong.filter((d) => d > 50).length,
			scrollLongestMs: Math.round(Math.max(0, ...scrollLong)),
			typingLongTasksOver50: typeLong.filter((d) => d > 50).length,
			typingLongestMs: Math.round(Math.max(0, ...typeLong)),
			typedOk: typed === text
		};
		await ctx.close();
		expect(firstRowsMs).toBeLessThan(300);
		expect(scrollLong.filter((d) => d > 50)).toEqual([]);
		expect(typed).toBe(text);
		expect(typeLong.filter((d) => d > 50)).toEqual([]);
	});
});
