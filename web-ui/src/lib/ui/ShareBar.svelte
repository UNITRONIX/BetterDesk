<!--
  Share bar: one whole split into its parts (devices online / offline /
  banned). The legend names every part with its number, so colour is never
  the only way to read it; the bar itself is decorative. Parts with 0 stay
  in the legend but leave the bar; with nothing at all the bar is hidden.
  parts: { value, label, tone: ok | muted | warning | danger, href? }; with
  href the legend entry is a link (e.g. to the filtered list).
  label: names the legend list for screen readers.
-->
<script lang="ts" module>
	export interface SharePart {
		value: number;
		label: string;
		tone: 'ok' | 'muted' | 'warning' | 'danger';
		href?: string;
	}
</script>

<script lang="ts">
	import { formatNumber } from '#lib/i18n/format.ts';

	let { parts, label }: { parts: readonly SharePart[]; label?: string } = $props();

	const clean = $derived(parts.map((p) => ({ ...p, value: Math.max(0, Number(p.value) || 0) })));
	const total = $derived(clean.reduce((sum, p) => sum + p.value, 0));
</script>

<div class="share">
	{#if total > 0}
		<div class="share-bar" aria-hidden="true">
			{#each clean as part, i (i)}
				{#if part.value > 0}<span class="is-{part.tone}" style:flex-grow={part.value}></span>{/if}
			{/each}
		</div>
	{/if}
	<ul class="share-legend" aria-label={label}>
		{#each clean as part, i (i)}
			<li>
				<span class="key is-{part.tone}" aria-hidden="true"></span>
				{#if part.href}
					<a href={part.href}><strong>{formatNumber(part.value)}</strong> {part.label}</a>
				{:else}
					<span><strong>{formatNumber(part.value)}</strong> {part.label}</span>
				{/if}
			</li>
		{/each}
	</ul>
</div>

<style>
	/* The bar and its legend a section's gap apart, as on the old pages */
	.share {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.share-bar {
		display: flex;
		gap: 2px;
		height: 8px;
		border-radius: 2px;
		overflow: hidden;
		background: var(--hover);
	}
	.share-bar > span {
		display: block;
		height: 100%;
		min-width: 2px;
	}
	.share-legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
	}
	.share-legend li {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.key {
		width: 10px;
		height: 10px;
		border-radius: 2px;
	}
	.share-legend strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	.is-ok {
		background: var(--success);
	}
	.is-muted {
		background: var(--border);
	}
	.is-warning {
		background: var(--warning);
	}
	.is-danger {
		background: var(--danger);
	}
	@media (forced-colors: active) {
		.share-bar > span,
		.key {
			forced-color-adjust: none;
			border: 1px solid CanvasText;
		}
	}
</style>
