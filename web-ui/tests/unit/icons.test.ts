/**
 * Every icon name the console writes literally has a glyph in the
 * self-hosted Material Symbols subset (static/fonts). A missing one draws
 * its name as text in a 1em box. Meanings ("copy") go through ICONS first,
 * as the Icon component does. Names built at run time are covered by
 * scripts/update-material-symbols.mjs, which scans more patterns and needs
 * the network; this check runs offline.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ICONS } from '../../src/lib/util/display.ts';

const root = path.resolve(__dirname, '../..');

function files(dir: string, out: string[] = []): string[] {
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, ent.name);
		if (ent.isDirectory()) files(full, out);
		else if (/\.(svelte|ts)$/.test(ent.name)) out.push(full);
	}
	return out;
}

const NAME = '([a-z][a-z0-9_]{1,48})';
const PATTERNS = [
	// <Icon name="devices" />
	new RegExp(`<Icon\\b[^>]*?\\bname=["']${NAME}["']`, 'g'),
	// <IconButton icon="close">, <MenuItem icon="edit">, trailingIcon="..."
	new RegExp(`\\b\\w*[iI]con=["']${NAME}["']`, 'g'),
	// { icon: 'folder' }
	new RegExp(`\\bicon\\s*:\\s*['"]${NAME}['"]`, 'g')
];

function subset(): Set<string> {
	const text = fs.readFileSync(path.join(root, 'static/fonts/MATERIAL_SYMBOLS_VERSION.txt'), 'utf8');
	const lines = text.split(/\r?\n/);
	const list = lines[lines.indexOf('Icons (alphabetical):') + 1] ?? '';
	return new Set(list.split(',').filter(Boolean));
}

describe('icon font subset', () => {
	test('the subset list is readable', () => {
		expect(subset().size).toBeGreaterThan(100);
		expect(subset().has('devices')).toBe(true);
	});

	test('has a glyph for every icon name written in the source', () => {
		const have = subset();
		const missing: Record<string, string[]> = {};
		for (const file of files(path.join(root, 'src'))) {
			const text = fs.readFileSync(file, 'utf8');
			for (const re of PATTERNS) {
				for (const m of text.matchAll(re)) {
					const name = (ICONS as Record<string, string>)[m[1]!] ?? m[1]!;
					if (!have.has(name)) (missing[name] ??= []).push(path.relative(root, file));
				}
			}
		}
		// Run `node scripts/update-material-symbols.mjs` from the repo root when this fails
		expect(missing).toEqual({});
	});
});
