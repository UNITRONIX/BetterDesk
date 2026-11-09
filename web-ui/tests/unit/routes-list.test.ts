import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, Builder } from '@sveltejs/kit';
import { withRoutesList } from '../../vite-plugins/routes.ts';

let dir: string;
beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-list-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

// The patterns SvelteKit builds for these route ids (as in a real build)
const routes = [
	{ id: '/(console)', pattern: /^\/$/ },
	{ id: '/(console)/policies/[[orgId]]', pattern: /^\/policies(?:\/([^/]+))?\/?$/ },
	{ id: '/(remote)/remote/[deviceId]', pattern: /^\/remote\/([^/]+?)\/?$/ }
] as unknown as Builder['routes'];

/** Like adapter-static: empties its folder, then writes the fallback page */
const fakeAdapter: Adapter = {
	name: 'fake',
	async adapt() {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.mkdirSync(dir);
		fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
	}
};

const builder = { routes, log: { minor: () => {} } } as unknown as Builder;

describe('routes.json', () => {
	test('lists every page with its pattern, after the adapter has written its folder', async () => {
		await withRoutesList(fakeAdapter, dir).adapt(builder);
		expect(fs.existsSync(path.join(dir, 'index.html'))).toBe(true);
		const list = JSON.parse(fs.readFileSync(path.join(dir, 'routes.json'), 'utf8')) as {
			id: string;
			pattern: string;
		}[];
		expect(list.map((r) => r.id)).toEqual([
			'/(console)',
			'/(console)/policies/[[orgId]]',
			'/(remote)/remote/[deviceId]'
		]);
		// The server rebuilds the patterns from the file and matches paths with them
		const match = (p: string) => list.some((r) => new RegExp(r.pattern).test(p));
		expect(match('/')).toBe(true);
		expect(match('/policies')).toBe(true);
		expect(match('/policies/7')).toBe(true);
		expect(match('/remote/900100001')).toBe(true);
		expect(match('/policies/7/x')).toBe(false);
		expect(match('/no-such-page')).toBe(false);
	});

	test('keeps the adapter name and options', () => {
		const wrapped = withRoutesList({ ...fakeAdapter, supports: { read: () => true } }, dir);
		expect(wrapped.name).toBe('fake');
		expect(wrapped.supports?.read).toBeTypeOf('function');
	});
});
