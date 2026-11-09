<!--
  Page controls under a list (components.css "Pagination"): previous, page
  numbers as small plain buttons (the current one marked like a selected
  segment, aria-current="page"), next. Shows the first and last page, the
  pages next to the current one, and "…" for the rest.

  `page` (bindable, from 1) and either `pageCount` or `total` with
  `pageSize`. `onchange(page)` runs on a new page. `pageSizes` adds a
  page-size select (bindable `pageSize`, `onpagesize(size)`).
  `summary` is the text at the start ("Showing 1–25 of 312"); without it
  and with `total`, it is built from pagination.showing. `label` names the
  page navigation.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import Icon from './Icon.svelte';
	import Select from './Select.svelte';

	interface Props {
		page?: number;
		pageCount?: number;
		total?: number;
		pageSize?: number;
		pageSizes?: number[];
		summary?: string;
		label?: string;
		class?: string;
		onchange?: (page: number) => void;
		onpagesize?: (size: number) => void;
	}

	let {
		page = $bindable(1),
		pageCount,
		total,
		pageSize = $bindable(25),
		pageSizes,
		summary,
		label,
		class: cls = '',
		onchange,
		onpagesize
	}: Props = $props();

	const uid = $props.id();
	const pages = $derived(Math.max(1, pageCount ?? Math.ceil((total ?? 0) / Math.max(1, pageSize))));
	const current = $derived(Math.min(Math.max(1, page), pages));

	const text = $derived.by(() => {
		if (summary !== undefined) return summary;
		if (total === undefined) return '';
		const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
		const end = Math.min(current * pageSize, total);
		return tf('pagination.showing', 'Showing {start}–{end} of {total}', {
			start: formatNumber(start),
			end: formatNumber(end),
			total: formatNumber(total)
		});
	});

	/** Page numbers to show, with null for a gap */
	const items = $derived.by(() => {
		const keep = [...new Set([1, current - 1, current, current + 1, pages])]
			.filter((p) => p >= 1 && p <= pages)
			.sort((a, b) => a - b);
		const out: (number | null)[] = [];
		for (const p of keep) {
			const prev = out.at(-1);
			if (typeof prev === 'number' && p - prev === 2) out.push(prev + 1);
			else if (typeof prev === 'number' && p - prev > 2) out.push(null);
			out.push(p);
		}
		return out;
	});

	const sizeOptions = $derived((pageSizes ?? []).map((n) => ({ value: n, label: formatNumber(n) })));

	function go(p: number) {
		if (p < 1 || p > pages || p === current) return;
		page = p;
		onchange?.(p);
	}

	function setSize(size: number | undefined) {
		if (size === undefined || size === pageSize) return;
		pageSize = size;
		onpagesize?.(size);
	}
</script>

<div class={['pagination-bar', cls]}>
	{#if text}<p class="pagination-summary">{text}</p>{/if}
	{#if pageSizes?.length}
		<span class="pagination-size">
			<label for="{uid}-size">{tf('pagination.per_page', 'Per page')}</label>
			<Select id="{uid}-size" small options={sizeOptions} bind:value={() => pageSize, setSize} />
		</span>
	{/if}
	{#if pages > 1}
		<nav class="pagination" aria-label={label ?? tf('pagination.label', 'Pages')}>
			<button
				type="button"
				class="pagination-btn"
				disabled={current <= 1}
				aria-label={tf('pagination.previous', 'Previous page')}
				onclick={() => go(current - 1)}
			>
				<Icon name="chevron_left" class="is-directional" />
			</button>
			{#each items as p, i (p ?? `gap-${i}`)}
				{#if p === null}
					<span class="pagination-ellipsis" aria-hidden="true">…</span>
				{:else}
					<button
						type="button"
						class="pagination-btn"
						aria-current={p === current ? 'page' : undefined}
						aria-label={tf('pagination.page', 'Page {page}', { page: formatNumber(p) })}
						onclick={() => go(p)}
					>
						{formatNumber(p)}
					</button>
				{/if}
			{/each}
			<button
				type="button"
				class="pagination-btn"
				disabled={current >= pages}
				aria-label={tf('pagination.next', 'Next page')}
				onclick={() => go(current + 1)}
			>
				<Icon name="chevron_right" class="is-directional" />
			</button>
		</nav>
	{/if}
</div>

<style>
	.pagination-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		padding-block: var(--space-3);
	}
	.pagination-summary {
		margin: 0;
		margin-inline-end: auto;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.pagination-size {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.pagination-size :global(.form-select) {
		width: auto;
	}
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
	}
	.pagination-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: var(--control-h-sm);
		min-height: var(--control-h-sm);
		padding: 0 var(--control-pad-x-sm);
		border: 1px solid transparent;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: var(--control-weight);
		line-height: var(--control-leading);
		cursor: pointer;
	}
	.pagination-btn:hover:not(:disabled) {
		background: var(--hover);
	}
	.pagination-btn[aria-current='page'] {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.pagination-btn:disabled {
		color: var(--text-muted);
		cursor: default;
	}
	.pagination-btn > :global(.material-icons) {
		font-size: 18px;
		vertical-align: middle;
	}
	/* Previous and next point the other way in right-to-left languages */
	.pagination-btn:dir(rtl) > :global(.is-directional) {
		transform: scaleX(-1);
	}
	.pagination-ellipsis {
		padding: 0 var(--space-1);
		color: var(--text-muted);
	}
</style>
