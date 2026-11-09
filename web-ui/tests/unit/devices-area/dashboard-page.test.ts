/**
 * The overview page: each part shows for exactly the permissions the server
 * checks, and asks the server only for what the person may read.
 */
import { cleanup, render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
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
let writes: { method: string; path: string; body: unknown }[] = [];
let answers: Record<string, unknown> = {};
/** Answers held back until the test lets them through */
let gates: Record<string, Promise<void>> = {};

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
	writes = [];
	gates = {};
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
		'/api/reports/trends': { success: true, data: { sessions: [], help: [] } },
		'POST /api/panel/pairing/codes': {
			success: true,
			code: 'K7Q2M9',
			id: '41',
			host: 'panel.example.com',
			label: 'Reception',
			expires_at: '',
			expires_in: 600
		}
	};
	vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
		const url = new URL(input, location.origin);
		const method = init.method ?? 'GET';
		requests.push(url.pathname);
		if (gates[url.pathname]) await gates[url.pathname];
		if (method !== 'GET')
			writes.push({
				method,
				path: url.pathname,
				body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
			});
		const data = answers[`${method} ${url.pathname}`] ?? answers[url.pathname] ?? { success: true };
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
		expect(screen.queryByRole('button', { name: 'dashboard.pair_with_code' })).toBeNull();
		// Client values are for everyone
		expect(screen.getByRole('button', { name: /dashboard.config_server_id$/ })).toBeInTheDocument();
	});

	test('device.view without chat.access: banned devices, but the help request list is not asked for (P17)', async () => {
		as(['device.view']);
		render(Page, early());
		await settle();
		// Devices are found with the top bar's search; the page has none of its own
		expect(screen.queryByRole('search')).toBeNull();
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
		expect(screen.getByRole('button', { name: 'dashboard.pair_with_code' })).toBeInTheDocument();
		// The QR scanner is no longer the overview's own button: it opens from the pairing dialog
		expect(screen.queryByRole('button', { name: 'dashboard.activate_agent_qr' })).toBeNull();
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

describe('pairing an agent with a one-time code', () => {
	test('?activateAgent=1 opens the pairing code dialog with the client address filled in', async () => {
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		await vi.waitFor(() =>
			expect(within(dialog).getByLabelText('pairing.host_field')).toHaveValue('desk.example.com')
		);
		expect(within(dialog).getByLabelText('pairing.label_field')).toHaveValue('');
		// Nothing is created until the person asks for a code
		expect(writes).toEqual([]);
		expect(pageInfo.title).toBe('nav.pair_agent');
		expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('nav.dashboard');
	});

	test('a client address that arrives after the dialog opened fills the field, unless one was typed', async () => {
		let release = () => {};
		gates['/api/dashboard/client-config'] = new Promise<void>((r) => (release = r));
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		const field = within(dialog).getByLabelText('pairing.host_field');
		expect(field).toHaveValue('');
		release();
		await vi.waitFor(() => expect(field).toHaveValue('desk.example.com'));
		cleanup();

		const user = userEvent.setup();
		gates['/api/dashboard/client-config'] = new Promise<void>((r) => (release = r));
		render(Page, early());
		const again = await screen.findByRole('dialog', { name: 'pairing.title' });
		await user.type(within(again).getByLabelText('pairing.host_field'), 'office.example.org');
		release();
		await vi.waitFor(() => expect(screen.getByText('dashboard.client_config_hint')).toBeInTheDocument());
		expect(within(again).getByLabelText('pairing.host_field')).toHaveValue('office.example.org');
	});

	test('a code is created with the label, shown once with its address and time', async () => {
		const user = userEvent.setup();
		as(['enrollment.approve']);
		render(Page, early());
		await user.click(await screen.findByRole('button', { name: 'dashboard.pair_with_code' }));
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		await vi.waitFor(() =>
			expect(within(dialog).getByLabelText('pairing.host_field')).toHaveValue('desk.example.com')
		);
		await user.type(within(dialog).getByLabelText('pairing.label_field'), 'Reception');
		await user.click(within(dialog).getByRole('button', { name: 'pairing.generate_button' }));
		await vi.waitFor(() => expect(within(dialog).getByText('K7Q2M9')).toBeInTheDocument());
		expect(writes).toEqual([
			{ method: 'POST', path: '/api/panel/pairing/codes', body: { label: 'Reception' } }
		]);
		// The address the person typed (the client address), not the panel's own
		expect(within(dialog).getByText('desk.example.com', { selector: 'dd' })).toBeInTheDocument();
		expect(within(dialog).getByText(/pairing\.valid_minutes/)).toBeInTheDocument();
		// Copy sits with the code
		expect(within(dialog).getByRole('button', { name: /pairing\.title$/ })).toBeInTheDocument();
	});

	test('Enter in a field creates the code', async () => {
		const user = userEvent.setup();
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		await user.type(within(dialog).getByLabelText('pairing.label_field'), 'Lab{Enter}');
		await vi.waitFor(() => expect(writes).toHaveLength(1));
		expect(writes[0]?.body).toEqual({ label: 'Lab' });
	});

	test('a refused code says why in the dialog', async () => {
		const user = userEvent.setup();
		answers['POST /api/panel/pairing/codes'] = { success: true, code: '' };
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		await user.click(within(dialog).getByRole('button', { name: 'pairing.generate_button' }));
		await vi.waitFor(() => expect(within(dialog).getByText(/pairing\.create_failed/)).toBeInTheDocument());
		expect(within(dialog).queryByText('K7Q2M9')).toBeNull();
	});

	test('the QR scanner opens from the pairing dialog', async () => {
		const user = userEvent.setup();
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['enrollment.approve']);
		render(Page, early());
		const dialog = await screen.findByRole('dialog', { name: 'pairing.title' });
		expect(within(dialog).getByRole('link', { name: 'nav.pairing' })).toHaveAttribute('href', '/app/pairing');
		await user.click(within(dialog).getByRole('button', { name: 'pairing.scan_qr_agent' }));
		const scanner = await screen.findByRole('dialog', { name: 'pairing.scan_qr_agent' });
		// jsdom has no BarcodeDetector: the way to approve the device instead
		expect(within(scanner).getByRole('link', { name: 'nav.registrations' })).toHaveAttribute(
			'href',
			'/app/registrations'
		);
		expect(screen.queryByRole('dialog', { name: 'pairing.title' })).toBeNull();
	});

	test('?activateAgent=1 does nothing for others', async () => {
		pageUrl.url = new URL('http://localhost/app?activateAgent=1');
		as(['device.view']);
		render(Page, early());
		await settle();
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
