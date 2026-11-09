<!--
  Language menu: every console language with its flag and its own name.
  In the top bar (trigger "icon", a globe button) choosing one saves it on
  the account (POST /api/i18n/set) and switches the strings, the direction
  and the navigation without a reload. On the sign-in page (trigger
  "label", the current language's flag and name) the page passes its own
  onchoose, since there is no account or navigation yet.
-->
<script lang="ts">
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { getBootstrap, saveLanguage } from '#lib/api/console.ts';
	import { i18n, switchLanguage, t } from '#lib/i18n/i18n.svelte.ts';
	import { applyBootstrap } from '#lib/state/session.svelte.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		/** "icon": the globe button; "label": the current language's flag and name */
		trigger?: 'icon' | 'label';
		align?: 'start' | 'end';
		/** Saves and applies a choice instead of the account and navigation update; handles its own errors */
		onchoose?: (code: string) => Promise<void>;
	}

	let { trigger = 'icon', align = 'end', onchoose }: Props = $props();

	const uid = $props.id();
	let open = $state(false);
	let iconButton = $state<HTMLButtonElement | null>(null);
	let labelButton = $state<HTMLElement | null>(null);
	const button = $derived(trigger === 'label' ? labelButton : iconButton);
	const current = $derived(i18n.available.find((l) => l.code === i18n.lang));
	let busy = false;

	function onclick() {
		if (open) {
			open = false;
			button?.focus();
		} else open = true;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
			e.preventDefault();
			open = true;
		}
	}

	function onclose(returnFocus: boolean) {
		if (returnFocus) button?.focus();
	}

	async function choose(code: string) {
		if (busy || code === i18n.lang) return;
		busy = true;
		if (onchoose) {
			try {
				await onchoose(code);
			} finally {
				busy = false;
			}
			return;
		}
		try {
			await switchLanguage(code, saveLanguage);
			// Page names in the navigation come translated from the server
			applyBootstrap(await getBootstrap());
		} catch {
			toast.error(t('errors.language_change_failed'));
		} finally {
			busy = false;
		}
	}
</script>

<span class="lang-anchor">
	{#if trigger === 'label'}
		<Button
			bind:element={labelButton}
			variant="ghost"
			size="sm"
			class="lang-label"
			aria-label="{t('settings.language')}: {current?.native || current?.name || i18n.lang}"
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? `${uid}-menu` : undefined}
			{onclick}
			{onkeydown}
			><LangFlag code={i18n.lang} /><span lang={i18n.lang}
				>{current?.native || current?.name || i18n.lang}</span
			><Icon name="expand_more" /></Button
		>
	{:else}
		<IconButton
			bind:element={iconButton}
			icon="language"
			label={t('settings.language')}
			aria-haspopup="menu"
			aria-expanded={open}
			aria-controls={open ? `${uid}-menu` : undefined}
			{onclick}
			{onkeydown}
		/>
	{/if}
	<Menu
		bind:open
		anchor={button}
		{align}
		id={`${uid}-menu`}
		label={t('settings.language')}
		class="lang-menu"
		{onclose}
	>
		{#each i18n.available as l (l.code)}
			<MenuItem type="radio" checked={l.code === i18n.lang} lang={l.code} onselect={() => choose(l.code)}>
				{#snippet lead()}<LangFlag code={l.code} />{/snippet}
				{l.native || l.name || l.code}
			</MenuItem>
		{/each}
	</Menu>
</span>

<style>
	.lang-anchor {
		position: relative;
		display: inline-flex;
	}
	.lang-anchor :global(.lang-label) {
		gap: var(--space-2);
	}
	.lang-anchor :global(.menu.lang-menu) {
		min-width: 200px;
		max-height: min(70vh, 480px);
	}
</style>
