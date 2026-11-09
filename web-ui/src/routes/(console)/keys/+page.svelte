<!--
  Client setup (/keys): what a RustDesk client needs to reach this server.
  The four values with Copy, all of them as one config string, the same
  values as a QR code for the phone app, how a connection runs (diagram),
  what happens after the client connects in the current enrollment mode,
  and the key file and download pages.

  Data: one call for the values, the key, the config string and the QR's
  text (/api/dashboard/client-config, with the overview's client address
  override for this tab). The enrollment mode (enrollment.manage) and the
  connection mode for the diagram (server.config) only when the role may
  read them. The server API key loads when "For scripts" opens; the whole
  key needs server.keys.

  Every signed-in role can open the page and read the values (the route
  and its calls need only a session).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getEnrollmentMode, type EnrollmentMode } from '#lib/api/enrollment.ts';
	import {
		KEY_FILE_URL,
		getClientConfig,
		getDiagramMode,
		getFullApiKey,
		getMaskedApiKey,
		NO_API_KEY,
		type ClientConfig
	} from '#lib/api/keys.ts';
	import { nextSteps, splitHostPort, storedClientHost, warnings, type NextStep } from '#lib/clients/keys.ts';
	import { externalLinks } from '#lib/clients/links.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ConnectionDiagram from '#lib/ui/ConnectionDiagram.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import QR from '#lib/ui/QR.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	const RUSTDESK_RELEASES = 'https://github.com/rustdesk/rustdesk/releases/latest';

	/* ── Values ── */

	let config = $state.raw<ClientConfig | null>(null);
	let loaded = $state(false);
	let failed = $state(false);

	async function loadConfig(): Promise<void> {
		try {
			config = await getClientConfig(storedClientHost());
			failed = false;
		} catch {
			config = null;
			failed = true;
		} finally {
			loaded = true;
		}
	}

	// Without an answer the values fall back to this address, as the old page did
	const here = typeof location !== 'undefined' ? location.hostname : '';
	const idServer = $derived(config?.server_id || (failed ? here : ''));
	const relay = $derived(config?.relay_server || (failed ? here : ''));
	const apiServer = $derived(config?.api_url ?? '');
	const publicKey = $derived(config?.public_key ?? '');
	const configString = $derived(config?.deploy_config_string.trim() ?? '');
	const qrText = $derived(config?.config_uri ?? '');
	const warn = $derived(warnings(idServer, config?.phone_unreachable_host ?? false));
	const keyMissing = $derived(failed ? t('errors.load_key_failed') : t('keys.no_key'));

	/* ── Enrollment mode and connection mode, when the role may read them ── */

	const canManage = $derived(can('enrollment.manage'));
	const canApprove = $derived(can('enrollment.approve'));
	let mode = $state<EnrollmentMode | null>(null);
	let diagramMode = $state<'direct-first' | 'relay-only'>('direct-first');

	async function loadMode(): Promise<void> {
		if (!canManage) return;
		try {
			mode = await getEnrollmentMode();
		} catch {
			mode = null;
		}
	}

	async function loadDiagramMode(): Promise<void> {
		if (!can('server.config')) return;
		try {
			diagramMode = await getDiagramMode();
		} catch {
			/* clients try a direct connection first */
		}
	}

	function loadAll() {
		void loadConfig();
		void loadMode();
		void loadDiagramMode();
		if (apiKeyLoaded) void loadApiKey();
	}

	$effect(() => untrack(loadAll));
	$effect(() => onRefresh(loadAll));

	const steps = $derived(nextSteps(mode, { approve: canApprove, manage: canManage }));
	const STEP_PAGES: Record<NextStep, { href: string; title: string; sub: string }> = {
		registrations: { href: '/registrations', title: 'nav.registrations', sub: 'keys.next_requests_sub' },
		tokens: { href: '/tokens', title: 'nav.tokens', sub: 'keys.next_tokens_sub' },
		pairing: { href: '/pairing', title: 'nav.pairing', sub: 'keys.next_pairing_sub' },
		devices: { href: '/devices', title: 'nav.devices', sub: 'keys.next_devices_sub' }
	};

	const id = $derived(splitHostPort(idServer, 21116));
	const rel = $derived(splitHostPort(relay, 21117));

	/* ── Server API key (For scripts) ── */

	let apiKey = $state('');
	let apiKeyLoaded = false;
	let scriptsOpen = $state(false);
	// The shortened key loads the first time "For scripts" opens
	$effect(() => {
		if (scriptsOpen && !untrack(() => apiKeyLoaded)) void loadApiKey();
	});
	let fullKey = $state<string | null>(null);
	let showingKey = $state(false);
	const canSeeKey = $derived(can('server.keys'));

	async function loadApiKey(): Promise<void> {
		apiKeyLoaded = true;
		try {
			apiKey = await getMaskedApiKey();
		} catch {
			apiKey = '';
		}
	}

	async function toggleFullKey() {
		if (fullKey !== null) {
			fullKey = null;
			return;
		}
		showingKey = true;
		try {
			fullKey = await getFullApiKey();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		} finally {
			showingKey = false;
		}
	}
</script>

{#snippet modeSentence()}
	{#if mode}
		<strong>{t('keys.next_mode', { mode: t(`tokens.mode_${mode}`) })}</strong>
		{t(`keys.next_${mode}`)}
	{:else}
		{t('keys.next_unknown')}
	{/if}
{/snippet}

{#snippet externalMark()}<Icon name="open_in_new" class="row-chevron" />{/snippet}

<div class="page keys-page">
	<div class="page-head">
		<h1>{t('nav.keys')}</h1>
		<p class="page-description">{t('keys.page_description')}</p>
	</div>

	<div class="page-cols">
		<div class="page-main">
			<section class="section" aria-labelledby="keys-values-title">
				<div class="section-head"><h2 id="keys-values-title">{t('keys.values_title')}</h2></div>
				<p class="section-note">{t('dashboard.client_config_hint')}</p>
				{#if warn.local}
					<Notice tone="warning" class="keys-local-warning">
						<p>
							{t('keys.local_warning')}
							<a href={link('/settings#public-endpoints')}>{t('dashboard.client_host_settings_link')}</a>
						</p>
					</Notice>
				{/if}

				<dl class="facts keys-facts" aria-busy={!loaded}>
					<dt>{t('dashboard.config_server_id')}</dt>
					<dd>
						{#if loaded}<ValueField value={idServer} label={t('dashboard.config_server_id')} />{:else}…{/if}
					</dd>
					<dt>{t('dashboard.config_relay_server')}</dt>
					<dd>
						{#if loaded}<ValueField value={relay} label={t('dashboard.config_relay_server')} />{:else}…{/if}
					</dd>
					<dt>{t('dashboard.config_api_server')}</dt>
					<dd>
						{#if loaded}<ValueField value={apiServer} label={t('dashboard.config_api_server')} />{:else}…{/if}
					</dd>
					<dt>{t('dashboard.config_key')}</dt>
					<dd>
						{#if loaded}<ValueField
								value={publicKey}
								label={t('dashboard.config_key')}
								hidden
								empty={keyMissing}
							/>{:else}…{/if}
					</dd>
					<dt>{t('keys.config_string')}</dt>
					<dd>
						{#if loaded}<span class="config-field"
								><ValueField
									value={configString}
									label={t('keys.config_string')}
									empty={t('keys.config_string_missing')}
								/></span
							>{:else}…{/if}
						<span class="fact-hint">{t('keys.config_string_hint')}</span>
					</dd>
				</dl>

				<!-- Only scripts that call the server API use it -->
				<Disclosure title={t('keys.scripts_title')} level={3} class="keys-scripts" bind:open={scriptsOpen}>
					<dl class="facts keys-facts">
						<dt>{t('keys.server_api_key')}</dt>
						<dd>
							{#if fullKey !== null}
								<ValueField value={fullKey} label={t('keys.server_api_key')} />
							{:else}
								<span class="mono api-key">{apiKey || '…'}</span>
							{/if}
							{#if canSeeKey && apiKey && apiKey !== NO_API_KEY}
								<Button size="sm" class="show-api-key" busy={showingKey} onclick={toggleFullKey}
									>{fullKey !== null
										? tf('keys.hide_api_key', 'Hide key')
										: tf('keys.show_api_key', 'Show whole key')}</Button
								>
							{/if}
							<span class="fact-hint"
								>{fullKey !== null
									? tf(
											'keys.server_api_key_full_hint',
											"The whole key. Anyone who has it can manage this server through its API, so keep it in your scripts' secret store."
										)
									: t('keys.server_api_key_hint')}</span
							>
						</dd>
					</dl>
				</Disclosure>
			</section>

			<section class="section" aria-labelledby="keys-diagram-title">
				<div class="section-head"><h2 id="keys-diagram-title">{t('diagram.how_title')}</h2></div>
				{#if loaded}
					<ConnectionDiagram
						idServer={id.host || here}
						relay={rel.host}
						idPort={id.port}
						relayPort={rel.port}
						mode={diagramMode}
					/>
				{:else}
					<States kind="loading" />
				{/if}
			</section>
		</div>

		<aside class="page-side" aria-label={t('keys.side_label')}>
			<section class="section" aria-labelledby="keys-qr-title">
				<div class="section-head"><h2 id="keys-qr-title">{t('keys.qr_title')}</h2></div>
				<p class="section-note">{t('keys.qr_hint')}</p>
				{#if warn.qr}
					<Notice tone="warning" message={t('keys.qr_unreachable_host')} />
				{/if}
				<div class="keys-qr" aria-live="polite">
					{#if !loaded}
						<States kind="loading" message={t('keys.qr_loading')} />
					{:else if qrText}
						<QR text={qrText} label={t('keys.qr_alt')} size={220} />
					{:else}
						<States
							kind="error"
							message={failed ? t('keys.qr_failed') : t('keys.no_qr')}
							retryLabel={t('actions.retry')}
							onretry={() => void loadConfig()}
						/>
					{/if}
				</div>
			</section>

			<section class="section" aria-labelledby="keys-next-title">
				<div class="section-head"><h2 id="keys-next-title">{t('keys.next_title')}</h2></div>
				<p class="section-note keys-next-mode">{@render modeSentence()}</p>
				<RowList>
					{#each steps as step (step)}
						{@const p = STEP_PAGES[step]}
						<ListRow href={link(p.href)} title={t(p.title)} sub={t(p.sub)} />
					{/each}
				</RowList>
			</section>

			<section class="section" aria-labelledby="keys-files-title">
				<div class="section-head"><h2 id="keys-files-title">{t('keys.files_title')}</h2></div>
				<div {@attach externalLinks}>
					<RowList>
						<ListRow title={t('keys.download_title')} sub={t('keys.download_hint')}>
							{#snippet end()}
								{#if publicKey}
									<Button
										href={KEY_FILE_URL}
										download="id_ed25519.pub"
										icon={ICONS.download}
										class="download-key">{t('keys.download')}</Button
									>
								{:else}
									<Button icon={ICONS.download} disabled class="download-key">{t('keys.download')}</Button>
								{/if}
							{/snippet}
						</ListRow>
						<ListRow
							href={RUSTDESK_RELEASES}
							title={t('dashboard.get_rustdesk')}
							sub={t('dashboard.get_rustdesk_hint')}
							chevron={false}
							end={externalMark}
						/>
						<ListRow
							href="/portal"
							title={t('keys.portal_title')}
							sub={t('keys.portal_sub')}
							chevron={false}
							end={externalMark}
						/>
					</RowList>
				</div>
			</section>
		</aside>
	</div>
</div>

<style>
	.keys-facts,
	.keys-page :global(.keys-local-warning),
	.keys-page :global(.keys-scripts) {
		max-width: 880px;
	}
	.keys-page :global(.keys-local-warning p) {
		margin: 0;
	}
	/* The config string is long: one line in the field, cut at its end */
	.config-field {
		display: flex;
		width: 100%;
		min-width: 0;
	}
	.config-field > :global(.value-field) {
		flex: 1 1 auto;
		min-width: 0;
	}
	.fact-hint {
		flex-basis: 100%;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.api-key {
		overflow-wrap: anywhere;
	}
	.keys-next-mode {
		margin-top: 0;
	}
	.keys-page :global(.row-end .btn) {
		white-space: nowrap;
	}

	/* Very wide screens: the page takes the whole width and the diagram sits
	   beside the values instead of below them */
	@media (min-width: 2200px) {
		.page.keys-page {
			max-width: none;
		}
		.keys-page .page-main {
			display: grid;
			grid-template-columns: minmax(0, 880px) minmax(0, 1fr);
			gap: var(--space-6) var(--space-7);
			align-items: start;
		}
	}
</style>
