<!--
  A long key or secret people copy (the server key, a config string): the
  value in an inset field with a labelled Copy button. One line, cut with
  an ellipsis; the full value is in the title and is what gets copied.
  label: what the value is ("Server key"); it goes into the buttons'
  names ("Copy Server key", "Show Server key"). hidden: starts as dots
  with a Show/Hide button; Copy still copies the value. empty: word when
  there is no value.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { Copier } from './clipboard.svelte.ts';
	import Empty from './Empty.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		value: string | null | undefined;
		label: string;
		hidden?: boolean;
		empty?: string;
	}

	let { value, label, hidden = false, empty }: Props = $props();

	const MASK = '••••••••••••••••••••••••';
	const text = $derived(String(value ?? ''));
	let revealed = $state(false);
	const masked = $derived(hidden && !revealed);
	const copier = new Copier();
	$effect(() => () => copier.dispose());

	const copyWord = $derived(tf('actions.copy', 'Copy'));
	const toggleWord = $derived(revealed ? tf('actions.hide_value', 'Hide') : tf('actions.show_value', 'Show'));
</script>

{#if text.trim() === ''}
	<Empty word={empty} />
{:else}
	<span class="value-field">
		{#if masked}
			<code class="value is-masked"><span aria-hidden="true">{MASK}</span></code>
		{:else}
			<code class="value" title={text}>{text}</code>
		{/if}
		{#if hidden}
			<button type="button" aria-label="{toggleWord} {label}" onclick={() => (revealed = !revealed)}
				>{toggleWord}</button
			>
		{/if}
		<button
			type="button"
			class:copied={copier.copied}
			aria-label="{copyWord} {label}"
			onclick={() => copier.copy(text)}><Icon name={copier.copied ? 'check' : 'copy'} />{copyWord}</button
		>
	</span>
{/if}

<style>
	.value-field {
		display: inline-flex;
		align-items: stretch;
		max-width: 100%;
		min-height: var(--control-h-sm);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-subtle);
	}
	/* One line, cut at the field's end; the field keeps its height */
	.value {
		display: block;
		align-self: center;
		min-width: 0;
		padding: 0 var(--space-3);
		overflow: hidden;
		font-family: var(--mono);
		font-size: var(--text-base);
		text-overflow: ellipsis;
		white-space: nowrap;
		unicode-bidi: isolate;
	}
	.value-field > button {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		flex-shrink: 0;
		width: auto;
		height: auto;
		padding: 0 var(--space-3);
		border: 0;
		border-inline-start: 1px solid var(--rule);
		background: transparent;
		color: var(--accent);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.value-field > button > :global(.material-icons) {
		font-size: 18px;
	}
	.value-field > button:hover {
		background: var(--hover);
	}
	.value-field > button.copied {
		color: var(--success);
	}
	.value-field > button:last-child {
		border-start-end-radius: calc(var(--radius) - 1px);
		border-end-end-radius: calc(var(--radius) - 1px);
	}
	@media (pointer: coarse) {
		.value-field > button {
			min-width: 44px;
			min-height: 44px;
		}
	}
</style>
