<!--
  A target's details: its address (copy), and its last 100 checks with time,
  result, response time and what went wrong. A wide details sheet with
  Close; opened by a click on the target's row or from its row menu.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { targetHistory, type HistoryEntry, type Target } from '#lib/api/network.ts';
	import { address } from '#lib/devices-area/network.ts';
	import { parseDate, formatDate } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';

	let { target, onclose }: { target: Target; onclose: () => void } = $props();

	let open = $state(true);
	let entries = $state.raw<(HistoryEntry & { key: string })[] | null>(null);
	let failed = $state<string | null>(null);

	async function load() {
		failed = null;
		try {
			const list = await targetHistory(target.id, 100);
			entries = list.map((e, i) => ({ ...e, key: `${i}-${e.checked_at}` }));
		} catch (err) {
			failed = err instanceof Error && err.message ? err.message : t('network.request_failed');
		}
	}
	$effect(() => {
		untrack(() => void load());
	});

	const down = $derived(entries ? entries.filter((e) => e.status !== 'up').length : 0);
	const detail = (e: HistoryEntry) =>
		e.error_msg || (e.status_code ? t('network.http_status', { code: e.status_code }) : '');

	const columns = $derived<Column<HistoryEntry & { key: string }>[]>([
		{
			id: 'time',
			label: t('network.history_time'),
			cell: timeCell,
			class: 'col-time',
			sortValue: (e) => parseDate(e.checked_at)
		},
		{
			id: 'status',
			label: t('network.status'),
			cell: statusCell,
			sortValue: (e) => (e.status === 'up' ? 1 : 0)
		},
		{
			id: 'rtt',
			label: t('network.col_response'),
			cell: rttCell,
			align: 'num',
			sortValue: (e) => (e.status === 'up' ? e.rtt_ms : null)
		},
		{ id: 'detail', label: t('network.history_detail'), cell: detailCell, class: 'col-detail' }
	]);

	const host = $derived(target.port ? `${target.host}:${target.port}` : target.host);
</script>

{#snippet timeCell(e: HistoryEntry)}{#if parseDate(e.checked_at)}<time
			datetime={parseDate(e.checked_at)?.toISOString()}
			>{formatDate(e.checked_at, { second: '2-digit' })}</time
		>{:else}<Empty />{/if}{/snippet}

{#snippet statusCell(e: HistoryEntry)}<Status
		tone={e.status === 'up' ? 'good' : 'danger'}
		label={e.status === 'up' ? t('network.status_up') : t('network.status_down')}
	/>{/snippet}

{#snippet rttCell(e: HistoryEntry)}{#if e.status === 'up' && e.rtt_ms !== null}{t('network.ms', {
			value: Math.round(e.rtt_ms)
		})}{:else}<Empty />{/if}{/snippet}

{#snippet detailCell(e: HistoryEntry)}{#if detail(e)}{detail(e)}{:else}<Empty />{/if}{/snippet}

<Sheet
	bind:open
	wide
	title={t('network.history_title', { name: target.name })}
	subtitle={t('network.history_sheet_desc', { host })}
	{onclose}
>
	<div class="history">
		<p class="address">
			<ValueCopy value={address(target)} label={t('network.host')} />
		</p>
		{#if failed !== null}
			<States kind="error" message={`${t('network.history_failed')} ${failed}`} onretry={() => void load()} />
		{:else if entries === null}
			<States kind="loading" message={t('network.loading_history')} />
		{:else if !entries.length}
			<States message={t('network.no_history_yet')} />
		{:else}
			<CountLine text={t('network.history_count')} values={{ count: entries.length, down }} />
			<Table
				rows={entries}
				{columns}
				key={(e) => e.key}
				label={t('network.history_title', { name: target.name })}
				sort={{ column: 'time', dir: 'desc' }}
			/>
		{/if}
	</div>
	{#snippet footer()}
		<Button
			onclick={() => {
				open = false;
				onclose();
			}}>{t('actions.close')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.history {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.address {
		margin: 0;
	}
	.history :global(td.col-time) {
		white-space: nowrap;
	}
	.history :global(td.col-detail) {
		overflow-wrap: anywhere;
	}
</style>
