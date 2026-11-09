<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { session, startSession } from '#lib/state/session.svelte.ts';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		startSession().catch((err: unknown) => {
			session.error = err instanceof Error ? err.message : String(err);
		});
	});
</script>

{#if session.ready}
	{@render children()}
{:else if session.error}
	<p class="state is-error">{session.error}</p>
{/if}
