import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import DevicePanelHost from '../../src/lib/devices/DevicePanelHost.svelte';
// Loaded up front so the host's lazy import resolves at once
import '../../src/lib/devices/DevicePanel.svelte';
import DialogHost from '../../src/lib/ui/DialogHost.svelte';
import {
	closeDevice,
	devicePanel,
	openDevice,
	refreshDevice
} from '../../src/lib/state/devicePanel.svelte.ts';
import { session } from '../../src/lib/state/session.svelte.ts';
import { dismissAll } from '../../src/lib/ui/toasts.svelte.ts';

const ID = '900100001';

type Handler = (body: unknown, url: URL) => unknown;
interface Call {
	method: string;
	path: string;
	body: unknown;
}

let calls: Call[] = [];
let routes: Record<string, Handler> = {};

function baseDevice(over: Record<string, unknown> = {}) {
	return {
		id: ID,
		hostname: 'demo-reception-01',
		display_name: 'Front desk',
		username: 'demo.front',
		platform: 'Windows 11 Pro',
		note: 'old note',
		online: true,
		banned: false,
		soft_deleted: false,
		folder_id: 1,
		tags: ['office'],
		device_type: 'rustdesk',
		status_tier: 'ONLINE',
		last_online: '2026-11-09T02:54:51Z',
		created_at: '2026-09-29T15:35:55Z',
		...over
	};
}

function serve(device: Record<string, unknown>) {
	routes = {
		[`GET /api/devices/${ID}`]: () => ({ success: true, data: device }),
		'GET /api/folders': () => ({
			success: true,
			data: {
				folders: [
					{ id: 1, name: 'Office' },
					{ id: 3, name: 'Servers' }
				]
			}
		}),
		'GET /api/tags': () => ({ success: true, data: { tags: ['office', 'lab'] } }),
		[`PATCH /api/devices/${ID}`]: () => ({ success: true, data: { changes: 1 } }),
		[`PUT /api/devices/${ID}/tags`]: (body) => ({ success: true, data: body }),
		[`PATCH /api/devices/${ID}/folder`]: () => ({ success: true })
	};
}

beforeEach(() => {
	calls = [];
	session.isSuperAdmin = true;
	session.permissions = [];
	vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
		const url = new URL(input, location.origin);
		const method = init.method ?? 'GET';
		const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
		calls.push({ method, path: url.pathname, body });
		const handler = routes[`${method} ${url.pathname}`];
		const status = handler ? 200 : 404;
		const data = handler ? handler(body, url) : { success: false, error: 'not found' };
		// A plain object instead of Response: its body resolves on microtasks, so fake timers stay in control
		return {
			ok: status < 400,
			status,
			redirected: false,
			url: url.href,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => data,
			text: async () => JSON.stringify(data)
		} as unknown as Response;
	});
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

let visibility: DocumentVisibilityState = 'visible';

afterEach(async () => {
	closeDevice();
	await tick();
	cleanup();
	dismissAll();
	visibility = 'visible';
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const deviceLoads = () => calls.filter((c) => c.method === 'GET' && c.path === `/api/devices/${ID}`).length;

async function openPanel(mode: 'view' | 'edit' = 'view') {
	render(DevicePanelHost);
	render(DialogHost);
	openDevice(ID, { mode });
	return screen.findByRole('tablist');
}

/** A button's words without its icon */
const words = (b: Element) =>
	[...b.childNodes]
		.filter((n) => !(n instanceof Element && n.getAttribute('aria-hidden') === 'true'))
		.map((n) => n.textContent)
		.join('')
		.trim();

/** The footer's slots and, per slot, the button that is not inert */
function footer() {
	const el = document.querySelector('.sheet-footer') as HTMLElement;
	const slots = [...el.querySelectorAll<HTMLElement>('.dp-slot')];
	return {
		slots,
		active: slots.map((s) => {
			const on = [...s.querySelectorAll('button')].find((b) => !b.hasAttribute('inert'));
			return on ? words(on) : null;
		}),
		buttons: slots.map((s) => [...s.querySelectorAll('button')])
	};
}

describe('footer keeps its slots between view and edit mode', () => {
	test('same slots, same buttons; only which one is active changes', async () => {
		serve(baseDevice());
		await openPanel();
		await waitFor(() => expect(footer().slots).toHaveLength(3));
		const view = footer();
		expect(view.active).toEqual(['actions.edit', 'actions.connect', 'actions.close']);

		await userEvent.click(screen.getByRole('button', { name: 'actions.edit' }));
		await waitFor(() => expect(footer().active).toEqual(['actions.cancel', null, 'actions.save']));
		const edit = footer();
		// The very same slot elements and buttons: nothing was re-created or moved
		edit.slots.forEach((s, i) => expect(s).toBe(view.slots[i]));
		edit.buttons.forEach((list, i) => list.forEach((b, j) => expect(b).toBe(view.buttons[i]?.[j])));
		// The inactive buttons are inert (out of the tab order and the accessibility tree)
		expect(screen.getByRole('button', { name: 'actions.connect' })).toHaveAttribute('inert');
		expect(within(edit.slots[2]!).getByRole('button', { name: 'actions.close' })).toHaveAttribute('inert');

		await userEvent.click(screen.getByRole('button', { name: 'actions.cancel' }));
		await waitFor(() =>
			expect(footer().active).toEqual(['actions.edit', 'actions.connect', 'actions.close'])
		);
		expect(document.activeElement && words(document.activeElement)).toBe('actions.edit');
	});

	test('without device.connect the Connect slot is left out, Edit and Close keep theirs', async () => {
		session.isSuperAdmin = false;
		session.permissions = ['device.view', 'device.edit'];
		serve(baseDevice());
		await openPanel();
		await waitFor(() => expect(footer().active).toEqual(['actions.edit', 'actions.close']));
	});
});

describe('edit mode', () => {
	test('Save sends only the changed fields, then shows the device again', async () => {
		serve(baseDevice());
		await openPanel('edit');
		const name = await screen.findByLabelText('devices.display_name');
		await waitFor(() => expect(document.activeElement).toBe(name));
		await userEvent.clear(name);
		await userEvent.type(name, 'Reception');
		const before = deviceLoads();
		await userEvent.click(screen.getByRole('button', { name: 'actions.save' }));

		await waitFor(() => expect(footer().active[0]).toBe('actions.edit'));
		const writes = calls.filter((c) => c.method !== 'GET');
		expect(writes).toEqual([
			{ method: 'PATCH', path: `/api/devices/${ID}`, body: { display_name: 'Reception' } }
		]);
		expect(devicePanel.mode).toBe('view');
		await waitFor(() => expect(deviceLoads()).toBeGreaterThan(before));
	});

	test('Enter in the name field saves', async () => {
		serve(baseDevice());
		await openPanel('edit');
		const name = await screen.findByLabelText('devices.display_name');
		await userEvent.clear(name);
		await userEvent.type(name, 'Lobby{Enter}');
		await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
		expect(calls.filter((c) => c.method !== 'GET')[0]?.body).toEqual({ display_name: 'Lobby' });
	});

	test('a typed tag is saved with the rest; a duplicate is refused next to the field', async () => {
		serve(baseDevice());
		await openPanel('edit');
		const tag = await screen.findByLabelText('devices.add_tag_label');
		await userEvent.type(tag, 'OFFICE');
		await userEvent.click(screen.getByRole('button', { name: 'actions.save' }));
		expect(await screen.findByText('device_detail.tag_exists')).toBeInTheDocument();
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([]);

		await userEvent.clear(tag);
		await userEvent.type(tag, 'lab');
		await userEvent.click(screen.getByRole('button', { name: 'actions.save' }));
		await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
		expect(calls.filter((c) => c.method !== 'GET')).toEqual([
			{ method: 'PUT', path: `/api/devices/${ID}/tags`, body: { tags: ['office', 'lab'] } }
		]);
	});

	test('Escape leaves editing, and asks first when something changed', async () => {
		serve(baseDevice());
		await openPanel('edit');
		const name = await screen.findByLabelText('devices.display_name');
		await userEvent.type(name, 'x');
		await userEvent.keyboard('{Escape}');
		const dialog = await screen.findByRole('dialog', { name: 'device_detail.discard_title' });
		await userEvent.click(within(dialog).getByRole('button', { name: 'device_detail.discard_confirm' }));
		await waitFor(() => expect(devicePanel.mode).toBe('view'));
		// Still open: Escape in edit mode doesn't close the panel
		expect(devicePanel.id).toBe(ID);
	});
});

describe('loading and polling', () => {
	test('a revision bump reloads the device', async () => {
		serve(baseDevice());
		await openPanel();
		await waitFor(() => expect(deviceLoads()).toBe(1));
		refreshDevice(ID);
		await waitFor(() => expect(deviceLoads()).toBe(2));
		refreshDevice('someone-else');
		await tick();
		expect(deviceLoads()).toBe(2);
	});

	test('polls every 15 s, not in a hidden tab, and stops when the panel closes', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
		serve(baseDevice());
		render(DevicePanelHost);
		openDevice(ID);
		await vi.advanceTimersByTimeAsync(100);
		expect(deviceLoads()).toBe(1);
		await vi.advanceTimersByTimeAsync(15_000);
		expect(deviceLoads()).toBe(2);

		visibility = 'hidden';
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(deviceLoads()).toBe(2);

		visibility = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(100);
		expect(deviceLoads()).toBe(3);

		closeDevice();
		const before = calls.length;
		await vi.advanceTimersByTimeAsync(60_000);
		// No request of any kind once the panel is gone
		expect(calls.slice(before)).toEqual([]);
	});

	test('a device that fails to load shows why, with Retry', async () => {
		routes = {};
		render(DevicePanelHost);
		openDevice(ID);
		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
	});
});

describe('permissions per role', () => {
	test('viewer: no Edit, no Connect, no Actions tab, note as text', async () => {
		session.isSuperAdmin = false;
		session.permissions = ['device.view', 'remote_target.view', 'cdap.view'];
		serve(baseDevice());
		await openPanel();
		await waitFor(() => expect(footer().active).toEqual(['actions.close']));
		expect(screen.queryByRole('tab', { name: 'device_detail.tab_actions' })).toBeNull();
		await userEvent.click(screen.getByRole('tab', { name: 'device_detail.tab_tags' }));
		expect(await screen.findByText('old note')).toBeInTheDocument();
		expect(screen.queryByRole('textbox')).toBeNull();
	});

	test('an edit request without device.edit stays in view mode', async () => {
		session.isSuperAdmin = false;
		session.permissions = ['device.view', 'device.connect'];
		serve(baseDevice());
		await openPanel('edit');
		await waitFor(() => expect(devicePanel.mode).toBe('view'));
		expect(screen.queryByLabelText('devices.display_name')).toBeNull();
	});
});

describe('text from the device is text', () => {
	const IMG = '<img src=x onerror="window.__pwned=1">';
	const SCRIPT = '"><script>window.__pwned=2</script>';
	const RTL = 'abc‮gpj.exe‬';

	test('hostname, note, user and process names never become markup', async () => {
		serve(baseDevice({ display_name: '', hostname: IMG, note: SCRIPT, username: RTL }));
		routes[`GET /api/devices/${ID}/processes`] = () => ({
			success: true,
			data: { processes: [{ pid: 7, name: IMG, user: SCRIPT, cpu: 1 }] }
		});
		await openPanel();
		const dialog = await screen.findByRole('dialog');
		expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe(IMG);
		expect(dialog.textContent).toContain(RTL);

		await userEvent.click(screen.getByRole('tab', { name: 'device_detail.tab_live' }));
		await userEvent.click(await screen.findByRole('button', { name: 'device_detail.tab_processes' }));
		await screen.findByRole('cell', { name: SCRIPT });
		expect(screen.getByRole('cell', { name: IMG })).toBeInTheDocument();
		expect(document.querySelector('img[src="x"]')).toBeNull();

		await userEvent.click(screen.getByRole('tab', { name: 'device_detail.tab_tags' }));
		expect(
			(await screen.findByRole('textbox', { name: 'device_detail.notes' })) as HTMLTextAreaElement
		).toHaveValue(SCRIPT);

		expect(document.querySelector('img[src="x"]')).toBeNull();
		expect(document.querySelector('script')).toBeNull();
		expect((window as { __pwned?: number }).__pwned).toBeUndefined();
	});
});
