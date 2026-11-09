/**
 * Puts licenses.txt next to the console's code (served at <base>/licenses.txt):
 * the license of every npm package whose code is in the browser bundle, with
 * the package's own license text. The build fails when a bundled package has
 * a license outside ALLOWED or no license text, so a new dependency can't
 * ship unnoticed. THIRD_PARTY_NOTICES.md lists the same packages.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export const ALLOWED = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0']);

interface Pkg {
	name: string;
	version: string;
	license?: unknown;
	main?: string;
}

/** The package name and folder for a module id inside node_modules */
export function packageOf(id: string): { name: string; dir: string } | null {
	const file = (id.replace(/^\0/, '').split('?')[0] ?? '').replaceAll('\\', '/');
	const at = file.lastIndexOf('/node_modules/');
	if (at < 0) return null;
	const start = at + '/node_modules/'.length;
	const [first = '', second = ''] = file.slice(start).split('/');
	const name = first.startsWith('@') ? `${first}/${second}` : first;
	return { name, dir: file.slice(0, start) + name };
}

/** A package without a license file: the comment its main file starts with */
function leadingComment(dir: string, pkg: Pkg): string {
	const main = path.join(dir, pkg.main ?? 'index.js');
	if (!fs.existsSync(main)) return '';
	const lines: string[] = [];
	for (const line of fs.readFileSync(main, 'utf8').split('\n')) {
		if (!line.startsWith('//')) break;
		lines.push(line.replace(/^\/\/ ?/, ''));
	}
	const text = lines.join('\n').trim();
	return /copyright/i.test(text) ? text : '';
}

export function licenseText(ids: Iterable<string>): { text: string; problems: string[] } {
	const dirs = new Map<string, string>();
	for (const id of ids) {
		const p = packageOf(id);
		if (p) dirs.set(p.name, p.dir);
	}
	const parts: string[] = [];
	const problems: string[] = [];
	for (const [name, dir] of [...dirs].sort(([a], [b]) => a.localeCompare(b))) {
		const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Pkg;
		const license = typeof pkg.license === 'string' ? pkg.license : '';
		if (!ALLOWED.has(license)) problems.push(`${name}: license "${license}" is not one the console ships`);
		const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
		const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : leadingComment(dir, pkg);
		if (!text) problems.push(`${name}: no license text in the package`);
		parts.push(`${name} ${pkg.version} (${license})\n\n${text}`);
	}
	const head = 'Third-party code in the BetterDesk console (see THIRD_PARTY_NOTICES.md)';
	return { text: [head, ...parts].join('\n\n' + '-'.repeat(72) + '\n\n') + '\n', problems };
}

export function licenses(): Plugin {
	return {
		name: 'bd-licenses',
		apply: 'build',
		generateBundle(_options, bundle) {
			if (this.environment.name !== 'client') return;
			const ids = new Set<string>();
			for (const chunk of Object.values(bundle)) {
				if (chunk.type === 'chunk') for (const id of chunk.moduleIds) ids.add(id);
			}
			const { text, problems } = licenseText(ids);
			if (problems.length) this.error(problems.join('\n'));
			this.emitFile({ type: 'asset', fileName: 'licenses.txt', source: text });
		}
	};
}
