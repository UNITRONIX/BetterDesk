<!--
  Audit log tab: what people did in this console. Search and a kind filter
  (both in the URL as ?q= and ?type=), 50 entries a page, long details cut
  after two lines. Loads up to 2,000 entries once; search and filter run
  here.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listAuditLog, listAvatarVersions } from '#lib/api/audit.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import DetailsText from '#lib/people/DetailsText.svelte';
	import {
		AUDIT_FILTERS,
		filterAudit,
		isAuditFilter,
		toAuditEntries,
		type AuditEntry,
		type AuditFilter
	} from '#lib/people/audit.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Pagination from '#lib/ui/Pagination.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import type { Column } from '#lib/ui/table.ts';
	import { ICONS } from '#lib/util/display.ts';

	const PAGE_SIZE = 50;

	interface Props {
		q: string;
		type: string;
		/** The search or filter changed: the page writes them into the URL */
		onfilter: (q: string, type: string) => void;
	}

	let { q, type, onfilter }: Props = $props();

	const uid = $props.id();

	let entries = $state.raw<AuditEntry[]>([]);
	let avatars = $state.raw(new Map<string, string>());
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let pageNo = $state(1);

	let searchInput = $state(untrack(() => q));
	let query = $state(untrack(() => q));
	let kind = $state<AuditFilter | ''>(untrack(() => (isAuditFilter(type) ? type : '')));

	async function load() {
		loaded = false;
		loadError = null;
		try {
			const [rows, pics] = await Promise.all([
				listAuditLog(2000),
				listAvatarVersions().catch(() => new Map<string, string>())
			]);
			entries = toAuditEntries(rows, t);
			avatars = pics;
		} catch {
			loadError = t('security_audit.audit_load_failed');
		} finally {
			loaded = true;
		}
	}

	$effect(() => {
		untrack(() => void load());
	});

	$effect(() => {
		const v = searchInput.trim();
		if (v === untrack(() => query)) return;
		const timer = setTimeout(() => {
			query = v;
			pageNo = 1;
			onfilter(v, kind);
		}, 150);
		return () => clearTimeout(timer);
	});

	function setKind(next: AuditFilter | '') {
		kind = next;
		pageNo = 1;
		onfilter(query, next);
	}

	const shown = $derived(filterAudit(entries, query, kind));
	const pageCount = $derived(Math.max(1, Math.ceil(shown.length / PAGE_SIZE)));
	const pageRows = $derived(
		shown.slice((Math.min(pageNo, pageCount) - 1) * PAGE_SIZE, Math.min(pageNo, pageCount) * PAGE_SIZE)
	);

	const filterOptions = $derived([
		{ value: '' as AuditFilter | '', label: t('security_audit.filter_all') },
		...AUDIT_FILTERS.map((f) => ({ value: f as AuditFilter | '', label: t(`security_audit.filter_${f}`) }))
	]);

	const person = (e: AuditEntry) =>
		e.userId
			? {
					id: e.userId,
					username: e.who,
					has_avatar: avatars.has(e.userId),
					avatar_version: avatars.get(e.userId) ?? null
				}
			: e.who;

	const columns = $derived<Column<AuditEntry>[]>([
		{ id: 'time', label: t('security_audit.col_time'), cell: timeCell, class: 'col-time' },
		{ id: 'who', label: t('security_audit.col_who'), cell: whoCell, class: 'col-who' },
		{ id: 'action', label: t('security_audit.col_action'), cell: actionCell },
		{ id: 'device', label: t('security_audit.col_device'), cell: deviceCell },
		{ id: 'details', label: t('security_audit.col_details'), cell: detailsCell, class: 'col-details' },
		{ id: 'ip', label: t('security_audit.col_ip'), cell: ipCell }
	]);
</script>

{#snippet timeCell(e: AuditEntry)}<Time
		value={e.time}
		relative={false}
		format={{ second: '2-digit' }}
	/>{/snippet}
{#snippet whoCell(e: AuditEntry)}<User user={person(e)} avatar />{/snippet}
{#snippet actionCell(e: AuditEntry)}{#if e.label}<Tag label={e.label} />{/if}{/snippet}
{#snippet deviceCell(e: AuditEntry)}<ValueCopy value={e.device} />{/snippet}
{#snippet detailsCell(e: AuditEntry)}<DetailsText text={e.details} />{/snippet}
{#snippet ipCell(e: AuditEntry)}<ValueCopy value={e.ip} />{/snippet}

<section class="section" aria-labelledby="{uid}-title">
	<h2 id="{uid}-title" class="sr-only">{t('security_audit.tab_audit_log')}</h2>
	<p class="section-note">{t('security_audit.audit_log_note')}</p>
	<Toolbar>
		{#snippet search()}<SearchField
				label={t('security_audit.audit_search')}
				bind:value={searchInput}
			/>{/snippet}
		<label class="filter">
			<span>{t('security_audit.show')}</span>
			<Select
				options={filterOptions}
				value={kind}
				onchange={(e) => setKind((e.currentTarget as HTMLSelectElement).value as AuditFilter | '')}
			/>
		</label>
		{#snippet end()}<Button icon={ICONS.refresh} onclick={() => void load()}
				>{t('security_audit.refresh')}</Button
			>{/snippet}
	</Toolbar>
	<div class="count" aria-live="polite">
		{#if loaded && !loadError}
			{#if shown.length !== entries.length}
				<CountLine
					text={t('security_audit.audit_count_filtered')}
					values={{ shown: shown.length, total: entries.length }}
				/>
			{:else}
				<CountLine text={t('security_audit.audit_count')} values={{ total: entries.length }} />
			{/if}
		{/if}
	</div>
	<div class="log-table">
		<Table
			rows={pageRows}
			{columns}
			key={(e) => e.key}
			label={t('security_audit.tab_audit_log')}
			loading={!loaded}
			error={loadError}
			onretry={() => void load()}
			emptyText={entries.length ? t('security_audit.audit_no_match') : t('security_audit.audit_empty')}
		/>
	</div>
	{#if pageCount > 1}
		<Pagination
			page={Math.min(pageNo, pageCount)}
			{pageCount}
			label={t('security_audit.pages')}
			onchange={(p) => (pageNo = p)}
		/>
	{/if}
</section>

<style>
	.filter {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text-muted);
	}
	.count {
		min-height: 1.5em;
	}
	.log-table :global(td.col-time) {
		white-space: nowrap;
	}
	.log-table :global(td.col-details) {
		min-width: 16rem;
		max-width: 36rem;
	}
</style>
