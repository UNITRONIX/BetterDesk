<!--
  The console's logo on the remote client's pages, as Settings › Appearance
  sets it: the BetterDesk logo, text with an accent, an SVG (shown as a
  picture, so it can't run anything) or an image, with the app name.
  Same rules as the shell's sidebar logo.
-->
<script lang="ts">
	import BrandLogo from '#lib/shell/BrandLogo.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import type { PublicBranding } from '#lib/api/remote.ts';

	let { appName, branding }: { appName: string; branding: Partial<PublicBranding> | null } = $props();

	const OTHER = new Set(['text', 'svg', 'image', 'icon']);
	const type = $derived(branding?.logoType || 'default');
	const svgSrc = $derived(
		branding?.logoSvg && /^\s*<svg[\s>]/i.test(branding.logoSvg)
			? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(branding.logoSvg)}`
			: ''
	);
	const imgSrc = $derived(
		branding?.logoUrl && /^(\/(?!\/)|https?:\/\/)/i.test(branding.logoUrl) ? branding.logoUrl : ''
	);
</script>

<span class="remote-brand">
	{#if !OTHER.has(type)}
		<BrandLogo name={appName} />
	{:else if type === 'text' && branding?.logoText}
		<span class="logo-text"
			>{branding.logoText}{#if branding.logoTextAccent}<span class="logo-accent"
					>{branding.logoTextAccent}</span
				>{/if}</span
		>
	{:else if type === 'svg' && svgSrc}
		<img class="logo-img" src={svgSrc} alt="" /><span class="logo-name">{appName}</span>
	{:else if type === 'image' && imgSrc}
		<img class="logo-img" src={imgSrc} alt="" /><span class="logo-name">{appName}</span>
	{:else}
		<Icon name={branding?.logoIcon || 'dns'} /><span class="logo-name">{appName}</span>
	{/if}
</span>

<style>
	.remote-brand {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		color: var(--text);
		font-weight: 600;
	}
	.remote-brand :global(.brand-logo-full) {
		height: 20px;
		width: auto;
	}
	.remote-brand :global(.brand-logo-mark) {
		height: 24px;
		width: 24px;
	}
	.logo-img {
		max-height: 24px;
		max-width: 120px;
	}
	.logo-accent {
		color: var(--accent);
	}
	.logo-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
