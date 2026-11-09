<!--
  A report's blocks (lib/people/reports.ts): sentences, facts, tables and
  sections with a heading. Every value is text or a mark component.
-->
<script lang="ts">
	import type { Block, Cell, TableBlock } from '#lib/people/reports.ts';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';

	let { blocks, label }: { blocks: Block[]; label: string } = $props();

	type Row = { key: string; cells: Cell[] };
	const EMPTY: Cell = { kind: 'empty' };

	/* One snippet per column position (the Table gives a cell snippet only the row) */
	const COLUMN_CELLS = [c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15];

	function tableColumns(b: TableBlock): Column<Row>[] {
		return b.columns.slice(0, COLUMN_CELLS.length).map((c, i) => ({
			id: `c${i}`,
			label: c.label,
			align: c.num ? ('num' as const) : undefined,
			cell: COLUMN_CELLS[i] as Column<Row>['cell']
		}));
	}
</script>

{#snippet cell(c: Cell)}{#if c.kind === 'text'}{c.text}{:else if c.kind === 'value'}<ValueCopy
			value={c.text}
		/>{:else if c.kind === 'time'}<Time
			value={c.value}
			relative={c.relative ?? true}
		/>{:else if c.kind === 'tag'}<Tag label={c.text} />{:else if c.kind === 'status'}<Status
			tone={c.tone}
			label={c.text}
		/>{:else if c.kind === 'user'}<User user={c.text} />{:else}<Empty />{/if}{/snippet}

{#snippet c0(r: Row)}{@render cell(r.cells[0] ?? EMPTY)}{/snippet}
{#snippet c1(r: Row)}{@render cell(r.cells[1] ?? EMPTY)}{/snippet}
{#snippet c2(r: Row)}{@render cell(r.cells[2] ?? EMPTY)}{/snippet}
{#snippet c3(r: Row)}{@render cell(r.cells[3] ?? EMPTY)}{/snippet}
{#snippet c4(r: Row)}{@render cell(r.cells[4] ?? EMPTY)}{/snippet}
{#snippet c5(r: Row)}{@render cell(r.cells[5] ?? EMPTY)}{/snippet}
{#snippet c6(r: Row)}{@render cell(r.cells[6] ?? EMPTY)}{/snippet}
{#snippet c7(r: Row)}{@render cell(r.cells[7] ?? EMPTY)}{/snippet}
{#snippet c8(r: Row)}{@render cell(r.cells[8] ?? EMPTY)}{/snippet}
{#snippet c9(r: Row)}{@render cell(r.cells[9] ?? EMPTY)}{/snippet}
{#snippet c10(r: Row)}{@render cell(r.cells[10] ?? EMPTY)}{/snippet}
{#snippet c11(r: Row)}{@render cell(r.cells[11] ?? EMPTY)}{/snippet}
{#snippet c12(r: Row)}{@render cell(r.cells[12] ?? EMPTY)}{/snippet}
{#snippet c13(r: Row)}{@render cell(r.cells[13] ?? EMPTY)}{/snippet}
{#snippet c14(r: Row)}{@render cell(r.cells[14] ?? EMPTY)}{/snippet}
{#snippet c15(r: Row)}{@render cell(r.cells[15] ?? EMPTY)}{/snippet}

{#snippet render(list: Block[], depth: number)}
	{#each list as b, i (i)}
		{#if b.kind === 'lead'}
			<p class="lead">{b.text}</p>
		{:else if b.kind === 'facts'}
			<Facts items={b.items.map(([k, v]) => ({ label: k, value: v }))} />
		{:else if b.kind === 'state'}
			<States message={b.text} />
		{:else if b.kind === 'note'}
			<p class="note">
				{b.text}
				{#if b.link}<a href={b.link.href}>{b.link.text}</a>{/if}
			</p>
		{:else if b.kind === 'table'}
			<Table
				rows={b.rows.map((cells, n) => ({ key: String(n), cells }))}
				columns={tableColumns(b)}
				key={(r) => r.key}
				{label}
			/>
		{:else}
			<section class="block">
				<h3>{b.title}</h3>
				{@render render(b.blocks, depth + 1)}
			</section>
		{/if}
	{/each}
{/snippet}

<div class="report-output">{@render render(blocks, 0)}</div>

<style>
	.report-output,
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.lead,
	.note {
		margin: 0;
		max-width: var(--measure);
	}
	.note {
		color: var(--text-muted);
	}
</style>
