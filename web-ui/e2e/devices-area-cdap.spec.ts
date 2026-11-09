/**
 * IoT devices (CDAP): the list and a device page, once per role. The demo
 * data has no CDAP device, so the gateway's answers and the device's sockets
 * are mocked. Each role is offered exactly what its permissions let through
 * (the routes check cdap.command and server.config, the sockets cdap.terminal,
 * cdap.files and cdap.command), commands carry what the control says, the
 * device's clipboard is never written into the browser's, and axe finds
 * nothing on the page or in its dialogs.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];
const ID = 'CDAP-0A1B2C3D';
const PNG =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const manifest = {
	device: { name: 'Boiler room controller', type: 'scada', firmware_version: '4.2.1' },
	widgets: [
		{ id: 'pump', type: 'toggle', label: 'Circulation pump' },
		{ id: 'reset', type: 'button', label: 'Reset alarms', confirm: 'Reset every alarm?' },
		{ id: 'temp', type: 'gauge', label: 'Water temperature', unit: '°C', min: 0, max: 120 },
		{ id: 'shell', type: 'terminal', label: 'Shell' },
		{ id: 'screen', type: 'desktop', label: 'Panel screen' },
		{ id: 'cam', type: 'video_stream', label: 'Camera' },
		{ id: 'files', type: 'file_browser', label: 'Files' },
		{ id: 'mic', type: 'audio', label: 'Microphone' },
		{ id: 'x', type: 'text', label: '<img src=x onerror="window.__xss=1">' }
	]
};

interface Sent {
	commands: Record<string, unknown>[];
	desktop: Record<string, unknown>[];
}

async function mock(page: Page): Promise<Sent> {
	const sent: Sent = { commands: [], desktop: [] };
	await page.route(/\/api\/cdap\//, async (route) => {
		const url = new URL(route.request().url());
		const p = url.pathname;
		const json = (body: unknown, status = 200) =>
			route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
		if (p === '/api/cdap/status') return json({ enabled: true, connected: 1, port: 21122, tls: false });
		if (p === '/api/cdap/devices')
			return json({ devices: [{ id: ID, connected: true, manifest, client_ip: '10.0.5.20' }] });
		if (p === '/api/cdap/alerts') return json({ alerts: [], total: 0 });
		if (p === `/api/cdap/devices/${ID}`) return json({ id: ID, connected: true, manifest });
		if (p === `/api/cdap/devices/${ID}/manifest`) return json(manifest);
		if (p === `/api/cdap/devices/${ID}/state`)
			return json({ device_id: ID, widget_state: { pump: true, temp: 70, x: '<b>bold</b>' } });
		if (p === `/api/cdap/devices/${ID}/linked`) return json({ linked: [] });
		if (p === `/api/cdap/devices/${ID}/command`) {
			sent.commands.push(JSON.parse(route.request().postData() ?? '{}'));
			return json({ status: 'sent' }, 202);
		}
		return json({ success: false, error: 'Request failed with status code 404' });
	});
	await page.routeWebSocket(/\/api\/cdap\/devices\/[^/]+\/desktop$/, (ws) => {
		ws.onMessage((raw) => {
			const msg = JSON.parse(String(raw)) as Record<string, unknown>;
			sent.desktop.push(msg);
			if (msg.width && !msg.type) {
				ws.send(JSON.stringify({ type: 'ready', session_id: 'd1' }));
				ws.send(JSON.stringify({ type: 'frame', data: PNG, format: 'png', width: 1, height: 1 }));
				ws.send(JSON.stringify({ type: 'clipboard_update', format: 'text', data: 'from the device' }));
			}
		});
	});
	return sent;
}

async function permissions(page: Page): Promise<(p: string) => boolean> {
	const boot = await page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', { headers: { Accept: 'application/json' } });
		return (await r.json()) as { permissions: string[]; isSuperAdmin: boolean };
	});
	return (p) => boot.isSuperAdmin || boot.permissions.includes(p);
}

for (const role of ROLES) {
	test.describe(`IoT devices as ${role}`, () => {
		test.use({ role });

		test('the list and the gateway switch follow the permissions', async ({ page }) => {
			await mock(page);
			await page.goto(`${UI}/cdap`);
			await expect(page.getByRole('link', { name: 'Boiler room controller' })).toBeVisible();
			const can = await permissions(page);
			await expect(page.getByRole('button', { name: /disable gateway/i })).toHaveCount(
				can('server.config') ? 1 : 0
			);
			await expectNoAxeViolations(page);
			// The alias
			await page.goto(`${UI}/cdap/devices`);
			await expect(page.getByRole('link', { name: 'Boiler room controller' })).toBeVisible();
		});

		test('the device page offers what the sockets and routes let through', async ({ page }) => {
			const sent = await mock(page);
			await page.addInitScript(() => {
				(window as unknown as { __writes: number }).__writes = 0;
				const clip = navigator.clipboard as unknown as
					{ writeText: (t: string) => Promise<void> } | undefined;
				if (clip)
					clip.writeText = () => {
						(window as unknown as { __writes: number }).__writes++;
						return Promise.resolve();
					};
			});
			await page.goto(`${UI}/cdap/devices/${ID}`);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Boiler room controller');
			await expect(page.locator('[data-widget-id="pump"]')).toBeVisible();
			const can = await permissions(page);
			await expect(page.getByRole('button', { name: /connect terminal/i })).toHaveCount(
				can('cdap.terminal') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: /connect desktop/i })).toHaveCount(
				can('cdap.terminal') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: /browse files/i })).toHaveCount(
				can('cdap.files') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: /connect stream/i })).toHaveCount(
				can('cdap.command') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: /connect audio/i })).toHaveCount(
				can('cdap.command') ? 1 : 0
			);
			await expect(page.getByRole('button', { name: 'Reset alarms' })).toHaveCount(
				can('cdap.command') ? 1 : 0
			);
			await expect(page.locator('[data-widget-id="pump"] input')).toBeEnabled({
				enabled: can('cdap.command')
			});
			// Device text stays text
			expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
			await expectNoAxeViolations(page);

			if (can('cdap.command')) {
				await page.locator('[data-widget-id="pump"] input').click();
				await expect
					.poll(() => sent.commands)
					.toContainEqual({ widget_id: 'pump', action: 'set', value: false });
				await page.getByRole('button', { name: 'Reset alarms' }).click();
				await expect(page.getByRole('dialog')).toContainText('Reset every alarm?');
				await expectNoAxeViolations(page);
				await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
				await expect
					.poll(() => sent.commands.some((c) => c.widget_id === 'reset' && c.action === 'trigger'))
					.toBe(true);
			}

			if (can('cdap.terminal')) {
				await page.getByRole('button', { name: /connect desktop/i }).click();
				await expect(page.getByRole('application')).toBeFocused();
				await expect(page.locator('.desktop-widget')).toContainText(/clipboard/i);
				expect(await page.evaluate(() => (window as unknown as { __writes: number }).__writes)).toBe(0);
				await page.keyboard.press('x');
				await expect
					.poll(() => sent.desktop.some((m) => m.input_type === 'keyboard' && m.key === 'x'))
					.toBe(true);
				await page.keyboard.press('Escape');
				await page.keyboard.press('Tab');
				await expect(page.getByRole('application')).not.toBeFocused();
				await expectNoAxeViolations(page);
			}
		});

		test('an unknown device says so', async ({ page }) => {
			await mock(page);
			await page.goto(`${UI}/cdap/devices/CDAP-NOPE01`);
			// The page's own message (the shell's toast region is an alert too)
			await expect(page.locator('#main-content').getByRole('alert')).toContainText('CDAP-NOPE01');
		});
	});
}
