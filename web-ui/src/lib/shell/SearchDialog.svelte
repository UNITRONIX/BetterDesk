<!--
  Global search (public/js/ui-search.js): one field for pages, devices and
  people. Opened from the top bar, with Ctrl+K / Cmd+K anywhere, or "/"
  when focus is not in a field (the shell listens for the keys and sets
  `open`). Pages come from the navigation the server sent (only pages this
  person may open); devices and people load on open from the APIs they may
  call, kept for a minute.

  A modal dialog: combobox field with a listbox of results in groups.
  ArrowUp and ArrowDown move, Enter opens, Escape closes and returns
  focus, Tab stays in the field; a click on the dimmed page closes.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { listDevices } from '#lib/api/devices.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import { openLayer } from '#lib/ui/layers.ts';
	import { portal } from '#lib/ui/portal.ts';
	import { listUsersForSearch } from './api.ts';
	import { searchPages } from './nav-model.ts';
	import {
		groupResults,
		searchAll,
		type ResultKind,
		type SearchDevice,
		type SearchResult,
		type SearchUser
	} from './search.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const uid = $props.id();
	const CACHE_MS = 60_000;

	let query = $state('');
	let active = $state(0);
	let dialog = $state<HTMLElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let overlay = $state<HTMLElement | null>(null);
	let devices = $state.raw<SearchDevice[] | null>(null);
	let users = $state.raw<SearchUser[] | null>(null);
	let loadedAt = 0;

	const pages = $derived(searchPages(session.nav));
	const results = $derived(searchAll(query, { pages, devices, users }));
	const groups = $derived(groupResults(results));
	const optionId = (i: number) => `${uid}-opt-${i}`;

	const GROUP_KEY: Record<ResultKind, string> = {
		page: 'search.group_pages',
		device: 'search.group_devices',
		user: 'search.group_people'
	};
	const ICON: Record<ResultKind, string> = {
		page: 'arrow_forward',
		device: 'desktop_windows',
		user: 'person'
	};
	const STATE_KEY = { online: 'status.online', offline: 'status.offline', banned: 'status.banned' } as const;

	const status = $derived(
		!query.trim()
			? t('search.hint')
			: !results.length
				? t('search.no_results')
				: t('search.count', { count: results.length })
	);

	/** The highlighted result, kept inside the list when results change */
	const current = $derived(results.length ? Math.min(active, results.length - 1) : -1);

	async function loadData() {
		if (loadedAt && Date.now() - loadedAt < CACHE_MS) return;
		loadedAt = Date.now();
		const jobs: Promise<void>[] = [];
		if (can('device.view'))
			jobs.push(
				listDevices()
					.then((d) => void (devices = d))
					.catch(() => void (devices = null))
			);
		if (can('user.view'))
			jobs.push(
				listUsersForSearch()
					.then((u) => void (users = u))
					.catch(() => void (users = null))
			);
		await Promise.all(jobs);
	}

	function close() {
		open = false;
	}

	function setActive(i: number) {
		if (i < 0 || i >= results.length) return;
		active = i;
		document.getElementById(optionId(i))?.scrollIntoView({ block: 'nearest' });
	}

	async function go(i: number) {
		const r: SearchResult | undefined = results[i];
		if (!r) return;
		close();
		const href = link(r.href);
		if (r.external) {
			window.open(href, '_blank', 'noopener');
			return;
		}
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- link() adds the base
		await goto(href);
	}

	function onkeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				setActive(Math.min(results.length - 1, current + 1));
				break;
			case 'ArrowUp':
				e.preventDefault();
				setActive(Math.max(0, current - 1));
				break;
			case 'Enter':
				e.preventDefault();
				void go(current);
				break;
			case 'Escape':
				e.preventDefault();
				close();
				break;
			case 'Tab':
				e.preventDefault();
				break;
		}
	}

	$effect(() => {
		const el = dialog;
		const back = overlay;
		if (!open || !el || !back) return;
		return untrack(() => {
			query = '';
			active = 0;
			const closed = openLayer({
				kind: 'dialog',
				element: el,
				dismiss: close,
				replace: close,
				blocking: () => false
			});
			const down = (e: PointerEvent) => {
				if (e.target === back) close();
			};
			back.addEventListener('pointerdown', down);
			input?.focus();
			void loadData();
			return () => {
				back.removeEventListener('pointerdown', down);
				closed();
			};
		});
	});
</script>

{#if open}
	<div class="search-overlay" bind:this={overlay} {@attach portal}>
		<div
			bind:this={dialog}
			class="search-dialog"
			role="dialog"
			aria-modal="true"
			aria-label={t('search.title')}
			tabindex="-1"
		>
			<div class="search-field">
				<Icon name="search" />
				<input
					bind:this={input}
					bind:value={query}
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={`${uid}-results`}
					aria-autocomplete="list"
					aria-activedescendant={current >= 0 ? optionId(current) : undefined}
					aria-label={t('search.title')}
					placeholder={t('search.placeholder')}
					autocomplete="off"
					spellcheck="false"
					oninput={() => (active = 0)}
					{onkeydown}
				/>
			</div>
			<div class="search-results" id={`${uid}-results`} role="listbox" aria-label={t('search.results')}>
				{#each groups as g (g.kind)}
					<div role="group" aria-labelledby={`${uid}-g-${g.kind}`}>
						<div class="search-group" id={`${uid}-g-${g.kind}`} role="presentation">
							{t(GROUP_KEY[g.kind])}
						</div>
						{#each g.items as { r, index } (index)}
							<!-- Options are chosen with the keyboard in the field; the mouse picks them here -->
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<div
								id={optionId(index)}
								class="search-result"
								role="option"
								aria-selected={index === current}
								tabindex="-1"
								onmousemove={() => (active = index)}
								onclick={() => go(index)}
							>
								<Icon name={ICON[r.kind]} />
								<span class="search-result-main">
									<span class="search-result-title">{r.title}</span>
									{#if r.kind === 'device'}
										<span class="search-result-sub">
											<span class="mono">{r.id}</span>
											{#if r.sub}<span>{r.sub}</span>{/if}
											{#if r.state}<span>{t(STATE_KEY[r.state])}</span>{/if}
										</span>
									{:else if r.sub}
										<span class="search-result-sub">{r.sub}</span>
									{/if}
								</span>
							</div>
						{/each}
					</div>
				{/each}
			</div>
			<p class="search-status" aria-live="polite">{status}</p>
			<p class="search-keys">{t('search.keys')}</p>
		</div>
	</div>
{/if}

<style>
	.search-overlay {
		position: fixed;
		inset: 0;
		z-index: var(--layer-search);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 10vh var(--space-4) var(--space-4);
		background: rgba(0, 0, 0, 0.45);
	}
	.search-dialog {
		display: flex;
		flex-direction: column;
		width: min(640px, 100%);
		max-height: 70vh;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		text-align: start;
	}
	.search-dialog:focus {
		outline: none;
	}
	.search-field {
		position: relative;
		padding: var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.search-field > :global(.material-icons) {
		position: absolute;
		top: 50%;
		inset-inline-start: calc(var(--space-3) + var(--space-2));
		color: var(--text-muted);
		font-size: 20px;
		transform: translateY(-50%);
		pointer-events: none;
	}
	.search-field input {
		box-sizing: border-box;
		width: 100%;
		min-height: 44px;
		padding-block: 0;
		padding-inline: calc(var(--space-2) + 20px + var(--space-2)) var(--control-pad-x-sm);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--text-md);
	}
	.search-field input::placeholder {
		color: var(--text-muted);
		opacity: 1;
	}
	.search-field input:focus {
		border-color: var(--focus);
		outline: 2px solid var(--focus);
		outline-offset: -1px;
	}
	.search-results {
		flex: 1;
		min-height: 0;
		padding: var(--space-1) 0;
		overflow-y: auto;
	}
	.search-results:empty {
		display: none;
	}
	.search-group {
		padding: var(--space-2) var(--space-3) var(--space-1);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.search-result {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--row-h);
		padding: var(--space-1) var(--space-3);
		cursor: pointer;
	}
	.search-result > :global(.material-icons) {
		color: var(--text-muted);
		font-size: 20px;
	}
	.search-result[aria-selected='true'] {
		background: var(--accent-tint);
	}
	.search-result-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.search-result-title {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.search-result-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0 var(--space-3);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.search-status,
	.search-keys {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.search-status {
		border-top: 1px solid var(--rule);
	}
	.search-keys {
		padding-top: 0;
	}
	@media (pointer: coarse) {
		.search-keys {
			display: none;
		}
	}
	@media (forced-colors: active) {
		.search-result[aria-selected='true'] {
			outline: 2px solid Highlight;
			outline-offset: -2px;
		}
	}
</style>
