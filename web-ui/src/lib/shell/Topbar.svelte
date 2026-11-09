<!--
  The top bar (views/partials/ux35-topbar.ejs): the drawer button and the
  logo mark below 1100 px, the breadcrumb (section, page), the global
  search, Help, then notifications, refresh, theme, accessibility,
  language, and the account menu below 1100 px. On phones (767 px and
  below) those last actions fold behind a "More" button into a row under
  the bar; menus open from there.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { session } from '#lib/state/session.svelte.ts';
	import { cycleTheme, theme } from '#lib/state/theme.svelte.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import AccountMenu from './AccountMenu.svelte';
	import BrandLogo from './BrandLogo.svelte';
	import LanguageMenu from './LanguageMenu.svelte';
	import NotificationsMenu from './NotificationsMenu.svelte';
	import { a11y, isDefault } from './a11y.svelte.ts';
	import { requestRefresh } from './page.svelte.ts';

	interface Props {
		crumbs: string[];
		drawer: boolean;
		drawerOpen: boolean;
		sidebarId: string;
		helpOpen: boolean;
		helpId: string;
		helpButton?: HTMLButtonElement | null;
		/** The actions row on phones is open */
		actionsOpen?: boolean;
		ondrawer: (opener: HTMLElement) => void;
		onsearch: () => void;
		onhelp: () => void;
	}

	let {
		crumbs,
		drawer,
		drawerOpen,
		sidebarId,
		helpOpen,
		helpId,
		helpButton = $bindable(null),
		actionsOpen = $bindable(false),
		ondrawer,
		onsearch,
		onhelp
	}: Props = $props();

	const uid = $props.id();
	let moreButton = $state<HTMLButtonElement | null>(null);
	let actions = $state<HTMLElement | null>(null);
	let spinning = $state(false);

	const themeLabel = $derived(
		`${t('theme.title')}: ${
			theme.choice === 'light'
				? t('theme.light')
				: theme.choice === 'dark'
					? t('theme.dark')
					: t('theme.console_default')
		}`
	);
	const themeIcon = $derived(
		theme.choice === 'light' ? 'light_mode' : theme.choice === 'dark' ? 'dark_mode' : 'contrast'
	);
	const a11yOn = $derived(!isDefault(a11y.settings));
	const isMac =
		typeof navigator !== 'undefined' && /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
	const kbd = isMac ? '⌘ K' : 'Ctrl K';

	function refresh() {
		requestRefresh();
		spinning = true;
		setTimeout(() => (spinning = false), 300);
	}

	// Phones: the actions row closes on a click outside it (menus inside stay part of it),
	// Escape (when no menu took the key), and when the screen gets wider
	$effect(() => {
		const el = actions;
		if (!actionsOpen || !el) return;
		const outside = (e: PointerEvent) => {
			const target = e.target as Node | null;
			if (target && (el.contains(target) || moreButton?.contains(target))) return;
			actionsOpen = false;
		};
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			e.preventDefault();
			const inside = el.contains(document.activeElement);
			actionsOpen = false;
			if (inside) moreButton?.focus();
		};
		const mq = window.matchMedia('(max-width: 767px)');
		const wide = () => {
			if (!mq.matches) actionsOpen = false;
		};
		document.addEventListener('pointerdown', outside, true);
		document.addEventListener('keydown', key);
		mq.addEventListener('change', wide);
		return () => {
			document.removeEventListener('pointerdown', outside, true);
			document.removeEventListener('keydown', key);
			mq.removeEventListener('change', wide);
		};
	});
</script>

<header class="shell-topbar">
	{#if drawer}
		<IconButton
			icon="menu"
			label={t('ux35.open_menu')}
			aria-controls={sidebarId}
			aria-expanded={drawerOpen}
			onclick={(e) => ondrawer(e.currentTarget)}
		/>
		<a class="topbar-logo" href={link('/')} title={session.appName}>
			<BrandLogo mark name={session.appName} /><span class="sr-only">{session.appName}</span>
		</a>
	{/if}

	<nav class="shell-breadcrumb" aria-label={t('ux35.breadcrumb')}>
		{#each crumbs as crumb, i (i)}
			{#if i > 0}<span class="crumb-sep" aria-hidden="true">/</span>{/if}
			{#if i === crumbs.length - 1}
				<span class="crumb current" aria-current="page">{crumb}</span>
			{:else}
				<span class="crumb">{crumb}</span>
			{/if}
		{/each}
	</nav>

	<span class="topbar-spacer"></span>

	<button
		type="button"
		class="search-trigger"
		aria-haspopup="dialog"
		aria-keyshortcuts="Control+K Meta+K /"
		onclick={onsearch}
	>
		<Icon name="search" />
		<span class="search-label">{t('search.placeholder')}</span>
		<kbd class="search-kbd" aria-hidden="true">{kbd}</kbd>
	</button>

	<div class="topbar-actions">
		<button
			bind:this={helpButton}
			type="button"
			class="topbar-text-btn"
			aria-haspopup="dialog"
			aria-expanded={helpOpen}
			aria-controls={helpOpen ? helpId : undefined}
			onclick={onhelp}>{t('nav.help')}</button
		>
		<span class="more-btn">
			<IconButton
				bind:element={moreButton}
				icon="more_vert"
				label={t('mobile_nav.more')}
				aria-controls={`${uid}-actions`}
				aria-expanded={actionsOpen}
				onclick={() => (actionsOpen = !actionsOpen)}
			/>
		</span>
		<div bind:this={actions} id={`${uid}-actions`} class={['action-list', actionsOpen && 'is-open']}>
			<NotificationsMenu />
			<span class={['refresh', spinning && 'is-spinning']}>
				<IconButton icon="refresh" label={t('actions.refresh')} onclick={refresh} />
			</span>
			<IconButton icon={themeIcon} label={themeLabel} onclick={cycleTheme} />
			<IconButton
				icon="accessibility_new"
				label={t('accessibility.title')}
				class={a11yOn ? 'is-active' : ''}
				aria-haspopup="dialog"
				aria-expanded={a11y.open}
				onclick={() => (a11y.open = true)}
			/>
			<LanguageMenu />
			{#if drawer}<AccountMenu place="topbar" />{/if}
		</div>
	</div>
</header>

<style>
	.shell-topbar {
		/* The bar's icon buttons are the default control height, like Help and search */
		--icon-btn-size: var(--control-h);
		position: sticky;
		top: 0;
		z-index: var(--layer-topbar);
		display: flex;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		height: var(--topbar-h);
		padding-block: 0;
		padding-inline: var(--page-pad) var(--space-3);
		border-bottom: 1px solid var(--rule);
		background: var(--bg);
	}
	.topbar-logo {
		display: inline-flex;
		flex: none;
		align-items: center;
		min-height: var(--control-h);
		padding-inline: var(--space-1);
		color: var(--text);
	}
	.shell-breadcrumb {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.topbar-logo + .shell-breadcrumb {
		padding-inline-start: var(--space-3);
		border-inline-start: 1px solid var(--rule);
	}
	.crumb.current {
		overflow: hidden;
		color: var(--text);
		text-overflow: ellipsis;
	}
	.topbar-spacer {
		flex: 1;
	}

	/* Global search: looks like a field, opens the search dialog */
	.search-trigger {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		width: min(320px, 28vw);
		min-height: var(--control-h-sm);
		margin-inline-end: var(--space-3);
		padding: 0 var(--space-2);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text-muted);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.search-trigger:hover {
		border-color: var(--text-muted);
	}
	.search-trigger > :global(.material-icons) {
		font-size: 20px;
	}
	.search-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-kbd {
		padding: 0 var(--space-1);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-family: var(--font);
		font-size: var(--text-xs);
	}

	.topbar-actions,
	.action-list {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	/* Help: the one top bar control with a word, since it opens a panel, not a setting */
	.topbar-text-btn {
		min-height: var(--control-h);
		padding: 0 var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.topbar-text-btn:hover,
	.topbar-text-btn[aria-expanded='true'] {
		background: var(--hover);
	}
	.action-list :global(.icon-btn.is-active) {
		background: var(--accent-tint);
		color: var(--accent);
	}
	.refresh {
		display: inline-flex;
	}
	.refresh.is-spinning :global(.material-icons) {
		animation: spin var(--motion) linear;
	}
	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}
	.more-btn {
		display: none;
	}

	@media (max-width: 767px), (pointer: coarse) {
		.search-kbd {
			display: none;
		}
	}

	@media (max-width: 1099px) {
		.shell-topbar {
			padding-inline: var(--space-2) var(--space-3);
		}
	}

	@media (max-width: 767px) {
		.shell-topbar {
			gap: var(--space-1);
			padding-inline: var(--space-2);
		}
		.topbar-logo + .shell-breadcrumb {
			padding-inline-start: var(--space-2);
		}
		.crumb:not(.current),
		.crumb-sep {
			display: none;
		}
		.search-trigger {
			justify-content: center;
			width: var(--control-h);
			min-height: var(--control-h);
			margin-inline-end: 0;
			padding: 0;
			border-color: transparent;
			background: transparent;
		}
		/* Hidden but still the button's name */
		.search-label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
		}
		.more-btn {
			display: inline-flex;
		}
		/* The actions fold into a row under the bar */
		.action-list {
			position: absolute;
			top: calc(var(--topbar-h) - var(--space-1));
			inset-inline-end: var(--space-2);
			z-index: var(--layer-menu);
			display: none;
			padding: var(--space-1);
			border: 1px solid var(--rule);
			border-radius: var(--radius);
			background: var(--bg-float);
			box-shadow: var(--shadow-float);
		}
		.action-list.is-open {
			display: flex;
		}
	}
	@media (pointer: coarse) {
		.topbar-text-btn {
			min-height: 44px;
		}
		.topbar-logo {
			min-width: 44px;
			min-height: 44px;
			justify-content: center;
		}
		.shell-topbar {
			--icon-btn-size: 44px;
		}
	}
</style>
