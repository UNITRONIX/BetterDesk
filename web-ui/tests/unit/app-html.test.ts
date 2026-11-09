import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('the page shell (src/app.html)', () => {
	test('preloads the fonts at the URLs the built stylesheet loads them from', () => {
		// The fonts are in static/, so Vite prefixes the stylesheet's /fonts/... URLs
		// with the base (/console/fonts/... in a build for /console). A preload of another URL downloads the
		// font a second time and doesn't help.
		const css = read('src/lib/styles/base.css');
		const faces = [...css.matchAll(/@font-face\s*\{[^}]*?url\('([^']+)'\)/g)].map((m) => m[1]!);
		const preloads = [...read('src/app.html').matchAll(/rel="preload"\s+href="([^"]+)"/g)].map((m) => m[1]!);
		expect(preloads.length).toBeGreaterThan(0);
		for (const href of preloads) {
			expect(href.startsWith('%sveltekit.assets%/')).toBe(true);
			const url = href.slice('%sveltekit.assets%'.length);
			expect(fs.existsSync(path.join(root, 'static', url.split('?')[0]!))).toBe(true);
			expect(faces).toContain(url);
		}
	});
});
