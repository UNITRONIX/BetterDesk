import { render, screen, cleanup, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import adminNav from '../../fixtures/nav-admin.json';
import type { NavSection } from '../../../src/lib/api/console.ts';
import { buildNavModel, pageKey } from '../../../src/lib/shell/nav-model.ts';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/'), asset: (p: string) => '/' + p }));

const nav = adminNav as NavSection[];

beforeEach(() => {
	localStorage.clear();
	sessionStorage.clear();
	document.documentElement.dir = 'ltr';
	document.documentElement.style.removeProperty('--sidebar-w');
});
afterEach(() => cleanup());

async function setup(path = '/devices', search = '', props: Record<string, unknown> = {}) {
	const Sidebar = (await import('../../../src/lib/shell/Sidebar.svelte')).default;
	const model = buildNavModel(nav, pageKey(path, search));
	const view = render(Sidebar, { id: 'sb', model, drawer: false, branding: null, navigation: 0, ...props });
	return { view, user: userEvent.setup(), model };
}

describe('Sidebar', () => {
	test('the current page is marked with aria-current; ported pages link into the app', async () => {
		await setup('/devices');
		const current = screen.getByRole('link', { name: 'All devices' });
		expect(current).toHaveAttribute('aria-current', 'page');
		expect(current).toHaveAttribute('href', '/app/devices');
		expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
		// A page still in the old console keeps its URL
		expect(screen.getByRole('link', { name: 'Inventory', hidden: true })).toHaveAttribute(
			'href',
			'/inventory'
		);
	});

	test('settings tabs are matched by their tab (pageKey)', async () => {
		await setup('/settings', '?tab=auth');
		expect(screen.getByRole('link', { name: 'Sign-in' })).toHaveAttribute('aria-current', 'page');
		expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute('aria-current');
	});

	test('the current section is open, others closed; opening one is remembered for this tab', async () => {
		const { user } = await setup('/devices');
		const devices = screen.getByRole('button', { name: /^Devices/ });
		const support = screen.getByRole('button', { name: /^Support/ });
		expect(devices).toHaveAttribute('aria-expanded', 'true');
		expect(support).toHaveAttribute('aria-expanded', 'false');
		await user.click(support);
		expect(support).toHaveAttribute('aria-expanded', 'true');
		expect(JSON.parse(sessionStorage.getItem('bd_nav_sections_collapsed')!)).toEqual({ support: false });
		// Closing the current section is not stored
		await user.click(devices);
		expect(devices).toHaveAttribute('aria-expanded', 'false');
		expect(JSON.parse(sessionStorage.getItem('bd_nav_sections_collapsed')!)).toEqual({ support: false });
	});

	test('a section opened in this tab stays open next time', async () => {
		sessionStorage.setItem('bd_nav_sections_collapsed', JSON.stringify({ people: false }));
		await setup('/devices');
		expect(screen.getByRole('button', { name: /^People/ })).toHaveAttribute('aria-expanded', 'true');
	});

	test('More shows the rest of a section with group headings, and the choice is stored', async () => {
		const { user } = await setup('/devices');
		const more = screen.getAllByRole('button', { name: /nav\.more/ })[0]!;
		expect(more).toHaveAttribute('aria-expanded', 'false');
		const list = document.getElementById(more.getAttribute('aria-controls')!)!;
		expect(list).not.toBeVisible();
		await user.click(more);
		expect(more).toHaveAttribute('aria-expanded', 'true');
		expect(more).toHaveTextContent('nav.fewer');
		expect(within(list).getByRole('link', { name: 'Inventory' })).toBeVisible();
		expect(JSON.parse(localStorage.getItem('bd_nav_more_open')!)).toEqual({ devices: true });
	});

	test('More is open when the current page is in it', async () => {
		await setup('/settings', '?tab=backup');
		const backup = screen.getByRole('link', { name: 'Backup' });
		expect(backup).toBeVisible();
		const list = backup.closest('ul')!;
		expect(within(list).getByText('Console')).toBeInTheDocument();
	});

	test('the registration count shows next to its page as text', async () => {
		const { live } = await import('../../../src/lib/shell/live-events.svelte.ts');
		live.registrations = 10;
		await setup('/devices');
		const link = screen.getByRole('link', { name: /Enrollment requests/ });
		expect(link.querySelector('.nav-count')).toHaveTextContent(/^10$/);
		expect(screen.getByRole('link', { name: 'All devices' }).querySelector('.nav-count')).toBeNull();
		live.registrations = null;
	});

	test('the width handle: arrows change it in 10 px steps, Home and End jump, it is stored', async () => {
		const { user } = await setup('/devices');
		const handle = screen.getByRole('separator', { name: 'ux35.resize_sidebar' });
		expect(handle).toHaveAttribute('aria-valuenow', '232');
		handle.focus();
		await user.keyboard('{ArrowRight}{ArrowRight}');
		expect(handle).toHaveAttribute('aria-valuenow', '252');
		expect(document.documentElement.style.getPropertyValue('--sidebar-w')).toBe('252px');
		expect(localStorage.getItem('bd_ux35_sidebar_width')).toBe('252');
		await user.keyboard('{End}');
		expect(handle).toHaveAttribute('aria-valuenow', '320');
		await user.keyboard('{ArrowRight}');
		expect(handle).toHaveAttribute('aria-valuenow', '320');
		await user.keyboard('{Home}{ArrowLeft}');
		expect(handle).toHaveAttribute('aria-valuenow', '200');
	});

	test('in right-to-left the arrows follow the edge', async () => {
		document.documentElement.dir = 'rtl';
		const { user } = await setup('/devices');
		const handle = screen.getByRole('separator');
		handle.focus();
		await user.keyboard('{ArrowLeft}');
		expect(handle).toHaveAttribute('aria-valuenow', '242');
	});

	test('a saved width is used and kept within the limits', async () => {
		localStorage.setItem('bd_ux35_sidebar_width', '900');
		await setup('/devices');
		expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '320');
	});

	test('as a closed drawer it is out of reach; open it is a dialog', async () => {
		const { view } = await setup('/devices', '', { drawer: true, open: false });
		const root = view.container.querySelector<HTMLElement>('.shell-sidebar')!;
		// Svelte sets the inert property (jsdom does not reflect it to the attribute)
		const inert = () =>
			root.hasAttribute('inert') || (root as HTMLElement & { inert?: boolean }).inert === true;
		expect(inert()).toBe(true);
		expect(screen.queryByRole('separator', { hidden: true })).toBeNull();
		await view.rerender({ open: true });
		expect(inert()).toBe(false);
		expect(root).toHaveAttribute('role', 'dialog');
		expect(root).toHaveAttribute('aria-modal', 'true');
	});
});
