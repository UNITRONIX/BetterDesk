<!--
  Meter: the share of a limit (disk, quota), always with the number as
  text. value of max (default 100); the bar turns warning from `high`
  (85 %) and danger from `full` (95 %). text: what to show instead of the
  percentage ("31 of 50", a duration). No value gives Empty.
  The bar is decorative: the text carries the number.
-->
<script lang="ts">
	import { formatPercent } from '#lib/i18n/format.ts';
	import Empty from './Empty.svelte';

	interface Props {
		value: number | null | undefined;
		max?: number;
		text?: string;
		high?: number;
		full?: number;
		empty?: string;
	}

	let { value, max = 100, text, high = 85, full = 95, empty }: Props = $props();

	const pct = $derived(
		value === null || value === undefined || !Number.isFinite(value) || !(max > 0)
			? null
			: Math.max(0, Math.min(100, (value / max) * 100))
	);
</script>

{#if pct === null}
	<Empty word={empty} />
{:else}
	<span class={['meter', pct >= full ? 'is-full' : pct >= high && 'is-high']}
		><span class="meter-bar" aria-hidden="true"><span class="meter-fill" style:width="{pct}%"></span></span
		><span class="meter-value">{text ?? formatPercent(pct)}</span></span
	>
{/if}

<style>
	.meter {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.meter-bar {
		flex: 1;
		min-width: 60px;
		height: 6px;
		border-radius: 1px;
		background: var(--hover);
		overflow: hidden;
	}
	.meter-fill {
		display: block;
		height: 100%;
		background: var(--text-muted);
	}
	.is-high .meter-fill {
		background: var(--warning);
	}
	.is-full .meter-fill {
		background: var(--danger);
	}
	.meter-value {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
