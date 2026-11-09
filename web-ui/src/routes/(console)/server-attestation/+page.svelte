<!--
  Capacity test (/server-attestation): run the load test, follow it, read
  the last result, and change what the sign-in page badge says. Needs
  server.attestation for the page and every call.

  The last result section shows only when there is a result; until then
  one line under "Run the test" says no test has run. While a test runs,
  the status is read every 2 s (paused in hidden tabs).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		getBadge,
		getStatus,
		runTest,
		saveBadge,
		stopTest,
		TIERS,
		type Progress,
		type Result
	} from '#lib/api/serverAttestation.ts';
	import { formatNumber, formatPercent } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import {
		outcome,
		phaseText,
		progressPercent,
		reportFileName,
		tierName
	} from '#lib/serverarea/attestation.ts';
	import { around } from '#lib/serverarea/text.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Meter from '#lib/ui/Meter.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	const allowed = $derived(can('server.attestation'));
	const uid = $props.id();

	let result = $state.raw<Result | null>(null);
	let running = $state(false);
	let progress = $state.raw<Progress | null>(null);
	let starting = $state(false);
	let stopping = $state(false);

	/** The names the admin set (saved), and the brand the sign-in page shows */
	let saved = $state.raw<Record<string, string>>({});
	let brand = $state('');

	/* ── Status ── */

	let stopPoll: (() => void) | null = null;

	function follow() {
		stopPoll?.();
		stopPoll = poll(
			async () => {
				const s = await getStatus();
				running = s.running;
				if (s.progress) progress = s.progress;
				if (!s.running) {
					stopPoll?.();
					stopPoll = null;
					stopping = false;
					const r = s.lastResult ?? s.progress?.result ?? null;
					if (r) {
						result = r;
						const end = outcome(r);
						if (end === 'stopped') toast.info(tf('server_attestation.stopped', 'Capacity test stopped.'));
						else if (end === 'complete') toast.success(t('server_attestation.complete'));
						else toast.warning(t('server_attestation.incomplete'));
					}
				}
			},
			{ every: 2000 }
		);
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			getStatus().then(
				(s) => {
					if (s.lastResult) result = s.lastResult;
					if (s.running) {
						running = true;
						progress = s.progress;
						follow();
					}
				},
				() => {
					/* the page still works: Run tries again */
				}
			);
			void loadBadge();
		});
		return () => stopPoll?.();
	});

	async function run() {
		const ok = await confirm({
			title: tf('server_attestation.confirm_title', 'Run the capacity test now?'),
			message: t('server_attestation.confirm_run'),
			confirmLabel: t('server_attestation.run_benchmark'),
			confirmIcon: ICONS.run
		});
		if (!ok) return;
		starting = true;
		running = true;
		progress = { phase: 'starting', connections: 0, message: '', result: null };
		try {
			await runTest();
			follow();
		} catch (err) {
			running = false;
			progress = null;
			toast.error(
				tf('server_attestation.start_failed', 'Could not start the test: {error}', {
					error: err instanceof Error ? err.message : String(err)
				})
			);
		} finally {
			starting = false;
		}
	}

	async function stop() {
		stopping = true;
		try {
			await stopTest();
		} catch {
			/* the next status read says how it ended */
		}
	}

	function download() {
		if (!result) return;
		const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = reportFileName(result);
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	/* ── Badge ── */

	const form = createForm({
		initial: { title: '', bronze: '', iron: '', platinum: '', titanium: '', obsidian: '' },
		submit: async (v) => {
			const tierLabels = Object.fromEntries(TIERS.map((tier) => [tier, v[tier]]));
			let out;
			try {
				out = await saveBadge({ badgeTitle: v.title, tierLabels });
			} catch (err) {
				throw new Error(
					tf('server_attestation.badge_save_failed', 'Could not save the badge settings: {error}', {
						error: err instanceof Error ? err.message : String(err)
					}),
					{ cause: err }
				);
			}
			saved = out.config.tierLabels;
			if (out.presentation?.brand) brand = out.presentation.brand;
			return { title: out.config.badgeTitle, ...pick(out.config.tierLabels) };
		},
		savedMessage: tf('server_attestation.badge_settings_saved', 'Badge settings saved.')
	});

	const pick = (labels: Record<string, string>) =>
		Object.fromEntries(TIERS.map((tier) => [tier, labels[tier] ?? ''])) as Record<
			(typeof TIERS)[number],
			string
		>;

	async function loadBadge() {
		try {
			const b = await getBadge();
			saved = b.config.tierLabels;
			brand = b.presentation?.brand || '';
			form.reset({ title: b.config.badgeTitle, ...pick(b.config.tierLabels) });
		} catch {
			/* the fields stay empty: the defaults apply */
		}
	}

	/* ── Words ── */

	const translate = (key: string) => t(key);
	const resultTier = $derived(tierName(result?.tier, saved, translate));
	const sentence = $derived(
		result
			? around('server_attestation.result_sentence', 'date', {
					count: formatNumber(result.maxConnections || 0),
					tier: resultTier
				})
			: ['', '']
	);
	const pct = $derived(progressPercent(progress));
	const phase = $derived(progress ? phaseText(progress) : null);
	const phaseLine = $derived(
		stopping
			? tf('server_attestation.stopping', 'Stopping…')
			: phase
				? phase.key
					? tf(phase.key, phase.fallback, phase.params)
					: phase.fallback
				: ''
	);

	/* The preview follows the fields as they are typed */
	const previewTitle = $derived(form.values.title.trim() || t('server_attestation.badge_tooltip'));
	const previewTier = $derived(
		result?.tier
			? form.values[result.tier as (typeof TIERS)[number]]?.trim() || tierName(result.tier, {}, translate)
			: tierName(null, {}, translate)
	);
	const metric = (v: number | null | undefined) => (v === null || v === undefined ? '' : formatPercent(v));
</script>

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page sa-page">
		<div class="page-head">
			<h1>{t('nav.server_attestation')}</h1>
			<p class="page-description">{t('server_attestation.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				{#if result}
					<section class="section" id="sa-result-section" aria-labelledby="{uid}-result">
						<div class="section-head">
							<h2 id="{uid}-result">{t('server_attestation.result_title')}</h2>
							<Button size="sm" class="sa-download" icon={ICONS.download} onclick={download}
								>{t('server_attestation.download_report')}</Button
							>
						</div>
						<p class="sentence">
							{#if result.testedAt}{sentence[0]}<Time
									value={result.testedAt}
									relative={false}
								/>{sentence[1]}{:else}{t('server_attestation.no_test_yet')}{/if}
						</p>
						{#if result.mode === 'estimated'}
							<Notice message={t('server_attestation.mode_estimated')} />
						{/if}
						<dl class="facts sa-facts">
							<dt>{t('server_attestation.max_connections')}</dt>
							<dd>
								{#if result.maxConnections !== null}<span class="num"
										>{formatNumber(result.maxConnections)}</span
									>{:else}<Empty />{/if}
								{#if result.signalConnections !== null || result.relaySessions !== null}
									<span class="sub"
										>{t('server_attestation.conn_detail', {
											signal: formatNumber(result.signalConnections || 0),
											relay: formatNumber(result.relaySessions || 0)
										})}</span
									>
								{/if}
							</dd>
							<dt>{t('server_attestation.tier_label')}</dt>
							<dd>{resultTier}</dd>
							<dt>{t('server_attestation.cpu_at_end')}</dt>
							<dd>{metric(result.finalMetrics?.cpu) || '–'}</dd>
							<dt>{t('server_attestation.mem_at_end')}</dt>
							<dd>{metric(result.finalMetrics?.mem) || '–'}</dd>
							<dt>{t('server_attestation.disk_at_end')}</dt>
							<dd>{metric(result.finalMetrics?.disk) || '–'}</dd>
						</dl>
						<p class="section-note">{t('server_attestation.docker_note')}</p>
					</section>
				{/if}

				<section class="section" aria-labelledby="{uid}-run">
					<div class="section-head"><h2 id="{uid}-run">{t('server_attestation.run_title')}</h2></div>
					{#if !result}<p class="sentence">{t('server_attestation.no_test_yet')}</p>{/if}
					<Notice tone="warning" message={t('server_attestation.warning_body')} />
					<div class="actions">
						<Button
							class="sa-run"
							variant="primary"
							icon={ICONS.run}
							disabled={running}
							busy={starting}
							onclick={run}>{t('server_attestation.run_benchmark')}</Button
						>
						{#if running && !starting}
							<Button class="sa-stop" disabled={stopping} onclick={stop}
								>{t('server_attestation.abort')}</Button
							>
						{/if}
					</div>
					{#if running}
						<div class="progress">
							<Meter value={pct} high={101} full={101} />
							<p class="progress-text" role="status">{phaseLine}</p>
						</div>
					{/if}
				</section>
			</div>

			<aside class="page-side" aria-labelledby="{uid}-tiers">
				<section class="section">
					<div class="section-head"><h2 id="{uid}-tiers">{t('server_attestation.tier_guide_title')}</h2></div>
					<dl class="facts tier-guide">
						{#each TIERS as tier (tier)}
							<dt class={['tier-name', result?.tier === tier && 'is-current']}>
								{tierName(tier, saved, translate)}
							</dt>
							<dd>
								<span>{t(`server_attestation.tier_${tier}_desc`)}</span>
								{#if result?.tier === tier}
									<span class="tier-current">{t('server_attestation.tier_this_server')}</span>
								{/if}
							</dd>
						{/each}
					</dl>
				</section>

				<Disclosure class="section" title={t('server_attestation.badge_settings_title')}>
					<form id={form.id} class="badge-form" onsubmit={form.onsubmit} novalidate>
						<p class="section-note">{t('server_attestation.badge_settings_desc')}</p>
						<div class="preview" role="group" aria-labelledby="{uid}-preview">
							<p class="label" id="{uid}-preview">{t('server_attestation.badge_preview')}</p>
							<div class="badge" title={previewTitle}>
								<span class="badge-brand">{brand || session.appName}</span>
								<span class="badge-tier">{previewTier}</span>
								{#if result?.maxConnections}
									<span class="badge-conn"
										>{formatNumber(result.maxConnections)} {t('server_attestation.connections_short')}</span
									>
								{/if}
							</div>
							<p class="hint">{t('server_attestation.badge_hover', { title: previewTitle })}</p>
						</div>
						<Field
							label={t('server_attestation.badge_title')}
							hint={t('server_attestation.badge_title_hint')}
						>
							{#snippet children(f)}
								<Input {...f} maxlength={96} autocomplete="off" bind:value={form.values.title} />
							{/snippet}
						</Field>
						<p class="hint" id="{uid}-tier-hint">{t('server_attestation.tier_names_hint')}</p>
						{#each TIERS as tier (tier)}
							<Field label={t(`server_attestation.tier_name_${tier}`)}>
								{#snippet children(f)}
									<Input
										{...f}
										describedby="{uid}-tier-hint"
										width="medium"
										maxlength={32}
										autocomplete="off"
										bind:value={form.values[tier]}
									/>
								{/snippet}
							</Field>
						{/each}
						<p class="effect">{t('server_attestation.badge_effect')}</p>
						<SaveBar {form} label={t('server_attestation.save_badge_settings')} />
					</form>
				</Disclosure>
			</aside>
		</div>
	</div>
{/if}

<style>
	.sentence {
		margin: 0;
		max-width: var(--measure);
	}
	.sa-facts > dd {
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 2px;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.sub {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: var(--measure);
	}
	.progress-text {
		margin: 0;
		color: var(--text-muted);
	}
	/* Side column: tier name above its description, the reached tier marked in words */
	.tier-guide {
		grid-template-columns: minmax(0, 1fr);
	}
	.tier-guide > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
		color: var(--text);
		font-weight: 600;
	}
	.tier-guide > dd {
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-height: 0;
		padding-top: var(--space-1);
	}
	.tier-current {
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.badge-form {
		margin-top: var(--space-3);
	}
	.preview {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-block: var(--space-4);
	}
	.label {
		margin: 0;
		font-weight: 600;
	}
	/* The same three lines the sign-in page shows, plain and legible */
	.badge {
		display: inline-flex;
		flex-direction: column;
		align-self: flex-start;
		gap: 2px;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
	}
	.badge-brand,
	.badge-conn {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.badge-tier {
		font-weight: 600;
	}
	.hint {
		margin: 0 0 var(--space-3);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.effect {
		margin: 0 0 var(--space-3);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
