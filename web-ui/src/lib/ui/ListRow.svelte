<!--
  One row of a RowList. A row that goes somewhere (href) or does one thing
  (onclick) is one click target over the whole row, with a hover background
  and a chevron when it navigates. With `actions` as well, the title is the
  target and stretches over the row, and the actions sit above it, so the
  row still opens with a click anywhere and the buttons stay separate
  controls.
  title, sub (text or snippet): the two lines. count: a number that leads
  the row ("3  Enrollment requests"). mark: a dot before it (warning,
  danger, info). start: leading content (an avatar, an OS mark). end:
  text at the end inside the target (a time, a status). actions: buttons
  or a row menu. chevron: defaults to on for href. current: the open item
  in a Split list (aria-current). empty: a muted "nothing here" row.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatNumber } from '#lib/i18n/format.ts';
	import Icon from './Icon.svelte';

	interface Props {
		title: string;
		sub?: string | Snippet;
		count?: number | string;
		mark?: 'warning' | 'danger' | 'info';
		start?: Snippet;
		end?: Snippet;
		actions?: Snippet;
		href?: string;
		onclick?: (event: MouseEvent) => void;
		chevron?: boolean;
		current?: boolean;
		empty?: boolean;
	}

	let {
		title,
		sub,
		count,
		mark,
		start,
		end,
		actions,
		href,
		onclick,
		chevron = !!href,
		current = false,
		empty = false
	}: Props = $props();

	const targeted = $derived(!!href || !!onclick);
	const countText = $derived(typeof count === 'number' ? formatNumber(count) : count);
</script>

{#snippet lead()}
	{#if mark}<span class={['row-mark', mark !== 'warning' && mark]} aria-hidden="true"></span>{/if}
	{#if start}{@render start()}{/if}
	{#if countText !== undefined && countText !== ''}<span class="row-count">{countText}</span>{/if}
{/snippet}

{#snippet subLine()}
	{#if sub}<span class="row-sub"
			>{#if typeof sub === 'function'}{@render sub()}{:else}{sub}{/if}</span
		>{/if}
{/snippet}

{#snippet tail()}
	{#if end}<span class="row-end">{@render end()}</span>{/if}
{/snippet}

{#snippet chevronMark()}
	{#if chevron}<Icon name="chevron_right" class="row-chevron" />{/if}
{/snippet}

{#if empty}
	<li class="list-row is-empty">{title}</li>
{:else if targeted && !actions}
	<li class="row-item">
		{#if href}
			<a class="list-row" {href} aria-current={current || undefined}>
				{@render lead()}
				<span class="row-main"><span class="row-title">{title}</span>{@render subLine()}</span>
				{@render tail()}
				{@render chevronMark()}
			</a>
		{:else}
			<button type="button" class="list-row is-link" aria-current={current || undefined} {onclick}>
				{@render lead()}
				<span class="row-main"><span class="row-title">{title}</span>{@render subLine()}</span>
				{@render tail()}
				{@render chevronMark()}
			</button>
		{/if}
	</li>
{:else}
	<li class={['list-row', targeted && 'has-target', current && 'is-current']}>
		{@render lead()}
		<span class="row-main">
			{#if href}
				<a class="row-title row-target" {href} aria-current={current || undefined}>{title}</a>
			{:else if onclick}
				<button type="button" class="row-title row-target" aria-current={current || undefined} {onclick}
					>{title}</button
				>
			{:else}
				<span class="row-title">{title}</span>
			{/if}
			{@render subLine()}
		</span>
		{@render tail()}
		{#if actions}<span class="row-actions">{@render actions()}</span>{/if}
		{@render chevronMark()}
	</li>
{/if}

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
	/* A whole-row button looks like the link rows */
	button.list-row {
		width: 100%;
		border: 0;
		border-bottom: 1px solid var(--rule);
		background: transparent;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	a.list-row:hover,
	.list-row.is-link:hover,
	.list-row.has-target:hover,
	.list-row[aria-current='true'],
	.list-row.is-current {
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
	.row-end {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-muted);
	}
	.list-row :global(.row-chevron) {
		color: var(--text-muted);
		font-size: 20px;
	}
	.list-row :global(.row-chevron:dir(rtl)) {
		transform: scaleX(-1);
	}
	.list-row.is-empty {
		color: var(--text-muted);
	}

	/* A count that leads a row: "3  Enrollment requests" */
	.row-count {
		min-width: 2ch;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		text-align: end;
	}
	.row-mark {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		border-radius: 50%;
		background: var(--warning);
	}
	.row-mark.danger {
		background: var(--danger);
	}
	.row-mark.info {
		background: var(--accent);
	}

	/* Title as the row's one target, stretched over the row; actions above it */
	.has-target {
		position: relative;
	}
	.row-target {
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-align: start;
		text-decoration: none;
		cursor: pointer;
	}
	.row-target::after {
		content: '';
		position: absolute;
		inset: 0;
	}
	.row-target:focus-visible {
		outline: none;
	}
	.row-target:focus-visible::after {
		outline: var(--focus-ring);
		outline-offset: calc(-1 * var(--focus-offset) - 2px);
	}
	.row-actions {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
</style>
