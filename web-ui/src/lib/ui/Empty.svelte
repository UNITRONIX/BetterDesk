<!--
  No value (GUIDE section 10). Without a word: one muted dash that screen
  readers hear as "None". With a word ("Never", "Unassigned"): that word,
  muted. Never in mono.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';

	let { word }: { word?: string } = $props();
</script>

{#if word}
	<span class="value-empty">{word}</span>
{:else}
	<span class="value-empty"
		><span aria-hidden="true">–</span><span class="sr-only">{tf('common.none', 'None')}</span></span
	>
{/if}

<style>
	.value-empty {
		color: var(--text-muted);
	}
</style>
