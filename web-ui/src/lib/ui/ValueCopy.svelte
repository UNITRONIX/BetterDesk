<!--
  A value people read exactly or copy (GUIDE section 10): ID, IP address,
  host:port, key. Mono by default. With copy (default on) a copy button
  follows that shows on hover or focus of its row (always on touch); its
  space is kept, so nothing moves. Long values are cut with an ellipsis;
  the full value is in the title and is what gets copied. After copying:
  a tick for 1.5 s and a toast.
  label: names the value in the button's label ("Copy Device ID"), default
  the value itself. empty: word when there is no value.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { Copier } from './clipboard.svelte.ts';
	import Empty from './Empty.svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		value: string | number | null | undefined;
		copy?: boolean;
		mono?: boolean;
		label?: string;
		empty?: string;
	}

	let { value, copy = true, mono = true, label, empty }: Props = $props();

	const text = $derived(value === null || value === undefined ? '' : String(value));
	const copier = new Copier();
	$effect(() => () => copier.dispose());
</script>

{#if text.trim() === ''}
	<Empty word={empty} />
{:else if !copy}
	<span class={mono ? 'mono' : 'value-text'}>{text}</span>
{:else}
	<span class="value-copy"
		><span class={mono ? 'mono' : 'value-text'} title={text}>{text}</span><IconButton
			class={copier.copied ? 'copy-btn copied' : 'copy-btn'}
			icon={copier.copied ? 'check' : 'copy'}
			label={tf('common.copy_value', 'Copy {value}', { value: label ?? text })}
			onclick={() => copier.copy(text)}
		/></span
	>
{/if}

<style>
	.value-copy {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		max-width: 100%;
		vertical-align: middle;
	}
	.value-copy > :first-child {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		unicode-bidi: isolate;
	}
	.value-copy > :global(.copy-btn) {
		opacity: 0;
	}
	:global(:is(tr, li, dd, .list-row):hover) .value-copy > :global(.copy-btn),
	.value-copy:hover > :global(.copy-btn),
	.value-copy > :global(.copy-btn:focus-visible),
	.value-copy > :global(.copy-btn.copied) {
		opacity: 1;
	}
	@media (hover: none) {
		.value-copy > :global(.copy-btn) {
			opacity: 1;
		}
	}
</style>
