<!--
  One entry in a Menu (components.css "Menus"). `icon`: a meaning from
  ICONS before the label (muted, so the label leads). `danger`: a
  destructive action (end its label with "…" when it asks first).
  `disabled` items are skipped by the keyboard and can't be chosen.

  Choosing an item closes the menu and puts focus back on the menu button
  before `onselect` runs, so a dialog it opens returns focus there.
  type="checkbox" is a menuitemcheckbox (column choices): it toggles the
  bindable `checked`, calls `onselect`, and leaves the menu open.
  `href` makes it a link (type item only).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import { getMenu } from './menu.ts';

	interface Props {
		icon?: string;
		danger?: boolean;
		disabled?: boolean;
		type?: 'item' | 'checkbox';
		checked?: boolean;
		href?: string;
		class?: string;
		onselect?: () => void;
		children: Snippet;
	}

	let {
		icon,
		danger = false,
		disabled = false,
		type = 'item',
		checked = $bindable(false),
		href,
		class: cls = '',
		onselect,
		children
	}: Props = $props();

	const menu = getMenu();
	const classes = $derived(['menu-item', danger && 'danger', cls]);

	function choose(event: MouseEvent) {
		if (disabled) {
			event.preventDefault();
			return;
		}
		if (type === 'checkbox') {
			checked = !checked;
			onselect?.();
			return;
		}
		menu?.close(true);
		onselect?.();
	}
</script>

{#if href && type === 'item'}
	<a
		class={classes}
		role="menuitem"
		tabindex="-1"
		href={disabled ? undefined : href}
		aria-disabled={disabled || undefined}
		onclick={choose}
	>
		{#if icon}<Icon name={icon} />{/if}<span class="menu-item-label">{@render children()}</span>
	</a>
{:else}
	<button
		type="button"
		class={classes}
		role={type === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'}
		aria-checked={type === 'checkbox' ? checked : undefined}
		tabindex="-1"
		{disabled}
		onclick={choose}
	>
		{#if type === 'checkbox'}
			<span class="menu-check" aria-hidden="true"></span>
		{:else if icon}
			<Icon name={icon} />
		{/if}<span class="menu-item-label">{@render children()}</span>
	</button>
{/if}

<style>
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
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
	}
	.menu-item:hover,
	.menu-item:focus-visible {
		background: var(--hover);
		color: var(--text);
	}
	/* The hover background alone is too faint to show keyboard focus: the
	   focus ring, inside the item so the menu does not clip it */
	.menu-item:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.menu-item:is(:disabled, [aria-disabled='true']) {
		background: transparent;
		color: var(--text-muted);
		opacity: 0.5;
		cursor: not-allowed;
	}
	.menu-item > :global(.material-icons) {
		flex-shrink: 0;
		width: 20px;
		font-size: 18px;
		color: var(--text-muted);
		text-align: center;
	}
	/* The box of a checkbox item, drawn like the native checkbox the old
	   console's menus had (accent fill and a tick when checked, --check-size).
	   It is not a glyph: the icon font has no checkbox symbols. */
	.menu-check {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
		width: var(--check-size);
		height: var(--check-size);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
	}
	/* Next to 20px icons in a mixed menu, centred in their slot */
	:global(.menu:has(.material-icons)) .menu-check {
		margin-inline: 2px;
	}
	.menu-item[aria-checked='true'] > .menu-check {
		border-color: var(--accent);
		background: var(--accent);
	}
	.menu-item[aria-checked='true'] > .menu-check::after {
		content: '';
		width: 30%;
		height: 60%;
		margin-top: -10%;
		border: solid var(--on-accent);
		border-width: 0 2px 2px 0;
		transform: rotate(45deg);
	}
	@media (forced-colors: active) {
		.menu-check {
			border-color: CanvasText;
		}
		.menu-item[aria-checked='true'] > .menu-check {
			background: Highlight;
			border-color: Highlight;
		}
		.menu-item[aria-checked='true'] > .menu-check::after {
			border-color: HighlightText;
		}
	}
	.danger,
	.danger:hover,
	.danger:focus-visible {
		color: var(--danger);
	}
	.danger > :global(.material-icons) {
		color: inherit;
	}
	.menu-item-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
