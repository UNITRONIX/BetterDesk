<!--
  A row in a RowList that opens another site in a new tab ("Download
  RustDesk"): title, a line under it, and the open-in-new mark at the end.
  ListRow has no way to open a new tab; this is its link row with
  target="_blank" (styles from ListRow). Screen readers hear that it opens
  a new tab.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';

	let { href, title, sub }: { href: string; title: string; sub?: string } = $props();
</script>

<li class="row-item">
	<a class="list-row" {href} target="_blank" rel="noopener noreferrer">
		<span class="row-main">
			<span class="row-title">{title}</span>
			{#if sub}<span class="row-sub">{sub}</span>{/if}
		</span>
		<span class="sr-only">({tf('common.opens_in_new_tab', 'opens in a new tab')})</span>
		<Icon name="open_in_new" class="row-chevron" />
	</a>
</li>

<style>
	.row-item {
		display: block;
	}
	.list-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		color: var(--text);
		text-decoration: none;
	}
	.list-row:hover {
		background: var(--bg-subtle);
		color: var(--text);
	}
	.row-main {
		flex: 1;
		min-width: 0;
	}
	.row-title {
		font-weight: 600;
	}
	.row-sub {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.list-row :global(.row-chevron) {
		color: var(--text-muted);
		font-size: 20px;
	}
</style>
