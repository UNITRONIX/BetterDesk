<!--
  One font choice on the Appearance tab (heading or text): the font in use
  ("Now: Inter", Use default), and a search field with a list of matching
  fonts under it. Picking a Google font that is not on the server yet
  downloads it first (people who can change the appearance); it still
  works from Google when that fails. Arrow down moves into the list,
  Escape closes it, a click outside closes it; only one list is open at a
  time (openPopup).
-->
<script lang="ts">
	import { searchFonts, downloadFont, type FontInfo } from '#lib/api/settings.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { openPopup } from '#lib/ui/popups.svelte.ts';

	interface Props {
		slot: 'heading' | 'body';
		value: string;
		google: boolean;
		category: string;
		canEdit: boolean;
		disabled?: boolean;
		/** A font was downloaded to the server */
		ondownload?: () => void;
	}

	let {
		slot,
		value = $bindable(),
		google,
		category,
		canEdit,
		disabled = false,
		ondownload
	}: Props = $props();

	const id = $derived(`font-${slot}-search`);
	const listId = $derived(`font-${slot}-dropdown`);

	let query = $state('');
	let open = $state(false);
	let fonts = $state.raw<FontInfo[] | null>(null);
	let problem = $state('');
	let picking = $state<string | null>(null);
	let root = $state<HTMLElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);
	let list = $state<HTMLElement | null>(null);
	let closePopup: (() => void) | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let ctrl: AbortController | null = null;

	function show() {
		if (open) return;
		open = true;
		closePopup = openPopup(() => (open = false));
	}

	function hide() {
		open = false;
		closePopup?.();
		closePopup = null;
	}

	async function search() {
		ctrl?.abort();
		const c = new AbortController();
		ctrl = c;
		try {
			const out = await searchFonts(query.trim(), category, google, c.signal);
			if (ctrl !== c) return;
			fonts = out;
			problem = '';
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			fonts = [];
			problem = err instanceof Error && err.message ? err.message : t('errors.server_error');
		}
		show();
	}

	function oninput() {
		clearTimeout(timer);
		timer = setTimeout(() => void search(), 300);
	}

	function onfocus() {
		if (fonts === null) void search();
		else show();
	}

	// Another category or source: search again while the list is open
	$effect(() => {
		void category;
		void google;
		if (open) void search();
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			e.preventDefault();
			e.stopPropagation();
			hide();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!open) void search();
			else list?.querySelector<HTMLElement>('button')?.focus();
		} else if (e.key === 'Enter') {
			// Not the page's save
			e.preventDefault();
		}
	}

	function onListKey(e: KeyboardEvent) {
		const items = [...(list?.querySelectorAll<HTMLElement>('button') ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			hide();
			input?.focus();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			items[Math.min(items.length - 1, at + 1)]?.focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (at <= 0) input?.focus();
			else items[at - 1]?.focus();
		}
	}

	async function pick(font: FontInfo) {
		if (!font.downloaded && canEdit) {
			picking = font.family;
			try {
				await downloadFont(font.family);
				ondownload?.();
			} catch {
				// The font still works from Google when the download fails
			}
			picking = null;
		}
		value = font.family;
		hide();
		input?.focus();
	}

	$effect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (root && e.target instanceof Node && !root.contains(e.target)) hide();
		};
		document.addEventListener('click', away);
		return () => document.removeEventListener('click', away);
	});

	$effect(() => () => {
		clearTimeout(timer);
		ctrl?.abort();
		closePopup?.();
	});
</script>

<div class="form-group font-slot" id="font-{slot}-slot" bind:this={root}>
	<label class="form-label" for={id}>{t(`branding.font_${slot}`)}</label>
	<p class="form-hint" id="{id}-hint">{t(`branding.font_${slot}_hint`)}</p>
	<p class="font-current-line">
		{t('settings.appearance.font_current')}
		<strong id="font-{slot}-current">{value || t('branding.font_system_default')}</strong>
		{#if value && !disabled}
			<Button id="font-{slot}-clear" variant="link" size="sm" onclick={() => (value = '')}
				>{t('settings.appearance.font_use_default')}</Button
			>
		{/if}
	</p>
	<div class="font-search">
		<Input
			bind:element={input}
			{id}
			type="search"
			role="combobox"
			aria-expanded={open}
			aria-controls={listId}
			aria-autocomplete="list"
			describedby="{id}-hint"
			autocomplete="off"
			placeholder={t('branding.font_search_placeholder')}
			{disabled}
			bind:value={query}
			{oninput}
			{onfocus}
			{onkeydown}
		/>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions (keys move between the font buttons) -->
		<div
			class="font-dropdown"
			id={listId}
			role="group"
			aria-label={t(`branding.font_${slot}`)}
			hidden={!open}
			bind:this={list}
			onkeydown={onListKey}
		>
			{#if problem}
				<p class="state is-error">{problem}</p>
			{:else if fonts && !fonts.length}
				<p class="state">{t('settings.appearance.font_none')}</p>
			{:else if fonts}
				{#each fonts as font (font.family)}
					<button type="button" class="font-item" disabled={picking !== null} onclick={() => void pick(font)}>
						<span>{font.family}</span>
						<span class="font-meta"
							>{[font.category, font.downloaded ? t('branding.font_local') : '']
								.filter(Boolean)
								.join(', ')}</span
						>
					</button>
				{/each}
			{/if}
		</div>
	</div>
</div>

<style>
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.form-label {
		font-weight: 600;
	}
	.form-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.font-current-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin: 0;
	}
	.font-search {
		position: relative;
	}
	.font-dropdown {
		position: absolute;
		inset-inline: 0;
		top: calc(100% + 2px);
		z-index: 20;
		max-height: 280px;
		overflow-y: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.16);
	}
	.font-dropdown[hidden] {
		display: none;
	}
	.font-item {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--control-h);
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-bottom: 1px solid var(--rule);
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.font-item:hover,
	.font-item:focus-visible {
		background: var(--hover);
	}
	.font-item:focus-visible {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-offset) - 2px);
	}
	.font-meta {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.state {
		margin: 0;
		padding: var(--space-3);
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
	@media (pointer: coarse) {
		.font-item {
			min-height: 44px;
		}
	}
</style>
