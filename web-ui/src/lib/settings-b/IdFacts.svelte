<!--
  ui/Facts with an id on each value, so the settings search and #<id>
  links (settings/search-index.ts) can point at one fact, as on the old
  page (<dd id="backup-stat-users">). Same markup and look as Facts; goes
  away when Facts takes an id per item.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface IdFact {
		label: string;
		value: string | number | null | undefined | Snippet;
		id?: string;
		empty?: string;
	}
</script>

<script lang="ts">
	import Empty from '#lib/ui/Empty.svelte';

	let { items, label }: { items: readonly IdFact[]; label?: string } = $props();
</script>

<dl class="facts" aria-label={label}>
	{#each items as item, i (i)}
		<dt>{item.label}</dt>
		<dd id={item.id}>
			{#if typeof item.value === 'function'}
				{@render item.value()}
			{:else if item.value === null || item.value === undefined || String(item.value).trim() === ''}
				<Empty word={item.empty} />
			{:else}
				{item.value}
			{/if}
		</dd>
	{/each}
</dl>
