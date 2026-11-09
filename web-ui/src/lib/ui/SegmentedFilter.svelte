<!--
  The one component for view filters (components.css segmented control):
  status filters above a list, list/grid switches, date presets. A group
  with an aria-label; each option is a button with aria-pressed, and the
  neighbours share one border. The selected one is tinted, outlined in the
  accent and has the full text colour. Counts belong in the label text
  ("Online (3)"), passed by the caller. Page tabs are Tabs, not this.
  Keyboard: Tab reaches each button, Space or Enter picks it.
-->
<script module lang="ts">
	export interface Segment<T extends string | number = string> {
		value: T;
		label: string;
		disabled?: boolean;
	}
</script>

<script lang="ts" generics="V extends string | number">
	interface Props {
		label: string;
		options: Segment<V>[];
		value?: V | undefined;
		class?: string;
		onchange?: (value: V) => void;
	}

	let { label, options, value = $bindable(), class: cls = '', onchange }: Props = $props();
</script>

<div class={['segmented', cls]} role="group" aria-label={label}>
	{#each options as o (o.value)}
		<button
			type="button"
			class="filter-btn"
			aria-pressed={value === o.value}
			disabled={o.disabled}
			onclick={() => {
				value = o.value;
				onchange?.(o.value);
			}}>{o.label}</button
		>
	{/each}
</div>

<style>
	.segmented {
		display: inline-flex;
		flex-wrap: wrap;
		max-width: 100%;
		vertical-align: middle;
	}
	.filter-btn {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: var(--control-h);
		padding: 0 var(--control-pad-x);
		border: 1px solid var(--border);
		border-radius: 0;
		background: var(--bg);
		color: var(--text-muted);
		font: inherit;
		font-weight: var(--control-weight);
		line-height: var(--control-leading);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--motion),
			border-color var(--motion);
	}
	/* Neighbours share one border line */
	.filter-btn + .filter-btn {
		margin-inline-start: -1px;
	}
	.filter-btn:first-child {
		border-start-start-radius: var(--control-radius);
		border-end-start-radius: var(--control-radius);
	}
	.filter-btn:last-child {
		border-start-end-radius: var(--control-radius);
		border-end-end-radius: var(--control-radius);
	}
	.filter-btn:hover {
		background: var(--hover);
		color: var(--text);
	}
	.filter-btn[aria-pressed='true'] {
		z-index: 1;
		border-color: var(--accent);
		background: var(--accent-tint);
		color: var(--text);
	}
	.filter-btn:focus-visible {
		z-index: 2;
	}
	.filter-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	/* On touch a short label ("All") still gets a 44px wide target */
	@media (pointer: coarse) {
		.filter-btn {
			min-width: var(--control-h);
		}
	}
</style>
