<!--
  Appearance preview: a small sample of the console in the colours, name,
  logo and fonts chosen on the page, before they are saved. Decoration
  for sighted people (aria-hidden); the caption says the theme and the
  accent colour in words. The colours are custom properties on the box
  (computed from the form), with the console's own tokens as fallback.
-->
<script lang="ts">
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import BrandLogo from '#lib/shell/BrandLogo.svelte';
	import { fontStack, luminance, textOn, type LogoType, type ThemeMode } from './appearance.ts';

	interface Props {
		palette: Record<string, string>;
		mode: ThemeMode;
		name: string;
		description: string;
		logoType: LogoType;
		/** An image to show as the logo (a picked file before upload, or the logo URL) */
		logoSrc: string;
		fontHeading: string;
		fontBody: string;
	}

	let { palette, mode, name, description, logoType, logoSrc, fontHeading, fontBody }: Props = $props();

	const shownName = $derived(name.trim() || 'BetterDesk');
	const isDefault = $derived(logoType === 'default');
	const fullLogo = $derived(isDefault && shownName.toLowerCase() === 'betterdesk');
	const safeLogo = $derived(
		logoType === 'image' && /^(\/(?!\/)|https?:|blob:)/i.test(logoSrc) ? logoSrc : ''
	);
	const bgLum = $derived(luminance(palette.bgPrimary ?? ''));
	const logoOn = $derived(bgLum !== null && bgLum < 0.2 ? 'dark' : 'light');
	const MODE: Record<ThemeMode, string> = {
		system: 'theme.auto',
		light: 'theme.light',
		dark: 'theme.dark',
		custom: 'theme.custom'
	};
	const caption = $derived(
		t('settings.side.preview_caption', { theme: t(MODE[mode]), accent: palette.accentBlue || '-' })
	);
</script>

<div
	class="theme-preview"
	id="theme-preview"
	aria-hidden="true"
	data-logo-on={logoOn}
	style:--pv-bg={palette.bgPrimary || null}
	style:--pv-bar={palette.bgSecondary || null}
	style:--pv-text={palette.textPrimary || null}
	style:--pv-muted={palette.textSecondary || null}
	style:--pv-accent={palette.accentBlue || null}
	style:--pv-on-accent={textOn(palette.accentBlue ?? '') || null}
	style:--pv-ok={palette.accentGreen || null}
	style:--pv-rule={palette.borderSecondary || null}
	style:font-family={fontStack(fontBody) || null}
>
	<div class="bar">
		{#if safeLogo}<img class="logo" src={safeLogo} alt="" />{/if}
		{#if fullLogo}
			<span class="brand"><BrandLogo name={shownName} /></span>
		{:else}
			{#if isDefault}<span class="brand mark"><BrandLogo mark /></span>{/if}
			<span class="name" style:font-family={fontStack(fontHeading) || null}>{shownName}</span>
		{/if}
	</div>
	<div class="body">
		<span class="heading">{t('nav.devices')}</span>
		<span class="row">
			<span>{t('settings.side.preview_device')}</span>
			<span class="ok">{t('status.online')}</span>
		</span>
		{#if description.trim()}<span class="muted">{description}</span>{/if}
		<span class="btn">{t('actions.connect')}</span>
	</div>
</div>
<p class="caption">{caption}</p>

<style>
	.theme-preview {
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid var(--pv-rule, var(--rule));
		border-radius: var(--radius);
		background: var(--pv-bg, var(--bg));
		color: var(--pv-text, var(--text));
	}
	.theme-preview[data-logo-on='light'] {
		--logo-square: #1f6feb;
		--logo-circle: #4d8f06;
		--logo-overlap: #0f9e96;
	}
	.theme-preview[data-logo-on='dark'] {
		--logo-square: #58a6ff;
		--logo-circle: #a3e635;
		--logo-overlap: #3fd0c4;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--pv-rule, var(--rule));
		background: var(--pv-bar, var(--bg-subtle));
	}
	.logo {
		width: 20px;
		height: 20px;
		object-fit: contain;
	}
	.brand {
		display: inline-flex;
		height: 20px;
		color: var(--pv-text, var(--text));
	}
	.brand :global(svg) {
		display: block;
		height: 20px;
		width: auto;
	}
	.name {
		font-weight: 600;
	}
	.body {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
	}
	.heading {
		font-size: var(--text-lg);
		font-weight: 600;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		padding-block: var(--space-2);
		border-block: 1px solid var(--pv-rule, var(--rule));
	}
	.ok {
		color: var(--pv-ok, var(--success));
	}
	.muted {
		color: var(--pv-muted, var(--text-muted));
		font-size: var(--text-sm);
	}
	.btn {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		background: var(--pv-accent, var(--accent));
		color: var(--pv-on-accent, var(--on-accent));
		font-weight: 600;
	}
	.caption {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
