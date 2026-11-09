<script lang="ts">
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import '#lib/styles/a11y.css';
	import type { Snippet } from 'svelte';
	import A11yEffects from '#lib/shell/A11yEffects.svelte';

	let { children }: { children: Snippet } = $props();
</script>

<!-- Colour filters and the reading guide of the accessibility settings, on every page -->
<A11yEffects />
{@render children()}
