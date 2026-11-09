<!--
  Support agents (/agents; the old /generator redirects here on the
  server): the signed agent release this server serves on its download
  page, how to set an agent up, where people get it, and where its name
  and logo come from.

  The page needs one of the four admin roles (requireAdmin, DECISIONS R7).
  Reading and importing the release need enrollment.manage; the Activate
  agent link needs enrollment.approve; the branding link branding.edit.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { importLatest, installerCount, listReleases, type AgentRelease } from '#lib/api/agents.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import { fill, isAdminRole, releaseError } from '#lib/clients/agents.ts';
	import { externalLinks } from '#lib/clients/links.ts';
	import { around } from '#lib/clients/text.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { has, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Steps from '#lib/ui/Steps.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import Version from '#lib/ui/Version.svelte';

	const GITHUB_RELEASES = 'https://github.com/UNITRONIX/BetterDesk-Client/releases';
	const allowed = isAdminRole(session.user?.role);
	const canImport = can('enrollment.manage');

	/** The server's message for a failed request, in the console's words */
	function why(err: unknown): string {
		const fallback = tf('agents.request_failed', 'The request could not be completed.');
		if (err instanceof ApiError && (err.status === 403 || err.status === 0)) return err.message;
		const raw = err instanceof Error ? err.message : '';
		return releaseError(raw, (k) => (has(k) ? t(k) : undefined), fallback);
	}

	/* ── Release ── */

	let latest = $state.raw<AgentRelease | null>(null);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);

	async function load(): Promise<void> {
		if (!allowed) return;
		// Reading the release needs enrollment.manage too: say so instead of asking
		if (!canImport) {
			loaded = true;
			return;
		}
		try {
			const list = await listReleases();
			latest = list[0] ?? null;
			loadError = null;
		} catch (err) {
			loadError = why(err);
		} finally {
			loaded = true;
		}
	}

	let importing = $state(false);
	let status = $state<{ message: string; tone: 'neutral' | 'ok' | 'error' }>({
		message: '',
		tone: 'neutral'
	});

	async function runImport() {
		if (importing) return;
		importing = true;
		status = { message: t('agents.sync_importing'), tone: 'neutral' };
		try {
			const tag = await importLatest();
			status = { message: fill(t('agents.sync_imported'), { tag }), tone: 'ok' };
			await load();
		} catch (err) {
			status = { message: why(err), tone: 'error' };
		} finally {
			importing = false;
		}
	}

	$effect(() => untrack(() => void load()));
	$effect(() => onRefresh(() => void load()));

	/** The download page's full address, to copy and send */
	const portal = typeof location !== 'undefined' ? `${location.origin}/portal` : '/portal';

	const [importedPre, importedPost] = $derived(around(t('agents.imported_on'), '{{date}}'));
</script>

{#snippet step3()}{@const [pre, post] = around(
		t('agents.step3'),
		'{page}'
	)}{pre}{#if can('enrollment.approve')}<a href={link('/?activateAgent=1')}>{t('nav.activate_agent')}</a
		>{:else}{t('nav.activate_agent')}{/if}{post}{/snippet}

{#snippet step4()}{@const [pre, post] = around(
		t('agents.step4'),
		'{page}'
	)}{pre}{#if can('enrollment.approve')}<a href={link('/registrations')}>{t('nav.registrations')}</a
		>{:else}{t('nav.registrations')}{/if}{post}{/snippet}

{#snippet externalMark()}<Icon name="open_in_new" class="row-chevron" />{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page agents-page">
		<div class="page-head">
			<h1>{t('nav.agents')}</h1>
			<p class="page-description">{t('agents.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				<section class="section" aria-labelledby="agents-sync-title">
					<div class="section-head"><h2 id="agents-sync-title">{t('agents.sync_title')}</h2></div>
					<p class="section-note">{t('agents.sync_hint')}</p>

					<dl class="facts agents-release" aria-live="polite">
						<dt>{t('agents.release_label')}</dt>
						<dd>
							{#if !canImport}
								<span class="text-muted">{t('agents.sync_no_permission')}</span>
							{:else if !loaded}
								<span class="text-muted">{t('common.loading')}</span>
							{:else if loadError}
								<States kind="error" message={loadError} onretry={() => void load()} />
							{:else if latest}
								{#if latest.tag}<Version version={latest.tag} />{:else}{t('agents.release_label')}{/if}
								<span class="text-muted"
									>{#if latest.imported_at}{importedPre}<Time value={latest.imported_at} />{importedPost},
									{/if}{fill(t('agents.sync_artifacts'), { count: formatNumber(installerCount(latest)) })},
									{t('agents.sync_verified')}</span
								>
							{:else}
								<span class="text-muted">{t('agents.sync_empty')}</span>
							{/if}
						</dd>
					</dl>

					{#if canImport}
						<div class="form-actions">
							<Button
								variant="primary"
								busy={importing}
								class="agents-import"
								onclick={() => void runImport()}>{t('agents.sync_import')}</Button
							>
							<FormStatus message={status.message} tone={status.tone} />
						</div>
					{/if}
				</section>

				<section class="section" aria-labelledby="agents-steps-title">
					<div class="section-head"><h2 id="agents-steps-title">{t('agents.steps_title')}</h2></div>
					<Steps items={[t('agents.step1'), t('agents.step2'), step3, step4]} />
				</section>
			</div>

			<aside class="page-side" aria-label={t('agents.side_label')}>
				<section class="section" aria-labelledby="agents-links-title">
					<div class="section-head"><h2 id="agents-links-title">{t('agents.get_title')}</h2></div>
					<p class="section-note">{t('agents.portal_hint')}</p>
					<span class="portal-field"><ValueField value={portal} label={t('agents.portal_address')} /></span>
					<div {@attach externalLinks}>
						<RowList>
							<ListRow
								href="/portal"
								title={t('agents.get_portal')}
								sub={t('agents.portal_open_hint')}
								chevron={false}
								end={externalMark}
							/>
							<ListRow
								href={GITHUB_RELEASES}
								title={t('agents.get_github')}
								sub={t('agents.note_no_build')}
								chevron={false}
								end={externalMark}
							/>
						</RowList>
					</div>
				</section>

				<section class="section" aria-labelledby="agents-branding-title">
					<div class="section-head"><h2 id="agents-branding-title">{t('agents.branding_title')}</h2></div>
					<p class="section-note">{t('agents.branding_body')}</p>
					{#if can('branding.edit')}
						<p class="branding-link"><a href={link('/client-branding')}>{t('nav.client_branding')}</a></p>
					{/if}
				</section>
			</aside>
		</div>
	</div>
{/if}

<style>
	.agents-release {
		max-width: 880px;
	}
	.agents-page :global(.steps) {
		max-width: var(--measure);
	}
	.form-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.branding-link {
		margin: 0;
	}
	.portal-field {
		display: flex;
		min-width: 0;
	}

	/* Wide screens: the installers and the setup steps sit side by side */
	@media (min-width: 1800px) {
		.agents-page .page-main {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: var(--space-6) var(--space-7);
			align-items: start;
		}
	}
	@media (min-width: 2200px) {
		.page.agents-page {
			max-width: none;
		}
	}
</style>
