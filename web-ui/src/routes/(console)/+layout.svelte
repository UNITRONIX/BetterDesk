<!--
  Pages behind sign-in. Starts the console (session, strings, theme, my
  status), then draws the shell around the page. While it starts, an empty
  frame in the shell's shape (no text: the strings are not there yet);
  when it fails, one sentence and Try again. Nobody signed in: the sign-in
  page, with the way back here.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { session, startSession } from '#lib/state/session.svelte.ts';
	import { initPresence } from '#lib/state/presence.svelte.ts';
	import { initTheme } from '#lib/state/theme.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Shell from '#lib/shell/Shell.svelte';
	import { goLogin } from '#lib/shell/session-guard.svelte.ts';

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

	onMount(() => void start());
</script>

{#if session.ready}
	<Shell>{@render children()}</Shell>
{:else if session.error}
	<div class="start-error" role="alert">
		<p>{session.error}</p>
		<Button onclick={() => void start()} busy={starting}>{tf('errors.try_again', 'Try again')}</Button>
	</div>
{:else}
	<div class="start-frame" aria-busy="true">
		<div class="frame-sidebar"></div>
		<div class="frame-main"><div class="frame-topbar"></div></div>
	</div>
{/if}

<style>
	.start-frame {
		display: flex;
		min-height: 100vh;
		min-height: 100dvh;
	}
	.frame-sidebar {
		flex: none;
		width: var(--sidebar-w);
		border-inline-end: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.frame-main {
		flex: 1;
	}
	.frame-topbar {
		height: var(--topbar-h);
		border-bottom: 1px solid var(--rule);
	}
	@media (max-width: 1099px) {
		.frame-sidebar {
			display: none;
		}
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
