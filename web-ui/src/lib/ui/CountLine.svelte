<!--
  A count in a sentence (components.css .count-line): "6 devices, 3 online".
  The numbers have the full text colour and tabular figures, the words are
  muted. Give the translated sentence with its placeholders and the numbers:

    <CountLine text={plural('devices.count_line', n)} values={{ count: n, online }} />

  where the string reads "{count} devices, {online} online". Numbers are
  formatted for the console language. Or pass your own markup as children
  (numbers in <strong>).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatNumber } from '#lib/i18n/format.ts';

	interface Props {
		text?: string;
		values?: Record<string, number | string>;
		class?: string;
		children?: Snippet;
	}

	let { text = '', values = {}, class: cls = '', children }: Props = $props();

	// "{count} devices" → [{ text: '' }, { num: '6' }, { text: ' devices' }]
	const parts = $derived.by(() => {
		const out: { text?: string; num?: string }[] = [];
		let last = 0;
		for (const m of text.matchAll(/\{(\w+)\}/g)) {
			const v = values[m[1] ?? ''];
			if (v === undefined) continue;
			out.push({ text: text.slice(last, m.index) });
			out.push({ num: typeof v === 'number' ? formatNumber(v) : v });
			last = m.index + m[0].length;
		}
		out.push({ text: text.slice(last) });
		return out;
	});
</script>

<p class={['count-line', cls]}>
	{#if children}
		{@render children()}
	{:else}
		{#each parts as p, i (i)}{#if p.num !== undefined}<strong>{p.num}</strong>{:else}{p.text}{/if}{/each}
	{/if}
</p>

<style>
	.count-line {
		margin: 0;
		color: var(--text-muted);
	}
	.count-line :global(strong) {
		color: var(--text);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
</style>
