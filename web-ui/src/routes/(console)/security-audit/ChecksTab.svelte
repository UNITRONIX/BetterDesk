<!--
  Security checks tab: each check with Passed or Failed and what to do
  about a failed one; the numbers and the encryption state under it; the
  result and the passed/failed split in the side column.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getOverview, type Overview } from '#lib/api/audit.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';

	type Check = Overview['checks'][number];

	const uid = $props.id();

	let data = $state.raw<Overview | null>(null);
	let loadError = $state<string | null>(null);

	async function load() {
		loadError = null;
		try {
			data = await getOverview();
		} catch {
			loadError = t('security_audit.overview_load_failed');
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	function translated(key: string, fallback: string): string {
		const v = t(key);
		return v === key ? fallback : v;
	}
	/** The legend's word: the string without its number (the bar's legend puts the number first) */
	const legendWord = (key: string) => t(key).replace('{n}', '').replace(/\s+/g, ' ').trim();

	const passed = $derived(data ? data.checks.filter((c) => c.pass).length : 0);
	const failed = $derived(data ? data.checks.length - passed : 0);

	const columns = $derived<Column<Check>[]>([
		{ id: 'check', label: t('security_audit.col_check'), cell: nameCell },
		{ id: 'status', label: t('security_audit.col_status'), cell: statusCell, class: 'col-status' },
		{ id: 'todo', label: t('security_audit.col_todo'), cell: todoCell }
	]);
</script>

{#snippet nameCell(c: Check)}{translated(`security_audit.check_${c.id}`, c.name)}{/snippet}
{#snippet statusCell(c: Check)}<Status
		tone={c.pass ? 'good' : 'danger'}
		label={c.pass ? t('security_audit.passed') : t('security_audit.failed')}
	/>{/snippet}
{#snippet todoCell(c: Check)}{#if c.pass}<Empty />{:else}{translated(
			`security_audit.fix_${c.id}`,
			''
		)}{/if}{/snippet}
{#snippet num(v: number | null)}{#if v === null}<Empty />{:else}{formatNumber(v)}{/if}{/snippet}
{#snippet failedLogins()}{@render num(data?.stats.failed_logins ?? null)}{/snippet}
{#snippet blocked()}{@render num(data?.stats.bans ?? null)}{/snippet}
{#snippet changes()}{@render num(data?.stats.config_changes ?? null)}{/snippet}
{#snippet keys()}{#if data?.stats.api_keys === null || data?.stats.api_keys === undefined}<Empty />{:else}{t(
			'security_audit.stat_api_keys_value',
			{ total: formatNumber(data.stats.api_keys), old: formatNumber(data.stats.old_keys ?? 0) }
		)}{/if}{/snippet}
{#snippet tls(v: boolean | null)}{#if v === null}<Status
			tone="neutral"
			label={t('security_audit.tls_unknown')}
		/>{:else}<BooleanStatus
			value={v}
			on={t('security_audit.enabled')}
			off={t('security_audit.disabled')}
		/>{/if}{/snippet}
{#snippet tlsSignal()}{@render tls(data?.tls.signal ?? null)}{/snippet}
{#snippet tlsRelay()}{@render tls(data?.tls.relay ?? null)}{/snippet}
{#snippet tlsApi()}{@render tls(data?.tls.api ?? null)}{/snippet}
{#snippet tlsWss()}{@render tls(data?.tls.wss ?? null)}{/snippet}

{#if loadError}
	<States
		kind="error"
		message={loadError}
		retryLabel={t('security_audit.try_again')}
		onretry={() => void load()}
	/>
{:else if !data}
	<States kind="loading" />
{:else}
	<div class="page-cols">
		<div class="page-main">
			<section class="section" aria-labelledby="{uid}-checks">
				<h2 id="{uid}-checks" class="sr-only">{t('security_audit.tab_checks')}</h2>
				<div class="checks">
					<Table
						rows={data.checks}
						{columns}
						key={(c) => c.id}
						label={t('security_audit.tab_checks')}
						emptyText={t('security_audit.no_checks')}
					/>
				</div>
			</section>
			<div class="cols">
				<section class="section" aria-labelledby="{uid}-numbers">
					<h2 id="{uid}-numbers">{t('security_audit.numbers_title')}</h2>
					<Facts
						items={[
							{ label: t('security_audit.stat_failed_logins'), value: failedLogins },
							{ label: t('security_audit.stat_blocked'), value: blocked },
							{ label: t('security_audit.stat_api_keys'), value: keys },
							{ label: t('security_audit.stat_config_changes'), value: changes }
						]}
					/>
				</section>
				<section class="section" aria-labelledby="{uid}-tls">
					<h2 id="{uid}-tls">{t('security_audit.tls_status')}</h2>
					<p class="section-note">{t('security_audit.tls_note')}</p>
					<Facts
						items={[
							{ label: t('security_audit.tls_signal'), value: tlsSignal },
							{ label: t('security_audit.tls_relay'), value: tlsRelay },
							{ label: t('security_audit.tls_api'), value: tlsApi },
							{ label: t('security_audit.tls_wss'), value: tlsWss }
						]}
					/>
				</section>
			</div>
		</div>
		<aside class="page-side" aria-labelledby="{uid}-result">
			<section class="section">
				<h2 id="{uid}-result">{t('security_audit.checks_result_title')}</h2>
				<p class="summary" aria-live="polite">
					{!data.checks.length
						? t('security_audit.no_checks')
						: failed
							? t('security_audit.checks_some_fail')
							: t('security_audit.checks_all_pass')}
				</p>
				{#if data.checks.length}
					<ShareBar
						label={t('security_audit.checks_result_title')}
						parts={[
							{ value: passed, label: legendWord('security_audit.checks_legend_passed'), tone: 'ok' },
							{ value: failed, label: legendWord('security_audit.checks_legend_failed'), tone: 'danger' }
						]}
					/>
				{/if}
			</section>
		</aside>
	</div>
{/if}

<style>
	.summary {
		margin: 0;
	}
	.checks :global(td.col-status) {
		white-space: nowrap;
	}
</style>
