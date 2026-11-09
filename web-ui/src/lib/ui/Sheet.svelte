<!--
  Side sheet (components.css "Sheet", GUIDE section 11): a panel from the
  end side, full height, for creating or editing a thing with more than a
  few fields, and for details of one item. 560px, or 720px with `wide`
  (editors, tables); the whole screen at 640px and below; the start side in
  right-to-left languages.

  Same rules as Dialog: role dialog with aria-modal, labelled by the title
  (described by the subtitle), focus on the first field, Tab kept inside,
  Escape, a click on the dimmed page and the close button close it (not
  when `blocking`), focus back to the opener. A dialog opened on top
  closes alone on Escape; opening another sheet replaces this one.

  Footer (the `footer` snippet): an editing sheet has Cancel on the start
  side (class "sheet-footer-start"), other actions, then Save (primary)
  last; a details sheet has its commands and then Close.
  `status`: the line above the footer buttons that says what the last
  action did. Pass a string (empty at first) to have the line; undefined
  leaves it out. `statusTone`: neutral ("Testing…"), ok or error.

  Hand-built panels (the device panel, the accessibility panel) keep the
  layer, focus and stacking rules and replace parts:
    header(parts)  replaces the head; give the title id={parts.titleId}
                   (and the subtitle id={parts.descId}); parts.close closes
    body(parts)    replaces the scrolling body (children go in the default one)
  Inside them the classes sheet-header, sheet-titles, sheet-title,
  sheet-subtitle, sheet-body and sheet-footer have the sheet's styles.
  `label` names the sheet when it has no title element.
-->
<script module lang="ts">
	export interface SheetParts {
		titleId: string;
		descId: string;
		close: () => void;
	}
</script>

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
		title?: string;
		subtitle?: string;
		label?: string;
		wide?: boolean;
		status?: string;
		statusTone?: 'neutral' | 'ok' | 'error';
		blocking?: boolean;
		class?: string;
		bodyClass?: string;
		onclose?: () => void;
		beforeclose?: () => boolean | Promise<boolean>;
		header?: Snippet<[SheetParts]>;
		body?: Snippet<[SheetParts]>;
		children?: Snippet;
		footer?: Snippet;
		element?: HTMLElement | null;
	}

	let {
		open = $bindable(true),
		title = '',
		subtitle,
		label,
		wide = false,
		status,
		statusTone = 'neutral',
		blocking = false,
		class: cls = '',
		bodyClass = '',
		onclose,
		beforeclose,
		header,
		body,
		children,
		footer,
		element = $bindable(null)
	}: Props = $props();

	const uid = $props.id();
	let layer = $state<HTMLElement | null>(null);

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

	const parts: SheetParts = { titleId: `${uid}-title`, descId: `${uid}-desc`, close: () => void dismiss() };

	$effect(() => {
		const el = element;
		const back = layer;
		if (!open || !el || !back) return;
		return untrack(() => {
			const closed = openLayer({
				kind: 'sheet',
				element: el,
				dismiss,
				replace: forceClose,
				blocking: () => blocking
			});
			let downOnPage = false;
			const down = (e: PointerEvent) => (downOnPage = e.target === back);
			const click = (e: MouseEvent) => {
				if (downOnPage && e.target === back) dismiss();
				downOnPage = false;
			};
			const key = (e: KeyboardEvent) => trapTab(el, e);
			back.addEventListener('pointerdown', down);
			back.addEventListener('click', click);
			el.addEventListener('keydown', key);
			focusInitial(el);
			return () => {
				back.removeEventListener('pointerdown', down);
				back.removeEventListener('click', click);
				el.removeEventListener('keydown', key);
				closed();
			};
		});
	});
</script>

{#if open}
	<div class="sheet-layer" bind:this={layer} {@attach portal}>
		<div
			bind:this={element}
			class={['sheet', wide && 'is-wide', cls]}
			role="dialog"
			aria-modal="true"
			aria-label={label}
			aria-labelledby={label ? undefined : parts.titleId}
			aria-describedby={subtitle ? parts.descId : undefined}
			tabindex="-1"
		>
			{#if header}
				{@render header(parts)}
			{:else}
				<div class="sheet-header">
					<div class="sheet-titles">
						<h2 class="sheet-title" id={parts.titleId}>{title}</h2>
						{#if subtitle}<p class="sheet-subtitle" id={parts.descId}>{subtitle}</p>{/if}
					</div>
					{#if !blocking}
						<IconButton
							icon="close"
							label={tf('common.close', 'Close')}
							class="modal-close"
							onclick={dismiss}
						/>
					{/if}
				</div>
			{/if}
			{#if body}
				{@render body(parts)}
			{:else}
				<div class={['sheet-body', bodyClass]}>{@render children?.()}</div>
			{/if}
			{#if footer || status !== undefined}
				<div class="sheet-footer">
					{#if status !== undefined}
						<p
							class={['form-status', 'sheet-status', statusTone !== 'neutral' && `is-${statusTone}`]}
							role="status"
							aria-live="polite"
						>
							{status}
						</p>
					{/if}
					{@render footer?.()}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sheet-layer {
		--sheet-pad-x: var(--space-5);
		position: fixed;
		inset: 0;
		z-index: var(--layer-dialog);
		display: block;
		padding: 0;
		background: rgba(0, 0, 0, 0.3);
		opacity: 1;
		transition: opacity var(--motion);
	}
	:global(:root[data-theme='dark']) .sheet-layer {
		background: rgba(0, 0, 0, 0.5);
	}
	.sheet {
		position: absolute;
		top: 0;
		bottom: 0;
		inset-inline-end: 0;
		display: flex;
		flex-direction: column;
		width: min(560px, 100vw);
		max-width: 100%;
		border-inline-start: 1px solid var(--rule);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		text-align: start;
		transform: none;
		transition: transform var(--motion);
	}
	/* Opening: the layer fades in and the sheet slides in from the end side
	   (no motion when --motion is 0 under reduced motion) */
	@starting-style {
		.sheet-layer {
			opacity: 0;
		}
		.sheet {
			transform: translateX(16px);
		}
		.sheet:dir(rtl) {
			transform: translateX(-16px);
		}
	}
	.sheet.is-wide {
		width: min(720px, 100vw);
	}
	.sheet:focus {
		outline: none;
	}
	.sheet > :global(.sheet-header) {
		display: flex;
		flex: none;
		align-items: flex-start;
		gap: var(--space-3);
		padding-block: var(--space-4);
		padding-inline: var(--sheet-pad-x) var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.sheet :global(.sheet-titles) {
		flex: 1;
		min-width: 0;
	}
	.sheet :global(.sheet-title) {
		margin: 0;
		font-size: var(--text-lg);
		font-weight: 600;
		line-height: 1.3;
		overflow-wrap: anywhere;
	}
	.sheet :global(.sheet-subtitle) {
		margin: var(--space-1) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.sheet :global(.sheet-body) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-5) var(--sheet-pad-x);
	}
	.sheet :global(.sheet-footer) {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--sheet-pad-x);
		padding-bottom: calc(var(--space-3) + env(safe-area-inset-bottom, 0px));
		border-top: 1px solid var(--rule);
		background: var(--bg-float);
	}
	.sheet :global(.sheet-footer :is(.sheet-footer-start, .modal-footer-start)) {
		margin-inline-end: auto;
	}
	/* What the last action did: a line of its own above the buttons. Empty,
	   it stays in the accessibility tree (so the message is announced) but
	   takes no room. */
	.form-status {
		color: var(--text-muted);
	}
	.form-status.is-ok {
		color: var(--success);
	}
	.form-status.is-error {
		color: var(--danger);
	}
	.sheet-status {
		flex: 1 0 100%;
		margin: 0;
	}
	.sheet-status:empty {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
	@media (max-width: 640px) {
		.sheet-layer {
			--sheet-pad-x: var(--space-4);
		}
		.sheet,
		.sheet.is-wide {
			width: 100%;
			border-inline-start: 0;
			box-shadow: none;
		}
		.sheet > :global(.sheet-header) {
			padding-top: calc(var(--space-4) + env(safe-area-inset-top, 0px));
		}
	}
	@media (forced-colors: active) {
		.sheet {
			border-inline-start: 1px solid CanvasText;
		}
	}
</style>
