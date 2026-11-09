<!--
  Long details in a log row (sign-ins carry the whole browser string and a
  fingerprint): cut after two lines, with "Show all" / "Show less" that
  opens them in place (aria-expanded). The button shows only where the two
  lines cut text off, checked again when the width changes. The full text
  stays in the DOM for search, screen readers and copying.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import { DETAILS_CLAMP } from './audit.ts';

	let { text }: { text: string } = $props();

	let open = $state(false);
	let cut = $state(false);
	let el = $state<HTMLElement | null>(null);
	const long = $derived(text.length > DETAILS_CLAMP);

	$effect(() => {
		const node = el;
		if (!node || !long || typeof ResizeObserver === 'undefined') return;
		const check = () => {
			// a hidden tab has no layout yet; it is checked again when shown
			if (open || !node.clientHeight) return;
			cut = node.scrollHeight > node.clientHeight + 1;
		};
		check();
		const ro = new ResizeObserver(check);
		ro.observe(node);
		return () => ro.disconnect();
	});
</script>

{#if !text}<Empty />{:else if !long}{text}{:else}<span
		bind:this={el}
		class={['details', !open && 'is-clamped']}>{text}</span
	>{#if cut || open}<Button variant="link" size="sm" aria-expanded={open} onclick={() => (open = !open)}
			>{open
				? tf('security_audit.details_less', 'Show less')
				: tf('security_audit.details_more', 'Show all')}</Button
		>{/if}{/if}

<style>
	.details {
		display: block;
		overflow-wrap: anywhere;
	}
	.is-clamped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}
</style>
