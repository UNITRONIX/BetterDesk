<!--
  One section of a device panel tab: a heading (h3, the sheet title is the
  h2), an optional note under it, actions beside the heading (a small
  button such as "Read again"), then the content. The tab lays sections out
  one gap apart (DevicePanel .dp-tab); `danger` is the danger zone at the end of Actions.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		note?: string;
		danger?: boolean;
		class?: string;
		actions?: Snippet;
		children: Snippet;
	}

	let { title, note, danger = false, class: cls = '', actions, children }: Props = $props();
	const id = $props.id();
</script>

<section class={['dp-section', danger && 'is-danger', cls]} aria-labelledby="{id}-title">
	<div class="dp-section-head">
		<h3 class="dp-section-title" id="{id}-title">{title}</h3>
		{@render actions?.()}
	</div>
	{#if note}<p class="dp-section-note">{note}</p>{/if}
	{@render children()}
</section>

<style>
	.dp-section {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.dp-section-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.dp-section-title {
		margin: 0;
		font-size: var(--text-md);
		font-weight: 600;
	}
	.dp-section-note {
		margin: calc(-1 * var(--space-1)) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		max-width: var(--measure);
	}
	.is-danger {
		margin-top: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--danger);
	}
	.is-danger .dp-section-title {
		color: var(--danger);
	}
</style>
