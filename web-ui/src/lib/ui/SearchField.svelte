<!--
  A search field with a leading search icon (components.css .search-wrapper).
  `label` is required: it is the field's aria-label and, unless
  `placeholder` says more ("Search by ID, name, user or tag"), its
  placeholder. small: the 30px field for dense rows. In a Toolbar, pass it
  as the search snippet. The icon follows the page direction.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';
	import Input from './Input.svelte';

	interface Props extends Omit<
		HTMLInputAttributes,
		'class' | 'type' | 'value' | 'size' | 'width' | 'aria-label'
	> {
		label: string;
		value?: string;
		small?: boolean;
		class?: string;
		element?: HTMLInputElement | null;
	}

	let {
		label,
		value = $bindable(''),
		small = false,
		placeholder,
		class: cls = '',
		element = $bindable(null),
		...rest
	}: Props = $props();
</script>

<div class={['search-wrapper', cls]}>
	<Icon name="search" />
	<Input
		bind:value
		bind:element
		type="search"
		{small}
		aria-label={label}
		placeholder={placeholder ?? label}
		{...rest}
	/>
</div>

<style>
	.search-wrapper {
		position: relative;
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.search-wrapper > :global(.material-icons) {
		position: absolute;
		/* Icons are direction: ltr (base.css); an absolutely placed icon
		   resolves its inline start from its own direction, so it follows
		   the page here or it sits on the text in right-to-left languages */
		direction: inherit;
		inset-inline-start: var(--space-2);
		color: var(--text-muted);
		pointer-events: none;
	}
	.search-wrapper > :global(.form-input) {
		padding-inline-start: calc(var(--space-2) + 18px + var(--space-2));
	}
</style>
