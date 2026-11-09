<!--
  The operating system mark alone, from the sprite static/img/os-icons.svg,
  each system in its own colour (--os-*). An unknown system keeps an empty
  box of the same size, so names next to it stay aligned. Decorative: the
  OS name is shown next to it (Platform) or in a label nearby.
-->
<script lang="ts">
	import { asset } from '$app/paths';
	import { platformId } from '#lib/util/display.ts';

	let { platform }: { platform: string | null | undefined } = $props();

	const id = $derived(platformId(platform));
	const sprite = asset('img/os-icons.svg');
</script>

{#if id}
	<svg class="os-icon os-{id}" aria-hidden="true" focusable="false"><use href="{sprite}#{id}"></use></svg>
{:else}
	<span class="os-icon os-icon-none" aria-hidden="true"></span>
{/if}

<style>
	.os-icon {
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		fill: currentColor;
		color: var(--text-muted);
		vertical-align: -3px;
	}
	.os-icon-none {
		display: inline-block;
	}
	/* Set as fill, so page rules that mute the colour don't grey the mark */
	.os-windows {
		fill: var(--os-windows);
	}
	.os-android {
		fill: var(--os-android);
	}
	.os-linux {
		fill: var(--os-linux);
	}
	.os-apple {
		fill: var(--os-apple);
	}
	.os-chrome {
		fill: var(--os-chrome);
	}
</style>
