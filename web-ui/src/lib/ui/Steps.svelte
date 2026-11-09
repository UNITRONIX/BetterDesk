<!--
  Steps: a real sequence, numbered by the list. items: text or snippets
  (a step with a link or a code value in it).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { items }: { items: readonly (string | Snippet)[] } = $props();
</script>

<ol class="steps">
	{#each items as item, i (i)}
		<li>
			{#if typeof item === 'function'}{@render item()}{:else}{item}{/if}
		</li>
	{/each}
</ol>

<style>
	.steps {
		margin: 0;
		padding-inline-start: 1.5em;
	}
	.steps > li {
		padding: var(--space-1) 0;
	}
	.steps > li::marker {
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
