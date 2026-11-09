<!--
  A link that looks like a Button, with target, rel and title (the shared
  Button's link form passes only href and download). Page-local until
  Button takes link attributes; same look as Button (components.css .btn).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes } from 'svelte/elements';
	import Icon from '#lib/ui/Icon.svelte';

	interface Props extends Omit<HTMLAnchorAttributes, 'class'> {
		href: string;
		variant?: 'primary' | 'secondary' | 'ghost';
		size?: 'default' | 'sm';
		icon?: string;
		block?: boolean;
		class?: string;
		children: Snippet;
	}

	let {
		href,
		variant = 'secondary',
		size = 'default',
		icon,
		block = false,
		class: cls = '',
		children,
		...rest
	}: Props = $props();
</script>

<a
	{href}
	class={[
		'btn',
		variant !== 'secondary' && `btn-${variant}`,
		size === 'sm' && 'btn-sm',
		block && 'btn-block',
		cls
	]}
	{...rest}
	>{#if icon}<Icon name={icon} />{/if}{@render children()}</a
>

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
	.btn-ghost {
		border-color: transparent;
		background: transparent;
	}
	.btn-ghost :global(.material-icons) {
		color: var(--text-muted);
	}
	.btn-sm {
		min-height: var(--control-h-sm);
		padding: 0 var(--control-pad-x-sm);
		font-size: var(--text-sm);
	}
	.btn-block {
		width: 100%;
	}
</style>
