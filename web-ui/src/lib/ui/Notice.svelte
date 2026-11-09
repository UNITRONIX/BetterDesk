<!--
  One message that must stand out on a page or in a sheet (components.css
  "notice"): a rule on the start side in the tone's colour, a faint
  background, no box. tone: info (default), warning, danger, ok.
  `message` as text, or children for a sentence with a link or button.
  Pass role="status" or role="alert" when it appears after an action.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'class'> {
		tone?: 'info' | 'warning' | 'danger' | 'ok';
		title?: string;
		message?: string;
		class?: string;
		children?: Snippet;
	}

	let { tone = 'info', title, message, class: cls = '', children, ...rest }: Props = $props();
</script>

<div class={['notice', `is-${tone}`, cls]} {...rest}>
	{#if title}<p class="notice-title">{title}</p>{/if}
	{#if message}<p>{message}</p>{/if}
	{@render children?.()}
</div>

<style>
	.notice {
		padding: var(--space-2) var(--space-3);
		border-inline-start: 3px solid var(--info);
		background: var(--bg-subtle);
	}
	.is-danger {
		border-inline-start-color: var(--danger);
	}
	.is-warning {
		border-inline-start-color: var(--warning);
	}
	.is-ok {
		border-inline-start-color: var(--success);
	}
	.notice p {
		margin: 0;
	}
	.notice-title {
		font-weight: 600;
	}
	@media (forced-colors: active) {
		.notice {
			border-inline-start-color: CanvasText;
		}
	}
</style>
