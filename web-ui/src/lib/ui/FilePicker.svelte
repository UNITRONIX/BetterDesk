<!--
  The native file control with a plain button look (components.css
  input[type="file"]). The browser draws the button and the chosen file
  name. Inside a Field: <FilePicker {...f} accept="image/png" bind:files />.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'type' | 'value'> {
		files?: FileList | null;
		describedby?: string | undefined;
		invalid?: boolean;
		class?: string;
		element?: HTMLInputElement | null;
	}

	let {
		files = $bindable(null),
		describedby,
		invalid = false,
		class: cls = '',
		element = $bindable(null),
		...rest
	}: Props = $props();
</script>

<input
	bind:this={element}
	bind:files
	type="file"
	class={['file-picker', cls]}
	aria-describedby={describedby}
	aria-invalid={invalid || undefined}
	{...rest}
/>

<style>
	.file-picker {
		max-width: 100%;
		color: var(--text-muted);
		font: inherit;
	}
	.file-picker::file-selector-button {
		min-height: var(--control-h);
		margin-inline-end: var(--space-3);
		padding: 0 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.file-picker::file-selector-button:hover {
		background: var(--hover);
	}
	.file-picker[aria-invalid='true']::file-selector-button {
		border-color: var(--danger);
	}
</style>
