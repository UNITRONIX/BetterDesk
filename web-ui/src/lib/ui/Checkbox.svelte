<!--
  A checkbox with its label (components.css .check-field, .checkbox-row).
  The box and the label sit on one line; a hint (and an effect line) go
  under the label, linked with aria-describedby. The whole label is the
  click target (44px high on touch). inline: the compact .checkbox-row for
  toolbars and menus ("Show deleted"), label at normal weight.
  Extra attributes (aria-controls, aria-expanded from ShowWhen, name,
  disabled, onchange) go to the input.
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'type' | 'checked'> {
		label: string;
		checked?: boolean;
		indeterminate?: boolean;
		hint?: string;
		effect?: string;
		effectTone?: 'default' | 'restart' | 'logout';
		error?: string | undefined;
		inline?: boolean;
		/** Class on the input (Switch sets toggle-switch) */
		inputClass?: string;
		class?: string;
		element?: HTMLInputElement | null;
	}

	let {
		label,
		checked = $bindable(false),
		indeterminate = $bindable(false),
		hint,
		effect,
		effectTone = 'default',
		error,
		inline = false,
		inputClass = '',
		class: cls = '',
		element = $bindable(null),
		id: givenId,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const id = $derived(givenId ?? `check-${uid}`);
	const labelId = $derived(`${id}-label`);
	const describedby = $derived(
		[error && `${id}-error`, hint && `${id}-hint`, effect && `${id}-effect`].filter(Boolean).join(' ') ||
			undefined
	);
</script>

<label class={[inline ? 'checkbox-row' : 'check-field', cls]}>
	<input
		bind:this={element}
		bind:checked
		bind:indeterminate
		type="checkbox"
		{id}
		class={inputClass}
		aria-labelledby={describedby ? labelId : undefined}
		aria-describedby={describedby}
		aria-invalid={error ? true : undefined}
		{...rest}
	/>
	<span class="check-label" id={labelId}>{label}</span>
	{#if hint}<span class="form-hint" id="{id}-hint">{hint}</span>{/if}
	{#if error}<span class="form-hint form-error" id="{id}-error">{error}</span>{/if}
	{#if effect}
		<span class={['field-effect', effectTone !== 'default' && `is-${effectTone}`]} id="{id}-effect"
			>{effect}</span
		>
	{/if}
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
	/* Switches render as plain checkboxes */
	input.toggle-switch {
		appearance: auto;
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
	.form-hint,
	.field-effect {
		grid-column: 2;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.form-error {
		color: var(--danger);
	}
	.field-effect.is-restart,
	.field-effect.is-logout {
		color: var(--warning);
	}
	/* On touch the whole label is the target, at least 44px high */
	@media (pointer: coarse) {
		.check-field,
		.checkbox-row {
			min-height: 44px;
			align-content: center;
		}
	}
</style>
