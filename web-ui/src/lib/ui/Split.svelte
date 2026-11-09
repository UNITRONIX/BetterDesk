<!--
  Split view: a list on the start side, the open item beside it (chat,
  tickets, folders). Below 768 px one pane shows at a time: the list, or
  the item while `open` is true; the item pane then needs its own way back
  to the list (the page's Back button sets open to false).
  list, detail: the two panes. listLabel: names the list pane.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		listLabel?: string;
		list: Snippet;
		detail: Snippet;
	}

	let { open = false, listLabel, list, detail }: Props = $props();
</script>

<div class={['split', open && 'is-detail-open']}>
	<div class="split-list" role={listLabel ? 'region' : undefined} aria-label={listLabel}>
		{@render list()}
	</div>
	<div class="split-detail">
		{@render detail()}
	</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
		min-height: 480px;
		border-top: 1px solid var(--rule);
	}
	.split-list {
		border-inline-end: 1px solid var(--rule);
		overflow-y: auto;
		min-width: 0;
	}
	/* A pane edge is the row edge: rows in it don't hang */
	.split-list :global(:is(.list, .table-scroll)) {
		margin-inline: 0;
	}
	.split-detail {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	@media (max-width: 767px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.split-list {
			border-inline-end: 0;
		}
		.is-detail-open .split-list,
		.split:not(.is-detail-open) .split-detail {
			display: none;
		}
	}
</style>
