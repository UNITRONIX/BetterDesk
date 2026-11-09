/**
 * The overview page: each part shows for exactly the permissions the server
 * checks, and asks the server only for what the person may read.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const pageUrl = vi.hoisted(() => ({ url: new URL('http://localhost/app') }));
vi.mock('$app/state', () => ({ page: pageUrl }));
vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), pushState: vi.fn(), replaceState: vi.fn() }));

import Page from '../../../src/routes/(console)/+page.svelte';
import { session } from '../../../src/lib/state/session.svelte.ts';
import { dismissAll } from '../../../src/lib/ui/toasts.svelte.ts';
import { pageInfo } from '../../../src/lib/shell/page.svelte.ts';

let requests: string[] = [];
let answers: Record<string, unknown> = {};

const RUNNING = {
	success: true,
	data: {
		uptime: 3600,
		hbbs: { status: 'running' },
		hbbr: { status: 'running' },
		signal_port: 21116,
		console_port: 5000
	}
};

beforeEach(() => {
	requests = [];
	answers = {
		'/api/stats': { success: true, data: { devices: { total: 33, online: 14, offline: 19, banned: 2 } } },
		'/api/server/status': RUNNING,
		'/api/dashboard/client-config': {
			success: true,
			data: {
				server_id: 'desk.example.com',
				relay_server: 'desk.example.com',
				public_key: 'KEY=',
				client_server_host: 'desk.example.com'
			}
		},
		'/api/registrations/count': { success: true, count: 10 },
		'/api/help/requests': { success: true, requests: [{ status: 'pending' }, { status: 'resolved' }] },
		'/api/reports/trends': { success: true, data: { sessions: [], help: [] } }
	};
	vi.stubGlobal('fetch', async (input: string) => {
		const url = new URL(input, location.origin);
		requests.push(url.pathname);
		const data = answers[url.pathname] ?? { success: true };
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
	pageUrl.url = new URL('http://localhost/app');
});

afterEach(() => {
	cleanup();
	dismissAll();
	vi.unstubAllGlobals();
});

function as(permissions: string[], navPages: string[] = []) {
	session.isSuperAdmin = false;
	session.permissions = permissions;
	session.nav = [
		{
			id: 'main',
			icon: '',
			text: '',
			pages: navPages.map((page) => ({
				page,
				href: '/' + page,
				text: page,
				group: '',
				core: false,
				keywords: '',
				external: false,
				countId: null
			}))
		}
	];
}

const early = () => ({
	data: {
		early: { stats: Promise.resolve(null), status: Promise.resolve(null), config: Promise.resolve(null) }
	}
});
const settle = () => vi.waitFor(() => expect(screen.queryByText('status.checking')).toBeNull());
const attention = () =>
	screen.getByRole('heading', { name: 'dashboard.attention_panel' }).closest('section')!;

describe('overview per permission', () => {
	test('without device.view: no device search, counts or banned line, and nothing asked that would fail', async () => {
		as([]);
		render(Page, early());
		await settle();
		expect(screen.queryByRole('search')).toBeNull();
		expect(screen.queryByRole('heading', { name: 'nav.devices' })).toBeNull();
		expect(within(attention()).queryByText('dashboard.banned')).toBeNull();
		expect(within(attention()).getByText('dashboard.attention_none')).toBeInTheDocument();
		expect(requests).not.toContain('/api/registrations/count');
		expect(requests).not.toContain('/api/help/requests');
		expect(requests).not.toContain('/api/reports/trends');
		expect(screen.queryByRole('button', { name: 'dashboard.activate_agent_qr' })).toBeNull();
		// Client values are for everyone
		expect(screen.getByRole('button', { name: /dashboard.config_server_id$/ })).toBeInTheDocument();
	});

	test('device.view without chat.access: banned devices, but the help request list is not asked for (P17)', async () => {
		as(['device.view']);
		render(Page, early());
		await settle();
		expect(screen.getByRole('search')).toBeInTheDocument();
		const banned = within(attention()).getByRole('link', { name: /dashboard\.banned/ });
		expect(banned).toHaveAttribute('href', '/app/devices?status=banned');
		expect(banned).toHaveTextContent('2');
		expect(requests).not.toContain('/api/help/requests');
		expect(screen.getByText('dashboard.devices_now_offline').closest('a')).toHaveTextContent('17');
	});

	test('enrollment.approve and chat.access add their lines and the activation button', async () => {
		as(['device.view', 'chat.access', 'enrollment.approve']);
		render(Page, early());
		await settle();
		const list = attention();
		expect(within(list).getByRole('link', { name: /nav\.registrations/ })).toHaveTextContent('10');
		expect(within(list).getByRole('link', { name: /nav\.help_requests/ })).toHaveTextContent('1');
		expect(screen.getByRole('button', { name: 'dashboard.activate_agent_qr' })).toBeInTheDocument();
	});

	test('audit.view asks for the trends', async () => {
		as(['audit.view']);
		render(Page, early());
		await vi.waitFor(() => expect(requests).toContain('/api/reports/trends'));
	});

	test('a stopped relay is a line in Needs attention; it links to server status only for those who may open it', async () => {
		answers['/api/server/status'] = {
			success: true,
			data: { hbbs: { status: 'running' }, hbbr: { status: 'stopped' } }
		};
		as([]);
		render(Page, early());
		await settle();
		const row = within(attention()).getByText('dashboard.status_relay_down');
		expect(row.closest('a')).toBeNull();
		cleanup();

		as(['server.config'], ['server-management:overview', 'keys', 'agents']);
		render(Page, early());
		await settle();
		const linked = within(attention()).getByText('dashboard.status_relay_down').closest('a');
		expect(linked).toHaveAttribute('href', '/app/server-management?tab=overview');
		expect(screen.getByRole('link', { name: 'dashboard.open_keys' })).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /dashboard\.open_agents/ })).toBeInTheDocument();
	});

	test('links to Agents and Keys follow the menu', async () => {
		as(['server.config']);
		render(Page, early());
		await settle();
		expect(screen.queryByRole('link', { name: 'dashboard.open_keys' })).toBeNull();
		expect(screen.queryByRole('link', { name: /dashboard\.open_agents/ })).toBeNull();
		expect(screen.queryByRole('link', { name: 'dashboard.open_server_status' })).toBeNull();
	});
});

describe('?activateAgent=1', () => {
	test('opens the activation for those who may activate', async () => {
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByRole('heading', { name: 'dashboard.activate_agent_qr' })).toBeInTheDocument();
		// jsdom has no BarcodeDetector: the way to approve the device instead
		expect(within(dialog).getByRole('link', { name: 'nav.registrations' })).toHaveAttribute(
			'href',
			'/app/registrations'
		);
		expect(pageInfo.title).toBe('nav.activate_agent');
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nav.dashboard');
	});

	test('does nothing for others', async () => {
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['device.view']);
		render(Page, early());
		await settle();
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
