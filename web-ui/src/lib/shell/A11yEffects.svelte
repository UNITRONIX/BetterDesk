<!--
  What the accessibility settings draw on every page (mounted once in the
  root layout): the colour vision filters the root's CSS filter points to
  (url(#bd-a11y-protanopia) ...), and the reading guide and mask, which
  follow the pointer while one of them is on. styles/a11y.css shows them.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { a11y, initA11y } from './a11y.svelte.ts';

	/** Height of the clear band between the two halves of the mask */
	const BAND = 150;

	let y = $state(0);
	let vh = $state(0);
	const following = $derived(a11y.settings.readingGuide || a11y.settings.readingMask);
	const top = $derived(Math.max(0, y - BAND / 2));
	const bottom = $derived(Math.min(vh, y + BAND / 2));

	onMount(() => {
		initA11y();
		vh = window.innerHeight;
		y = Math.round(vh / 2);
	});

	$effect(() => {
		if (!following) return;
		const move = (e: PointerEvent) => (y = e.clientY);
		const resize = () => (vh = window.innerHeight);
		document.addEventListener('pointermove', move, { passive: true });
		window.addEventListener('resize', resize, { passive: true });
		return () => {
			document.removeEventListener('pointermove', move);
			window.removeEventListener('resize', resize);
		};
	});
</script>

<svg class="bd-a11y-filter-defs" aria-hidden="true" focusable="false">
	<filter id="bd-a11y-protanopia" color-interpolation-filters="sRGB">
		<feColorMatrix type="matrix" values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0" />
	</filter>
	<filter id="bd-a11y-deuteranopia" color-interpolation-filters="sRGB">
		<feColorMatrix type="matrix" values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0" />
	</filter>
	<filter id="bd-a11y-tritanopia" color-interpolation-filters="sRGB">
		<feColorMatrix type="matrix" values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0" />
	</filter>
	<filter id="bd-a11y-achromatopsia" color-interpolation-filters="sRGB">
		<feColorMatrix
			type="matrix"
			values="0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0.299 0.587 0.114 0 0 0 0 0 1 0"
		/>
	</filter>
</svg>
{#if following}
	<div class="bd-a11y-reading-guide" style:top="{Math.max(0, y - 2)}px"></div>
	<div class="bd-a11y-reading-mask" style:top="0" style:height="{top}px"></div>
	<div class="bd-a11y-reading-mask" style:top="{bottom}px" style:height="{Math.max(0, vh - bottom)}px"></div>
{/if}
