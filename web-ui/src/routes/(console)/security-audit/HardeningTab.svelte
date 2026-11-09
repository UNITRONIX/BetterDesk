<!--
  Hardening tab: planned and finished security work, most severe first,
  each with its severity, area and Done / Not done; the dependency scan in
  the side column. From 1800 px the items sit in two columns, so each
  status stays near its item.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getVulnerabilities, listHardening, type HardeningItem, type VulnScan } from '#lib/api/audit.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';

	const uid = $props.id();

	let items = $state.raw<HardeningItem[] | null>(null);
	let itemsError = $state<string | null>(null);
	let scan = $state.raw<VulnScan | null>(null);
	let scanError = $state<string | null>(null);

	async function loadItems() {
		itemsError = null;
		try {
			items = await listHardening();
		} catch {
			itemsError = t('security_audit.hardening_load_failed');
		}
	}

	async function loadScan() {
		scanError = null;
		try {
			scan = await getVulnerabilities();
		} catch {
			scanError = t('security_audit.vuln_load_failed');
		}
	}

	$effect(() => {
		untrack(() => {
			void loadItems();
			void loadScan();
		});
	});

	function severity(sev: string): string {
		const key = `security_audit.severity_${sev}`;
		const word = t(key) === key ? sev : t(key);
		return word.charAt(0).toUpperCase() + word.slice(1);
	}
	const sevTone = (sev: string) =>
		sev === 'critical' || sev === 'high' ? 'danger' : sev === 'medium' ? 'warning' : 'neutral';

	const done = $derived(items ? items.filter((h) => h.implemented).length : 0);
</script>

<div class="page-cols">
	<section class="section page-main" aria-labelledby="{uid}-title">
		<h2 id="{uid}-title" class="sr-only">{t('security_audit.tab_hardening')}</h2>
		<p class="section-note">{t('security_audit.hardening_hint')}</p>
		{#if itemsError}
			<States
				kind="error"
				message={itemsError}
				retryLabel={t('security_audit.try_again')}
				onretry={() => void loadItems()}
			/>
		{:else if !items}
			<States kind="loading" />
		{:else if !items.length}
			<States message={t('security_audit.no_hardening')} />
		{:else}
			<p class="count">{t('security_audit.hardening_count', { done, total: items.length })}</p>
			<div class="items">
				<RowList>
					{#each items as h (h.id || h.name)}
						{@const sev = String(h.severity || 'medium').toLowerCase()}
						{#snippet sub()}<span class="desc">{h.description}</span><span class="meta"
								><span class="sr-only"
									>{t('security_audit.hardening_meta', {
										severity: severity(sev),
										category: h.category || '-'
									})}</span
								><span class="marks" aria-hidden="true"
									><Status tone={sevTone(sev)} label={severity(sev)} />{#if h.category}<Tag
											label={h.category}
										/>{/if}</span
								></span
							>{/snippet}
						{#snippet state()}<Status
								tone={h.implemented ? 'good' : 'waiting'}
								label={h.implemented ? t('security_audit.done') : t('security_audit.not_done')}
							/>{/snippet}
						<ListRow title={h.name} {sub} end={state} />
					{/each}
				</RowList>
			</div>
		{/if}
	</section>

	<aside class="page-side" aria-labelledby="{uid}-vuln">
		<section class="section">
			<h2 id="{uid}-vuln">{t('security_audit.vuln_title')}</h2>
			{#if scanError}
				<States
					kind="error"
					message={scanError}
					retryLabel={t('security_audit.try_again')}
					onretry={() => void loadScan()}
				/>
			{:else if !scan}
				<States kind="loading" />
			{:else if scan.scan_available === false}
				<States message={t('security_audit.vuln_no_scan')} />
			{:else}
				<p class="count">{t('security_audit.vuln_counts', scan.counts)}</p>
				{#if scan.vulnerabilities.length}
					<RowList>
						{#each scan.vulnerabilities as v, i (i)}
							{@const sev = v.severity.toLowerCase()}
							{#snippet level()}<Status tone={sevTone(sev)} label={severity(sev)} />{/snippet}
							<ListRow title={v.package || v.name} sub={v.title || v.description} end={level} />
						{/each}
					</RowList>
				{:else}
					<States message={t('security_audit.no_vulns')} />
				{/if}
			{/if}
		</section>
	</aside>
</div>

<style>
	.count {
		margin: 0;
	}
	.desc,
	.meta {
		display: block;
	}
	.marks {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-1);
	}
	/* From 1800 px two columns, so each status stays near its item */
	@media (min-width: 1800px) {
		.items :global(.list) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: var(--space-7);
		}
	}
</style>
