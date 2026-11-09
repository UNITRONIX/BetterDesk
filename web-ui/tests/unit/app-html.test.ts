import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('the page shell (src/app.html)', () => {
	test('preloads the icon font at the URL the stylesheet loads it from', () => {
		// A different URL (another ?v=) would download the font twice and not help
		const css = read('src/lib/styles/base.css');
		const face = /@font-face\s*\{[^}]*Material Symbols Outlined[^}]*url\('([^']+)'\)/.exec(css);
		expect(face?.[1]).toBeTruthy();
		const preloads = [...read('src/app.html').matchAll(/<link\s+rel="preload"\s+href="([^"]+)"/g)].map(
			(m) => m[1]
		);
		expect(preloads).toContain(face?.[1]);
	});
});
