<!--
  The install progress dialog (old settings.js "Update progress modal"):
  a bar with the step and what happens now, the six steps with their
  state, the log (copy, expand), and at the end what happened with Close,
  Reload console and, after errors, Copy log and Retry. It can't be closed
  while the install runs. After a restart it reloads the page itself
  after 8 seconds.
-->
<script lang="ts">
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { Copier } from '#lib/ui/clipboard.svelte.ts';
	import type { InstallRun } from './install.svelte.ts';
	import { PHASES, hasUpdateFailures, needsReload, type PhaseState } from './updates.ts';

	interface Props {
		run: InstallRun;
		onclose: () => void;
		onretry: () => void;
	}

	let { run, onclose, onretry }: Props = $props();

	const ICON: Record<PhaseState, string> = {
		pending: 'radio_button_unchecked',
		active: 'sync',
		done: 'check_circle',
		warning: 'warning',
		error: 'error',
		skipped: 'remove_circle_outline'
	};

	/** The step's state in words, for screen readers (the icon carries it on screen) */
	const STATE_WORD: Record<PhaseState, () => string> = {
		pending: () => tf('updates.step_waiting', 'Waiting'),
		active: () => tf('updates.step_running', 'Running'),
		done: () => tf('updates.step_done', 'Done'),
		warning: () => tf('updates.step_warning', 'Needs a look'),
		error: () => tf('updates.step_failed', 'Failed'),
		skipped: () => tf('updates.step_skipped', 'Skipped')
	};

	let expanded = $state(false);
	let countdown = $state<number | null>(null);
	const copier = new Copier();
	$effect(() => () => copier.dispose());

	const running = $derived(run.state === 'running');
	const failed = $derived(run.state === 'partial_error' || run.state === 'error');
	const title = $derived(
		running
			? t('updates.modal_title')
			: failed
				? t('updates.modal_done_with_errors_title')
				: t('updates.modal_done_title')
	);
	const o = $derived(run.outcome);
	const logText = $derived(run.log.join('\n'));

	function reload() {
		const url = new URL(location.href);
		url.searchParams.set('_bd_reload', String(Date.now()));
		location.replace(url.toString());
	}

	// Errors open the log; a finished restart reloads after 8 s
	$effect(() => {
		if (failed) expanded = true;
	});
	$effect(() => {
		if (run.state !== 'success_reload') return;
		countdown = 8;
		const timer = setInterval(() => {
			countdown = (countdown ?? 1) - 1;
			if (countdown <= 0) {
				clearInterval(timer);
				reload();
			}
		}, 1000);
		return () => clearInterval(timer);
	});

	function close() {
		run.stop();
		onclose();
	}

	let logEl = $state<HTMLElement | null>(null);
	// New lines scroll into view while the reader is at the bottom
	$effect.pre(() => {
		void run.log.length;
		const el = logEl;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
		if (atBottom) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
	});
</script>

<Dialog {title} size="large" blocking={running} onclose={close}>
	<div class="wizard">
		<div class="bar-wrap">
			<div
				class="bar"
				role="progressbar"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={run.percent}
				aria-label={t('updates.modal_title')}
			>
				<span class="bar-fill" style:width="{run.percent}%"></span>
			</div>
			<p class="meta">
				<span>{t('updates.progress_step', { current: run.step, total: PHASES.length })}</span>
				<span class="detail" role="status">{run.detail}</span>
				<span>{run.percent} %</span>
			</p>
		</div>

		<ol class="phases">
			{#each PHASES as p (p.id)}
				{@const st = run.phases[p.id]}
				<li class={['phase', `is-${st}`]}>
					<span class="phase-label">{t(p.key)}</span>
					<span class="phase-state"
						><Icon name={ICON[st]} /><span class="sr-only">{STATE_WORD[st]()}</span></span
					>
				</li>
			{/each}
		</ol>

		<div class="log-panel">
			<div class="log-toolbar">
				<span class="log-title" id="update-log-title">{t('updates.log_title')}</span>
				<Button size="sm" aria-expanded={expanded} onclick={() => (expanded = !expanded)}
					>{expanded ? t('updates.log_collapse') : t('updates.log_expand')}</Button
				>
				<Button size="sm" icon="copy" disabled={!logText} onclick={() => copier.copy(logText)}
					>{copier.copied ? t('common.copied') : t('updates.log_copy')}</Button
				>
			</div>
			<!-- svelte-ignore a11y_no_noninteractive_tabindex (a scrolling log must be reachable with the keyboard) -->
			<pre
				class={['log', expanded && 'is-expanded']}
				bind:this={logEl}
				aria-labelledby="update-log-title"
				tabindex="0">{logText}</pre>
		</div>

		{#if !running && o}
			<div class={['banner', failed ? (o.restartTimeout ? 'is-warning' : 'is-error') : 'is-success']}>
				{#if run.state === 'success_reload'}
					<p>{t('updates.restart_complete_msg')}</p>
				{:else}
					{#if !failed}<p>{t('updates.complete_summary')}</p>{/if}
					{#if failed && !o.errorMessage}
						<p>{hasUpdateFailures(o) ? t('updates.complete_with_errors') : t('updates.complete_summary')}</p>
					{/if}
					{#if !o.errorMessage}
						<ul>
							<li>{t('updates.applied')}: <strong>{o.applied?.length ?? 0}</strong></li>
							<li>{t('updates.failed')}: <strong>{o.failed?.length ?? 0}</strong></li>
							<li>{t('updates.removed')}: <strong>{o.removed?.length ?? 0}</strong></li>
						</ul>
					{/if}
					{#if o.failed?.length}
						<ul class="errors">
							{#each o.failed as f, i (i)}
								{@const item = f as { file?: string; error?: string }}
								<li><strong>{item.file || 'unknown'}</strong>{item.error ? `: ${item.error}` : ''}</li>
							{/each}
						</ul>
					{/if}
					{#if o.servicesFailed?.length}
						<ul class="errors">
							{#each o.servicesFailed as s, i (i)}
								{@const item = s as { service?: string; error?: string }}
								<li><strong>{item.service || 'service'}</strong>{item.error ? `: ${item.error}` : ''}</li>
							{/each}
						</ul>
					{/if}
					{#if o.consoleRestartBlocked}<p class="errors">{o.consoleRestartBlocked}</p>{/if}
					{#if o.restartTimeout}
						<p>{t('updates.restart_timeout')}</p>
						<p>{t('updates.refresh_recommended')}</p>
					{/if}
					{#if o.errorMessage}<p class="errors">{o.errorMessage}</p>{/if}
					{#if o.serverDeploy?.success === false}
						<p class="errors"><strong>{t('updates.server_deploy_failed')}</strong></p>
					{:else if o.serverBuild?.success}
						<p>{t('updates.server_built')}</p>
					{/if}
					{#if needsReload(o.applied) && !o.restartTimeout}<p>{t('updates.refresh_recommended')}</p>{/if}
				{/if}
				{#if countdown !== null && run.state === 'success_reload'}
					<p class="countdown" role="status">
						{t('updates.reload_countdown', { seconds: Math.max(0, countdown) })}
					</p>
				{/if}
			</div>
		{/if}
	</div>

	{#snippet footer()}
		{#if !running}
			<Button onclick={close}>{t('updates.modal_close')}</Button>
			{#if failed}
				{#if o?.restartTimeout}
					<Button icon="refresh" onclick={reload}>{t('updates.modal_reload_now')}</Button>
				{/if}
				<Button icon="copy" onclick={() => copier.copy(logText)}>{t('updates.log_copy')}</Button>
				<Button variant="primary" icon="retry" onclick={onretry}>{t('updates.retry_update')}</Button>
			{:else if run.offersReload}
				<Button variant="primary" icon="refresh" onclick={reload}>{t('updates.modal_reload_now')}</Button>
			{/if}
		{/if}
	{/snippet}
</Dialog>

<style>
	.wizard {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.bar {
		height: 6px;
		overflow: hidden;
		border-radius: 1px;
		background: var(--hover);
	}
	.bar-fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
		margin-top: var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.detail {
		flex: 1;
		min-width: 0;
	}
	.phases {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.phase {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--row-h);
		border-bottom: 1px solid var(--rule);
	}
	.phase-label {
		flex: 1;
	}
	.phase.is-pending,
	.phase.is-skipped {
		color: var(--text-muted);
	}
	.phase.is-active {
		font-weight: 600;
	}
	.phase-state :global(.material-icons) {
		font-size: 18px;
	}
	.phase.is-done .phase-state {
		color: var(--success);
	}
	.phase.is-warning .phase-state {
		color: var(--warning);
	}
	.phase.is-error .phase-state {
		color: var(--danger);
	}
	.log-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.log-title {
		margin-inline-end: auto;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.log {
		max-height: 160px;
		margin: var(--space-1) 0 0;
		padding: var(--space-2);
		overflow: auto;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		font-size: var(--text-sm);
		white-space: pre-wrap;
	}
	.log.is-expanded {
		max-height: 420px;
	}
	.banner {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		padding-inline-start: var(--space-3);
		border-inline-start: 3px solid var(--rule);
	}
	.banner.is-success {
		border-inline-start-color: var(--success);
	}
	.banner.is-warning {
		border-inline-start-color: var(--warning);
	}
	.banner.is-error {
		border-inline-start-color: var(--danger);
	}
	.banner ul {
		margin: 0;
		padding-inline-start: 1.25em;
	}
	.errors {
		color: var(--danger);
	}
</style>
