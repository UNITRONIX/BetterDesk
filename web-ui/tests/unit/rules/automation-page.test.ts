/**
 * The Alerts and automation page follows the server: without server.config
 * it shows the 403 text and asks the server for nothing; with it, the rules
 * load and the actions show.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const pageState = vi.hoisted(() => ({ url: new URL('http://localhost/app/automation'), state: {} }));
vi.mock('$app/state', () => ({ page: pageState }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), pushState: vi.fn(), replaceState: vi.fn() }));

import Page from '../../../src/routes/(console)/automation/+page.svelte';
import { session } from '../../../src/lib/state/session.svelte.ts';
import { dismissAll } from '../../../src/lib/ui/toasts.svelte.ts';

let requests: string[] = [];

beforeEach(() => {
	requests = [];
	vi.stubGlobal('fetch', async (input: string) => {
		const url = new URL(input, location.origin);
		requests.push(url.pathname);
		const data = url.pathname === '/api/automation/rules' ? { rules: [], total: 0 } : {};
		return {
			ok: true,
			status: 200,
			redirected: false,
			url: url.href,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => data,
			text: async () => JSON.stringify(data)
		} as unknown as Response;
	});
});

afterEach(() => {
	cleanup();
	dismissAll();
	vi.unstubAllGlobals();
	session.isSuperAdmin = false;
	session.permissions = [];
	session.user = null;
});

function signIn(role: string, permissions: string[]) {
	session.isSuperAdmin = false;
	session.permissions = permissions;
	session.user = { id: 1, username: 'demo', role, preferredLanguage: null, avatarVersion: null };
}

describe('alerts and automation page', () => {
	test.each([
		['viewer', ['device.view', 'audit.view']],
		['operator', ['device.view', 'device.edit', 'audit.view']],
		['global_admin', ['device.view', 'org.edit', 'audit.view']]
	])('%s gets the 403 text and no automation request', async (role, permissions) => {
		signIn(role, permissions);
		render(Page);
		expect(await screen.findByRole('heading', { level: 1, name: 'errors.forbidden_title' })).toBeVisible();
		await new Promise((r) => setTimeout(r, 50));
		expect(requests.filter((p) => p.startsWith('/api/automation'))).toEqual([]);
		expect(screen.queryByRole('tab')).toBeNull();
	});

	test('with server.config the rules load and Create rule shows', async () => {
		signIn('server_admin', ['server.config', 'device.view', 'audit.view']);
		render(Page);
		expect(await screen.findByRole('heading', { level: 1, name: 'nav.automation' })).toBeVisible();
		expect(screen.getByRole('button', { name: 'automation.create_rule' })).toBeVisible();
		await vi.waitFor(() => expect(requests).toContain('/api/automation/rules'));
	});
});
