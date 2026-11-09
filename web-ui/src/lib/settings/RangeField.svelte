<!--
  A slider with its value in the label ("Blur: 12 px"), as the old
  Appearance page had them. The value is a number.
-->
<script lang="ts">
	interface Props {
		id: string;
		label: string;
		unit: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		hint?: string;
		/** Extra id of the block around it (the settings search jumps there) */
		groupId?: string;
	}

	let { id, label, unit, value = $bindable(), min, max, step = 1, hint, groupId }: Props = $props();
</script>

<div class="form-group" id={groupId}>
	<label class="form-label" for={id}>{label}: <span class="num">{value}</span> {unit}</label>
	<input
		{id}
		type="range"
		class="form-range"
		{min}
		{max}
		{step}
		bind:value
		aria-describedby={hint ? `${id}-hint` : undefined}
	/>
	{#if hint}<p class="form-hint" id="{id}-hint">{hint}</p>{/if}
</div>

<style>
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}
	.form-label {
		font-weight: 600;
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	.form-range {
		width: 100%;
		max-width: 360px;
		margin: 0;
		accent-color: var(--accent);
	}
	.form-range:focus-visible {
		outline: var(--focus-ring);
		outline-offset: var(--focus-offset);
	}
	@media (pointer: coarse) {
		.form-range {
			height: var(--control-h);
		}
	}
	.form-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
