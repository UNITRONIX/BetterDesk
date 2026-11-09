<!--
  /portal: the support agent's download page for the people who need help
  (views/downloads-portal.ejs). The installers of the latest imported
  release, the one for this computer first in line; when there is none,
  why (no release imported yet, files missing) in plain words.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getInstallers, type Installers } from '#lib/api/downloads.ts';
	import { getLoginPage } from '#lib/api/signin.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import DownloadFrame from '#lib/public/DownloadFrame.svelte';
	import InstallerList, { type InstallerRow } from '#lib/public/InstallerList.svelte';
	import { detectComputer, installerTitle, matchingIndex, safeDownloadUrl } from '#lib/public/detect.ts';
	import States from '#lib/ui/States.svelte';
	import Version from '#lib/ui/Version.svelte';

	let data = $state<Installers | null>(null);
	let failed = $state(false);
	let appName = $state('');

	const mine = detectComputer(navigator.userAgent);

	const rows = $derived.by<InstallerRow[]>(() => {
		const list = data?.installers ?? [];
		const match = matchingIndex(list, mine);
		return list.map((i, n) => ({
			key: `${i.platform}/${i.arch}/${i.format}/${n}`,
			platform: i.platform,
			title: installerTitle(i, (f) => (f === 'portable' ? t('portal.format_portable') : f)),
			matches: n === match,
			href: safeDownloadUrl(i.url)
		}));
	});

	const emptyText = $derived(
		data?.reason === 'no_release_imported'
			? t('portal.no_release')
			: data?.reason === 'release_cache_incomplete'
				? t('portal.incomplete')
				: t('portal.empty')
	);
	const releaseParts = $derived(t('portal.release').split('{tag}'));

	async function load() {
		failed = false;
		data = null;
		try {
			data = await getInstallers();
		} catch {
			failed = true;
		}
	}

	onMount(() => {
		void load();
		// The console's name for the window title, as the old page had it
		getLoginPage()
			.then((p) => (appName = p.appName))
			.catch(() => {});
	});
</script>

<svelte:head>
	<title>{t('portal.title')}{appName ? ` - ${appName}` : ''}</title>
</svelte:head>

<DownloadFrame>
	<header class="dl-head">
		<h1>{t('portal.title')}</h1>
		<p class="dl-description">{t('portal.description')}</p>
	</header>

	<section class="section" aria-labelledby="portal-list-title">
		<div class="section-head"><h2 id="portal-list-title">{t('download.choose_platform')}</h2></div>
		{#if data?.release && rows.length}
			<p class="count-line">
				{releaseParts[0]}<Version version={data.release} />{releaseParts.slice(1).join('')}
			</p>
		{/if}
		<div aria-live="polite">
			{#if failed}
				<States kind="error" message={t('portal.load_failed')} onretry={() => void load()} />
			{:else if !data}
				<States kind="loading" message={t('portal.loading')} />
			{:else if !rows.length}
				<States kind="empty" message={emptyText} />
			{:else}
				<InstallerList {rows} label={t('download.choose_platform')} />
			{/if}
		</div>
	</section>

	<p class="dl-footer">{t('portal.footer')}</p>
</DownloadFrame>

<style>
	.dl-head {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}
	.dl-description {
		max-width: var(--measure);
		color: var(--text-muted);
	}
	.count-line {
		color: var(--text-muted);
	}
	.dl-footer {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
