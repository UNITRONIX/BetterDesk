<!--
  USB and drive access (/resource-control). The device list with a search,
  "Rules followed" beside it (a share bar and the numbers per kind of rule),
  and a device's rules in a sheet (a click anywhere on its row, or Edit
  rules).

  The server can't store these rules yet (BUGS.md P5); the notice under the
  heading says so, and every option stays.

  Who: server.config (the page route and every API call).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getCompliance, listRcDevices, type Compliance, type RcDevice } from '#lib/api/resourceControl.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { complianceView, filterRcDevices, isOnline, rulesSummary } from '#lib/rules/resourceControl.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import RulesSheet from './RulesSheet.svelte';

	$effect(() => setPageTitle(t('nav.resource_control')));
	const allowed = $derived(can('server.config'));

	let devices = $state.raw<RcDevice[]>([]);
	let loaded = $state(false);
	let failed = $state(false);
	let compliance = $state.raw<Compliance | null>(null);
	let complianceState = $state<'loading' | 'ready' | 'error'>('loading');
	let query = $state('');
	let open = $state.raw<RcDevice | null>(null);

	async function loadDevices() {
		try {
			devices = await listRcDevices();
			failed = false;
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	}

	async function loadCompliance() {
		complianceState = 'loading';
		try {
			compliance = await getCompliance();
			complianceState = 'ready';
		} catch {
			complianceState = 'error';
		}
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			void loadDevices();
			void loadCompliance();
		});
	});
	$effect(() =>
		onRefresh(() => {
			void loadDevices();
			void loadCompliance();
		})
	);

	const shown = $derived(filterRcDevices(devices, query));
	// The rules column only earns its place once some device reports its rules
	const anyRules = $derived(devices.some((d) => d.resources && typeof d.resources === 'object'));
	const view = $derived(compliance ? complianceView(compliance) : null);
	const shareParts = $derived(
		view
			? [
					{ value: view.compliant, label: t('resource_control.legend_all'), tone: 'ok' as const },
					{ value: view.nonCompliant, label: t('resource_control.legend_not'), tone: 'danger' as const },
					{ value: view.none, label: t('resource_control.legend_none'), tone: 'muted' as const }
				]
			: []
	);
	const categoryFacts = $derived(
		(view?.rows ?? []).map((r) => ({
			label: t(`resource_control.cat_${r.key}`),
			value:
				r.pct !== null ? `${r.pct} %` : t('resource_control.of_devices', { n: r.enforced, total: r.total })
		}))
	);

	const columns = $derived<Column<RcDevice>[]>([
		{
			id: 'device',
			label: t('resource_control.col_device'),
			cell: deviceCell,
			primary: true,
			sortValue: (d) => (d.hostname || d.id).toLowerCase()
		},
		{
			id: 'platform',
			label: t('resource_control.col_platform'),
			cell: platformCell,
			sortValue: (d) => d.platform,
			class: 'col-platform'
		},
		{
			id: 'status',
			label: t('resource_control.col_status'),
			cell: statusCell,
			sortValue: (d) => (isOnline(d) ? 0 : 1)
		},
		...(anyRules
			? [{ id: 'rules', label: t('resource_control.col_rules'), cell: rulesCell, class: 'col-rules' }]
			: []),
		{
			id: 'actions',
			label: t('resource_control.col_actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions'
		}
	]);
</script>

{#snippet deviceCell(d: RcDevice)}<span class="strong rc-name">{d.hostname || d.id}</span
	>{#if d.hostname}<span class="cell-sub mono">{d.id}</span>{/if}{#if d.platform}<span
			class="cell-sub platform-sub">{d.platform}</span
		>{/if}{/snippet}
{#snippet platformCell(d: RcDevice)}<Platform platform={d.platform} />{/snippet}
{#snippet statusCell(d: RcDevice)}<Status
		tone={isOnline(d) ? 'good' : 'neutral'}
		label={t(isOnline(d) ? 'status.online' : 'status.offline')}
	/>{/snippet}
{#snippet rulesCell(d: RcDevice)}{@const s = rulesSummary(d.resources, t)}{#if s}{s}{:else}{t(
			'resource_control.rules_unknown'
		)}{/if}{/snippet}
{#snippet actionsCell(d: RcDevice)}<Button
		size="sm"
		aria-label="{t('resource_control.edit_rules')}: {d.hostname || d.id}"
		onclick={() => (open = d)}>{t('resource_control.edit_rules')}</Button
	>{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide rc-page">
		<div class="page-head">
			<h1>{t('nav.resource_control')}</h1>
			<p class="page-description">{t('resource_control.page_description')}</p>
		</div>

		<Notice tone="warning" class="rc-gap" message={t('resource_control.unavailable_note')} />

		<div class="page-cols">
			<section class="page-main section" aria-labelledby="rc-list-title">
				<h2 id="rc-list-title" class="sr-only">{t('resource_control.devices_title')}</h2>
				<Toolbar>
					{#snippet search()}<SearchField
							label={t('resource_control.search_label')}
							bind:value={query}
						/>{/snippet}
				</Toolbar>
				{#if loaded && !failed && devices.length}
					{#if shown.length === devices.length}
						<CountLine
							text={t(devices.length === 1 ? 'resource_control.count_one' : 'resource_control.count_many')}
							values={{ count: devices.length }}
						/>
					{:else}
						<CountLine
							text={t('resource_control.count_filtered')}
							values={{ shown: shown.length, total: devices.length }}
						/>
					{/if}
				{/if}
				<Table
					rows={shown}
					{columns}
					key={(d) => d.id}
					label={t('resource_control.devices_title')}
					onrowclick={(d) => (open = d)}
					loading={!loaded}
					loadingText={t('resource_control.loading')}
					error={failed ? t('resource_control.load_failed') : null}
					onretry={() => {
						void loadDevices();
						void loadCompliance();
					}}
					emptyText={devices.length ? t('resource_control.no_match') : t('resource_control.empty_list')}
				/>
			</section>

			<aside class="page-side">
				<section class="section" aria-labelledby="rc-compliance-title">
					<h2 id="rc-compliance-title">{t('resource_control.compliance_title')}</h2>
					<p class="section-note">{t('resource_control.compliance_note')}</p>
					{#if complianceState === 'loading'}
						<States kind="loading" message={t('resource_control.loading')} />
					{:else if complianceState === 'error' || !view}
						<States
							kind="error"
							message={t('resource_control.compliance_failed')}
							retryLabel={t('resource_control.try_again')}
							onretry={() => void loadCompliance()}
						/>
					{:else if !view.total}
						<p class="muted">{t('resource_control.compliance_empty')}</p>
					{:else}
						<ShareBar parts={shareParts} label={t('resource_control.compliance_title')} />
						<h3 class="by-category">{t('resource_control.by_category')}</h3>
						<Facts items={categoryFacts} />
					{/if}
				</section>
			</aside>
		</div>
	</div>
{/if}

{#if open}
	<RulesSheet device={open} onclose={() => (open = null)} />
{/if}

<style>
	.strong {
		font-weight: 600;
	}
	/* A host name stays on one line on wide screens */
	@media (min-width: 641px) {
		.rc-name {
			white-space: nowrap;
		}
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	.by-category {
		margin: var(--space-2) 0 0;
	}
	.rc-page :global(.rc-gap) {
		max-width: var(--measure);
	}
	.rc-page :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.rc-page :global(td.col-rules) {
		color: var(--text-muted);
	}
	/* Narrow screens: the platform moves under the device name */
	.rc-page .cell-sub.platform-sub {
		display: none;
	}
	@media (max-width: 640px) {
		.rc-page :global(.col-platform) {
			display: none;
		}
		.rc-page .cell-sub.platform-sub {
			display: block;
		}
	}
</style>
