<!--
  Dangerous actions apart at the end of a page (components.css .danger-zone):
  a heading in the danger colour, then rows with a title, the consequence in
  one plain sentence and a quiet danger button (its label ends in "…" when
  it asks for confirmation, which the page does with a danger dialog). The
  button is described by the consequence sentence.

    <DangerZone title={t('x.reset')} rows={[{ title, consequence, action: t('x.regenerate'), onclick }]} />
-->
<script module lang="ts">
	export interface DangerRow {
		title: string;
		consequence: string;
		/** The button's label */
		action: string;
		onclick: () => void;
		disabled?: boolean;
		busy?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Button from './Button.svelte';

	interface Props {
		title: string;
		/** One sentence under the heading */
		note?: string;
		rows: DangerRow[];
		level?: 2 | 3;
		class?: string;
		/** Anything after the rows */
		children?: Snippet;
	}

	let { title, note, rows, level = 2, class: cls = '', children }: Props = $props();

	const uid = $props.id();
	const headId = `danger-${uid}`;
</script>

<section class={['danger-zone', cls]} aria-labelledby={headId}>
	<svelte:element this={`h${level}`} class="danger-title" id={headId}>{title}</svelte:element>
	{#if note}<p class="danger-note">{note}</p>{/if}
	<ul class="list">
		{#each rows as row, i (i)}
			<li class="list-row">
				<span class="row-main">
					<span class="row-title">{row.title}</span>
					<span class="row-sub" id="{headId}-{i}">{row.consequence}</span>
				</span>
				<span class="row-end">
					<Button
						variant="danger-quiet"
						disabled={row.disabled}
						busy={row.busy}
						aria-describedby="{headId}-{i}"
						onclick={row.onclick}>{row.action}</Button
					>
				</span>
			</li>
		{/each}
	</ul>
	{@render children?.()}
</section>

<style>
	.danger-zone {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
	.danger-title {
		margin: 0;
		color: var(--danger);
	}
	.danger-note {
		margin: calc(-1 * var(--space-2)) 0 0;
		color: var(--text-muted);
		max-width: var(--measure);
	}
	/* Row list (components.css .list): rows on rules, padding hung outside
	   the column so the titles line up with the heading */
	.list {
		margin: 0 calc(-1 * var(--row-pad-x));
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.list-row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--row-h);
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
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
	.row-end {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--space-2);
	}
</style>
