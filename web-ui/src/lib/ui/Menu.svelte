<!--
  The popup list of a menu (components.css "Menus"). Usually opened by a
  MenuButton; use it alone only for menus opened some other way.

  Items: MenuItem, MenuDivider. Arrow keys move (and wrap), Home and End
  jump, a letter moves to the next item starting with it; Escape closes and
  returns focus to the opener, Tab and a click outside close. Only one popup
  is open at a time (openPopup).

  Placement: fixed to the viewport at coordinates measured on open, below
  `anchor` with its start edge on the anchor's start edge (`align="start"`)
  or its end edge on the anchor's end edge (`align="end"`, row menus, so
  the menu opens towards the start of the row). It flips above when there
  is not enough room below and stays inside the viewport, also in RTL. The
  menu stays in the DOM right after its button rather than in <body>: Tab
  order and the reading order follow the button, and a menu inside a sheet
  stays inside the sheet's focus trap and aria-modal tree. Fixed
  positioning escapes the overflow of a scrolling table; the coordinates
  are corrected when an ancestor's transform moves the fixed origin, and
  re-measured on scroll and resize.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { openPopup } from './popups.svelte.ts';
	import { menuItems, setMenu } from './menu.ts';

	interface Props {
		open?: boolean;
		/** The element the menu opens from; clicks on it don't count as outside */
		anchor: HTMLElement | null;
		align?: 'start' | 'end';
		/** Where focus goes on open */
		initialFocus?: 'first' | 'last' | 'menu';
		id?: string;
		labelledby?: string;
		label?: string;
		class?: string;
		/** Called after the menu closed; returnFocus: focus belongs back on the opener */
		onclose?: (returnFocus: boolean) => void;
		children: Snippet;
	}

	let {
		open = $bindable(false),
		anchor,
		align = 'start',
		initialFocus = 'first',
		id,
		labelledby,
		label,
		class: cls = '',
		onclose,
		children
	}: Props = $props();

	/** Gap to the anchor (--space-1) and the least distance to the viewport edge */
	const GAP = 4;
	const EDGE = 8;

	let menu = $state<HTMLElement | null>(null);
	let up = $state(false);

	function close(returnFocus: boolean) {
		if (!open) return;
		open = false;
		onclose?.(returnFocus);
	}

	setMenu({ close });

	function place(el: HTMLElement) {
		if (!anchor) return;
		el.style.maxHeight = '';
		const a = anchor.getBoundingClientRect();
		const vw = document.documentElement.clientWidth || window.innerWidth;
		const vh = window.innerHeight;
		const w = el.offsetWidth;
		let h = el.offsetHeight;
		const rtl = getComputedStyle(anchor).direction === 'rtl';
		// The anchor's left edge is its start edge in LTR and its end edge in RTL
		let left = (align === 'start') !== rtl ? a.left : a.right - w;
		left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
		const below = vh - a.bottom - GAP - EDGE;
		const above = a.top - GAP - EDGE;
		const flip = h > below && above > below;
		const room = flip ? above : below;
		if (h > room) {
			h = Math.max(room, 0);
			el.style.maxHeight = `${h}px`;
		}
		const top = flip ? a.top - GAP - h : a.bottom + GAP;
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
		up = flip;
		// A transformed ancestor makes the fixed origin its own box: correct for it
		const r = el.getBoundingClientRect();
		const dx = r.left - left;
		const dy = r.top - top;
		if (dx || dy) {
			el.style.left = `${left - dx}px`;
			el.style.top = `${top - dy}px`;
		}
	}

	function move(el: HTMLElement, event: KeyboardEvent) {
		const list = menuItems(el);
		const n = list.length;
		const active = document.activeElement;
		const i = active instanceof HTMLElement ? list.indexOf(active) : -1;
		let next: HTMLElement | undefined;
		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				event.stopPropagation();
				close(true);
				return;
			case 'Tab':
				close(false);
				return;
			case 'ArrowDown':
				next = list[(i + 1) % n];
				break;
			case 'ArrowUp':
				next = list[i < 0 ? n - 1 : (i - 1 + n) % n];
				break;
			case 'Home':
			case 'PageUp':
				next = list[0];
				break;
			case 'End':
			case 'PageDown':
				next = list[n - 1];
				break;
			default:
				next = typeahead(list, i, event);
		}
		if (next) {
			event.preventDefault();
			next.focus();
		}
	}

	/** A letter moves to the next item whose label starts with it (pressing it again cycles) */
	function typeahead(list: HTMLElement[], i: number, event: KeyboardEvent): HTMLElement | undefined {
		if (event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
		const key = event.key.toLocaleLowerCase();
		// The label only: the icon's text is a ligature name ("edit", "sell")
		const labelOf = (el: HTMLElement) =>
			(el.querySelector('.menu-item-label')?.textContent ?? '').trim().toLocaleLowerCase();
		const n = list.length;
		for (let k = 1; k <= n; k++) {
			const el = list[(i + k + n) % n];
			if (el && labelOf(el).startsWith(key)) return el;
		}
		return undefined;
	}

	$effect(() => {
		const el = menu;
		if (!open || !el) return;
		return untrack(() => {
			const release = openPopup(() => close(false));
			place(el);
			const list = menuItems(el);
			const first = initialFocus === 'last' ? list.at(-1) : initialFocus === 'first' ? list[0] : undefined;
			(first ?? el).focus();

			const outside = (e: Event) => {
				const target = e.target as Node | null;
				if (target && (el.contains(target) || anchor?.contains(target))) return;
				close(false);
			};
			const keydown = (e: KeyboardEvent) => move(el, e);
			const reposition = () => place(el);
			document.addEventListener('pointerdown', outside, true);
			el.addEventListener('keydown', keydown);
			window.addEventListener('resize', reposition);
			window.addEventListener('scroll', reposition, true);
			return () => {
				document.removeEventListener('pointerdown', outside, true);
				el.removeEventListener('keydown', keydown);
				window.removeEventListener('resize', reposition);
				window.removeEventListener('scroll', reposition, true);
				release();
			};
		});
	});
</script>

{#if open}
	<div
		bind:this={menu}
		{id}
		class={['menu', align === 'end' && 'menu-end', up && 'menu-up', cls]}
		role="menu"
		aria-labelledby={labelledby}
		aria-label={label}
		tabindex="-1"
	>
		{@render children()}
	</div>
{/if}

<style>
	/* top and left are viewport coordinates that place() sets (physical on
	   purpose: they are measured, and RTL is handled there) */
	.menu {
		position: fixed;
		top: 0;
		left: 0;
		z-index: var(--layer-menu);
		box-sizing: border-box;
		min-width: 180px;
		max-width: calc(100vw - 16px);
		padding: var(--space-1) 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		text-align: start;
	}
	.menu:focus {
		outline: none;
	}
	/* In a menu with icons, items without one keep the labels aligned (a
	   checkbox item's box takes the icon's place) */
	.menu:has(:global(.material-icons))
		:global(.menu-item:not(:has(.material-icons)):not([role='menuitemcheckbox'])::before) {
		content: '';
		width: 20px;
		flex-shrink: 0;
	}
</style>
