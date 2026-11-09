<!--
  A version number without a leading "v" ("1.4.2"), tabular figures. Plain
  text, not a tag. No version gives Empty (dash, or the `empty` word).
-->
<script lang="ts">
	import { cleanVersion } from '#lib/util/display.ts';
	import Empty from './Empty.svelte';

	let { version, empty }: { version: unknown; empty?: string } = $props();
	const v = $derived(cleanVersion(version));
</script>

{#if v}
	<span class="version">{v}</span>
{:else}
	<Empty word={empty} />
{/if}

<style>
	.version {
		font-variant-numeric: tabular-nums;
	}
</style>
