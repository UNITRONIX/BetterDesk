<!--
  Full-window tools behind sign-in, without the console's sidebar and top
  bar (the old views/layouts/studio.ejs): the flow builder. Starts the
  session like the console does (strings, theme, my status), watches the
  idle sign-out, and mounts the dialog, toast and idle-warning hosts once.
  The page brings its own way back to the console.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import IdleWarning from '#lib/shell/IdleWarning.svelte';
	import { goLogin, startGuard, stopGuard } from '#lib/shell/session-guard.svelte.ts';
	import { initPresence } from '#lib/state/presence.svelte.ts';
	import { session, startSession } from '#lib/state/session.svelte.ts';
	import { initTheme } from '#lib/state/theme.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import DialogHost from '#lib/ui/DialogHost.svelte';
	import ToastHost from '#lib/ui/ToastHost.svelte';

	let { children }: { children: Snippet } = $props();

	let starting = $state(false);

	async function start() {
		starting = true;
		session.error = null;
		try {
			await startSession();
			const boot = session.raw;
			if (boot) initTheme(boot.branding.themeMode, boot.palettes);
			initPresence();
			startGuard(boot?.sessionPolicy);
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				goLogin(err.code);
				return;
			}
			const failed = tf('shell.start_failed', 'The console could not start.');
			session.error =
				err instanceof ApiError && err.status !== 0 && err.status !== 200
					? `${failed} (HTTP ${err.status})`
					: failed;
		} finally {
			starting = false;
		}
	}

	onMount(() => {
		void start();
		return stopGuard;
	});
</script>

{#if session.ready}
	{@render children()}
	<IdleWarning />
	<DialogHost />
	<ToastHost />
{:else if session.error}
	<div class="start-error" role="alert">
		<p>{session.error}</p>
		<Button onclick={() => void start()} busy={starting}>{tf('errors.try_again', 'Try again')}</Button>
	</div>
{:else}
	<div class="start-frame" aria-busy="true"></div>
{/if}

<style>
	.start-frame {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
	}
	.start-error {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: var(--measure);
		padding: var(--space-7) var(--page-pad);
	}
	.start-error p {
		color: var(--danger);
	}
</style>
