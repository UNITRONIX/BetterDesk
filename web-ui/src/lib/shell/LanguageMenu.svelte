<!--
  Language menu (top bar): every console language with its flag and its
  own name. Choosing one saves it on the account (POST /api/i18n/set) and
  switches the strings, the direction and the navigation without a reload.
-->
<script lang="ts">
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import { getBootstrap, saveLanguage } from '#lib/api/console.ts';
	import { i18n, switchLanguage, t } from '#lib/i18n/i18n.svelte.ts';
	import { applyBootstrap } from '#lib/state/session.svelte.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import LangFlag from '#lib/ui/LangFlag.svelte';
	import Menu from '#lib/ui/Menu.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	const uid = $props.id();
	let open = $state(false);
	let button = $state<HTMLButtonElement | null>(null);
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
	<IconButton
		bind:element={button}
		icon="language"
		label={t('settings.language')}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		{onclick}
		{onkeydown}
	/>
	<Menu
		bind:open
		anchor={button}
		align="end"
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
	.lang-anchor :global(.menu.lang-menu) {
		min-width: 200px;
		max-height: min(70vh, 480px);
	}
</style>
