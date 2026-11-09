<!--
  One tool: a disclosure with its title and one sentence under it, then a
  one-column form and its result. Each tool measures its own width, so the
  form and its result sit side by side whenever the tool is wide enough.
  (ui/Disclosure puts its meta at the end of the title line; a tool needs
  the sentence under the title.)
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		id: string;
		title: string;
		desc: string;
		open?: boolean;
		/** The form */
		children: Snippet;
		/** What the last run returned (empty: nothing shown) */
		result?: Snippet;
	}

	let { id, title, desc, open = $bindable(false), children, result }: Props = $props();
</script>

<details class="tool" id="tool-{id}" bind:open>
	<summary>
		<span class="tool-summary">
			<h2 class="tool-title">{title}</h2>
			<span class="tool-desc">{desc}</span>
		</span>
	</summary>
	<div class="tool-body">
		<div class="tool-form">{@render children()}</div>
		{#if result}<div class="tool-result" aria-live="polite">{@render result()}</div>{/if}
	</div>
</details>

<style>
	.tool {
		border-bottom: 1px solid var(--rule);
		container-type: inline-size;
	}
	.tool > summary {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		min-height: var(--row-h);
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: var(--row-pad-y) var(--row-pad-x);
		cursor: pointer;
		list-style: none;
	}
	.tool > summary::-webkit-details-marker {
		display: none;
	}
	.tool > summary:hover {
		background: var(--bg-subtle);
	}
	/* Closed: the chevron points to the end side; open: down */
	.tool > summary::before {
		content: 'expand_more';
		flex: none;
		margin-top: 1px;
		font-family: 'Material Symbols Outlined';
		font-size: 20px;
		line-height: 1;
		color: var(--text-muted);
		transform: rotate(-90deg);
		transition: transform var(--motion);
		font-feature-settings: 'liga';
	}
	.tool:dir(rtl) > summary::before {
		transform: rotate(90deg);
	}
	.tool[open] > summary::before {
		transform: none;
	}
	.tool-summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.tool-title {
		margin: 0;
		font-size: var(--text-base);
	}
	.tool-desc {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* The body lines up with the title, past the chevron */
	.tool-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		max-width: calc(var(--measure) + 20px + var(--space-2));
		padding: var(--space-2) 0 var(--space-5);
		padding-inline-start: calc(20px + var(--space-2));
	}
	.tool-form,
	.tool-result {
		min-width: 0;
	}
	.tool-result:empty {
		display: none;
	}
	/* Wide tools: the form and its result side by side */
	@container (min-width: 54rem) {
		.tool-body {
			display: grid;
			grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
			align-items: start;
			gap: var(--space-4) var(--space-7);
			max-width: none;
		}
	}
	@media (max-width: 640px) {
		.tool-body {
			padding-inline-start: 0;
		}
	}
</style>
