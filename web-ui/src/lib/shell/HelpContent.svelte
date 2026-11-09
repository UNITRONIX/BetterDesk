<!--
  What the Help panel shows (views/partials/help-panel.ejs): thanks, the
  project's supporters, ways to support it and useful links, from
  config/supporters.json. Every link opens a new tab without access back
  to the console; only http(s) links and console paths are used.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import States from '#lib/ui/States.svelte';
	import { getSupporters, type Supporters } from './api.ts';

	let data = $state.raw<Supporters | null>(null);
	let failed = $state(false);

	async function load() {
		failed = false;
		try {
			data = await getSupporters();
		} catch {
			failed = true;
		}
	}

	onMount(() => void load());

	/** An outside link we may show: http(s) only */
	function web(url: string | null | undefined): string {
		const u = String(url ?? '');
		return /^https?:\/\//i.test(u) ? u : '';
	}
	/** A picture we may load: a console path only (the CSP blocks others anyway) */
	function local(url: string | null | undefined): string {
		const u = String(url ?? '');
		return u.startsWith('/') && !u.startsWith('//') && !u.includes('\\') ? u : '';
	}

	const links = $derived(data?.links);
	const support = $derived(
		[
			{ href: web(links?.sponsors), icon: 'volunteer_activism', key: 'help.panel.link_sponsors' },
			{ href: web(links?.buyMeACoffee), icon: 'local_cafe', key: 'help.panel.link_bmc' }
		].filter((l) => l.href)
	);
	const useful = $derived(
		[
			{ href: web(links?.repo), icon: 'code', key: 'help.panel.link_repo' },
			{ href: web(links?.issues), icon: 'bug_report', key: 'help.panel.link_issues' },
			{ href: web(links?.sponsorsMd), icon: 'menu_book', key: 'help.panel.link_sponsors_md' }
		].filter((l) => l.href)
	);
</script>

<div class="help-content">
	<p class="help-thanks">{t('help.panel.thanks')}</p>

	{#if failed}
		<States kind="error" message={t('errors.try_again')} retryLabel={t('actions.retry')} onretry={load} />
	{:else if !data}
		<States kind="loading" />
	{:else}
		{#if data.honorary.length}
			<section class="help-section">
				<h3>{t('help.panel.honorary')}</h3>
				<ul class="help-list">
					{#each data.honorary as item, i (i)}
						{@const url = web(item.url)}
						{@const logo = local(item.logo)}
						<li class="help-row">
							{#if logo}
								{#if url}
									<a class="help-logo-link" href={url} target="_blank" rel="noopener noreferrer">
										<img class="help-logo" src={logo} alt={item.name} loading="lazy" />
									</a>
								{:else}
									<img class="help-logo" src={logo} alt={item.name} loading="lazy" />
								{/if}
							{/if}
							{#if url}
								<a class="help-name" href={url} target="_blank" rel="noopener noreferrer">{item.name}</a>
							{:else}
								<span class="help-name">{item.name}</span>
							{/if}
							{#if item.role}<span class="help-meta">{item.role}</span>{/if}
							{#if item.blurb}<p class="help-blurb">{item.blurb}</p>{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if data.individuals.length}
			<section class="help-section">
				<h3>{t('help.panel.backers')}</h3>
				<ul class="help-list">
					{#each data.individuals as item, i (i)}
						{@const gh = web(item.githubUrl)}
						<li class="help-row is-person">
							<Icon name="person" />
							<span class="help-person">
								<span class="help-name">{item.name}</span>
								{#if gh}
									<a class="help-meta" href={gh} target="_blank" rel="noopener noreferrer"
										>@{item.github || item.name}</a
									>
								{:else if item.github}
									<span class="help-meta">@{item.github}</span>
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if support.length}
			<section class="help-section">
				<h3>{t('help.panel.sponsor_cta')}</h3>
				<ul class="help-links">
					{#each support as l (l.key)}
						<li>
							<a href={l.href} target="_blank" rel="noopener noreferrer"><Icon name={l.icon} />{t(l.key)}</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if useful.length}
			<section class="help-section">
				<h3>{t('help.panel.links')}</h3>
				<ul class="help-links">
					{#each useful as l (l.key)}
						<li>
							<a href={l.href} target="_blank" rel="noopener noreferrer"><Icon name={l.icon} />{t(l.key)}</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>

<style>
	.help-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.help-thanks {
		color: var(--text-muted);
	}
	.help-section h3 {
		margin-bottom: var(--space-2);
		font-size: var(--text-base);
		font-weight: 600;
	}
	.help-list,
	.help-links {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	/* Plain rows on rules, no boxes */
	.help-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: var(--space-2) 0;
	}
	.help-row + .help-row {
		border-top: 1px solid var(--rule);
	}
	.help-row.is-person {
		flex-direction: row;
		align-items: center;
		gap: var(--space-2);
	}
	.help-row.is-person > :global(.material-icons) {
		color: var(--text-muted);
		font-size: 20px;
	}
	.help-person {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.help-logo-link {
		display: block;
		align-self: flex-start;
	}
	.help-logo {
		display: block;
		max-width: 160px;
		max-height: 48px;
		margin-bottom: var(--space-1);
		object-fit: contain;
	}
	.help-name {
		color: var(--text);
		font-weight: 600;
	}
	a.help-name {
		color: var(--accent);
	}
	.help-meta {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	a.help-meta {
		color: var(--accent);
	}
	.help-blurb {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.help-links a {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--control-h);
		padding: var(--space-1) 0;
	}
	.help-links a > :global(.material-icons) {
		color: var(--text-muted);
		font-size: 18px;
	}
	@media (pointer: coarse) {
		.help-links a {
			min-height: 44px;
		}
	}
</style>
