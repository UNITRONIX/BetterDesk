<!--
  Pages outside the console (sign-in, download pages): no shell, no
  session. Loads the strings and follows the theme; the page draws itself
  once the strings are there (they were requested in <head>). When they
  don't come, one sentence and Try again.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { publicPage, startPublic } from '#lib/public/boot.svelte.ts';
	import Button from '#lib/ui/Button.svelte';

	let { children }: { children: Snippet } = $props();

	let starting = $state(false);

	async function start() {
		starting = true;
		await startPublic();
		starting = false;
	}

	onMount(() => void start());
</script>

{#if publicPage.ready}
	{@render children()}
{:else if publicPage.failed}
	<main class="start-error" role="alert">
		<p>
			{tf('desktop_login.network_error', 'Could not reach the server. Check your connection and try again.')}
		</p>
		<Button onclick={() => void start()} busy={starting}>{tf('errors.try_again', 'Try again')}</Button>
	</main>
{/if}

<style>
	.start-error {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-3);
		max-width: calc(var(--measure) + 2 * var(--space-4));
		margin: 0 auto;
		padding: 12vh var(--space-4) var(--space-6);
	}
	.start-error p {
		color: var(--danger);
	}
</style>
