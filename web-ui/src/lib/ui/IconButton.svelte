<!--
  A button that shows only a glyph. Allowed only for close, the row menu,
  copy and the disclosure chevron (GUIDE section 1); everything else gets a
  visible label. `label` is required and becomes aria-label and title.
-->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	interface Props extends Omit<HTMLButtonAttributes, 'class' | 'aria-label'> {
		icon: string;
		label: string;
		class?: string;
		element?: HTMLButtonElement | null;
	}

	let { icon, label, class: cls = '', type = 'button', element = $bindable(null), ...rest }: Props = $props();
</script>

<button bind:this={element} {type} class={['icon-btn', cls]} aria-label={label} title={label} {...rest}>
	<Icon name={icon} />
</button>

<style>
	.icon-btn {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--icon-btn-size);
		height: var(--icon-btn-size);
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		line-height: 1;
		cursor: pointer;
		vertical-align: middle;
		transition:
			background-color var(--motion),
			color var(--motion);
	}
	.icon-btn > :global(.material-icons) {
		font-size: var(--icon-btn-glyph);
	}
	.icon-btn:is(:hover, [aria-expanded='true'], [aria-pressed='true'], :global(.copied)) {
		background: var(--hover);
		color: var(--text);
	}
	.icon-btn:is(:disabled, [aria-disabled='true']) {
		background: transparent;
		color: var(--text-muted);
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
