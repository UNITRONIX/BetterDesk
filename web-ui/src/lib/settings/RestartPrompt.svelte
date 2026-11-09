<!--
  The "restart required" dialog (old restart-flow.js). The shell mounts it
  once, next to DialogHost: <RestartPrompt />. No props. For people with
  server.config it asks the server on mount whether a restart of theirs is
  waiting, finished or failed, and shows it; pages open it through
  showRestartPrompt() in restart.svelte.ts after a save that needs a
  restart.

  Waiting: restart now, or cancel and put the previous values back
  (blocking, like the old modal). Restarting: the probe's progress
  (blocking). Ready: go to the sign-in page. Failed: try again or keep the
  saved values; this one can be closed.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import { warnOnLeave } from '#lib/ui/form.svelte.ts';
	import {
		cancelPendingRestart,
		confirmPendingRestart,
		dismissFailedRestart,
		finishAndSignIn,
		hideRestartPrompt,
		restartFlow,
		resumeRestart
	} from './restart.svelte.ts';

	onMount(() => {
		if (can('server.config')) void resumeRestart();
	});

	// Leaving while a restart waits or runs loses the answer or the progress
	$effect(() => warnOnLeave(() => restartFlow.view === 'pending' || restartFlow.view === 'restarting'));

	const view = $derived(restartFlow.view);
	const changes = $derived((restartFlow.item?.changes ?? []).map((c) => c.label || c.key).filter(Boolean));

	const title = $derived(
		view === 'restarting'
			? tf('settings.restart_prompt.title_progress', 'Restarting BetterDesk')
			: view === 'ready'
				? tf('settings.restart_prompt.title_ready', 'BetterDesk is back')
				: view === 'failed'
					? tf('settings.restart_prompt.title_failed', 'The restart needs attention')
					: tf('settings.restart_prompt.title_pending', 'Restart needed')
	);

	const text = $derived(
		view === 'restarting'
			? tf(
					'settings.restart_prompt.message_progress',
					'The BetterDesk services are restarting. Keep this page open.'
				)
			: view === 'ready'
				? tf(
						'settings.restart_prompt.message_ready',
						'The services have restarted. Sign in again to start a fresh session.'
					)
				: view === 'failed'
					? tf(
							'settings.restart_prompt.message_failed',
							'BetterDesk could not finish the restart. Check the service permissions, then try again.'
						)
					: tf(
							'settings.restart_prompt.message_pending',
							'The settings you saved take effect after the BetterDesk services restart. Restart now, or cancel to put the previous values back.'
						)
	);
</script>

{#if view !== 'hidden'}
	<!-- A new restart draws a new dialog, also after another dialog replaced this one -->
	{#key restartFlow.item?.id}
		<Dialog {title} blocking={view !== 'failed'} onclose={hideRestartPrompt}>
			<p>{text}</p>
			{#if changes.length}
				<ul
					class="restart-changes"
					aria-label={tf('settings.restart_prompt.changes_label', 'Changed settings')}
				>
					{#each changes as label, i (i)}
						<li>{label}</li>
					{/each}
				</ul>
			{/if}
			{#if view === 'failed'}
				<p class="restart-reason" role="alert">{restartFlow.reason}</p>
			{/if}
			<p class="restart-status" role="status">{restartFlow.status}</p>
			{#snippet footer()}
				{#if view === 'pending'}
					<Button icon="undo" busy={restartFlow.busy} onclick={() => void cancelPendingRestart()}
						>{tf('settings.restart_prompt.cancel', 'Cancel and restore')}</Button
					>
					<Button
						variant="danger"
						icon="restart"
						busy={restartFlow.busy}
						onclick={() => void confirmPendingRestart()}
						>{tf('settings.restart_prompt.confirm', 'Restart services')}</Button
					>
				{:else if view === 'ready'}
					<Button
						variant="primary"
						icon="login"
						busy={restartFlow.busy}
						onclick={() => void finishAndSignIn()}
						>{tf('settings.restart_prompt.ready_button', 'Go to sign-in')}</Button
					>
				{:else if view === 'failed'}
					<Button icon="check" busy={restartFlow.busy} onclick={() => void dismissFailedRestart()}
						>{tf('settings.restart_prompt.continue', 'Keep the saved values')}</Button
					>
					<Button
						variant="danger"
						icon="retry"
						busy={restartFlow.busy}
						onclick={() => void confirmPendingRestart()}
						>{tf('settings.restart_prompt.retry', 'Try the restart again')}</Button
					>
				{/if}
			{/snippet}
		</Dialog>
	{/key}
{/if}

<style>
	.restart-changes {
		margin: var(--space-2) 0 0;
		padding-inline-start: 1.25em;
	}
	.restart-reason {
		margin-top: var(--space-2);
		color: var(--danger);
	}
	.restart-status {
		margin-top: var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
