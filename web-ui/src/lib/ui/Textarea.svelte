<!--
  A text area (components.css textarea.form-input): at least 80px high,
  resizes vertically. Inside a Field: <Textarea {...f} bind:value={...} />.
-->
<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import type { FieldWidth } from './Field.svelte';

	interface Props extends Omit<HTMLTextareaAttributes, 'class' | 'value'> {
		value?: string | null;
		describedby?: string | undefined;
		invalid?: boolean;
		width?: FieldWidth | undefined;
		class?: string;
		element?: HTMLTextAreaElement | null;
	}

	let {
		value = $bindable(),
		describedby,
		invalid = false,
		width,
		class: cls = '',
		element = $bindable(null),
		...rest
	}: Props = $props();
</script>

<textarea
	bind:this={element}
	bind:value
	class={['form-input', width && `is-${width}`, cls]}
	aria-describedby={describedby}
	aria-invalid={invalid || undefined}
	{...rest}></textarea>

<style>
	.form-input {
		width: 100%;
		min-height: 80px;
		padding: var(--space-2) var(--control-pad-x-sm);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		line-height: var(--control-leading);
		resize: vertical;
	}
	.form-input::placeholder {
		color: var(--text-muted);
		font-family: var(--font);
		opacity: 1;
	}
	.form-input:focus {
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
