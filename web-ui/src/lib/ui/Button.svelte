<!--
  Button (components.css "Buttons"). One primary per view.
  variant: secondary (default, outlined), primary, ghost, danger (a dialog's
  answer), danger-quiet (a destructive action on the page), link (an action
  inside running text). size: default or sm. With href it renders a link
  that looks like a button; `download` marks a link to a file (true, or the
  file name), which the app router then leaves to the browser. icon: a
  meaning from ICONS before the label (Connect, Add, Download, Copy,
  Refresh, Approve...; not on Save).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Variant = 'secondary' | 'primary' | 'ghost' | 'danger' | 'danger-quiet' | 'link';

	interface Props extends Omit<HTMLButtonAttributes, 'class'> {
		variant?: Variant;
		size?: 'default' | 'sm';
		icon?: string;
		href?: string;
		/** With href: the link is a file download (true, or the file name to save as) */
		download?: boolean | string;
		block?: boolean;
		/** Shows the button as busy and blocks clicks (double-submit guard) */
		busy?: boolean;
		class?: string;
		element?: HTMLElement | null;
		children: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'default',
		icon,
		href,
		download,
		block = false,
		busy = false,
		type = 'button',
		disabled = false,
		class: cls = '',
		element = $bindable(null),
		children,
		...rest
	}: Props = $props();

	// The same attributes on a link (aria-label, aria-describedby, data-*, onclick...);
	// the button-only ones (form, formaction, name, value) mean nothing there
	const linkAttrs = $derived(rest as HTMLAnchorAttributes);

	const classes = $derived([
		'btn',
		variant !== 'secondary' && `btn-${variant}`,
		size === 'sm' && 'btn-sm',
		block && 'btn-block',
		cls
	]);
</script>

{#if href}
	<a
		bind:this={element}
		{...linkAttrs}
		{href}
		download={download === true ? '' : download || undefined}
		class={classes}
		aria-disabled={disabled || undefined}
	>
		{#if icon}<Icon name={icon} />{/if}{@render children()}
	</a>
{:else}
	<button
		bind:this={element}
		{type}
		class={classes}
		disabled={disabled || undefined}
		aria-busy={busy || undefined}
		aria-disabled={busy || undefined}
		{...rest}
		onclick={(e) => {
			if (busy) {
				e.preventDefault();
				return;
			}
			rest.onclick?.(e);
		}}
	>
		{#if icon}<Icon name={icon} />{/if}{@render children()}
	</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--control-h);
		padding: 0 var(--control-pad-x);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-weight: var(--control-weight);
		line-height: var(--control-leading);
		text-decoration: none;
		white-space: nowrap;
		vertical-align: middle;
		cursor: pointer;
		transition:
			background-color var(--motion),
			border-color var(--motion);
	}
	.btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn[aria-busy='true'] {
		cursor: progress;
	}
	.btn :global(.material-icons) {
		font-size: 18px;
	}
	.btn-primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.btn-primary:hover {
		background: var(--accent-hover);
		border-color: var(--accent-hover);
		color: var(--on-accent);
	}
	.btn-danger {
		background: var(--danger);
		border-color: var(--danger);
		color: var(--on-accent);
	}
	.btn-danger:hover {
		background: var(--danger-hover);
		border-color: var(--danger-hover);
		color: var(--on-accent);
	}
	.btn-danger-quiet,
	.btn-danger-quiet:hover {
		color: var(--danger);
	}
	.btn-ghost,
	.btn-link {
		border-color: transparent;
		background: transparent;
	}
	/* A link in running text: it sits on the text's baseline and wraps with
	   it, as the old .btn-link (which had no .btn box) did */
	.btn-link {
		display: inline;
		color: var(--accent);
		padding: 0;
		min-height: 0;
		border: 0;
		font: inherit;
		white-space: normal;
		vertical-align: baseline;
		text-align: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.btn-link:hover {
		background: transparent;
		color: var(--accent-hover);
	}
	.btn-sm {
		min-height: var(--control-h-sm);
		padding: 0 var(--control-pad-x-sm);
		font-size: var(--text-sm);
	}
	.btn-ghost.btn-sm {
		gap: var(--space-1);
	}
	.btn-ghost :global(.material-icons) {
		color: var(--text-muted);
	}
	.btn-ghost:hover :global(.material-icons) {
		color: var(--text);
	}
	.btn-block {
		width: 100%;
	}
</style>
