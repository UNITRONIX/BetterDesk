<!--
  One radio with its label on one line (components.css .checkbox-row); with
  a hint it takes the .check-field layout and the hint is linked with
  aria-describedby. Radios of one question share `name` and bind the same
  `group`; arrow keys move between them (native). Wrap them in an element
  with role="radiogroup" and an aria-label, or use ChoiceList.
-->
<script lang="ts" generics="V extends string | number">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'type' | 'value' | 'checked' | 'name'> {
		label: string;
		value: V;
		/** The selected value of the group */
		group?: V | undefined;
		name: string;
		hint?: string;
		class?: string;
		element?: HTMLInputElement | null;
	}

	let {
		label,
		value,
		group = $bindable(),
		name,
		hint,
		class: cls = '',
		element = $bindable(null),
		id: givenId,
		onchange,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const id = $derived(givenId ?? `radio-${uid}`);
</script>

<label class={[hint ? 'check-field' : 'checkbox-row', cls]}>
	<input
		bind:this={element}
		type="radio"
		{id}
		{name}
		{value}
		checked={group === value}
		aria-labelledby={hint ? `${id}-label` : undefined}
		aria-describedby={hint ? `${id}-hint` : undefined}
		{...rest}
		onchange={(e) => {
			if (e.currentTarget.checked) group = value;
			onchange?.(e);
		}}
	/>
	<span class="check-label" id="{id}-label">{label}</span>
	{#if hint}<span class="form-hint" id="{id}-hint">{hint}</span>{/if}
</label>

<style>
	input {
		flex-shrink: 0;
		width: var(--check-size);
		height: var(--check-size);
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.checkbox-row {
		display: flex;
		align-items: center;
		gap: var(--check-gap);
		min-height: var(--control-h);
		cursor: pointer;
	}
	.check-field {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: 2px var(--check-gap);
		align-items: start;
		cursor: pointer;
	}
	.check-field > input {
		margin-top: 2px;
	}
	.check-field .check-label {
		font-weight: 600;
	}
	.form-hint {
		grid-column: 2;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	@media (pointer: coarse) {
		.check-field,
		.checkbox-row {
			min-height: 44px;
			align-content: center;
		}
	}
</style>
