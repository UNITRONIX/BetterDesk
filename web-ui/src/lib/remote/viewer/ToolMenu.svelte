<!--
  A control in the viewer's controls row that opens a menu: icon, label
  (visually hidden in narrower windows, kept as the name and tooltip) and
  a caret. Same keyboard as MenuButton: Enter, Space or the arrows open it,
  Escape closes and returns focus.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import { menuItems } from '#lib/ui/menu.ts';

	interface Props {
		label: string;
		icon: string;
		menuClass?: string;
		onopen?: () => void;
		children: Snippet;
	}

	let { label, icon, menuClass = '', onopen, children }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let button = $state<HTMLElement | null>(null);
	let initialFocus = $state<'first' | 'last'>('first');

	function show(where: 'first' | 'last') {
		if (open) {
			const menu = document.getElementById(`${uid}-menu`);
			const list = menu ? menuItems(menu) : [];
			(where === 'last' ? list.at(-1) : list[0])?.focus();
			return;
		}
		initialFocus = where;
		onopen?.();
		open = true;
	}
</script>

<span class="tool-anchor">
	<Button
		size="sm"
		class="toolbar-btn"
		{icon}
		bind:element={button}
		id="{uid}-btn"
		title={label}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		onclick={() => {
			if (open) {
				open = false;
				button?.focus();
			} else show('first');
		}}
		onkeydown={(e: KeyboardEvent) => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				show(e.key === 'ArrowUp' ? 'last' : 'first');
			}
		}}
	>
		<span class="tb-label">{label}</span><Icon name="expand_more" class="btn-caret" />
	</Button>
	<Menu
		bind:open
		anchor={button}
		{initialFocus}
		id="{uid}-menu"
		labelledby="{uid}-btn"
		class={menuClass}
		onclose={(returnFocus) => {
			if (returnFocus) button?.focus();
		}}
	>
		{@render children()}
	</Menu>
</span>

<style>
	.tool-anchor {
		position: relative;
		display: inline-flex;
	}
	.tool-anchor :global(.btn-caret) {
		margin-inline-start: -2px;
		color: var(--text-muted);
		font-size: 18px;
	}
</style>
