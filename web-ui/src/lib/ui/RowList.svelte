<!--
  Row list: the one list pattern for things people open or act on. Rows on
  rules, the same height and inset as table rows and facts; the rows hang
  their padding outside the column so titles line up with headings.
  Children are ListRow components. label: names the list when no heading
  does.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label?: string; children: Snippet } = $props();
</script>

<ul class="list" aria-label={label}>
	{@render children()}
</ul>

<style>
	.list {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
</style>
