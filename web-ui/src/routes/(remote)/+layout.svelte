<!--
  The remote client's pages (/remote, /remote/<id>, /remote/login,
  /remote/guest): no console shell. Loads the strings and the theme, then
  the page; each page asks for its own data (a guest link has no session).
  Remembered device passwords are forgotten when this browser signs out
  (DECISIONS S5).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { startRemotePage } from '#lib/remote/boot.ts';
	import { watchSignOut } from '#lib/remote/secure-store.ts';
	import Button from '#lib/ui/Button.svelte';
	import DialogHost from '#lib/ui/DialogHost.svelte';
	import ToastHost from '#lib/ui/ToastHost.svelte';

	let { children }: { children: Snippet } = $props();

	let ready = $state(false);
	let failed = $state(false);
	let busy = $state(false);

	async function start() {
		busy = true;
		failed = false;
		try {
			await startRemotePage();
			ready = true;
		} catch {
			failed = true;
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		void start();
		return watchSignOut();
	});
</script>

{#if ready}
	{@render children()}
{:else if failed}
	<div class="start-error" role="alert">
		<p>{tf('shell.start_failed', 'The console could not start.')}</p>
		<Button onclick={() => void start()} {busy}>{tf('errors.try_again', 'Try again')}</Button>
	</div>
{/if}

<DialogHost />
<ToastHost />

<style>
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
