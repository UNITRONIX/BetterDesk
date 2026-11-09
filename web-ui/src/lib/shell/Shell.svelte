<!--
  The console around every page (views/layouts/main.ejs): skip link,
  sidebar (a drawer below 1100 px), top bar, the page in <main>, the Help
  panel, the bottom bar on phones, and once each: the search dialog, the
  accessibility panel, the idle warning, the dialog, toast and device
  panel hosts. Inside a Desktop Mode window (?embed=1) only the page.

  On every navigation: dialogs from code, menus, the drawer and the phone
  actions row close. When the page itself changes (not just its query),
  focus moves to the page's heading, so keyboard and screen reader users
  start there.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, tick } from 'svelte';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import DevicePanelHost from '#lib/devices/DevicePanelHost.svelte';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { appPath } from '#lib/nav.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import DialogHost from '#lib/ui/DialogHost.svelte';
	import ToastHost from '#lib/ui/ToastHost.svelte';
	import { closeDialogs } from '#lib/ui/dialogs.svelte.ts';
	import { focusables, trapTab } from '#lib/ui/focus.ts';
	import { openLayer, openLayers } from '#lib/ui/layers.ts';
	import { closePopups } from '#lib/ui/popups.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import A11yPanel from './A11yPanel.svelte';
	import BottomNav from './BottomNav.svelte';
	import HelpPanel from './HelpPanel.svelte';
	import IdleWarning from './IdleWarning.svelte';
	import SearchDialog from './SearchDialog.svelte';
	import Sidebar from './Sidebar.svelte';
	import Topbar from './Topbar.svelte';
	import { a11y } from './a11y.svelte.ts';
	import { brandingExtras } from './api.ts';
	import { onPanelEvents, startLiveEvents, stopLiveEvents } from './live-events.svelte.ts';
	import { bottomItems, breadcrumb, buildNavModel, pageKey } from './nav-model.ts';
	import { onPanelEvent, startNotifications, stopNotifications } from './notifications.svelte.ts';
	import { embedded, pageInfo } from './page.svelte.ts';
	import { isSearchShortcut } from './search.ts';
	import { startGuard, stopGuard } from './session-guard.svelte.ts';

	let { children }: { children: Snippet } = $props();

	const uid = $props.id();
	const sidebarId = `${uid}-sidebar`;
	const helpId = `${uid}-help`;
	const DRAWER_QUERY = '(max-width: 1099px)';

	let drawer = $state(typeof window !== 'undefined' && window.matchMedia(DRAWER_QUERY).matches);
	let drawerOpen = $state(false);
	let helpOpen = $state(false);
	let searchOpen = $state(false);
	let actionsOpen = $state(false);
	let navigation = $state(0);
	const branding = $derived(session.raw ? brandingExtras(session.raw.branding) : null);
	let sidebar = $state<HTMLElement | null>(null);
	let main = $state<HTMLElement | null>(null);
	let helpButton = $state<HTMLButtonElement | null>(null);

	const key = $derived(pageKey(appPath(page.url.pathname), page.url.searchParams));
	const model = $derived(buildNavModel(session.nav, key));
	const crumbs = $derived(breadcrumb(model, pageInfo.title));
	const bottom = $derived(bottomItems(session.nav, key));
	const pageName = $derived(pageInfo.title || model.activePage?.text || '');
	const docTitle = $derived(pageName ? `${pageName} - ${session.appName}` : session.appName);

	/* ── Drawer ── */

	function openDrawer() {
		if (drawer) drawerOpen = true;
	}

	function closeDrawer() {
		drawerOpen = false;
	}

	$effect(() => {
		const el = sidebar;
		if (!drawer || !drawerOpen || !el) return;
		const closed = openLayer({
			kind: 'sheet',
			element: el,
			dismiss: closeDrawer,
			replace: closeDrawer,
			blocking: () => false
		});
		const onKey = (e: KeyboardEvent) => trapTab(el, e);
		el.addEventListener('keydown', onKey);
		// The drawer slides in; focus its first stop on the next frame
		const frame = requestAnimationFrame(() => focusables(el)[0]?.focus({ preventScroll: true }));
		document.body.style.overflow = 'hidden';
		return () => {
			cancelAnimationFrame(frame);
			el.removeEventListener('keydown', onKey);
			document.body.style.overflow = '';
			closed();
		};
	});

	/* ── Navigation ── */

	beforeNavigate(({ from, to }) => {
		if (to && from && to.url.pathname !== from.url.pathname) pageInfo.title = null;
	});

	afterNavigate(({ from, to, type }) => {
		closeDialogs();
		closePopups();
		drawerOpen = false;
		actionsOpen = false;
		navigation++;
		if (type === 'enter' || !from || !to || from.url.pathname === to.url.pathname) return;
		void tick().then(() => {
			// A sheet or dialog the new page opened (a device from ?open=) keeps the focus
			if (openLayers() > 0) return;
			const heading = main?.querySelector<HTMLElement>('h1');
			const target = heading ?? main;
			if (!target) return;
			if (target === heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
			target.focus({ preventScroll: true });
		});
	});

	function skipToMain(e: MouseEvent) {
		e.preventDefault();
		main?.focus();
	}

	/* ── Start: real-time data, session watch ── */

	onMount(() => {
		const mq = window.matchMedia(DRAWER_QUERY);
		const onMq = () => {
			drawer = mq.matches;
			if (!drawer) drawerOpen = false;
		};
		mq.addEventListener('change', onMq);

		startGuard(session.raw?.sessionPolicy);
		const cleanups: (() => void)[] = [() => mq.removeEventListener('change', onMq), stopGuard];
		if (!embedded) {
			startNotifications();
			cleanups.push(stopNotifications);
			if (can('enrollment.approve')) {
				startLiveEvents();
				cleanups.push(stopLiveEvents, onPanelEvents(onPanelEvent), onPanelEvents(announce));
			}
		}
		return () => cleanups.forEach((fn) => fn());
	});

	/** A help request or a device asking to join: tell the person (the old shell only updated the bell) */
	function announce(payload: Record<string, unknown>) {
		const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
		if (payload.type === 'help_request') {
			const status = str(payload.status);
			if (status && status !== 'pending' && status !== 'open') return;
			const name = str(payload.hostname) || str(payload.device_name) || str(payload.device_id);
			toast.info(name || t('notifications.help_request'), name ? t('notifications.help_request') : undefined);
		} else if (payload.type === 'registration_pending') {
			const r = (payload.registration ?? {}) as Record<string, unknown>;
			const name = str(r.hostname) || str(r.device_id) || str(r.id);
			toast.info(
				name || t('notifications.kind_registration'),
				name ? t('notifications.kind_registration') : undefined
			);
		}
	}

	/* ── Keys and gestures ── */

	function onkeydown(e: KeyboardEvent) {
		if (embedded || !isSearchShortcut(e)) return;
		e.preventDefault();
		searchOpen = true;
	}

	let touchX = 0;
	let touchFromEdge = false;
	function ontouchstart(e: TouchEvent) {
		const x = e.touches[0]?.clientX ?? 0;
		touchX = x;
		const rtl = document.documentElement.dir === 'rtl';
		touchFromEdge = rtl ? window.innerWidth - x < 40 : x < 40;
	}
	function ontouchend(e: TouchEvent) {
		if (!drawer || !window.matchMedia('(pointer: coarse)').matches) return;
		const rtl = document.documentElement.dir === 'rtl';
		const raw = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
		const dx = rtl ? -raw : raw;
		if (dx > 80 && touchFromEdge && !drawerOpen) openDrawer();
		else if (dx < -80 && drawerOpen) closeDrawer();
	}
</script>

<svelte:head><title>{docTitle}</title></svelte:head>
<svelte:document {onkeydown} {ontouchstart} {ontouchend} />

{#if embedded}
	<main bind:this={main} id="main-content" class="main-content is-embedded" tabindex="-1">
		{@render children()}
	</main>
{:else}
	<a class="skip-link" href="#main-content" onclick={skipToMain}
		>{tf('shell.skip_to_content', 'Skip to main content')}</a
	>
	{#if session.emergencyMode}
		<div class="emergency-banner" role="alert">{t('auth.emergency_mode_banner')}</div>
	{/if}
	<div class="shell">
		<Sidebar
			bind:element={sidebar}
			id={sidebarId}
			{model}
			{drawer}
			open={drawerOpen}
			onlinkclick={closeDrawer}
			{branding}
			{navigation}
		/>
		{#if drawer && drawerOpen}
			<!-- A click on the dimmed page closes the drawer; Escape does it for the keyboard -->
			<div class="drawer-overlay" aria-hidden="true" onclick={closeDrawer}></div>
		{/if}
		<div class="shell-main" inert={drawer && drawerOpen}>
			<Topbar
				{crumbs}
				{drawer}
				{drawerOpen}
				{sidebarId}
				{helpOpen}
				{helpId}
				bind:helpButton
				bind:actionsOpen
				ondrawer={() => (drawerOpen ? closeDrawer() : openDrawer())}
				onsearch={() => (searchOpen = true)}
				onhelp={() => (helpOpen = !helpOpen)}
			/>
			<div class="shell-body">
				<main bind:this={main} id="main-content" class="main-content" tabindex="-1">
					{@render children()}
				</main>
				<HelpPanel bind:open={helpOpen} docked={!drawer} id={helpId} opener={helpButton} />
			</div>
		</div>
		<BottomNav items={bottom} drawerId={sidebarId} {drawerOpen} onmore={openDrawer} />
	</div>
	<SearchDialog bind:open={searchOpen} />
	<A11yPanel bind:open={a11y.open} />
{/if}
<IdleWarning />
<DialogHost />
<ToastHost />
<DevicePanelHost />

<style>
	.skip-link {
		position: fixed;
		top: var(--space-2);
		inset-inline-start: var(--space-2);
		z-index: calc(var(--layer-toast) + 1);
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--accent);
		transform: translateY(calc(-100% - var(--space-4)));
	}
	.skip-link:focus-visible,
	.skip-link:focus {
		transform: none;
	}
	.emergency-banner {
		padding: var(--space-2) var(--space-4);
		background: var(--danger);
		color: var(--on-accent);
		font-weight: 600;
	}
	.shell {
		display: flex;
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
	}
	.shell-main {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}
	.shell-body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.main-content {
		flex: 1;
		min-width: 0;
		padding: var(--page-pad);
		padding-bottom: var(--space-7);
	}
	.main-content:focus {
		outline: none;
	}
	/* The heading takes focus after a page change only to start reading there; it is not a control */
	.main-content :global(h1[tabindex='-1']:focus) {
		outline: none;
	}
	.main-content.is-embedded {
		display: block;
		padding: var(--space-4);
	}
	.drawer-overlay {
		position: fixed;
		inset: 0;
		z-index: 55;
		background: rgba(0, 0, 0, 0.35);
	}
	@media (max-width: 767px) {
		.main-content {
			padding-bottom: calc(72px + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
