<!--
  Bottom bar on phones (views/partials/mobile-bottom-nav.ejs): Home,
  Devices, Remote and Chat when the navigation the server sent has them,
  and More, which opens the sidebar drawer.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import type { BottomItem } from './nav-model.ts';

	interface Props {
		items: BottomItem[];
		drawerId: string;
		drawerOpen: boolean;
		onmore: (opener: HTMLElement) => void;
	}

	let { items, drawerId, drawerOpen, onmore }: Props = $props();
</script>

<nav class="bottom-nav" aria-label={t('mobile_nav.label')}>
	{#each items as item (item.id)}
		<a
			href={link(item.href)}
			class={['bottom-item', item.active && 'active']}
			aria-current={item.active ? 'page' : undefined}
		>
			<Icon name={item.icon} />
			<span>{t(item.labelKey)}</span>
		</a>
	{/each}
	<button
		type="button"
		class="bottom-item"
		aria-expanded={drawerOpen}
		aria-controls={drawerId}
		onclick={(e) => onmore(e.currentTarget)}
	>
		<Icon name="menu" />
		<span>{t('mobile_nav.more')}</span>
	</button>
</nav>

<style>
	.bottom-nav {
		display: none;
	}
	@media (max-width: 767px) {
		.bottom-nav {
			position: fixed;
			inset-inline: 0;
			bottom: 0;
			z-index: 40;
			display: flex;
			padding-bottom: env(safe-area-inset-bottom, 0px);
			border-top: 1px solid var(--rule);
			background: var(--bg);
		}
	}
	.bottom-item {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-width: 0;
		min-height: 56px;
		padding: var(--space-1) 0;
		border: 0;
		border-top: 2px solid transparent;
		background: transparent;
		color: var(--text-muted);
		font: inherit;
		font-size: var(--text-xs);
		text-decoration: none;
		cursor: pointer;
	}
	.bottom-item:hover {
		color: var(--text);
	}
	.bottom-item:focus-visible {
		outline-offset: -2px;
	}
	.bottom-item.active {
		border-top-color: var(--accent);
		color: var(--text);
		font-weight: 600;
	}
	.bottom-item > :global(.material-icons) {
		font-size: 22px;
	}
</style>
