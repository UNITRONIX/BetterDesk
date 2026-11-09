<!--
  /d/<id>: one support bundle's download page (views/agent-download.ejs).
  The bundle id is the access token. The company's name, text, logo and
  button colour, one row per installer (download, or building / failed),
  how to reach the support team, "Powered by" when the admin keeps it.
  While installers still build, the list refreshes every 8 s (not in a
  hidden tab). An unknown or withdrawn link shows the 404 page.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ApiError } from '#lib/api/client.ts';
	import {
		bundleDownloadUrl,
		getBundleManifest,
		getBundlePage,
		type BundlePage,
		type BundlePlatform
	} from '#lib/api/downloads.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import DownloadFrame from '#lib/public/DownloadFrame.svelte';
	import ErrorPage from '#lib/public/ErrorPage.svelte';
	import InstallerList, { type InstallerRow } from '#lib/public/InstallerList.svelte';
	import { detectComputer, matchingIndex } from '#lib/public/detect.ts';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import States from '#lib/ui/States.svelte';

	/** The product name after "Powered by", not translated */
	const PRODUCT = 'BetterDesk';
	const publicId = page.params.publicId ?? '';
	const mine = detectComputer(navigator.userAgent, true);

	let bundle = $state<BundlePage | null>(null);
	let phase = $state<'loading' | 'ready' | 'missing' | 'failed'>('loading');

	const pending = (p: BundlePlatform) => p.status !== 'ready' && p.status !== 'failed';

	const rows = $derived.by<InstallerRow[]>(() => {
		const b = bundle;
		if (!b) return [];
		// The installer for this computer says so; ready, it has the primary button
		const match = matchingIndex(b.platforms, mine);
		return b.platforms.map((p, i) => ({
			key: `${p.platform}/${p.arch}/${p.format}`,
			platform: p.platform,
			title: p.label || [p.platform, p.arch, p.format].filter(Boolean).join(' '),
			matches: i === match,
			href: p.status === 'ready' ? bundleDownloadUrl(b.publicId, p) : null,
			status: p.status === 'failed' ? 'failed' : 'building'
		}));
	});

	const product = $derived.by(() => {
		if (!bundle || bundle.product.hidden) return '';
		if (bundle.product.label) return bundle.product.label;
		return bundle.product.type === 'rdclient'
			? t('download.product_rdclient')
			: bundle.product.type === 'agent-client'
				? t('download.product_agent_client')
				: t('download.product_support_agent');
	});

	const contact = $derived.by<Fact[]>(() => {
		const c = bundle?.contact;
		if (!c) return [];
		const out: Fact[] = [];
		if (c.email) out.push({ label: t('download.contact_email'), value: email });
		if (c.phone) out.push({ label: t('download.contact_phone'), value: phone });
		if (c.url) out.push({ label: t('download.contact_web'), value: web });
		return out;
	});

	async function load() {
		phase = 'loading';
		try {
			bundle = await getBundlePage(publicId);
			phase = 'ready';
		} catch (err) {
			phase = err instanceof ApiError && err.status === 404 ? 'missing' : 'failed';
		}
	}

	onMount(() => void load());

	// Installers that still build: ask again every 8 s until all are ready or failed
	const building = $derived(phase === 'ready' && !!bundle?.platforms.some(pending));
	$effect(() => {
		if (!building) return;
		return poll(
			async () => {
				const m = await getBundleManifest(publicId);
				if (!bundle) return;
				const byKey = new Map(m.platforms.map((p) => [`${p.platform}/${p.arch}/${p.format}`, p.status]));
				bundle = {
					...bundle,
					platforms: bundle.platforms.map((p) => ({
						...p,
						status: byKey.get(`${p.platform}/${p.arch}/${p.format}`) ?? p.status
					}))
				};
			},
			{ every: 8000, immediate: false }
		);
	});
</script>

{#snippet email()}<a dir="ltr" href="mailto:{bundle?.contact.email}">{bundle?.contact.email}</a>{/snippet}
{#snippet phone()}<a dir="ltr" href="tel:{bundle?.contact.phone}">{bundle?.contact.phone}</a>{/snippet}
{#snippet web()}<a dir="ltr" href={bundle?.contact.url} target="_blank" rel="noopener noreferrer"
		>{bundle?.contact.url}</a
	>{/snippet}

<svelte:head>
	{#if bundle}<title>{bundle.companyName} - {t('download.title')}</title>{/if}
</svelte:head>

{#if phase === 'missing'}
	<ErrorPage status={404} />
{:else if phase === 'ready' && bundle}
	<DownloadFrame background={bundle.background} accent={bundle.accent}>
		<header class="dl-head">
			{#if bundle.logo}<img class="dl-logo" src={bundle.logo} alt="" />{/if}
			<h1>{bundle.companyName}</h1>
			{#if bundle.shortText}<p class="dl-description">{bundle.shortText}</p>{/if}
		</header>

		<section class="section" aria-labelledby="dl-platforms-title">
			<div class="section-head"><h2 id="dl-platforms-title">{t('download.choose_platform')}</h2></div>
			<p class="section-note">{t('download.choose_platform_hint')}</p>
			{#if product}<p class="dl-product">{product}</p>{/if}
			{#if rows.length}
				<div aria-live="polite"><InstallerList {rows} label={t('download.choose_platform')} /></div>
			{:else}
				<States kind="empty" message={t('download.no_platforms')} />
			{/if}
		</section>

		{#if contact.length}
			<section class="section" aria-labelledby="dl-help-title">
				<div class="section-head"><h2 id="dl-help-title">{t('download.need_help')}</h2></div>
				<Facts items={contact} />
			</section>
		{/if}

		{#if bundle.showPoweredBy}
			<footer class="dl-footer">{t('download.powered_by')} {PRODUCT}</footer>
		{/if}
	</DownloadFrame>
{:else}
	<DownloadFrame>
		{#if phase === 'failed'}
			<States kind="error" message={t('portal.load_failed')} onretry={() => void load()} />
		{:else}
			<States kind="loading" />
		{/if}
	</DownloadFrame>
{/if}

<style>
	.dl-head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.dl-logo {
		display: block;
		width: auto;
		max-width: 200px;
		height: 40px;
		margin-bottom: var(--space-2);
		object-fit: contain;
	}
	.dl-description,
	.dl-product {
		max-width: var(--measure);
		color: var(--text-muted);
	}
	.dl-footer {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
