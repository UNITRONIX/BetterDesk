<!--
  A menu item that keeps the menu open: an option of a group
  (menuitemradio, the default), a switch (menuitemcheckbox) or an action
  (menuitem), so several viewer settings can be changed in one go, as in
  the old Display and Screens menus. The shared MenuItem's radio closes its
  menu on select.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';

	interface Props {
		kind?: 'radio' | 'checkbox' | 'action';
		checked?: boolean;
		icon?: string;
		disabled?: boolean;
		title?: string;
		onselect: () => void;
		children: Snippet;
	}

	let {
		kind = 'radio',
		checked = false,
		icon,
		disabled = false,
		title,
		onselect,
		children
	}: Props = $props();
	const role = $derived(
		kind === 'radio' ? 'menuitemradio' : kind === 'checkbox' ? 'menuitemcheckbox' : 'menuitem'
	);
</script>

<button
	type="button"
	class="menu-choice"
	{role}
	aria-checked={kind === 'action' ? undefined : checked}
	tabindex="-1"
	{disabled}
	{title}
	onclick={() => {
		if (!disabled) onselect();
	}}
>
	{#if icon}<Icon name={icon} class="lead" />{/if}<span class="menu-item-label">{@render children()}</span>
	{#if kind !== 'action'}<Icon name="check" class={checked ? 'tick' : 'tick is-off'} />{/if}
</button>

<style>
	.menu-choice {
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
		white-space: normal;
		cursor: pointer;
	}
	.menu-choice:hover,
	.menu-choice:focus-visible {
		background: var(--hover);
	}
	.menu-choice:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.menu-choice[aria-checked='true'] {
		font-weight: 600;
	}
	.menu-choice:disabled {
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.menu-item-label {
		flex: 1;
		min-width: 0;
	}
	.menu-choice :global(.lead) {
		font-size: 20px;
		color: var(--text-muted);
	}
	.menu-choice :global(.tick) {
		margin-inline-start: auto;
		font-size: 18px;
		color: var(--accent);
	}
	.menu-choice :global(.tick.is-off) {
		visibility: hidden;
	}
</style>
