<!--
  A share bar whose legend entries filter the list beside it (help
  requests and tickets "By status"). The same look as ui/ShareBar.svelte,
  plus two things it can't do yet: a legend entry is a link-style button
  that picks a filter, and an "accent" tone for waiting / in progress (the
  colour of those status marks). Kept here until ShareBar takes both.
  The bar is decorative; the legend names every part with its number.
-->
<script lang="ts" module>
	export interface ShareFilterPart<V extends string> {
		value: V;
		count: number;
		label: string;
		tone: 'accent' | 'ok' | 'muted' | 'warning' | 'danger';
	}
</script>

<script lang="ts" generics="V extends string">
	import { formatNumber } from '#lib/i18n/format.ts';
	import Button from '#lib/ui/Button.svelte';

	interface Props {
		parts: readonly ShareFilterPart<V>[];
		label?: string;
		/** The filter that is on, so its entry reads as pressed */
		current?: V | null;
		onpick: (value: V) => void;
	}

	let { parts, label, current = null, onpick }: Props = $props();

	const total = $derived(parts.reduce((sum, p) => sum + Math.max(0, p.count), 0));
</script>

<div class="share">
	{#if total > 0}
		<div class="share-bar" aria-hidden="true">
			{#each parts as part (part.value)}
				{#if part.count > 0}<span class="is-{part.tone}" style:flex-grow={part.count}></span>{/if}
			{/each}
		</div>
	{/if}
	<ul class="share-legend" aria-label={label}>
		{#each parts as part (part.value)}
			<li>
				<span class="key is-{part.tone}" aria-hidden="true"></span>
				<Button
					variant="link"
					class="share-filter"
					aria-pressed={current === part.value}
					onclick={() => onpick(part.value)}><strong>{formatNumber(part.count)}</strong> {part.label}</Button
				>
			</li>
		{/each}
	</ul>
</div>

<style>
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
	/* Links that pick a filter, in regular weight; the one that is on drops its underline */
	.share-legend :global(.share-filter) {
		font-weight: 400;
	}
	.share-legend :global(.share-filter[aria-pressed='true']) {
		text-decoration: none;
	}
	.share-legend strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}
	@media (pointer: coarse) {
		.share-legend :global(.share-filter) {
			display: inline-flex;
			align-items: center;
			min-height: 44px;
		}
	}
	.is-accent {
		background: var(--accent);
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
