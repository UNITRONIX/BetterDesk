<!--
  Tabs (components.css "Tabs"): parts of one thing, such as a detail panel
  or a settings page. The open tab is underlined.

  tabs: { id, label, disabled? }. `value` (bindable) is the open tab's id;
  `onchange(id)` runs when someone picks another one. Keeping it in the URL
  (?tab=) is the page's job. `label` names the tab list.
  Keyboard: one tab stop; Left and Right move and open (mirrored in RTL),
  Home and End go to the first and last. The `children` snippet gets the
  open tab's id and renders inside the tab panel; without it, the page
  places the content itself.
-->
<script module lang="ts">
	export interface TabItem {
		id: string;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		tabs: TabItem[];
		value?: string;
		label?: string;
		class?: string;
		onchange?: (id: string) => void;
		children?: Snippet<[string]>;
	}

	let { tabs, value = $bindable(), label, class: cls = '', onchange, children }: Props = $props();

	const uid = $props.id();
	const panelId = `${uid}-panel`;
	const tabId = (i: number) => `${uid}-tab-${i}`;
	// Without a value, the first tab that can be opened is open
	const current = $derived(value ?? tabs.find((t) => !t.disabled)?.id ?? '');
	const currentIndex = $derived(tabs.findIndex((t) => t.id === current));
	let list = $state<HTMLElement | null>(null);

	function pick(id: string) {
		if (id === current) return;
		value = id;
		onchange?.(id);
	}

	function onkeydown(event: KeyboardEvent, i: number) {
		const enabled = tabs.map((t, k) => (t.disabled ? -1 : k)).filter((k) => k >= 0);
		if (!enabled.length) return;
		const pos = enabled.indexOf(i);
		const rtl = list ? getComputedStyle(list).direction === 'rtl' : false;
		let target: number | undefined;
		if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
			const step = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
			target = enabled[(pos + step + enabled.length) % enabled.length];
		} else if (event.key === 'Home') target = enabled[0];
		else if (event.key === 'End') target = enabled[enabled.length - 1];
		if (target === undefined) return;
		event.preventDefault();
		const tab = tabs[target];
		if (!tab) return;
		pick(tab.id);
		list?.querySelectorAll<HTMLElement>('[role="tab"]')[target]?.focus();
	}
</script>

<div bind:this={list} class={['tabs', cls]} role="tablist" aria-label={label}>
	{#each tabs as tab, i (tab.id)}
		<button
			type="button"
			class="tab"
			role="tab"
			id={tabId(i)}
			aria-selected={tab.id === current}
			aria-controls={children && tab.id === current ? panelId : undefined}
			tabindex={tab.id === current ? 0 : -1}
			disabled={tab.disabled || undefined}
			onclick={() => pick(tab.id)}
			onkeydown={(e) => onkeydown(e, i)}
		>
			{tab.label}
		</button>
	{/each}
</div>
{#if children}
	<div
		role="tabpanel"
		id={panelId}
		aria-labelledby={currentIndex >= 0 ? tabId(currentIndex) : undefined}
		tabindex="0"
	>
		{@render children(current)}
	</div>
{/if}

<style>
	/* The strip scrolls sideways, which clips anything outside it. It reaches
	   --tab-ring-room past the page edge on both sides so a focus ring has
	   room there, and draws its rule only under the content box, so the rule
	   and the first tab still start on the page's edge. */
	.tabs {
		--tab-ring-room: 6px;
		display: flex;
		gap: var(--space-4);
		margin-inline: calc(-1 * var(--tab-ring-room));
		padding-inline: var(--tab-ring-room);
		scroll-padding-inline: var(--tab-ring-room);
		background: linear-gradient(var(--rule), var(--rule)) no-repeat bottom / 100% 1px content-box;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		position: relative;
		display: inline-flex;
		flex: none;
		align-items: center;
		min-height: var(--control-h);
		padding: 0;
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-weight: var(--control-weight);
		white-space: nowrap;
		cursor: pointer;
		text-decoration: none;
	}
	.tab:hover {
		color: var(--text);
	}
	.tab[aria-selected='true'] {
		border-bottom-color: var(--accent);
		color: var(--text);
	}
	.tab:disabled {
		color: var(--text-muted);
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* Focus: the usual ring around the label, inside the tab top and bottom
	   (clear of the underline, so it never reads as "selected") and
	   --tab-ring-room past the label at the sides */
	.tab:focus-visible {
		outline: none;
	}
	.tab:focus-visible::after {
		content: '';
		position: absolute;
		inset-block: 3px;
		inset-inline: calc(-1 * var(--tab-ring-room, 6px));
		border: var(--focus-ring);
		border-radius: var(--control-radius);
		pointer-events: none;
	}
	:global(html[data-a11y-strong-focus='true']) .tab:focus-visible::after {
		border-width: 3px;
	}
</style>
