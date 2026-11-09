<!--
  Two independent parts of a settings tab side by side once the main
  column has room for two (880 px, the container "settings-main" from
  SettingsLayout), one under the other before that. Each part is a column
  of sections; one section's fields never split across the columns.

    <SettingsGrid>
        {#snippet start()}...sections...{/snippet}
        {#snippet end()}...sections...{/snippet}
    </SettingsGrid>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { start, end }: { start: Snippet; end?: Snippet } = $props();
</script>

<div class="settings-grid">
	<div class="settings-stack">{@render start()}</div>
	{#if end}<div class="settings-stack">{@render end()}</div>{/if}
</div>

<style>
	.settings-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-6) var(--space-7);
		align-items: start;
	}
	.settings-stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		min-width: 0;
	}
	@container settings-main (min-width: 880px) {
		.settings-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
