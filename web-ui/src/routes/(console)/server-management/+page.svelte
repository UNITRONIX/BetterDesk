<!--
  Server management (/server-management?tab=overview|terminal|files|services).
  Each tab is its own entry in the navigation and its own view with its own
  title, as before; an unknown or missing ?tab= is the overview (as the
  server read it). The page and every call need server.config; without it
  the page says so and asks for nothing.
-->
<script lang="ts">
	import { page } from '$app/state';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import { TAB_TITLE, tabFrom } from '#lib/serverarea/management.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import Button from '#lib/ui/Button.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import FilesPanel from './FilesPanel.svelte';
	import Overview from './Overview.svelte';
	import ServicesPanel from './ServicesPanel.svelte';
	import TerminalPanel from './TerminalPanel.svelte';

	const tab = $derived(tabFrom(page.url.searchParams.get('tab')));
	const title = $derived(t(TAB_TITLE[tab]));
	const allowed = $derived(can('server.config'));

	$effect(() => setPageTitle(title));

	let services = $state<ReturnType<typeof ServicesPanel> | null>(null);
	let refreshing = $state(false);

	async function refreshServices() {
		refreshing = true;
		try {
			await services?.refresh();
		} finally {
			refreshing = false;
		}
	}
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide sm-page" data-tab={tab}>
		<div class="page-head">
			<h1>{title}</h1>
			<p class="page-description">{t(`server_mgmt.${tab}_description`)}</p>
			{#if tab === 'services'}
				<div class="page-actions">
					<Button class="services-refresh" icon={ICONS.refresh} busy={refreshing} onclick={refreshServices}
						>{t('actions.refresh')}</Button
					>
				</div>
			{/if}
		</div>

		{#key tab}
			{#if tab === 'overview'}
				<Overview />
			{:else if tab === 'terminal'}
				<TerminalPanel />
			{:else if tab === 'files'}
				<FilesPanel />
			{:else}
				<ServicesPanel bind:this={services} />
			{/if}
		{/key}
	</div>
{/if}
