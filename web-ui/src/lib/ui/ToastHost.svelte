<!--
  Where toasts appear (components.css "Toasts"): the end side of the bottom
  edge, above the mobile tab bar on small screens. The shell mounts it
  once. Two live regions in one stack: errors are announced right away
  (role alert), the rest politely (role status). Both exist before any
  toast, so screen readers hear the first one too.
-->
<script lang="ts">
	import Toast from './Toast.svelte';
	import { toasts } from './toasts.svelte.ts';

	const polite = $derived(toasts.items.filter((t) => t.type !== 'error'));
	const errors = $derived(toasts.items.filter((t) => t.type === 'error'));
</script>

<div class="toast-container">
	<div class="toast-region" role="status" aria-live="polite" aria-atomic="false">
		{#each polite as t (t.id)}<Toast toast={t} />{/each}
	</div>
	<div class="toast-region" role="alert" aria-live="assertive" aria-atomic="false">
		{#each errors as t (t.id)}<Toast toast={t} />{/each}
	</div>
</div>

<style>
	.toast-container {
		position: fixed;
		inset-inline-end: var(--space-4);
		bottom: var(--space-4);
		z-index: var(--layer-toast);
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		pointer-events: none;
	}
	.toast-region {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	@media (max-width: 767px) {
		.toast-container {
			inset-inline: var(--space-4);
			bottom: calc(64px + env(safe-area-inset-bottom, 0px));
		}
	}
</style>
