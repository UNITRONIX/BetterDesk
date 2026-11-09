<!--
  The overview (/), the first page after sign-in. The main column says what
  needs someone (each line only while its count is above zero), how the
  devices are doing, and the last two weeks of sessions and help requests;
  the side column holds the values a RustDesk client needs and the
  server's status.

  Data: /api/stats and /api/server/status on load, every 30 s while the tab
  is visible (poll) and on Refresh; the attention counts with them, each
  only for the people allowed to read it (enrollment.approve, chat.access).
  The client values (/api/dashboard/client-config) on load, on Refresh and
  when an address is typed into "Client server address" (kept for this
  tab, as the old overview did). Trends (audit.view) load on their own.

  URL: ?activateAgent=1 opens "Activate support agent" (enrollment.approve).
-->
<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import {
		countOpenHelpRequests,
		countRegistrations,
		getClientConfig,
		getDeviceStats,
		getServerStatus,
		type ClientConfig,
		type DeviceStats,
		type ServerStatus
	} from '#lib/api/dashboard.ts';
	import {
		configText,
		deviceParts,
		partLabelKey,
		partState,
		partTone,
		portList,
		readClientHost,
		serverProblem,
		writeClientHost,
		type PartState
	} from '#lib/devices-area/dashboard.ts';
	import ExternalRow from '#lib/devices-area/ExternalRow.svelte';
	import { formatDuration } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import { Copier } from '#lib/ui/clipboard.svelte.ts';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import ShareBar from '#lib/ui/ShareBar.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let { data }: { data: PageData } = $props();

	/* ── Who may see what (the server checks each request; this hides what would fail) ── */

	const canDevices = can('device.view');
	const canApprove = can('enrollment.approve');
	// The help request list needs chat.access (DECISIONS.md P17)
	const canHelp = canDevices && can('chat.access');
	const canTrends = can('audit.view');
	// Links go only where the menu goes: the server builds the menu from the same checks as its routes
	const navPages = new Set(session.nav.flatMap((s) => s.pages.map((p) => p.page)));
	const showServerLink = navPages.has('server-management:overview');

	/* ── The answers +page.ts asked for while the console started, each used once ── */

	const early = untrack(() => new Map<string, Promise<unknown>>(Object.entries(data.early)));
	function first<T>(name: keyof PageData['early'], fresh: () => Promise<T>): Promise<T> {
		const p = early.get(name) as Promise<T | null> | undefined;
		early.delete(name);
		return p ? p.then((v) => v ?? fresh()) : fresh();
	}
	const orNull = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

	/* ── Overview: counts, server status, what needs someone ── */

	let stats = $state.raw<DeviceStats | null>(null);
	let statsFailed = $state(false);
	let status = $state.raw<ServerStatus | null>(null);
	/** false until the first status answer (or failure) */
	let statusKnown = $state(false);
	let registrations = $state(0);
	let openHelp = $state(0);
	let attentionKnown = $state(false);

	async function loadOverview(): Promise<void> {
		const counts = Promise.all([
			canApprove ? orNull(countRegistrations()) : Promise.resolve(0),
			canHelp ? orNull(countOpenHelpRequests()) : Promise.resolve(0)
		]);
		const [s, st] = await Promise.all([
			orNull(first('stats', () => getDeviceStats())),
			orNull(first('status', () => getServerStatus()))
		]);
		if (s) stats = s;
		statsFailed = !s && !stats;
		status = st;
		statusKnown = true;
		const [reg, help] = await counts;
		registrations = reg ?? 0;
		openHelp = help ?? 0;
		attentionKnown = true;
	}

	// Now, every 30 s while the tab is visible, once when it is shown again
	$effect(() => poll(loadOverview, { every: 30_000 }));

	const problem = $derived(statusKnown ? serverProblem(status) : null);
	const parts = $derived(stats ? deviceParts(stats) : null);
	const banned = $derived(canDevices && parts ? parts.banned : 0);
	const attentionRows = $derived(
		(problem ? 1 : 0) + (registrations > 0 ? 1 : 0) + (openHelp > 0 ? 1 : 0) + (banned > 0 ? 1 : 0)
	);

	const signalState = $derived<PartState | 'checking'>(
		statusKnown ? partState(status?.hbbs ?? null) : 'checking'
	);
	const relayState = $derived<PartState | 'checking'>(
		statusKnown ? partState(status?.hbbr ?? null) : 'checking'
	);
	const ports = $derived(portList(status));

	/* ── Client values ── */

	let config = $state.raw<ClientConfig | null>(null);
	let configFailed = $state(false);
	let configLoaded = $state(false);
	let host = $state(readClientHost());
	let applying = $state(false);

	async function loadConfig(persist = false): Promise<void> {
		const typed = host.trim();
		try {
			const c = await first('config', () => getClientConfig(typed));
			config = c;
			configFailed = false;
			// The field shows the address the values are for
			if (!typed && c.client_server_host) host = c.client_server_host;
			if (persist) writeClientHost(typed);
		} catch {
			config = null;
			configFailed = true;
		} finally {
			configLoaded = true;
		}
	}

	async function applyHost(e?: SubmitEvent) {
		e?.preventDefault();
		if (applying || config?.env_override_active) return;
		applying = true;
		// An empty field goes back to the server's own address
		if (!host.trim()) writeClientHost('');
		await loadConfig(true);
		applying = false;
	}

	$effect(() => {
		untrack(() => void loadConfig());
	});

	// The top bar's Refresh: everything again
	$effect(() =>
		onRefresh(() => {
			void loadOverview();
			void loadConfig();
		})
	);

	const envOverride = $derived(Boolean(config?.env_override_active));
	const fallbackHost = typeof location !== 'undefined' ? location.hostname : '';

	const copyAll = new Copier();
	const copyDeploy = new Copier();
	$effect(() => () => {
		copyAll.dispose();
		copyDeploy.dispose();
	});

	function copyConfig() {
		if (!config) return void toast.warning(t('dashboard.config_not_ready'));
		void copyAll.copy(configText(config, t));
	}

	function copyDeployString() {
		const value = config?.deploy_config_string.trim();
		if (!value) return void toast.warning(t('dashboard.deploy_string_not_ready'));
		void copyDeploy.copy(value);
	}

	/* ── Dialogs (their code loads on first use) ── */

	let qrOpen = $state(false);
	let scriptOpen = $state(false);
	let activationOpen = $state(false);

	function showQr() {
		if (!config?.config_uri || !config.public_key) return void toast.warning(t('keys.no_qr'));
		qrOpen = true;
	}

	function showScript() {
		if (!config?.deploy_config_string) return void toast.warning(t('dashboard.deploy_string_not_ready'));
		scriptOpen = true;
	}

	const activateParam = page.url.searchParams.get('activateAgent') === '1';
	// The tab title and the breadcrumb name the task, as the old server did; the page stays the overview
	if (activateParam) setPageTitle(t('nav.activate_agent'));
	onMount(() => {
		if (activateParam && canApprove) activationOpen = true;
	});
</script>

<div class="page page-wide dashboard-page">
	<div class="page-head">
		<h1>{t('nav.dashboard')}</h1>
		<p class="page-description">{t('dashboard.page_intro')}</p>
		{#if canDevices}
			<!-- The most common job: someone reads out an ID or a name -->
			<form
				class="find page-actions"
				role="search"
				aria-label={t('dashboard.find_device')}
				method="get"
				action={link('/devices')}
			>
				<SearchField
					class="find-field"
					name="search"
					label={t('dashboard.find_device')}
					placeholder={t('dashboard.find_device_long')}
					autocomplete="off"
					spellcheck={false}
				/>
				<Button type="submit">{t('dashboard.find_device_button')}</Button>
			</form>
		{/if}
	</div>

	<div class="page-cols">
		<div class="page-main">
			<!-- Attention and the device counts are short: side by side when the main column is wide -->
			<div class="cols now">
				<section class="section" aria-labelledby="attention-title">
					<div class="section-head"><h2 id="attention-title">{t('dashboard.attention_panel')}</h2></div>
					<div aria-live="polite">
						<RowList>
							{#if problem}
								<ListRow
									mark="danger"
									title={t('dashboard.server_status')}
									sub={t(problem)}
									href={showServerLink ? link('/server-management?tab=overview') : undefined}
								/>
							{/if}
							{#if registrations > 0}
								<ListRow
									mark="warning"
									count={registrations}
									title={t('nav.registrations')}
									href={link('/registrations')}
								/>
							{/if}
							{#if openHelp > 0}
								<ListRow
									mark="warning"
									count={openHelp}
									title={t('nav.help_requests')}
									href={link('/help-requests')}
								/>
							{/if}
							{#if banned > 0}
								<ListRow
									mark="danger"
									count={banned}
									title={t('dashboard.banned')}
									href={link('/devices?status=banned')}
								/>
							{/if}
							{#if !attentionRows}
								<ListRow
									empty
									title={attentionKnown && statusKnown ? t('dashboard.attention_none') : t('status.checking')}
								/>
							{/if}
						</RowList>
					</div>
				</section>

				{#if canDevices}
					<!-- How the devices are doing right now: the total and the parts of the whole -->
					<section class="section devices-now" aria-labelledby="devices-now-title">
						<div class="section-head">
							<h2 id="devices-now-title">{t('nav.devices')}</h2>
							<a href={link('/devices')}>{t('dashboard.open_device_list')}</a>
						</div>
						<div class="devices-body" aria-live="polite">
							{#if stats && parts}
								<CountLine text={t('dashboard.devices_total_line')} values={{ total: stats.total }} />
								<ShareBar
									label={t('nav.devices')}
									parts={[
										{
											value: parts.online,
											label: t('dashboard.devices_now_online'),
											tone: 'ok',
											href: link('/devices?status=online')
										},
										{
											value: parts.offline,
											label: t('dashboard.devices_now_offline'),
											tone: 'muted',
											href: link('/devices?status=offline')
										},
										{
											value: parts.banned,
											label: t('dashboard.devices_now_banned'),
											tone: 'danger',
											href: link('/devices?status=banned')
										}
									]}
								/>
							{:else if statsFailed}
								<States
									kind="error"
									message={t('errors.load_devices_failed')}
									onretry={() => void loadOverview()}
								/>
							{:else}
								<States kind="loading" message={t('status.checking')} />
							{/if}
						</div>
					</section>
				{/if}
			</div>

			{#if canTrends}
				<!-- Two weeks of remote sessions and help requests, as on the reports page -->
				{#await import('#lib/people/Trends.svelte') then { default: Trends }}<Trends />{/await}
			{/if}
		</div>

		<aside class="page-side" aria-label={t('dashboard.client_config_title')}>
			<!-- Drawn once the client values are in (or failed): whether the "only this computer"
			     notice shows is known then, so nothing in this column moves after it appears -->
			{#if configLoaded}
				<!-- Values to type into RustDesk -->
				<section class="section client-setup" aria-labelledby="client-config-title">
					<div class="section-head">
						<h2 id="client-config-title">{t('dashboard.client_config_title')}</h2>
					</div>
					<p class="section-note">{t('dashboard.client_config_hint')}</p>
					{#if config?.phone_unreachable_host}
						<Notice tone="warning" message={t('dashboard.client_config_local_warning')} />
					{/if}

					<form class="host-form" onsubmit={applyHost}>
						<Field
							label={t('dashboard.client_server_host_label')}
							hint={envOverride
								? t('dashboard.client_server_host_env_hint')
								: t('dashboard.client_server_host_hint')}
						>
							{#snippet children(f)}
								<div class="host-controls">
									<Input
										{...f}
										class="host-input"
										placeholder={t('dashboard.client_server_host_placeholder')}
										autocomplete="off"
										spellcheck={false}
										disabled={envOverride}
										bind:value={host}
									/>
									<Button type="submit" busy={applying} disabled={envOverride}
										>{t('dashboard.apply_client_host')}</Button
									>
								</div>
							{/snippet}
						</Field>
						{#if envOverride}
							<p class="env-link">
								<a href={link('/settings#public-endpoints')}>{t('dashboard.client_host_settings_link')}</a>
							</p>
						{/if}
					</form>

					<dl class="facts values" aria-busy={!configLoaded}>
						<dt>{t('dashboard.config_server_id')}</dt>
						<dd>
							<ValueField
								label={t('dashboard.config_server_id')}
								value={configFailed ? fallbackHost : config?.server_id}
								empty={configLoaded ? undefined : '…'}
							/>
						</dd>
						<dt>{t('dashboard.config_relay_server')}</dt>
						<dd>
							<ValueField
								label={t('dashboard.config_relay_server')}
								value={configFailed ? fallbackHost : config?.relay_server}
								empty={configLoaded ? undefined : '…'}
							/>
						</dd>
						<dt>{t('dashboard.config_api_server')}</dt>
						<dd>
							<ValueField
								label={t('dashboard.config_api_server')}
								value={config?.api_url}
								empty={configLoaded ? undefined : '…'}
							/>
						</dd>
						<dt>{t('dashboard.config_key')}</dt>
						<dd>
							{#if configFailed}
								<span class="text-danger">{t('errors.load_key_failed')}</span>
							{:else}
								<ValueField
									hidden
									label={t('dashboard.config_key')}
									value={config?.public_key}
									empty={configLoaded ? t('keys.no_key') : '…'}
								/>
							{/if}
						</dd>
					</dl>

					<div class="page-actions setup-actions">
						{#if canApprove}
							<Button variant="primary" onclick={() => (activationOpen = true)}
								>{t('dashboard.activate_agent_qr')}</Button
							>
						{/if}
						<Button icon={copyAll.copied ? 'check' : ICONS.copy} onclick={copyConfig}
							>{t('dashboard.copy_all_config')}</Button
						>
						<Button icon={ICONS.qr} onclick={showQr}>{t('dashboard.show_config_qr')}</Button>
						<MenuButton label={t('mobile_nav.more')}>
							<MenuItem icon={copyDeploy.copied ? 'check' : ICONS.copy} onselect={copyDeployString}
								>{t('dashboard.copy_deploy_string')}</MenuItem
							>
							<MenuItem icon={ICONS.terminal} onselect={showScript}
								>{t('dashboard.show_intune_script')}</MenuItem
							>
						</MenuButton>
					</div>

					<RowList>
						<ExternalRow
							href="https://github.com/rustdesk/rustdesk/releases/latest"
							title={t('dashboard.get_rustdesk')}
							sub={t('dashboard.get_rustdesk_hint')}
						/>
						{#if navPages.has('agents')}
							<ListRow
								title={t('dashboard.open_agents')}
								sub={t('dashboard.agents_hint')}
								href={link('/agents')}
							/>
						{/if}
						{#if navPages.has('keys')}
							<ListRow title={t('dashboard.open_keys')} href={link('/keys')} />
						{/if}
					</RowList>
				</section>

				<!-- Server processes at a glance; ports are rarely needed and stay folded -->
				<section class="section server-details" aria-labelledby="server-details-title">
					<div class="section-head">
						<h2 id="server-details-title">{t('dashboard.server_status')}</h2>
						{#if showServerLink}
							<a href={link('/server-management?tab=overview')}>{t('dashboard.open_server_status')}</a>
						{/if}
					</div>
					<dl class="facts">
						<dt>{t('dashboard.signal_server')}</dt>
						<dd><Status tone={partTone(signalState)} label={t(partLabelKey(signalState))} /></dd>
						<dt>{t('dashboard.relay_server_label')}</dt>
						<dd><Status tone={partTone(relayState)} label={t(partLabelKey(relayState))} /></dd>
						<dt>{t('dashboard.web_console')}</dt>
						<dd><Status tone="good" label={t('status.running')} /></dd>
						<dt>{t('dashboard.server_uptime')}</dt>
						<dd class="num">{status?.uptime ? formatDuration(status.uptime) : '–'}</dd>
					</dl>
					<Disclosure title={t('dashboard.ports_title')} level={3}>
						<dl class="facts">
							{#each ports as p (p.key)}
								<dt>{t(p.key)}</dt>
								<dd class="num">{p.value ?? '–'}</dd>
							{/each}
						</dl>
					</Disclosure>
				</section>
			{/if}
		</aside>
	</div>
</div>

{#if qrOpen && config}
	{#await import('#lib/devices-area/ConfigQrDialog.svelte') then { default: ConfigQrDialog }}
		<ConfigQrDialog {config} onclose={() => (qrOpen = false)} />
	{/await}
{/if}

{#if scriptOpen && config}
	{#await import('#lib/devices-area/InstallScriptSheet.svelte') then { default: InstallScriptSheet }}
		<InstallScriptSheet {config} onclose={() => (scriptOpen = false)} />
	{/await}
{/if}

{#if activationOpen}
	{#await import('#lib/devices-area/AgentActivation.svelte') then { default: AgentActivation }}
		<AgentActivation onclose={() => (activationOpen = false)} />
	{/await}
{/if}

<style>
	/* Find a device: in the page head, on the title's line on wide screens */
	.find {
		flex: 0 1 34rem;
		flex-wrap: nowrap;
		min-width: 0;
	}
	.find > :global(.find-field) {
		flex: 1;
		min-width: 0;
	}
	@media (max-width: 640px) {
		.find {
			flex-basis: 100%;
		}
	}

	/* The counts keep their place while they load */
	.devices-body {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-height: 5.5rem;
	}
	.devices-body :global(.share) {
		max-width: var(--measure);
	}

	/* Client setup: the address field with its button on one line */
	.host-form :global(.form-group) {
		margin-bottom: 0;
	}
	.host-controls {
		display: flex;
		gap: var(--space-2);
	}
	.host-controls > :global(.host-input) {
		flex: 1;
		min-width: 0;
	}
	.env-link {
		margin: var(--space-1) 0 0;
		font-size: var(--text-sm);
	}

	/* Values read top to bottom in the side column: label above value */
	.values {
		grid-template-columns: minmax(0, 1fr);
	}
	.values > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		font-size: var(--text-sm);
	}
	.values > dd {
		padding-top: var(--space-1);
	}

	/* Server status: the state at the end of its row, on phones too */
	.server-details > .facts {
		grid-template-columns: minmax(0, 1fr) auto;
	}
	@media (max-width: 640px) {
		.server-details > .facts > dt {
			min-height: var(--row-h);
			padding-bottom: var(--row-pad-y);
			border-bottom: 1px solid var(--rule);
			font-size: inherit;
		}
		.server-details > .facts > dd {
			padding-top: var(--row-pad-y);
		}
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
</style>
