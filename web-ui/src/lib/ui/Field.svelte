<!--
  A labelled field (components.css "Form fields", "Forms that change
  settings"): label above, the control, a hint under it, the error when the
  value was refused, then what happens after a change (effect: "Applies
  right away", "After a restart"; effectTone restart or logout shows it in
  the warning colour).

  The control comes as a snippet that gets the wiring as its argument:
    <Field label={t('x.port')} hint={t('x.port_hint')} error={form.errors.port} width="short">
        {#snippet children(f)}<Input {...f} type="number" bind:value={form.values.port} />{/snippet}
    </Field>
  f.id is what the label's `for` points at; f.describedby lists the error,
  hint and effect; f.invalid sets aria-invalid; f.width is the width class
  (short: ports and numbers, medium: names and short choices, host: host
  names, addresses and longer choices).
-->
<script module lang="ts">
	export type FieldWidth = 'short' | 'medium' | 'host';

	export interface FieldControl {
		id: string;
		describedby: string | undefined;
		invalid: boolean;
		width: FieldWidth | undefined;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		hint?: string;
		/** Why the value was refused; empty or missing when it is fine */
		error?: string | undefined;
		effect?: string;
		effectTone?: 'default' | 'restart' | 'logout';
		width?: FieldWidth;
		/** The control's id; one is made up when missing */
		id?: string;
		class?: string;
		children: Snippet<[FieldControl]>;
	}

	let {
		label,
		hint,
		error,
		effect,
		effectTone = 'default',
		width,
		id: givenId,
		class: cls = '',
		children
	}: Props = $props();

	const uid = $props.id();
	const id = $derived(givenId ?? `field-${uid}`);
	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);
	const effectId = $derived(`${id}-effect`);
	const describedby = $derived(
		[error && errorId, hint && hintId, effect && effectId].filter(Boolean).join(' ') || undefined
	);
	const control = $derived<FieldControl>({ id, describedby, invalid: !!error, width });
</script>

<div class={['form-group', cls]}>
	<label class="form-label" for={id}>{label}</label>
	{@render children(control)}
	{#if hint}<p class="form-hint" id={hintId}>{hint}</p>{/if}
	{#if error}<p class="form-hint form-error" id={errorId}>{error}</p>{/if}
	{#if effect}
		<p class={['field-effect', effectTone !== 'default' && `is-${effectTone}`]} id={effectId}>{effect}</p>
	{/if}
</div>

<style>
	.form-group {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
		min-width: 0;
	}
	.form-group:last-child {
		margin-bottom: 0;
	}
	.form-label {
		font-weight: 600;
		color: var(--text);
	}
	.form-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.form-error {
		color: var(--danger);
	}
	.field-effect {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.field-effect.is-restart,
	.field-effect.is-logout {
		color: var(--warning);
	}
</style>
