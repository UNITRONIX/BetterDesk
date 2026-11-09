<!--
  Several tags: a list or comma-separated text ("office, finance"). Blank
  entries are dropped; no tags at all gives Empty (dash, or the `empty` word).
-->
<script lang="ts">
	import Empty from './Empty.svelte';
	import Tag from './Tag.svelte';

	let {
		tags,
		empty
	}: { tags: readonly (string | null | undefined)[] | string | null | undefined; empty?: string } = $props();

	const items = $derived(
		(Array.isArray(tags) ? tags : String(tags ?? '').split(','))
			.map((s) => String(s ?? '').trim())
			.filter(Boolean)
	);
</script>

{#if items.length}
	<span class="tag-set">
		{#each items as item, i (i)}<Tag label={item} />{/each}
	</span>
{:else}
	<Empty word={empty} />
{/if}

<style>
	.tag-set {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
		max-width: 100%;
		vertical-align: middle;
	}
</style>
