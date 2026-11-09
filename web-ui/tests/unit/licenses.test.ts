import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { licenseText, packageOf } from '../../vite-plugins/licenses.ts';

let root: string;
const nm = () => path.join(root, 'node_modules');

function pkg(name: string, json: object, files: Record<string, string> = {}) {
	const dir = path.join(nm(), name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...json }));
	for (const [f, text] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
		fs.writeFileSync(path.join(dir, f), text);
	}
	return path.join(dir, 'index.js').replaceAll('\\', '/');
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'licenses-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('licenses.txt', () => {
	test('lists each bundled package once with its own license text, app code left out', () => {
		const a = pkg('@scope/a', { license: 'MIT' }, { LICENSE: 'MIT License\n\nCopyright (c) A' });
		const b = pkg('b', { license: 'ISC' }, { 'license.md': 'ISC License\n\nCopyright (c) B' });
		const { text, problems } = licenseText([
			a,
			'\0' + a + '?commonjs-proxy',
			b,
			b.replace('index.js', 'lib/other.js'),
			path.join(root, 'src/app.ts')
		]);
		expect(problems).toEqual([]);
		expect(text).toContain('@scope/a 1.0.0 (MIT)\n\nMIT License\n\nCopyright (c) A');
		expect(text).toContain('b 1.0.0 (ISC)\n\nISC License\n\nCopyright (c) B');
		expect(text.match(/^@scope\/a /gm)).toHaveLength(1);
		expect(text).not.toContain('app.ts');
	});

	test('a package without a license file gives the copyright comment its main file starts with', () => {
		const id = pkg(
			'qr',
			{ license: 'MIT', main: 'dist/qr.js' },
			{
				'dist/qr.js':
					'// QR code\n//\n// Copyright (c) 2009 Someone\n// Licensed under the MIT license\nvar x;'
			}
		);
		const { text, problems } = licenseText([id]);
		expect(problems).toEqual([]);
		expect(text).toContain('Copyright (c) 2009 Someone\nLicensed under the MIT license');
		expect(text).not.toContain('var x');
	});

	test('a license outside the allowed list, or no license text, is a problem', () => {
		const gpl = pkg('gpl', { license: 'GPL-3.0' }, { LICENSE: 'GNU GPL' });
		const bare = pkg('bare', { license: 'MIT' });
		const odd = pkg('odd', { licenses: [{ type: 'MIT' }] }, { LICENSE: 'text' });
		const { problems } = licenseText([gpl, bare, odd]);
		expect(problems).toEqual([
			'bare: no license text in the package',
			'gpl: license "GPL-3.0" is not one the console ships',
			'odd: license "" is not one the console ships'
		]);
	});
});

describe('packageOf', () => {
	test.each([
		['/w/node_modules/svelte/src/index.js', 'svelte', '/w/node_modules/svelte'],
		['/w/node_modules/@xterm/xterm/lib/xterm.mjs', '@xterm/xterm', '/w/node_modules/@xterm/xterm'],
		['/w/node_modules/a/node_modules/b/x.js', 'b', '/w/node_modules/a/node_modules/b'],
		['C:\\w\\node_modules\\clsx\\dist\\clsx.mjs', 'clsx', 'C:/w/node_modules/clsx']
	])('%s', (id, name, dir) => {
		expect(packageOf(id)).toEqual({ name, dir });
	});

	test('app code is not a package', () => {
		expect(packageOf('/w/src/lib/api/client.ts')).toBeNull();
	});
});
