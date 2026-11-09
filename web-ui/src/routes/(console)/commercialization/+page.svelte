<!--
  Billing (/commercialization): ?tab=packages (also the old overview and
  settings) and ?tab=sessions (also the old reports), each its own entry
  in the navigation. ?settings=1 or ?tab=settings opens the billing
  settings (#billing-settings-panel) on the packages view. A warning above
  both views when the server clock is not in sync. The page needs
  billing.view; the views hide what billing.manage, billing.reports and
  billing.export allow.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { timesyncStatus } from '#lib/api/billing.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import { billingTab, opensSettings } from '#lib/serverarea/billing.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import PackagesView from './PackagesView.svelte';
	import SessionsView from './SessionsView.svelte';

	const tab = $derived(billingTab(page.url.searchParams.get('tab')));
	const other = $derived(tab === 'packages' ? 'sessions' : 'packages');
	const settingsOpen = $derived(
		opensSettings(page.url.searchParams) || page.url.hash === '#billing-settings-panel'
	);
	const title = $derived(t(`commercialization.tabs.${tab}`));
	const allowed = $derived(can('billing.view'));
	const canManage = $derived(can('billing.manage'));

	$effect(() => setPageTitle(title));

	let unsynced = $state(false);
	$effect(() => {
		if (!allowed) return;
		untrack(() =>
			timesyncStatus().then(
				(s) => (unsynced = !s.synced),
				() => {
					/* no banner when the check itself fails, as before */
				}
			)
		);
	});

	let packagesView = $state<ReturnType<typeof PackagesView> | null>(null);
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide billing-page" data-tab={tab}>
		<div class="page-head">
			<h1>{title}</h1>
			{#if tab === 'packages' && canManage}
				<div class="page-actions">
					<Button
						class="package-new"
						variant="primary"
						icon={ICONS.add}
						onclick={() => packagesView?.newPackage()}>{t('commercialization.packages.new')}</Button
					>
				</div>
			{/if}
			<p class="page-description">
				{t(`commercialization.ui.${tab}_description`)}
				<a href={link(`/commercialization?tab=${other}`)}>{t(`commercialization.tabs.${other}`)}</a>
			</p>
		</div>

		{#if unsynced}
			<Notice tone="warning" message={t('commercialization.clock.unsynced')} />
		{/if}

		{#key tab}
			{#if tab === 'packages'}
				<PackagesView bind:this={packagesView} {canManage} {settingsOpen} />
			{:else}
				<SessionsView {canManage} canWrite={can('billing.reports')} canExport={can('billing.export')} />
			{/if}
		{/key}
	</div>
{/if}
