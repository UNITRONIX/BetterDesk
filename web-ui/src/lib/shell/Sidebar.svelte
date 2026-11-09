<!--
  The sidebar (views/partials/ux35-sidebar.ejs, public/js/ux35-shell.js):
  the logo section on top, as wide as the sidebar; the sections the server
  sent, each with its everyday pages and the rest under "More" (with a
  heading where the group changes); the account menu and the footer text
  at the bottom; a handle on the end edge to change the width.

  Remembered with the old keys: sections opened or closed in this tab
  (sessionStorage bd_nav_sections_collapsed; the current page's section is
  always open), "More" lists left open (localStorage bd_nav_more_open),
  the width (localStorage bd_ux35_sidebar_width, 200 to 320 px, applied
  before first paint by /console-boot.js as --sidebar-w), and the scroll
  position in this tab (sessionStorage bd_ux35_sidebar_scroll).
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import BrandLogo from './BrandLogo.svelte';
	import type { BrandingExtras } from './api.ts';
	import { live } from './live-events.svelte.ts';
	import {
		COLLAPSED_KEY,
		MORE_KEY,
		SCROLL_KEY,
		WIDTH_DEFAULT,
		WIDTH_KEY,
		WIDTH_MAX,
		WIDTH_MIN,
		WIDTH_STEP,
		clampWidth,
		moreOpen,
		parseWidth,
		readFlags,
		sectionOpen,
		writeFlags,
		type NavModel
	} from './nav-model.ts';

	interface Props {
		id: string;
		model: NavModel;
		/** The sidebar is a drawer (below 1100 px) */
		drawer: boolean;
		/** The drawer is open */
		open?: boolean;
		/** A link in the sidebar was clicked (closes the drawer) */
		onlinkclick?: () => void;
		branding: BrandingExtras | null;
		/** Bumped on every navigation: forget choices made for the page that was open */
		navigation: number;
		element?: HTMLElement | null;
	}

	let {
		id,
		model,
		drawer,
		open = false,
		onlinkclick,
		branding,
		navigation,
		element = $bindable(null)
	}: Props = $props();

	const uid = $props.id();

	function storage(kind: 'local' | 'session'): Storage | null {
		try {
			return kind === 'local' ? window.localStorage : window.sessionStorage;
		} catch {
			return null;
		}
	}

	let collapsed = $state<Record<string, boolean>>(readFlags(storage('session'), COLLAPSED_KEY));
	let moreStored = $state<Record<string, boolean>>(readFlags(storage('local'), MORE_KEY));
	/** Choices made since the current page opened (not stored for the current section) */
	const closedHere = new SvelteSet<string>();
	let moreHere = $state<Record<string, boolean>>({});

	$effect(() => {
		void navigation;
		closedHere.clear();
		moreHere = {};
	});

	function toggleSection(id: string, active: boolean, open: boolean) {
		if (active) {
			if (open) closedHere.add(id);
			else closedHere.delete(id);
			return;
		}
		collapsed = { ...collapsed, [id]: open };
		writeFlags(storage('session'), COLLAPSED_KEY, collapsed);
	}

	function toggleMore(id: string, open: boolean) {
		moreHere = { ...moreHere, [id]: !open };
		moreStored = { ...moreStored, [id]: !open };
		writeFlags(storage('local'), MORE_KEY, moreStored);
	}

	/* ── Width ── */

	let width = $state(WIDTH_DEFAULT);
	let dragging = $state(false);
	let startX = 0;
	let startWidth = WIDTH_DEFAULT;
	let pointerId: number | null = null;

	function rtl(): boolean {
		return document.documentElement.dir === 'rtl';
	}

	function applyWidth(px: number): number {
		width = clampWidth(px);
		document.documentElement.style.setProperty('--sidebar-w', `${width}px`);
		return width;
	}

	function saveWidth() {
		try {
			localStorage.setItem(WIDTH_KEY, String(width));
		} catch {
			/* kept for this page */
		}
	}

	function onpointerdown(e: PointerEvent) {
		if (drawer || e.button !== 0) return;
		dragging = true;
		startX = e.clientX;
		startWidth = width;
		pointerId = e.pointerId;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onpointermove(e: PointerEvent) {
		if (!dragging) return;
		const delta = rtl() ? startX - e.clientX : e.clientX - startX;
		applyWidth(startWidth + delta);
	}

	function endDrag(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		const el = e.currentTarget as HTMLElement;
		if (pointerId !== null && el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
		pointerId = null;
		saveWidth();
	}

	function onHandleKey(e: KeyboardEvent) {
		if (drawer) return;
		const wider = rtl() ? 'ArrowLeft' : 'ArrowRight';
		const narrower = rtl() ? 'ArrowRight' : 'ArrowLeft';
		let next: number | null = null;
		if (e.key === wider) next = width + WIDTH_STEP;
		else if (e.key === narrower) next = width - WIDTH_STEP;
		else if (e.key === 'Home') next = WIDTH_MIN;
		else if (e.key === 'End') next = WIDTH_MAX;
		if (next === null) return;
		e.preventDefault();
		applyWidth(next);
		saveWidth();
	}

	// Escape during a drag puts the width back
	$effect(() => {
		if (!dragging) return;
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			applyWidth(startWidth);
			dragging = false;
		};
		window.addEventListener('keydown', key, true);
		return () => window.removeEventListener('keydown', key, true);
	});

	/* ── Scroll position ── */

	let nav = $state<HTMLElement | null>(null);

	onMount(() => {
		const w = parseWidth(storage('local')?.getItem(WIDTH_KEY) ?? null);
		if (w !== null) applyWidth(w);
		else width = WIDTH_DEFAULT;

		const save = () => {
			try {
				sessionStorage.setItem(SCROLL_KEY, String(nav?.scrollTop ?? 0));
			} catch {
				/* ignore */
			}
		};
		void tick().then(() => {
			if (!nav) return;
			const top = parseInt(storage('session')?.getItem(SCROLL_KEY) ?? '', 10);
			if (top > 0) nav.scrollTop = top;
			const a = nav.querySelector<HTMLElement>('[aria-current="page"]');
			if (
				a &&
				(a.offsetTop < nav.scrollTop || a.offsetTop + a.offsetHeight > nav.scrollTop + nav.clientHeight)
			)
				nav.scrollTop = Math.max(0, a.offsetTop - nav.clientHeight / 2);
		});
		window.addEventListener('pagehide', save);
		return () => window.removeEventListener('pagehide', save);
	});

	/* ── Logo and footer (branding) ── */

	const appName = $derived(session.appName);
	/** Logo kinds other than the BetterDesk logo (Settings › Appearance) */
	const OTHER_LOGOS = new Set(['text', 'svg', 'image', 'icon']);
	const logoType = $derived(branding?.logoType || session.raw?.branding.logoType || 'default');
	/** An admin's SVG logo as a picture: it can't run anything there */
	const svgSrc = $derived(
		branding?.logoSvg && /^\s*<svg[\s>]/i.test(branding.logoSvg)
			? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(branding.logoSvg)}`
			: ''
	);
	const imgSrc = $derived(
		branding?.logoUrl && /^(\/(?!\/)|https?:\/\/)/i.test(branding.logoUrl) ? branding.logoUrl : ''
	);
	const showPoweredBy = $derived(branding ? branding.showPoweredBy : true);
	const PROJECT_URL = 'https://github.com/UNITRONIX/BetterDesk';
	const footerText = $derived(branding?.footerText ?? '');
</script>

{#snippet item(p: NavModel['sections'][number]['core'][number])}
	<li>
		<a
			href={link(p.page.href)}
			class={['nav-item', p.active && 'active']}
			aria-current={p.active ? 'page' : undefined}
			target={p.page.external ? '_blank' : undefined}
			rel={p.page.external ? 'noopener noreferrer' : undefined}
			title={p.page.external ? t('nav.remote_open_tab') : undefined}
			onclick={() => onlinkclick?.()}
		>
			<span class="nav-label">{p.page.text}</span>
			{#if p.page.external}<span class="nav-note" aria-hidden="true">↗</span>{/if}
			{#if p.page.countId && live.registrations}<span class="nav-count">{live.registrations}</span>{/if}
		</a>
	</li>
{/snippet}

<div
	bind:this={element}
	{id}
	class={['shell-sidebar', drawer && 'is-drawer', drawer && open && 'is-open', dragging && 'is-resizing']}
	role={drawer && open ? 'dialog' : undefined}
	aria-modal={drawer && open ? 'true' : undefined}
	aria-label={drawer && open ? t('nav.main') : undefined}
	inert={drawer && !open}
>
	<a class="logo-section" href={link('/')} onclick={() => onlinkclick?.()}>
		{#if !OTHER_LOGOS.has(logoType)}
			<BrandLogo name={appName} />
		{:else if logoType === 'text' && branding?.logoText}
			<span class="logo-text"
				>{branding.logoText}{#if branding.logoTextAccent}<span class="logo-text-accent"
						>{branding.logoTextAccent}</span
					>{/if}</span
			>
		{:else if logoType === 'svg' && svgSrc}
			<img class="logo-img" src={svgSrc} alt="" /><span class="logo-name">{appName}</span>
		{:else if logoType === 'image' && imgSrc}
			<img class="logo-img" src={imgSrc} alt="" /><span class="logo-name">{appName}</span>
		{:else}
			<!-- The icon logo, and the name alone while the other kinds load or when they are empty -->
			{#if logoType === 'icon' || branding}<Icon name={branding?.logoIcon || 'dns'} />{/if}<span
				class="logo-name">{appName}</span
			>
		{/if}
	</a>

	<nav class="sidebar-nav" bind:this={nav} aria-label={t('nav.main')}>
		{#each model.sections as s (s.id)}
			{@const open = sectionOpen(s, collapsed, closedHere)}
			{@const more = moreOpen(s, moreStored, moreHere)}
			<div class={['nav-section', s.active && 'is-current']}>
				<button
					type="button"
					class="nav-heading"
					aria-expanded={open}
					aria-controls={`${uid}-s-${s.id}`}
					onclick={() => toggleSection(s.id, s.active, open)}
				>
					<Icon name={s.icon} class="nav-section-icon" />
					<span class="nav-section-label">{s.text}</span>
					<Icon name={open ? 'expand_less' : 'expand_more'} class="nav-chevron" />
				</button>
				<ul class="nav-list" id={`${uid}-s-${s.id}`} hidden={!open}>
					{#each s.core as p (p.page.page)}{@render item(p)}{/each}
					{#if s.moreCount}
						<li class="nav-more">
							<button
								type="button"
								class="nav-item nav-more-toggle"
								aria-expanded={more}
								aria-controls={`${uid}-m-${s.id}`}
								onclick={() => toggleMore(s.id, more)}
							>
								<span class="nav-label">{more ? t('nav.fewer') : t('nav.more')}</span>
								<span class="nav-note">{s.moreCount}</span>
								<Icon name={more ? 'expand_less' : 'expand_more'} class="nav-chevron" />
							</button>
							<ul class="nav-list nav-more-list" id={`${uid}-m-${s.id}`} hidden={!more}>
								{#each s.more as row, i (row.kind === 'page' ? row.page.page : `g${i}`)}
									{#if row.kind === 'group'}
										<li class="nav-group">{row.text}</li>
									{:else}
										{@render item(row)}
									{/if}
								{/each}
							</ul>
						</li>
					{/if}
				</ul>
			</div>
		{/each}
	</nav>

	<div class="sidebar-footer">
		<AccountMenu place="sidebar" />
		{#if footerText || showPoweredBy}
			<div class="sidebar-attribution">
				{#if footerText}<span>{footerText}</span>{/if}
				{#if showPoweredBy}
					<!-- The project's page, in a new tab so the console stays open -->
					<a class="powered-by" href={PROJECT_URL} target="_blank" rel="noopener noreferrer">
						<BrandLogo mark />
						<span>{t('branding.powered_by')} <span translate="no">BetterDesk</span></span>
						{#if session.appVersion}<span class="powered-version">{session.appVersion}</span>{/if}
					</a>
				{/if}
			</div>
		{/if}
	</div>

	{#if !drawer}
		<!-- A focusable separator is a widget (ARIA): it takes the arrow keys -->
		<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
		<div
			class={['resize-handle', dragging && 'active']}
			role="separator"
			aria-orientation="vertical"
			tabindex="0"
			aria-label={t('ux35.resize_sidebar')}
			title={t('ux35.resize_sidebar')}
			aria-valuemin={WIDTH_MIN}
			aria-valuemax={WIDTH_MAX}
			aria-valuenow={width}
			{onpointerdown}
			{onpointermove}
			onpointerup={endDrag}
			onpointercancel={endDrag}
			onkeydown={onHandleKey}
		></div>
	{/if}
</div>

<style>
	.shell-sidebar {
		position: sticky;
		top: 0;
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		width: var(--sidebar-w);
		height: 100vh;
		height: 100dvh;
		border-inline-end: 1px solid var(--rule);
		background: var(--bg-subtle);
		color: var(--text);
	}
	.is-resizing,
	.is-resizing * {
		cursor: col-resize;
		user-select: none;
	}

	/* Logo section: as wide as the sidebar, as high as the top bar */
	.logo-section {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		min-height: var(--topbar-h);
		padding: var(--space-2) var(--space-4);
		overflow: hidden;
		border-bottom: 1px solid var(--rule);
		color: var(--text);
		font-weight: 700;
		text-decoration: none;
		white-space: nowrap;
	}
	.logo-section:hover {
		color: var(--text);
	}
	.logo-section:focus-visible {
		outline-offset: -2px;
	}
	/* The full logo almost fills the section: its width, at most 30 px high (815.9 x 132.92) */
	.logo-section > :global(.brand-logo-full) {
		width: min(100%, calc(30px * 815.9 / 132.92));
	}
	.logo-section > :global(.material-icons) {
		color: var(--accent);
	}
	.logo-img {
		display: block;
		width: auto;
		height: 22px;
	}
	.logo-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.logo-text-accent {
		color: var(--accent);
	}

	.sidebar-nav {
		flex: 1;
		min-height: 0;
		padding: var(--space-3) var(--space-2);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.nav-section + .nav-section {
		margin-top: var(--space-1);
	}
	.nav-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: var(--control-h);
		padding: 0 var(--space-2);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-weight: 600;
		text-align: start;
		cursor: pointer;
	}
	.nav-heading:hover {
		background: var(--hover);
	}
	.nav-heading > :global(.nav-section-icon) {
		color: var(--text-muted);
		font-size: 20px;
	}
	.is-current .nav-heading > :global(.nav-section-icon) {
		color: var(--accent);
	}
	.nav-section-label {
		flex: 1;
	}
	.nav-heading > :global(.nav-chevron) {
		color: var(--text-muted);
	}
	.nav-list {
		margin: 0 0 var(--space-2);
		padding: 0;
		list-style: none;
	}
	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		min-height: 34px;
		padding: var(--space-1) var(--space-2);
		/* lines up with the section label, after its icon */
		padding-inline-start: calc(var(--space-2) + 20px + 10px - 2px);
		border-inline-start: 2px solid transparent;
		border-start-end-radius: var(--radius);
		border-end-end-radius: var(--radius);
		color: var(--text);
		text-decoration: none;
	}
	.nav-item:hover {
		background: var(--hover);
		color: var(--text);
	}
	.nav-item:focus-visible {
		outline-offset: -2px;
	}
	.nav-item.active {
		border-inline-start-color: var(--accent);
		background: var(--bg);
		font-weight: 600;
	}
	.nav-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nav-note,
	.nav-count {
		margin-inline-start: auto;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.nav-more-toggle {
		width: 100%;
		border-top: 0;
		border-bottom: 0;
		border-inline-end: 0;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.nav-more-toggle > :global(.nav-chevron) {
		color: var(--text-muted);
		font-size: 18px;
	}
	.nav-more-list {
		margin: 0;
	}
	/* Small heading where the group changes (Settings) */
	.nav-group {
		padding: var(--space-3) var(--space-2) var(--space-1);
		padding-inline-start: calc(var(--space-2) + 20px + 10px);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.nav-more-list > .nav-group:first-child {
		padding-top: var(--space-1);
	}

	.sidebar-footer {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-3) var(--space-4);
		padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--rule);
	}
	.sidebar-attribution {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-top: var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-xs);
	}
	/* The mark, the line and the version on one row; the version at the end */
	.powered-by {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 24px;
		color: inherit;
		text-decoration: none;
	}
	.powered-by :global(.brand-logo-mark) {
		flex: none;
		width: 14px;
		height: 14px;
	}
	.powered-version {
		margin-inline-start: auto;
		font-variant-numeric: tabular-nums;
	}
	.powered-by:hover {
		color: var(--text);
	}
	.powered-by:hover > span:not(.powered-version) {
		text-decoration: underline;
	}
	.powered-by:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
		border-radius: 2px;
	}

	.resize-handle {
		position: absolute;
		top: 0;
		bottom: 0;
		inset-inline-end: -3px;
		z-index: 2;
		width: 6px;
		cursor: col-resize;
		touch-action: none;
	}
	.resize-handle:hover,
	.resize-handle.active {
		background: var(--border);
	}
	.resize-handle:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 0;
		background: var(--focus);
	}

	/* Below 1100 px: a drawer from the start side over the page */
	.shell-sidebar.is-drawer {
		position: fixed;
		inset-block: 0;
		inset-inline-start: 0;
		z-index: 60;
		width: min(300px, 86vw);
		height: auto;
		transform: translateX(-100%);
		visibility: hidden;
		transition:
			transform var(--motion),
			visibility 0s linear var(--motion);
	}
	.shell-sidebar.is-drawer:dir(rtl) {
		transform: translateX(100%);
	}
	.shell-sidebar.is-drawer.is-open {
		transform: none;
		visibility: visible;
		box-shadow: var(--shadow-float);
		transition: transform var(--motion);
	}

	@media (pointer: coarse) {
		.nav-item,
		.nav-heading {
			min-height: 44px;
		}
	}
</style>
