<!--
  The logo above the sign-in form (views/login.ejs): the BetterDesk logo,
  the admin's text logo, an SVG or image logo with the name next to it, or
  the name alone. An admin's SVG is shown as a picture (data URL), where it
  can't run anything; image addresses must be on this server or http(s).
-->
<script lang="ts">
	import BrandLogo from '#lib/shell/BrandLogo.svelte';
	import type { LoginBranding } from '#lib/api/signin.ts';

	let { branding, appName }: { branding: LoginBranding; appName: string } = $props();

	const svgSrc = $derived(
		/^\s*<svg[\s>]/i.test(branding.logoSvg)
			? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(branding.logoSvg)}`
			: ''
	);
	const imgSrc = $derived(/^(\/(?!\/)|https?:\/\/)/i.test(branding.logoUrl) ? branding.logoUrl : '');
</script>

<div class="login-brand">
	{#if branding.logoType === 'default'}
		<BrandLogo name={appName} />
	{:else if branding.logoType === 'text' && branding.logoText}
		<span class="brand-text-logo"
			>{branding.logoText}{#if branding.logoTextAccent}<span class="brand-text-accent"
					>{branding.logoTextAccent}</span
				>{/if}</span
		>
	{:else if branding.logoType === 'svg' && svgSrc}
		<img class="login-logo-img" src={svgSrc} alt="" /><span class="login-logo-text">{appName}</span>
	{:else if branding.logoType === 'image' && imgSrc}
		<img class="login-logo-img" src={imgSrc} alt="" /><span class="login-logo-text">{appName}</span>
	{:else}
		<span class="login-logo-text">{appName}</span>
	{/if}
</div>

<style>
	.login-brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 28px;
		margin-bottom: var(--space-6);
		font-weight: 700;
	}
	/* The BetterDesk logo 28 px high, as on the old page */
	.login-brand > :global(.brand-logo-full) {
		width: auto;
		height: 28px;
	}
	.login-brand > :global(.brand-logo-mark) {
		width: 28px;
		height: 28px;
	}
	.login-logo-img {
		display: block;
		width: auto;
		height: 28px;
	}
	.brand-text-accent {
		color: var(--accent);
	}
</style>
