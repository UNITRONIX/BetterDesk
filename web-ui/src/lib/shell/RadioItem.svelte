<!--
  A choice of one in a Menu (role menuitemradio, aria-checked): My status
  in the account menu, the language menu. Looks like MenuItem, with a check
  mark at the end of the chosen one. `lead` draws what goes before the
  label (a presence dot, a flag). Choosing closes the menu and returns
  focus to its button before `onselect` runs, like MenuItem.

  (MenuItem has no radio type yet; when it gets one, this file goes.)
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { getMenu } from '#lib/ui/menu.ts';

	interface Props {
		checked: boolean;
		lang?: string;
		lead?: Snippet;
		onselect?: () => void;
		children: Snippet;
	}

	let { checked, lang, lead, onselect, children }: Props = $props();

	const menu = getMenu();

	function choose() {
		menu?.close(true);
		onselect?.();
	}
</script>

<button
	type="button"
	class="menu-item"
	role="menuitemradio"
	aria-checked={checked}
	tabindex="-1"
	{lang}
	onclick={choose}
>
	{@render lead?.()}<span class="menu-item-label">{@render children()}</span><Icon
		name="check"
		class={checked ? 'menu-item-check' : 'menu-item-check is-off'}
	/>
</button>

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
		white-space: nowrap;
		cursor: pointer;
	}
	.menu-item:hover,
	.menu-item:focus-visible {
		background: var(--hover);
		color: var(--text);
	}
	.menu-item:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.menu-item[aria-checked='true'] {
		font-weight: 600;
	}
	.menu-item-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.menu-item > :global(.menu-item-check) {
		flex-shrink: 0;
		margin-inline-start: var(--space-2);
		color: var(--accent);
		font-size: 18px;
	}
	/* Always there (hidden when not chosen), so Menu sees an icon in every item and adds no spacer */
	.menu-item > :global(.menu-item-check.is-off) {
		visibility: hidden;
	}
</style>
