<!--
  "On this page": links to the sections of a settings tab. Above the forms
  it is a row of links; in the side column (side) a list with a title, and
  the section in view is marked (aria-current), as the old settings.js did.
  A link sets #<id>; the settings page scrolls there and marks the section.
-->
<script module lang="ts">
	export interface TocItem {
		/** The section's element id */
		id: string;
		label: string;
	}
</script>

<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';

	let { items, side = false }: { items: readonly TocItem[]; side?: boolean } = $props();

	let current = $state<string | null>(null);

	// Mark the section in view (side list only)
	$effect(() => {
		if (!side || typeof IntersectionObserver !== 'function') return;
		const blocks = items
			.map((item) => {
				const target = document.getElementById(item.id);
				if (!target) return null;
				const block = target.matches('section, form, .danger-zone, .settings-subgroup')
					? target
					: (target.closest<HTMLElement>('.settings-subgroup, form, section') ?? target);
				return { id: item.id, block };
			})
			.filter((b): b is { id: string; block: HTMLElement } => b !== null);
		// Bookkeeping for the observer, not something markup reads
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const inView = new Map<Element, boolean>();
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) inView.set(e.target, e.isIntersecting);
				current = blocks.find((b) => inView.get(b.block))?.id ?? null;
			},
			{ rootMargin: '-64px 0px -55% 0px' }
		);
		for (const b of blocks) io.observe(b.block);
		return () => io.disconnect();
	});
</script>

<nav class={['settings-toc', side && 'is-side']} aria-label={t('settings.page.on_this_page')}>
	{#if side}<p class="settings-toc-title">{t('settings.page.on_this_page')}</p>{/if}
	<ul class="toc">
		{#each items as item (item.id)}
			<li>
				<a href="#{item.id}" aria-current={side && current === item.id ? 'true' : undefined}>{item.label}</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.toc a {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h-sm);
		color: var(--text-muted);
	}
	.toc a:hover,
	.toc a[aria-current='true'] {
		color: var(--text);
	}
	.settings-toc-title {
		margin: 0 0 var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.is-side .toc {
		flex-direction: column;
		flex-wrap: nowrap;
		gap: 0;
	}
	.is-side .toc a {
		width: 100%;
		padding-inline-start: var(--space-3);
		border-inline-start: 2px solid var(--rule);
	}
	.is-side .toc a[aria-current='true'] {
		border-inline-start-color: var(--accent);
		font-weight: 600;
	}
	@media (pointer: coarse) {
		.toc a {
			min-height: 44px;
		}
	}
</style>
