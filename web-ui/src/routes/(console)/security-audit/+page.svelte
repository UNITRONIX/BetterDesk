<!--
  Security and audit (/security-audit, audit.view): the console audit log,
  the server's own events, the security checks, the hardening plan and the
  signed-in person's sessions. Each tab loads when it is first opened.

  URL: ?tab=audit|events|overview|hardening|sessions (the old
  "vulnerabilities" opens Hardening) follows the open tab; on the audit log
  ?q= and ?type= fill the search and the filter and follow them.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { auditTab, type AuditTab } from '#lib/people/audit.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Tabs from '#lib/ui/Tabs.svelte';
	import AuditLogTab from './AuditLogTab.svelte';
	import ChecksTab from './ChecksTab.svelte';
	import EventsTab from './EventsTab.svelte';
	import HardeningTab from './HardeningTab.svelte';
	import SessionsTab from './SessionsTab.svelte';

	const allowed = can('audit.view');
	const params = untrack(() => page.url.searchParams);

	let tab = $state<AuditTab>(auditTab(params.get('tab')));
	let q = $state(params.get('q') ?? '');
	let type = $state(params.get('type') ?? '');
	/** Tabs opened once stay mounted (hidden), so going back does not load again */
	const opened = new SvelteSet<AuditTab>([untrack(() => tab)]);
	/** Bumped by Refresh: the open tab mounts again and loads */
	let generation = $state(0);

	function writeUrl() {
		const url = new URL(location.href);
		url.searchParams.set('tab', tab);
		if (tab === 'audit' && q) url.searchParams.set('q', q);
		else url.searchParams.delete('q');
		if (tab === 'audit' && type) url.searchParams.set('type', type);
		else url.searchParams.delete('type');
		// This page's own address with another tab or search
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, page.state);
	}

	function pick(id: string) {
		tab = auditTab(id);
		if (tab !== 'audit') {
			q = '';
			type = '';
		}
		opened.add(tab);
		writeUrl();
	}

	$effect(() =>
		onRefresh(() => {
			opened.clear();
			opened.add(tab);
			generation++;
		})
	);

	const tabs = $derived([
		{ id: 'audit', label: t('security_audit.tab_audit_log') },
		{ id: 'events', label: t('security_audit.tab_server_events') },
		{ id: 'overview', label: t('security_audit.tab_checks') },
		{ id: 'hardening', label: t('security_audit.tab_hardening') },
		{ id: 'sessions', label: t('security_audit.tab_your_sessions') }
	]);
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide secaudit-page">
		<div class="page-head">
			<h1>{t('nav.security_audit')}</h1>
			<p class="page-description">{t('security_audit.page_description')}</p>
		</div>

		<div class="body">
			<Tabs {tabs} value={tab} label={t('nav.security_audit')} onchange={pick}>
				{#snippet children(current)}
					{#key generation}
						<div class="panels">
							{#if opened.has('audit')}
								<div hidden={current !== 'audit'}>
									<AuditLogTab
										{q}
										{type}
										onfilter={(nq, nt) => {
											q = nq;
											type = nt;
											writeUrl();
										}}
									/>
								</div>
							{/if}
							{#if opened.has('events')}
								<div hidden={current !== 'events'}><EventsTab /></div>
							{/if}
							{#if opened.has('overview')}
								<div hidden={current !== 'overview'}><ChecksTab /></div>
							{/if}
							{#if opened.has('hardening')}
								<div hidden={current !== 'hardening'}><HardeningTab /></div>
							{/if}
							{#if opened.has('sessions')}
								<div hidden={current !== 'sessions'}><SessionsTab /></div>
							{/if}
						</div>
					{/key}
				{/snippet}
			</Tabs>
		</div>
	</div>
{/if}

<style>
	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
</style>
