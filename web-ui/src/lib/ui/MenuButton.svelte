<!--
  A button that opens a small menu (components.css "Menu button"): a
  labelled button with a caret, or with `kebab` the row menu (an
  IconButton, `label` becomes its accessible name). The menu content is the
  children: MenuItem and MenuDivider.

  Enter, Space and ArrowDown open the menu on the first item, ArrowUp on
  the last; a click toggles it. See Menu for the keys inside. The button
  has aria-haspopup="menu", aria-expanded, and aria-controls while open.
  `align`: start (default for labelled buttons) or end (default for the row
  menu, so it opens towards the start of the row).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import IconButton from './IconButton.svelte';
	import Menu from './Menu.svelte';
	import { menuItems } from './menu.ts';

	interface Props {
		label: string;
		kebab?: boolean;
		/** Labelled button only: a meaning from ICONS before the label */
		icon?: string;
		variant?: 'secondary' | 'ghost' | 'primary';
		size?: 'default' | 'sm';
		align?: 'start' | 'end';
		disabled?: boolean;
		open?: boolean;
		class?: string;
		menuClass?: string;
		children: Snippet;
	}

	let {
		label,
		kebab = false,
		icon,
		variant = 'secondary',
		size = 'default',
		align,
		disabled = false,
		open = $bindable(false),
		class: cls = '',
		menuClass = '',
		children
	}: Props = $props();

	const uid = $props.id();
	const buttonId = `${uid}-button`;
	const menuId = `${uid}-menu`;
	let labelled = $state<HTMLElement | null>(null);
	let iconOnly = $state<HTMLButtonElement | null>(null);
	let initialFocus = $state<'first' | 'last'>('first');
	const trigger = $derived(kebab ? iconOnly : labelled);

	function show(where: 'first' | 'last') {
		if (open) {
			const menu = document.getElementById(menuId);
			const list = menu ? menuItems(menu) : [];
			(where === 'last' ? list.at(-1) : list[0])?.focus();
			return;
		}
		initialFocus = where;
		open = true;
	}

	function onclick() {
		if (open) {
			open = false;
			trigger?.focus();
		} else show('first');
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			show(event.key === 'ArrowUp' ? 'last' : 'first');
		}
	}

	function onclose(returnFocus: boolean) {
		if (returnFocus) trigger?.focus();
	}

	const aria = $derived({
		id: buttonId,
		'aria-haspopup': 'menu' as const,
		'aria-expanded': open,
		'aria-controls': open ? menuId : undefined
	});
</script>

<span class={['menu-anchor', cls]}>
	{#if kebab}
		<IconButton bind:element={iconOnly} icon="more_vert" {label} {disabled} {onclick} {onkeydown} {...aria} />
	{:else}
		<Button bind:element={labelled} {variant} {size} {icon} {disabled} {onclick} {onkeydown} {...aria}>
			{label}<Icon name="expand_more" class="btn-caret" />
		</Button>
	{/if}
	<Menu
		bind:open
		anchor={trigger}
		align={align ?? (kebab ? 'end' : 'start')}
		{initialFocus}
		id={menuId}
		labelledby={buttonId}
		class={menuClass}
		{onclose}
	>
		{@render children()}
	</Menu>
</span>

<style>
	/* Inline controls sit on the middle of the line, whether or not a
	   button starts with an icon */
	.menu-anchor {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}
	.menu-anchor :global(.btn-caret) {
		margin-inline-end: -4px;
		font-size: 18px;
	}
</style>
