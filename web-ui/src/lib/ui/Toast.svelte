<!--
  One toast (components.css "Toasts"): a rule on the start side in the
  type's colour, an optional title, the message as text, and a close
  button. Shown by ToastHost; pages call toast.success() and the like.
  Time stops while the pointer or focus is on it.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import IconButton from './IconButton.svelte';
	import { dismiss, pause, resume, type ToastItem } from './toasts.svelte.ts';

	let { toast }: { toast: ToastItem } = $props();

	function holdWhileUsed(node: HTMLElement) {
		const id = toast.id;
		const hold = () => pause(id);
		const release = (e: Event) => {
			if (e instanceof FocusEvent && node.contains(e.relatedTarget as Node | null)) return;
			if (e.type === 'pointerleave' && node.contains(document.activeElement)) return;
			resume(id);
		};
		node.addEventListener('pointerenter', hold);
		node.addEventListener('focusin', hold);
		node.addEventListener('pointerleave', release);
		node.addEventListener('focusout', release);
		return () => {
			node.removeEventListener('pointerenter', hold);
			node.removeEventListener('focusin', hold);
			node.removeEventListener('pointerleave', release);
			node.removeEventListener('focusout', release);
		};
	}
</script>

<div class={['toast', toast.type]} {@attach holdWhileUsed}>
	<div class="toast-content">
		{#if toast.title}<div class="toast-title">{toast.title}</div>{/if}
		<div class="toast-message">{toast.message}</div>
	</div>
	<IconButton
		icon="close"
		label={tf('common.close', 'Close')}
		class="toast-close"
		onclick={() => dismiss(toast.id)}
	/>
</div>

<style>
	.toast {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		box-sizing: border-box;
		width: min(380px, calc(100vw - 2 * var(--space-4)));
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-inline-start: 3px solid var(--info);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		pointer-events: auto;
	}
	.success {
		border-inline-start-color: var(--success);
	}
	.error {
		border-inline-start-color: var(--danger);
	}
	.warning {
		border-inline-start-color: var(--warning);
	}
	.toast-content {
		flex: 1;
		min-width: 0;
	}
	.toast-title {
		font-weight: 600;
	}
	.toast-message {
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.toast-title + .toast-message {
		color: var(--text-muted);
	}
	/* The close button's glyph sits on the title's line */
	.toast > :global(.toast-close) {
		margin-block: -5px;
		margin-inline-end: -6px;
	}
	@media (max-width: 767px) {
		.toast {
			width: 100%;
		}
	}
</style>
