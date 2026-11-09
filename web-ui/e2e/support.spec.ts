/**
 * Help requests, tickets, chat and network tools, once per role: each page
 * offers exactly what the role's permissions allow (and what it offers the
 * server accepts), the main tasks work, and axe finds nothing in the page,
 * its menus, sheets and dialogs. Writes are undone (a created ticket is
 * deleted again); nothing else changes the demo data.
 */
import type { Page } from '@playwright/test';
import { test, expect, expectNoAxeViolations } from './fixtures.ts';
import { UI, type Role } from './roles.ts';

const ROLES: Role[] = ['admin', 'super_admin', 'server_admin', 'global_admin', 'operator', 'viewer'];

async function permissions(
	page: Page
): Promise<{ permissions: string[]; superAdmin: boolean; username: string }> {
	return page.evaluate(async () => {
		const r = await fetch('/api/console/bootstrap', {
			credentials: 'same-origin',
			headers: { Accept: 'application/json' }
		});
		const b = await r.json();
		return {
			permissions: b.permissions as string[],
			superAdmin: !!b.isSuperAdmin,
			username: b.user?.username ?? ''
		};
	});
}

const has = (p: { permissions: string[]; superAdmin: boolean }, perm: string) =>
	p.superAdmin || p.permissions.includes(perm);

for (const role of ROLES) {
	test.describe(`support pages as ${role}`, () => {
		test.use({ role });

		test('help requests: the list needs chat.access, actions follow the permissions', async ({ page }) => {
			await page.goto(`${UI}/help-requests`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const p = await permissions(page);
			if (!has(p, 'chat.access')) {
				// P17: one sentence instead of a list whose API answers 403
				await expect(page.locator('.notice')).toBeVisible();
				await expect(page.locator('.hr-table')).toHaveCount(0);
				await expectNoAxeViolations(page);
				return;
			}
			await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'All' }).click();
			await expect(page.locator('.hr-table tbody tr[data-key]').first()).toBeVisible();
			await expectNoAxeViolations(page);
			const connect = page.locator('.hr-connect .btn');
			if (has(p, 'device.connect') && (await connect.count())) {
				await connect.first().click();
				await expect(page.getByRole('menu')).toBeVisible();
				await expectNoAxeViolations(page);
				await page.keyboard.press('Escape');
			} else {
				expect(await connect.count()).toBe(0);
			}
			// A click on a row opens the device panel (device.view)
			await page.locator('.hr-table tbody tr[data-key] .row-open').first().click();
			await expect(page.getByRole('dialog')).toHaveCount(has(p, 'device.view') ? 1 : 0);
			if (has(p, 'device.view')) await page.keyboard.press('Escape');
		});

		test('tickets: New, Edit and Delete only with device.edit; a ticket opens in a sheet', async ({
			page
		}) => {
			await page.goto(`${UI}/tickets`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const p = await permissions(page);
			const canEdit = has(p, 'device.edit');
			await expect(page.getByRole('button', { name: 'New ticket' })).toHaveCount(canEdit ? 1 : 0);
			const rows = page.locator('.tickets-table tbody tr[data-key]');
			await expect(rows.first().or(page.locator('.tickets-table .state-cell'))).toBeVisible();
			await expectNoAxeViolations(page);
			expect((await page.locator('.tickets-table tbody [aria-haspopup="menu"]').count()) > 0).toBe(
				canEdit && (await rows.count()) > 0
			);
			// Another role's run may delete its own "e2e <role> ticket" meanwhile: open a lasting one
			const lasting = rows.filter({ hasNotText: /e2e \w+ ticket/ });
			if (!(await lasting.count())) return;

			await lasting.first().locator('.row-open').click();
			const sheet = page.getByRole('dialog');
			await expect(sheet.locator('.ticket-facts')).toBeVisible();
			await expect(sheet.getByRole('button', { name: 'Edit ticket' })).toHaveCount(canEdit ? 1 : 0);
			await expect(sheet.getByRole('button', { name: 'Delete ticket' })).toHaveCount(canEdit ? 1 : 0);
			await expect(sheet.getByRole('group', { name: 'Status and assignee' })).toHaveCount(canEdit ? 1 : 0);
			await expect(sheet.getByRole('textbox', { name: 'New comment' })).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await expect(sheet).toBeHidden();

			if (!canEdit) return;
			// P20/A11: every role the page offers New ticket to can create, change and delete one
			await page.getByRole('button', { name: 'New ticket' }).click();
			const form = page.getByRole('dialog');
			await form.getByRole('textbox', { name: 'Title' }).fill(`e2e ${role} ticket`);
			await expectNoAxeViolations(page);
			await form.getByRole('button', { name: 'Create ticket' }).click();
			const detail = page.getByRole('dialog');
			await expect(detail.getByRole('heading', { name: new RegExp(`e2e ${role} ticket`) })).toBeVisible();
			await detail.getByRole('button', { name: 'Mark in progress' }).click();
			await expect(detail.locator('.sheet-status')).toContainText('Ticket updated');
			await detail.getByRole('button', { name: 'Delete ticket' }).click();
			const confirm = page.getByRole('dialog').last();
			await expectNoAxeViolations(page);
			await confirm.getByRole('button', { name: 'Delete ticket' }).click();
			await expect(page.locator('.tickets-table')).not.toContainText(`e2e ${role} ticket`);
		});

		test('chat: needs chat.access; lists people and devices; a conversation opens', async ({ page }) => {
			await page.goto(`${UI}/chat`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const p = await permissions(page);
			if (!has(p, 'chat.access')) {
				await expect(page.locator('.notice')).toBeVisible();
				await expect(page.getByRole('button', { name: 'New group' })).toHaveCount(0);
				await expectNoAxeViolations(page);
				return;
			}
			const rows = page.locator('.chat-list button.list-row');
			await expect(rows.first()).toBeVisible({ timeout: 20_000 });
			await expectNoAxeViolations(page);
			await rows.first().click();
			await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
			await page.getByRole('button', { name: 'Emoji' }).click();
			await expect(page.getByRole('menu')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
			await page.getByRole('button', { name: 'New group' }).click();
			await expect(page.getByRole('dialog')).toBeVisible();
			await expectNoAxeViolations(page);
			await page.keyboard.press('Escape');
		});

		test('network tools: tools and groups follow the permissions; #crypto opens its group', async ({
			page
		}) => {
			await page.goto(`${UI}/toolkit#crypto`);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			const p = await permissions(page);
			await expect(page.getByRole('tab', { name: 'Passwords and hashes' })).toHaveAttribute(
				'aria-selected',
				'true'
			);
			await page.getByRole('tab', { name: 'Network' }).click();
			await expect(page).toHaveURL(/#network$/);
			await expect(page.locator('#tool-ping')).toHaveCount(has(p, 'device.connect') ? 1 : 0);
			await expect(page.locator('#tool-ssl')).toHaveCount(1);
			await expect(page.getByRole('tab', { name: 'Server' })).toHaveCount(has(p, 'metrics.view') ? 1 : 0);
			await page.locator('#tool-ssl summary').click();
			await expectNoAxeViolations(page);
			// A hash runs on the server and comes back
			await page.getByRole('tab', { name: 'Passwords and hashes' }).click();
			await page.locator('#tool-hash summary').click();
			await page.getByRole('textbox', { name: 'Text' }).first().fill('betterdesk');
			await page.locator('#tool-hash').getByRole('button', { name: 'Calculate hash' }).click();
			await expect(page.locator('#tool-hash .code-block')).toHaveText(/^[0-9a-f]{64}$/);
			await expectNoAxeViolations(page);
		});
	});
}
