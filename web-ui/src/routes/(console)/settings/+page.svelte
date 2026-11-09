<!--
  Settings (/settings). Each tab is a sub-page: ?tab=general (or none),
  branding, auth, backup, updates, email, time, advanced, listed in the
  sidebar; an unknown tab is General. The tabs Backup to Advanced need
  server.config; anyone else who opens one gets one sentence.

  Old links: #<tab> and #server become ?tab=; #<element-id> scrolls to that
  setting, or switches to the tab that holds it first (lib/settings/tabs.ts,
  search-index.ts). The search above the side column finds a setting on any
  tab the person may open (lib/settings/search.ts) and jumps to it the same
  way (lib/settings/reveal.ts).

  Each tab is its own component in lib/settings/tabs/, loaded when it is
  opened; it loads its own data. Leaving a tab with unsaved changes asks
  first (lib/settings/dirty.ts).
-->
<script lang="ts">
	import type { Component } from 'svelte';
	import { tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { clientMessages } from '#lib/api/client.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { base } from '#lib/nav.ts';
	import { setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import CountLine from '#lib/ui/CountLine.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import States from '#lib/ui/States.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { warnOnLeave } from '#lib/ui/form.svelte.ts';
	import { anyDirty } from '#lib/settings/dirty.ts';
	import {
		clearAllReveals,
		findTarget,
		highlight,
		onControlChange,
		whenPresent
	} from '#lib/settings/reveal.ts';
	import { MIN_QUERY, searchSettings, type SearchHit } from '#lib/settings/search.ts';
	import {
		TAB_TITLE,
		decodeHash,
		hashTab,
		parseTab,
		tabAllowed,
		tabDescKey,
		tabOfId,
		tabSearch,
		type TabId
	} from '#lib/settings/tabs.ts';

	type Loader = () => Promise<{ default: Component }>;

	// One chunk per tab: a tab's code loads when it is opened
	const LOADERS: Record<TabId, Loader> = {
		general: () => import('#lib/settings/tabs/GeneralTab.svelte'),
		branding: () => import('#lib/settings/tabs/AppearanceTab.svelte'),
		auth: () => import('#lib/settings/tabs/SignInTab.svelte'),
		backup: () => import('#lib/settings/tabs/BackupTab.svelte'),
		updates: () => import('#lib/settings/tabs/UpdatesTab.svelte'),
		email: () => import('#lib/settings/tabs/EmailTab.svelte'),
		time: () => import('#lib/settings/tabs/TimeTab.svelte'),
		advanced: () => import('#lib/settings/tabs/AdvancedTab.svelte')
	};

	/** Bumped by Retry when a tab's code could not be loaded */
	let attempt = $state(0);

	const raw = $derived(page.url.searchParams.get('tab'));
	const tab = $derived(parseTab(raw));
	const canConfig = $derived(can('server.config'));
	const allowed = $derived(tabAllowed(tab, canConfig));
	const title = $derived(t(TAB_TITLE[tab]));
	const desc = $derived(t(tabDescKey(tab, canConfig)));

	/** Go to this page's own URL (tabHref adds the base; resolve() is for route paths) */
	function go2(url: string, opts?: Parameters<typeof goto>[1]): Promise<void> {
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		return goto(url, opts);
	}

	/** /app/settings?tab=x#id */
	function tabHref(name: TabId, id?: string): string {
		return `${base}/settings${tabSearch(name)}${id ? `#${encodeURIComponent(id)}` : ''}`;
	}

	// An unknown ?tab= is General: say so in the URL, so the sidebar and breadcrumb agree
	$effect(() => {
		const r = raw;
		const name = tab;
		if (r === null || r === name) return;
		untrack(() => void go2(tabHref(name) + page.url.hash, { replace: true, reset: false }));
	});

	// A tab this person may not open is not in their sidebar: name it in the breadcrumb
	$effect(() => {
		setPageTitle(allowed ? null : title);
	});

	/* ── Links into the page: #<tab>, #server, #<element-id> ── */

	let following: AbortController | null = null;

	async function followHash(hash: string, current: TabId): Promise<void> {
		following?.abort();
		following = null;
		if (!hash || hash === '#') return;
		const asTab = hashTab(hash);
		if (asTab) {
			await go2(tabHref(asTab), { replace: true, reset: false });
			return;
		}
		const id = decodeHash(hash);
		const owner = tabOfId(id);
		if (owner && owner !== current && tabAllowed(owner, canConfig)) {
			await go2(tabHref(owner, id), { replace: true, reset: false });
			return;
		}
		const ctrl = new AbortController();
		following = ctrl;
		// The tab draws parts of itself when its data arrives
		const target = await whenPresent(id, ctrl.signal);
		if (!target || ctrl.signal.aborted) return;
		await tick();
		highlight(target);
	}

	$effect(() => {
		const hash = page.url.hash;
		const current = tab;
		untrack(() => void followHash(hash, current));
	});

	$effect(() => () => following?.abort());

	// A switch that changes ends the "shown for the search" state of what it controls
	$effect(() => {
		const onChange = (e: Event) => onControlChange(e.target);
		document.addEventListener('change', onChange);
		return () => document.removeEventListener('change', onChange);
	});

	$effect(() => {
		void tab;
		return () => clearAllReveals();
	});

	/* ── Search ── */

	let query = $state('');
	const searching = $derived(query.trim().length >= MIN_QUERY);
	const hits = $derived(
		searching ? searchSettings(query, { t, can, current: tab, locale: i18n.locale }) : ([] as SearchHit[])
	);

	async function go(hit: SearchHit): Promise<void> {
		query = '';
		if (hit.tab === tab) {
			const same = decodeHash(page.url.hash) === hit.id;
			await go2(tabHref(hit.tab, hit.id), { replace: true, reset: false });
			// The same #id again: no change for the URL to follow
			if (same) {
				const el = findTarget(hit.id);
				if (el) highlight(el);
			}
			return;
		}
		await go2(tabHref(hit.tab, hit.id), { reset: false });
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && hits[0]) {
			e.preventDefault();
			void go(hits[0]);
		} else if (e.key === 'Escape' && query) {
			e.preventDefault();
			query = '';
		}
	}

	// A result is a link (it opens in a new tab too); a plain click jumps without a page load
	function onResultClick(e: MouseEvent) {
		if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
		const a = e.target instanceof Element ? e.target.closest('a') : null;
		const hit = a ? hits.find((h) => tabHref(h.tab, h.id) === a.getAttribute('href')) : undefined;
		if (!hit) return;
		e.preventDefault();
		void go(hit);
	}

	/* ── Unsaved changes ── */

	$effect(() => warnOnLeave(anyDirty));

	let leaving = false;
	beforeNavigate((nav) => {
		if (leaving || nav.willUnload || !nav.to || !anyDirty()) return;
		const to = nav.to.url;
		// Only the #id changes: nothing is lost
		if (to.pathname === page.url.pathname && parseTab(to.searchParams.get('tab')) === tab) return;
		nav.cancel();
		void confirm({
			title: tf('settings.page.discard_title', 'Discard unsaved changes?'),
			message: tf('settings.page.discard_message', 'The changes on this page are not saved yet.'),
			confirmLabel: tf('settings.page.discard_confirm', 'Discard changes'),
			danger: true
		}).then((ok) => {
			if (!ok) return;
			leaving = true;
			void go2(to.pathname + to.search + to.hash).finally(() => (leaving = false));
		});
	});
</script>

<div class={['page', 'settings-page', tab === 'advanced' && 'is-wide']} data-current-tab={tab}>
	<div class="page-head">
		<h1>{title}</h1>
		<div class="page-actions settings-search" role="search">
			<SearchField
				label={t('settings.page.search_label')}
				placeholder={t('settings.ui.search_placeholder')}
				bind:value={query}
				id="settings-search-input"
				autocomplete="off"
				aria-controls="settings-search-results"
				onkeydown={onSearchKey}
			/>
		</div>
		<p class="page-description">{desc}</p>
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (the results are links; Enter clicks them) -->
	<div
		class="settings-search-results"
		id="settings-search-results"
		aria-live="polite"
		onclick={onResultClick}
	>
		{#if searching}
			{#if hits.length}
				<CountLine text={t('settings.page.search_count')} values={{ count: hits.length }} />
				<RowList label={t('settings.page.search_label')}>
					{#each hits as hit (`${hit.tab}#${hit.id}#${hit.label}`)}
						<ListRow title={hit.label} sub={hit.where} href={tabHref(hit.tab, hit.id)} />
					{/each}
				</RowList>
			{:else}
				<p class="count-line">{t('settings.page.search_none', { query: query.trim() })}</p>
			{/if}
		{/if}
	</div>

	{#if !allowed}
		<p class="state">{t('settings.page.admin_only')}</p>
	{:else}
		{#key `${tab}:${attempt}`}
			{#await LOADERS[tab]()}
				<States kind="loading" />
			{:then mod}
				<mod.default />
			{:catch}
				<States kind="error" message={clientMessages.network} onretry={() => attempt++} />
			{/await}
		{/key}
	{/if}
</div>

<style>
	.settings-page:not(.is-wide) {
		max-width: calc(2 * var(--measure) + var(--side-w) + 2 * var(--space-7));
	}
	.settings-page .page-head .settings-search {
		flex: 0 1 300px;
	}
	.settings-search :global(.search-wrapper) {
		width: 100%;
	}
	@media (max-width: 640px) {
		.settings-page .page-head .settings-search {
			flex-basis: 100%;
			order: 3;
		}
	}
	@media (min-width: 1200px) {
		.settings-page > .page-head {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(280px, var(--side-w));
			gap: var(--space-1) var(--space-7);
			align-items: center;
		}
		.settings-page > .page-head > h1 {
			grid-column: 1;
			grid-row: 1;
		}
		.settings-page > .page-head > .page-description {
			grid-column: 1;
			grid-row: 2;
			margin-top: 0;
			padding-inline-end: 0;
			max-width: var(--measure);
		}
		.settings-page > .page-head > .settings-search {
			grid-column: 2;
			grid-row: 1 / span 2;
		}
	}

	/* Results across all tabs */
	.settings-search-results {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: calc(-1 * var(--space-4));
	}
	.settings-search-results:empty {
		display: none;
	}
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.state {
		padding: var(--space-4) 0;
		color: var(--text-muted);
	}

	/* A setting reached from the search or a link: outlined for a moment (reveal.ts).
	   No background, so text and borders keep the contrast they have at rest. */
	.settings-page
		:global(:is(.form-group, .check-field, .choice, .facts, .settings-subgroup, .section, .danger-zone)) {
		outline: 2px solid transparent;
		outline-offset: 4px;
		transition: outline-color var(--motion);
	}
	.settings-page :global(.is-found) {
		outline-color: var(--accent);
		border-radius: var(--radius);
	}
</style>
