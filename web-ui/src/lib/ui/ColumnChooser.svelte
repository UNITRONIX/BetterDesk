<!--
  "Columns" button with a popup of checkboxes, one per hideable column
  (the old console's column visibility menu). Takes the table's columns;
  `onchange(id, visible)` reports a change, the page keeps and stores the
  choice and passes the columns back with `visible` set.

  A disclosure, not an ARIA menu: the button has aria-expanded, the popup
  is a labelled group of native checkboxes reached with Tab. Opening moves
  focus to the first checkbox; Escape closes and focus goes back to the
  button; a click outside or Tab out of the popup closes it. One popup at
  a time (openPopup).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';
	import { openPopup } from './popups.svelte.ts';

	interface ChooserColumn {
		id: string;
		label: string;
		hideable?: boolean;
		visible?: boolean;
	}

	interface Props {
		columns: ChooserColumn[];
		onchange: (id: string, visible: boolean) => void;
		/** Button text; "Columns" by default */
		label?: string;
		/** Popup opens towards the start (default end, under a toolbar's end) */
		align?: 'start' | 'end';
	}

	let { columns, onchange, label, align = 'end' }: Props = $props();

	const popupId = $props.id();
	const text = $derived(label ?? tf('table.columns', 'Columns'));
	const hideable = $derived(columns.filter((c) => c.hideable));

	let open = $state(false);
	let anchor = $state<HTMLElement | null>(null);
	let button = $state<HTMLElement | null>(null);
	let popup = $state<HTMLElement | null>(null);
	let release: (() => void) | null = null;

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
		popup?.querySelector<HTMLInputElement>('input')?.focus();
	}

	function toggle() {
		if (open) close();
		else void show();
	}

	// While open: Escape, a click outside and focus leaving close it
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

	// Leaving the page with the popup open frees the one-popup slot
	$effect(() => () => release?.());
</script>

<div class="menu-anchor column-chooser" bind:this={anchor}>
	<Button
		bind:element={button}
		class="toolbar-menu-btn"
		aria-haspopup="true"
		aria-expanded={open}
		aria-controls={popupId}
		onclick={toggle}
	>
		<span>{text}</span><Icon name="expand_more" class="btn-caret" />
	</Button>
	<div
		bind:this={popup}
		id={popupId}
		class={['menu', align === 'end' && 'menu-end']}
		role="group"
		aria-label={text}
		hidden={!open}
	>
		{#each hideable as col (col.id)}
			<label class="checkbox-row">
				<input
					type="checkbox"
					checked={col.visible !== false}
					onchange={(e) => onchange(col.id, e.currentTarget.checked)}
				/>
				<span>{col.label}</span>
			</label>
		{/each}
	</div>
</div>

<style>
	.menu-anchor {
		position: relative;
		display: inline-flex;
		vertical-align: middle;
	}
	.menu-anchor :global(.btn-caret) {
		margin-inline-end: -4px;
		font-size: 18px;
	}
	.menu {
		position: absolute;
		top: calc(100% + var(--space-1));
		inset-inline-start: 0;
		z-index: var(--layer-menu);
		min-width: 180px;
		padding: var(--space-1) 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
	}
	.menu.menu-end {
		inset-inline-start: auto;
		inset-inline-end: 0;
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
</style>
