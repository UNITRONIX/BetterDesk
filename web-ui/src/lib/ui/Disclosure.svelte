<!--
  A section that starts closed (components.css "Disclosure"): a native
  details/summary with the sidebar's chevron and a heading in the summary.
  `open` (bindable) opens it; `meta`: a short muted note at the end of the
  summary ("3 rules"). `level`: the heading level (2 by default). `id`
  goes on the details element, for links that jump to the section.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id?: string;
		title: string;
		meta?: string;
		level?: 2 | 3 | 4;
		open?: boolean;
		class?: string;
		ontoggle?: (open: boolean) => void;
		children: Snippet;
	}

	let {
		id,
		title,
		meta,
		level = 2,
		open = $bindable(false),
		class: cls = '',
		ontoggle,
		children
	}: Props = $props();
</script>

<details {id} class={['disclosure', cls]} bind:open ontoggle={() => ontoggle?.(open)}>
	<summary>
		<svelte:element this={`h${level}`} class="disclosure-title">{title}</svelte:element>
		{#if meta}<span class="summary-meta">{meta}</span>{/if}
	</summary>
	{@render children()}
</details>

<style>
	.disclosure > summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--row-h);
		padding: 0 var(--row-pad-x);
		margin: 0 calc(-1 * var(--row-pad-x));
		border-radius: var(--radius);
		cursor: pointer;
		list-style: none;
	}
	.disclosure > summary::-webkit-details-marker {
		display: none;
	}
	.disclosure > summary:hover {
		background: var(--bg-subtle);
	}
	/* Closed: the chevron points to the end side; open: down */
	.disclosure > summary::before {
		content: 'expand_more';
		font-family: 'Material Symbols Outlined';
		font-size: 20px;
		line-height: 1;
		color: var(--text-muted);
		transform: rotate(-90deg);
		transition: transform var(--motion);
		font-feature-settings: 'liga';
	}
	.disclosure:dir(rtl) > summary::before {
		transform: rotate(90deg);
	}
	.disclosure[open] > summary::before {
		transform: none;
	}
	.disclosure-title {
		margin: 0;
	}
	.summary-meta {
		margin-inline-start: auto;
		color: var(--text-muted);
	}
	.disclosure[open] > summary {
		margin-bottom: var(--space-3);
	}
</style>
