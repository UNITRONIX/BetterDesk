<!--
  Centred dialog (components.css "Modal", GUIDE section 11): confirmations,
  one question, prompts of 1 to 3 fields, anything that must block. Longer
  forms and details go in a Sheet.

  Role dialog with aria-modal, labelled by the title and described by
  `message`. Focus starts on an element with data-autofocus, the first
  field, or the safest footer button (Cancel); Tab stays inside; Escape, a
  click on the dimmed page and the close button close it (not when
  `blocking`); focus goes back to what opened it. Opened while a sheet is
  open, it sits on top and Escape closes only the dialog.

  Footer buttons come as the `footer` snippet: Cancel first, the answer
  last (`variant="danger"` when it destroys something); a destructive
  action on the start side gets class "modal-footer-start".
  `open` defaults to true, so `{#if x}<Dialog …/>{/if}` works as well as
  `<Dialog bind:open …/>`. `onclose` runs when the person closes it (or
  another dialog replaces it), not when the page sets `open` to false.
  `beforeclose` can refuse a close (return false), e.g. to ask "Discard
  changes?".
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import IconButton from './IconButton.svelte';
	import { focusInitial, trapTab } from './focus.ts';
	import { openLayer } from './layers.ts';
	import { portal } from './portal.ts';

	interface Props {
		open?: boolean;
		title: string;
		message?: string;
		blocking?: boolean;
		size?: 'default' | 'large';
		class?: string;
		onclose?: () => void;
		beforeclose?: () => boolean | Promise<boolean>;
		children?: Snippet;
		footer?: Snippet;
		element?: HTMLElement | null;
	}

	let {
		open = $bindable(true),
		title,
		message,
		blocking = false,
		size = 'default',
		class: cls = '',
		onclose,
		beforeclose,
		children,
		footer,
		element = $bindable(null)
	}: Props = $props();

	const uid = $props.id();
	let overlay = $state<HTMLElement | null>(null);

	function forceClose() {
		if (!open) return;
		open = false;
		onclose?.();
	}

	async function dismiss() {
		if (blocking || !open) return;
		if (beforeclose && !(await beforeclose())) return;
		forceClose();
	}

	$effect(() => {
		const el = element;
		const layer = overlay;
		if (!open || !el || !layer) return;
		return untrack(() => {
			const closed = openLayer({
				kind: 'dialog',
				element: el,
				dismiss,
				replace: forceClose,
				blocking: () => blocking
			});
			// A click that starts and ends on the dimmed page closes; a text
			// selection dragged out of the dialog does not
			let downOnPage = false;
			const down = (e: PointerEvent) => (downOnPage = e.target === layer);
			const click = (e: MouseEvent) => {
				if (downOnPage && e.target === layer) dismiss();
				downOnPage = false;
			};
			const key = (e: KeyboardEvent) => trapTab(el, e);
			layer.addEventListener('pointerdown', down);
			layer.addEventListener('click', click);
			el.addEventListener('keydown', key);
			focusInitial(el);
			return () => {
				layer.removeEventListener('pointerdown', down);
				layer.removeEventListener('click', click);
				el.removeEventListener('keydown', key);
				closed();
			};
		});
	});
</script>

{#if open}
	<div class="modal-overlay" bind:this={overlay} {@attach portal}>
		<div
			bind:this={element}
			class={['modal', size === 'large' && 'modal-lg', cls]}
			role="dialog"
			aria-modal="true"
			aria-labelledby="{uid}-title"
			aria-describedby={message ? `${uid}-desc` : undefined}
			tabindex="-1"
		>
			<div class="modal-header">
				<h2 class="modal-title" id="{uid}-title">{title}</h2>
				{#if !blocking}
					<IconButton
						icon="close"
						label={tf('common.close', 'Close')}
						class="modal-close"
						onclick={dismiss}
					/>
				{/if}
			</div>
			{#if message || children}
				<div class="modal-body">
					{#if message}<p id="{uid}-desc">{message}</p>{/if}
					{@render children?.()}
				</div>
			{/if}
			{#if footer}
				<div class="modal-footer">{@render footer()}</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	/* Above an open sheet: a dialog opened from a sheet stacks on it */
	.modal-overlay {
		position: fixed;
		inset: 0;
		z-index: calc(var(--layer-dialog) + 1);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background: rgba(0, 0, 0, 0.45);
		opacity: 1;
		transition: opacity var(--motion);
	}
	@starting-style {
		.modal-overlay {
			opacity: 0;
		}
	}
	.modal {
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 520px;
		max-height: calc(100vh - 2 * var(--space-4));
		max-height: calc(100dvh - 2 * var(--space-4));
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		text-align: start;
	}
	.modal:focus {
		outline: none;
	}
	.modal-lg {
		max-width: 760px;
	}
	.modal-header {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-3);
		padding-inline: var(--space-5) var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.modal-title {
		margin: 0;
		margin-inline-end: auto;
		font-size: var(--text-md);
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.modal-body {
		min-height: 0;
		padding: var(--space-5);
		overflow-y: auto;
	}
	.modal-body > p {
		margin: 0;
	}
	/* The message, then the body's own content */
	.modal-body > p:not(:last-child) {
		margin-bottom: var(--space-3);
	}
	.modal-body > :global(p + p) {
		margin-top: var(--space-3);
	}
	.modal-footer {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--rule);
	}
	/* A destructive footer action sits apart on the start side */
	.modal-footer :global(:is(.btn-danger-quiet, .modal-footer-start)) {
		margin-inline-end: auto;
	}
	@media (max-width: 640px) {
		.modal-overlay {
			align-items: flex-end;
			padding: 0;
		}
		.modal {
			max-width: none;
			max-height: 92dvh;
			border-radius: var(--radius) var(--radius) 0 0;
		}
	}
</style>
