<!--
  The layout of one settings tab (settings.css "Settings page layout"):
  the forms in the main column, what helps with them in the side column.
  Below 1200 px the side column follows the main one and the contents
  (toc) sit as a row of links above the forms; from 1200 px the contents
  are a list at the top of the side column.

    <SettingsLayout toc={[{ id: 'public-endpoints', label: ... }]} side={side} sideLabelledby="general-side-title">
        ...sections...
    </SettingsLayout>

  sticky: the side column stays in view while the page scrolls (when it is
  shorter than the window). formSide: a tab that is one form keeps the form
  at its measure and gives the rest of the width to the side column.
  The main column is the size container "settings-main" that SettingsGrid
  uses to go to two columns.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import SettingsToc, { type TocItem } from './SettingsToc.svelte';

	interface Props {
		toc?: readonly TocItem[];
		side?: Snippet;
		sideLabelledby?: string;
		sticky?: boolean;
		formSide?: boolean;
		children: Snippet;
	}

	let { toc, side, sideLabelledby, sticky = false, formSide = false, children }: Props = $props();

	const WIDE = '(min-width: 1200px)';
	let wide = $state(
		typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia(WIDE).matches
	);

	$effect(() => {
		if (typeof window.matchMedia !== 'function') return;
		const mq = window.matchMedia(WIDE);
		const sync = () => (wide = mq.matches);
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});

	const tocInSide = $derived(!!toc?.length && wide);
</script>

<div class={['page-cols', 'settings-cols', formSide && 'is-form-side']}>
	<div class="page-main">
		{#if toc?.length && !tocInSide}<SettingsToc items={toc} />{/if}
		{@render children()}
	</div>
	{#if side || tocInSide}
		<aside class={['page-side', 'settings-side', sticky && 'is-sticky']} aria-labelledby={sideLabelledby}>
			{#if toc && tocInSide}<SettingsToc items={toc} side />{/if}
			{@render side?.()}
		</aside>
	{/if}
</div>

<style>
	.page-main {
		gap: var(--space-6);
		container: settings-main / inline-size;
	}
	/* The side column is narrow: labels take what they need, values the rest */
	@media (min-width: 641px) {
		.settings-side :global(.facts) {
			grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
		}
		.settings-side :global(.facts > dt) {
			max-width: 160px;
		}
	}
	@media (min-width: 1200px) {
		.is-form-side {
			grid-template-columns: minmax(0, var(--measure)) minmax(280px, 1fr);
		}
		.is-form-side > .page-side {
			container: settings-side / inline-size;
		}
	}
</style>
