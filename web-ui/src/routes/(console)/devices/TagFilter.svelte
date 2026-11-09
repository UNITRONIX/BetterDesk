<!--
  "Tags" in the toolbar: a popup of tag checkboxes that narrows the list
  to devices with every ticked tag. The button says which tags are on
  ("Tags: scanner", "Tags: 2 selected"). With device.edit the popup ends
  with Manage tags (rename or delete a tag on every device).
  Same popup behaviour as the column chooser: one popup at a time, Escape
  and a click or focus outside close it, Escape returns focus.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { openPopup } from '#lib/ui/popups.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		tags: string[];
		selected: string[];
		onchange: (selected: string[]) => void;
		/** Shown with device.edit */
		onmanage?: () => void;
	}

	let { tags, selected, onchange, onmanage }: Props = $props();

	const popupId = $props.id();
	let open = $state(false);
	let anchor = $state<HTMLElement | null>(null);
	let button = $state<HTMLElement | null>(null);
	let popup = $state<HTMLElement | null>(null);
	let release: (() => void) | null = null;

	const summary = $derived(
		selected.length === 0
			? ''
			: selected.length === 1
				? (selected[0] ?? '')
				: t('devices.tags_selected', { count: selected.length })
	);

	function close(focusButton = false) {
		if (!open) return;
		open = false;
		release?.();
		release = null;
		if (focusButton) button?.focus();
	}

	async function show() {
		release = openPopup(() => close());
		open = true;
		await tick();
		popup?.querySelector<HTMLElement>('input, button')?.focus();
	}

	function toggle(tag: string, on: boolean) {
		onchange(on ? [...selected.filter((s) => s !== tag), tag] : selected.filter((s) => s !== tag));
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			close(true);
		};
		const onDown = (e: PointerEvent) => {
			if (anchor && e.target instanceof Node && !anchor.contains(e.target)) close();
		};
		const onFocus = (e: FocusEvent) => {
			if (anchor && e.target instanceof Node && !anchor.contains(e.target)) close();
		};
		document.addEventListener('keydown', onKey);
		document.addEventListener('pointerdown', onDown, true);
		document.addEventListener('focusin', onFocus);
		return () => {
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('pointerdown', onDown, true);
			document.removeEventListener('focusin', onFocus);
		};
	});

	$effect(() => () => release?.());
</script>

<div class="menu-anchor tag-filter" bind:this={anchor}>
	<Button
		bind:element={button}
		class={selected.length > 0 ? 'toolbar-menu-btn is-on' : 'toolbar-menu-btn'}
		aria-haspopup="true"
		aria-expanded={open}
		aria-controls={popupId}
		onclick={() => (open ? close() : void show())}
	>
		<span>{t('devices.tags')}</span>{#if summary}<span class="summary">: {summary}</span>{/if}<Icon
			name="expand_more"
			class="btn-caret"
		/>
	</Button>
	<div
		bind:this={popup}
		id={popupId}
		class="menu menu-end"
		role="group"
		aria-label={t('devices.filter_by_tags')}
		hidden={!open}
	>
		<p class="note">{t('devices.tag_filter_note')}</p>
		<div class="options">
			{#each tags as tag (tag)}
				<label class="checkbox-row">
					<input
						type="checkbox"
						checked={selected.includes(tag)}
						onchange={(e) => toggle(tag, e.currentTarget.checked)}
					/>
					<span>{tag}</span>
				</label>
			{:else}
				<p class="empty">{t('devices.no_tags')}</p>
			{/each}
		</div>
		{#if onmanage}
			<div class="menu-divider" role="separator"></div>
			<button
				type="button"
				class="menu-item"
				onclick={() => {
					close(true);
					onmanage();
				}}
			>
				<Icon name={ICONS.tags} /><span class="menu-item-label">{t('devices.manage_tags')}</span>
			</button>
		{/if}
	</div>
</div>

<style>
	.tag-filter {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}
	.tag-filter :global(.btn-caret) {
		margin-inline-end: -4px;
		font-size: 18px;
	}
	.tag-filter > :global(.toolbar-menu-btn.is-on) {
		color: var(--accent);
	}
	.summary {
		max-width: 14ch;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		inset-inline-end: 0;
		z-index: var(--layer-menu);
		min-width: 220px;
		padding: var(--space-1) 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
	}
	.menu[hidden] {
		display: none;
	}
	.note {
		max-width: 260px;
		margin: 0;
		padding: var(--space-1) var(--space-3) var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.options {
		max-height: 260px;
		overflow-y: auto;
	}
	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--check-gap);
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-3);
		white-space: nowrap;
		cursor: pointer;
	}
	.checkbox-row:hover {
		background: var(--hover);
	}
	.checkbox-row input {
		flex-shrink: 0;
		width: var(--check-size);
		height: var(--check-size);
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.empty {
		margin: 0;
		padding: var(--space-2) var(--space-3);
		color: var(--text-muted);
	}
	.menu-divider {
		height: 1px;
		margin: var(--space-1) 0;
		background: var(--rule);
	}
	.menu-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		box-sizing: border-box;
		width: 100%;
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		white-space: nowrap;
		cursor: pointer;
	}
	.menu-item:hover,
	.menu-item:focus-visible {
		background: var(--hover);
	}
	.menu-item:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.menu-item > :global(.material-icons) {
		flex-shrink: 0;
		width: 20px;
		font-size: 18px;
		color: var(--text-muted);
		text-align: center;
	}
</style>
