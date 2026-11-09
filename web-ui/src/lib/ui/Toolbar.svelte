<!--
  The row above a list (components.css .toolbar): search first (flexible,
  capped at 380px), then filters and other controls, then actions at the
  end. One height, one baseline; it wraps on narrow screens, where the
  search takes the full width.

    <Toolbar>
        {#snippet search()}<SearchField label={t('x.search')} bind:value={q} />{/snippet}
        <SegmentedFilter label={t('x.status')} options={...} bind:value={status} />
        {#snippet end()}<Checkbox inline label={t('x.show_deleted')} bind:checked={deleted} /><Button>...</Button>{/snippet}
    </Toolbar>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		search?: Snippet;
		/** Filters and other controls, after the search */
		children?: Snippet;
		/** Actions at the end of the row */
		end?: Snippet;
		class?: string;
	}

	let { search, children, end, class: cls = '' }: Props = $props();
</script>

<div class={['toolbar', cls]}>
	{#if search}<div class="toolbar-search">{@render search()}</div>{/if}
	{@render children?.()}
	{#if end}<div class="toolbar-end">{@render end()}</div>{/if}
</div>

<style>
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
	}
	.toolbar-search {
		display: flex;
		flex: 1 1 240px;
		max-width: 380px;
	}
	.toolbar-search > :global(*) {
		flex: 1;
	}
	.toolbar > :global(.form-select),
	.toolbar-end > :global(.form-select) {
		width: auto;
	}
	/* A checkbox here is one of the row's controls: the weight of the buttons
	   beside it, inline like them */
	.toolbar > :global(.checkbox-row),
	.toolbar-end > :global(.checkbox-row) {
		display: inline-flex;
		font-weight: var(--control-weight);
		white-space: nowrap;
	}
	.toolbar-end {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		margin-inline-start: auto;
	}
	@media (max-width: 640px) {
		.toolbar-search {
			flex-basis: 100%;
			max-width: none;
		}
		.toolbar-end {
			margin-inline-start: 0;
		}
	}
</style>
