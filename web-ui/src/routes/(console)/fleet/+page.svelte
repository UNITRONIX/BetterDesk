<!--
  Fleet tasks (/fleet, ?tab=resources|tasks|builder|compliance; old
  fleet.ejs, fleet.js, fleet-builder.js): printers, drives and network
  settings for an organization's devices, tasks run on many devices, the
  workflow builder, and compliance results. Needs org.manage_devices
  (admin, super admin, global admin, operator); other roles get the
  no-access page and no requests.

  The Go server has no fleet handlers yet (BUGS.md P4). The page asks the
  console once (GET /api/panel/fleet/availability); when fleet is not
  offered, a notice says so, the lists say "nothing to show" without
  asking the server, and the controls that need the server are turned off
  with the notice as their description. Forms still open, and a workflow
  can still be laid out and exported.

  Filters, the chosen organization and the workflow on the canvas are kept
  here, so switching tabs keeps them (each tab loads its list when it
  opens, as before).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { fleetAvailability } from '#lib/api/fleet.ts';
	import { listOrgs, type Organization } from '#lib/api/orgs.ts';
	import { FLEET_TABS, tabFrom, urlForTab, type FleetTab } from '#lib/canvas/fleet.ts';
	import { WorkflowEditor } from '#lib/canvas/workflow-editor.svelte.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Notice from '#lib/ui/Notice.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import ComplianceTab from './ComplianceTab.svelte';
	import ResourcesTab from './ResourcesTab.svelte';
	import TasksTab from './TasksTab.svelte';
	import WorkflowsTab from './WorkflowsTab.svelte';

	$effect(() => setPageTitle(t('nav.fleet')));

	const allowed = $derived(can('org.manage_devices'));

	/* ── Tabs, kept in ?tab= ── */

	let tab = $state<FleetTab>(untrack(() => tabFrom(page.url.searchParams.get('tab'))));
	const tabs = $derived(FLEET_TABS.map((id) => ({ id, label: t(`fleet.tab_${id}`) })));

	function selectTab(id: string) {
		tab = tabFrom(id);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- this page's own URL with ?tab=
		replaceState(urlForTab(new URL(location.href), tab), page.state);
	}

	/* ── Does the server offer fleet tasks? ── */

	let ready = $state(false);
	let unavailable = $state(false);
	const NOTICE_ID = 'fleet-unavailable';

	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			fleetAvailability().then(
				(available) => {
					unavailable = available === false;
					ready = true;
				},
				() => (ready = true)
			);
		});
	});

	/* ── Organizations (resources and compliance) ── */

	let orgs = $state.raw<Organization[]>([]);
	let orgsState = $state<'loading' | 'ok' | 'failed'>('loading');

	function loadOrgs() {
		orgsState = 'loading';
		listOrgs().then(
			(list) => {
				orgs = list;
				orgsState = 'ok';
			},
			() => {
				orgs = [];
				orgsState = 'failed';
			}
		);
	}

	$effect(() => {
		if (allowed) untrack(loadOrgs);
	});

	/* ── What the tabs keep ── */

	let resOrg = $state('');
	let resType = $state('');
	let taskSearch = $state('');
	let taskStatus = $state('');
	let compOrg = $state('');
	const editor = new WorkflowEditor();

	// Resources always belong to one organization: start with the first one
	$effect(() => {
		if (orgsState === 'ok' && !resOrg && orgs[0]) resOrg = orgs[0].id;
	});
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide fleet-page">
		<div class="page-head">
			<h1>{t('nav.fleet')}</h1>
			<p class="page-description">{t('fleet.page_description')}</p>
		</div>

		{#if unavailable}
			<Notice tone="warning" id={NOTICE_ID} role="status" message={t('fleet.unavailable_notice')} />
		{/if}

		<Tabs {tabs} value={tab} label={t('nav.fleet')} onchange={selectTab}>
			{#snippet children(id)}
				<div class="fleet-panel">
					{#if id === 'resources'}
						<ResourcesTab
							{ready}
							bind:unavailable
							{orgs}
							{orgsState}
							onreloadorgs={loadOrgs}
							bind:org={resOrg}
							bind:type={resType}
						/>
					{:else if id === 'tasks'}
						<TasksTab {ready} bind:unavailable bind:query={taskSearch} bind:status={taskStatus} />
					{:else if id === 'builder'}
						<WorkflowsTab {ready} bind:unavailable noticeId={NOTICE_ID} {editor} />
					{:else}
						<ComplianceTab {ready} bind:unavailable noticeId={NOTICE_ID} {orgs} bind:org={compOrg} />
					{/if}
				</div>
			{/snippet}
		</Tabs>
	</div>
{/if}

<style>
	.fleet-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
</style>
