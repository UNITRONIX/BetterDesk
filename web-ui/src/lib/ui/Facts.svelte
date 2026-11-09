<!--
  Facts: label and value rows in a definition list (base.css .facts, one
  column on narrow screens). items: { label, value, empty? }; value is text
  (shown as text, never markup), a number, or a snippet for a component
  (Status, Time, ValueCopy ...). A blank value shows Empty (dash, or the
  item's `empty` word).
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface Fact {
		label: string;
		value: string | number | null | undefined | Snippet;
		empty?: string;
	}
</script>

<script lang="ts">
	import Empty from './Empty.svelte';

	let { items, label }: { items: readonly Fact[]; label?: string } = $props();
</script>

<dl class="facts" aria-label={label}>
	{#each items as item, i (i)}
		<dt>{item.label}</dt>
		<dd>
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
