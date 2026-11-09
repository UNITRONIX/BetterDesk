<!--
  Help panel (public/js/help-panel.js): opened from "Help" in the top bar.
  From 1100 px it docks beside the page (not modal: the page stays usable,
  focus goes to its close button, Escape closes it); below that it is a
  side sheet over the page (modal, Tab stays inside). Either way focus goes
  back to the Help button when it closes.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { openLayers } from '#lib/ui/layers.ts';
	import HelpContent from './HelpContent.svelte';

	interface Props {
		open?: boolean;
		docked: boolean;
		id: string;
		/** The Help button, for focus when the docked panel closes */
		opener: HTMLElement | null;
	}

	let { open = $bindable(false), docked, id, opener }: Props = $props();

	const uid = $props.id();
	let closeBtn = $state<HTMLButtonElement | null>(null);
	let panel = $state<HTMLElement | null>(null);

	function close() {
		const hadFocus = !!panel && panel.contains(document.activeElement);
		open = false;
		if (docked && hadFocus) opener?.focus({ preventScroll: true });
	}

	// Docked: focus the close button on open; Escape closes when nothing above it took the key
	$effect(() => {
		if (!open || !docked) return;
		closeBtn?.focus({ preventScroll: true });
		const key = (e: KeyboardEvent) => {
			if (e.key !== 'Escape' || e.defaultPrevented || openLayers() > 0) return;
			e.preventDefault();
			close();
		};
		document.addEventListener('keydown', key);
		return () => document.removeEventListener('keydown', key);
	});
</script>

{#if open && docked}
	<aside bind:this={panel} {id} class="help-panel" aria-labelledby={`${uid}-title`}>
		<div class="help-head">
			<h2 class="help-title" id={`${uid}-title`}><Icon name="favorite" />{t('help.panel.title')}</h2>
			<IconButton bind:element={closeBtn} icon="close" label={t('help.panel.close')} onclick={close} />
		</div>
		<div class="help-body"><HelpContent /></div>
	</aside>
{:else if open}
	<Sheet bind:open title={t('help.panel.title')}>
		<HelpContent />
	</Sheet>
{/if}

<style>
	.help-panel {
		position: sticky;
		top: var(--topbar-h);
		display: flex;
		flex: none;
		flex-direction: column;
		width: var(--side-w);
		height: calc(100vh - var(--topbar-h));
		height: calc(100dvh - var(--topbar-h));
		border-inline-start: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.help-head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--topbar-h);
		padding-inline: var(--space-4) var(--space-2);
		border-bottom: 1px solid var(--rule);
	}
	.help-title {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-md);
	}
	.help-title > :global(.material-icons) {
		color: var(--accent);
		font-size: 20px;
	}
	.help-body {
		flex: 1;
		min-height: 0;
		padding: var(--space-4);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
</style>
