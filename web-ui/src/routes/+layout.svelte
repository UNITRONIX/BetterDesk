<script lang="ts">
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
