<!--
  A native select (components.css .form-select). options: { value, label,
  disabled? }; the bound value keeps the option's type (a number stays a
  number). Inside a Field: <Select {...f} {options} bind:value={...} />.
  small: next to small buttons in a dense row (a page size, a sort).
-->
<script module lang="ts">
	export interface SelectOption<T extends string | number = string> {
		value: T;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="V extends string | number">
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import type { FieldWidth } from './Field.svelte';

	interface Props extends Omit<HTMLSelectAttributes, 'class' | 'value' | 'multiple'> {
		options: SelectOption<V>[];
		value?: V | undefined;
		describedby?: string | undefined;
		invalid?: boolean;
		width?: FieldWidth | undefined;
		small?: boolean;
		class?: string;
		element?: HTMLSelectElement | null;
	}

	let {
		options,
		value = $bindable(),
		describedby,
		invalid = false,
		width,
		small = false,
		class: cls = '',
		element = $bindable(null),
		...rest
	}: Props = $props();
</script>

<select
	bind:this={element}
	bind:value
	class={['form-select', width && `is-${width}`, small && 'is-small', cls]}
	aria-describedby={describedby}
	aria-invalid={invalid || undefined}
	{...rest}
>
	{#each options as o (o.value)}
		<option value={o.value} disabled={o.disabled}>{o.label}</option>
	{/each}
</select>

<style>
	.form-select {
		width: 100%;
		min-height: var(--control-h);
		padding: 0 var(--control-pad-x-sm);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		line-height: var(--control-leading);
	}
	.form-select.is-small {
		min-height: var(--control-h-sm);
		font-size: var(--text-sm);
	}
	.form-select:focus {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.form-select:disabled {
		background: var(--bg-subtle);
		color: var(--text-muted);
	}
	.form-select[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.is-short {
		max-width: 12ch;
	}
	.is-medium {
		max-width: 28ch;
	}
	.is-host {
		max-width: 40ch;
	}
</style>
