<!--
  A text field (components.css .form-input). Inside a Field, spread the
  snippet argument: <Input {...f} bind:value={form.values.name} />.
  width: short (ports, numbers), medium (names), host (host names,
  addresses); small: next to small buttons in a dense row.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import type { FieldWidth } from './Field.svelte';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value' | 'size' | 'width'> {
		value?: string | number | null;
		describedby?: string | undefined;
		invalid?: boolean;
		width?: FieldWidth | undefined;
		small?: boolean;
		class?: string;
		element?: HTMLInputElement | null;
	}

	let {
		value = $bindable(),
		type = 'text',
		describedby,
		invalid = false,
		width,
		small = false,
		class: cls = '',
		element = $bindable(null),
		...rest
	}: Props = $props();
</script>

<input
	bind:this={element}
	bind:value
	{type}
	class={['form-input', width && `is-${width}`, small && 'is-small', cls]}
	aria-describedby={describedby}
	aria-invalid={invalid || undefined}
	{...rest}
/>

<style>
	.form-input {
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
	.form-input.is-small {
		min-height: var(--control-h-sm);
		font-size: var(--text-sm);
	}
	.form-input::placeholder {
		color: var(--text-muted);
		font-family: var(--font);
		opacity: 1;
	}
	/* The focus ring of buttons and links, shown on any focus because people
	   type here; :focus-within keeps it in a date field's parts */
	.form-input:focus,
	.form-input:focus-within {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	.form-input:disabled {
		background: var(--bg-subtle);
		color: var(--text-muted);
	}
	.form-input[aria-invalid='true'] {
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
