<!--
  The sign-in page's promo panel beside the form (Settings › Appearance ›
  sign-in layout). "single": one picture, painted by /css/branding.css
  (body.login-page.login-layout-single .login-promo). "slides": a carousel
  of the admin's slides, title and text over the picture; it moves on
  every 7 s, stops while the pointer or focus is on it, in hidden tabs and
  when motion is reduced (system setting or the accessibility panel).
  Hidden below 900 px, where the form needs the width.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { has, i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import IconButton from '#lib/ui/IconButton.svelte';
	import type { Slide } from '#lib/api/signin.ts';

	let { mode, slides }: { mode: 'single' | 'slides'; slides: readonly Slide[] } = $props();

	const INTERVAL_MS = 7000;

	let index = $state(0);
	let hovered = $state(false);
	let focused = $state(false);
	let hidden = $state(false);
	let still = $state(false);

	const count = $derived(slides.length);
	const current = $derived(count ? ((index % count) + count) % count : 0);
	const paused = $derived(hovered || focused || hidden || still || count < 2);

	function text(slide: Slide, part: 'title' | 'body'): string {
		if (slide[part]) return slide[part];
		const key = `login_promo.slides.${slide.slideKey}.${part}`;
		return slide.slideKey && has(key) ? t(key) : '';
	}

	function go(to: number) {
		index = ((to % count) + count) % count;
	}

	onMount(() => {
		const root = document.documentElement;
		const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
		const update = () => {
			hidden = document.hidden;
			still =
				!!mq?.matches ||
				root.dataset.a11yReduceMotion === 'true' ||
				root.dataset.a11yPauseAnimations === 'true';
		};
		update();
		document.addEventListener('visibilitychange', update);
		mq?.addEventListener('change', update);
		// The accessibility panel sets data-a11y-* on <html>
		const watch = new MutationObserver(update);
		watch.observe(root, {
			attributes: true,
			attributeFilter: ['data-a11y-reduce-motion', 'data-a11y-pause-animations']
		});
		return () => {
			document.removeEventListener('visibilitychange', update);
			mq?.removeEventListener('change', update);
			watch.disconnect();
		};
	});

	// Moves on while nothing holds it; a click on the controls starts the wait again
	$effect(() => {
		if (paused) return;
		void index;
		const timer = setTimeout(() => go(current + 1), INTERVAL_MS);
		return () => clearTimeout(timer);
	});

	const rtl = $derived(i18n.dir === 'rtl');
</script>

{#if mode === 'single'}
	<aside class="login-promo login-promo-single" aria-hidden="true"></aside>
{:else if count}
	<aside
		class="login-promo"
		aria-roledescription={tf('login_promo.carousel', 'carousel')}
		aria-label={t('branding.login_slides_title')}
		onpointerenter={() => (hovered = true)}
		onpointerleave={() => (hovered = false)}
		onfocusin={() => (focused = true)}
		onfocusout={(e) => {
			const next = e.relatedTarget;
			if (!(next instanceof Node) || !e.currentTarget.contains(next)) focused = false;
		}}
	>
		<div class="login-promo-slides" aria-live={paused ? 'polite' : 'off'}>
			{#each slides as slide, i (slide.id || i)}
				{@const title = text(slide, 'title')}
				{@const body = text(slide, 'body')}
				<div
					class={['login-promo-slide', slide.imageUrl && 'has-image']}
					role="group"
					aria-roledescription={tf('login_promo.slide', 'slide')}
					aria-label={tf('login_promo.slide_n', 'Slide {n} of {count}', { n: i + 1, count })}
					hidden={i !== current}
				>
					{#if slide.imageUrl}
						<img class="login-promo-slide-bg" src={slide.imageUrl} alt="" />
						<div
							class="login-promo-slide-overlay"
							style:opacity={Math.min(90, Math.max(0, slide.overlay)) / 100}
						></div>
					{/if}
					<div class="login-promo-copy">
						{#if title}<h2 class="login-promo-title">{title}</h2>{/if}
						{#if body}<p class="login-promo-body">{body}</p>{/if}
					</div>
				</div>
			{/each}
		</div>
		{#if count > 1}
			<div class="login-promo-controls">
				<IconButton
					class="login-promo-nav"
					icon={rtl ? 'chevron_right' : 'chevron_left'}
					label={t('login_promo.prev')}
					onclick={() => go(current - 1)}
				/>
				<div class="login-promo-dots">
					{#each slides as slide, i (slide.id || i)}
						<button
							type="button"
							class="login-promo-dot"
							aria-current={i === current || undefined}
							aria-label={tf('login_promo.slide_n', 'Slide {n} of {count}', { n: i + 1, count })}
							onclick={() => go(i)}
						></button>
					{/each}
				</div>
				<IconButton
					class="login-promo-nav"
					icon={rtl ? 'chevron_left' : 'chevron_right'}
					label={t('login_promo.next')}
					onclick={() => go(current + 1)}
				/>
			</div>
		{/if}
	</aside>
{/if}

<style>
	.login-promo {
		position: relative;
		flex: 0 0 50%;
		overflow: hidden;
		border-inline-end: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.login-promo-slides,
	.login-promo-slide,
	.login-promo-slide-bg,
	.login-promo-slide-overlay {
		position: absolute;
		inset: 0;
	}
	.login-promo-slide-bg {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.login-promo-slide-overlay {
		background: #000000;
	}
	.login-promo-copy {
		position: absolute;
		bottom: calc(var(--space-7) + var(--control-h));
		inset-inline: var(--space-6);
		max-width: 480px;
		color: var(--text);
	}
	/* Text over a picture: white on the darkened picture */
	.has-image .login-promo-copy {
		color: #ffffff;
	}
	.login-promo-title {
		margin-bottom: var(--space-2);
		color: inherit;
		font-size: var(--text-lg);
	}
	.login-promo-body {
		color: inherit;
		opacity: 0.9;
	}
	.login-promo-controls {
		position: absolute;
		bottom: var(--space-4);
		inset-inline-start: var(--space-6);
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	.login-promo-controls > :global(.login-promo-nav) {
		width: var(--control-h);
		height: var(--control-h);
		border-color: rgba(255, 255, 255, 0.6);
		background: rgba(0, 0, 0, 0.3);
		color: #ffffff;
	}
	.login-promo-controls > :global(.login-promo-nav:hover) {
		background: rgba(0, 0, 0, 0.5);
		color: #ffffff;
	}
	.login-promo-dots {
		display: flex;
	}
	/* A 10 px square in a 24 px target (44 px on touch screens) */
	.login-promo-dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		background: transparent;
		cursor: pointer;
	}
	.login-promo-dot::before {
		content: '';
		width: 10px;
		height: 10px;
		border: 1px solid #ffffff;
		border-radius: 1px;
		box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
	}
	.login-promo-dot[aria-current='true']::before {
		background: #ffffff;
	}
	.login-promo-dot:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	@media (pointer: coarse) {
		.login-promo-dot,
		.login-promo-controls > :global(.login-promo-nav) {
			width: 44px;
			height: 44px;
		}
	}
	@media (max-width: 899px) {
		.login-promo {
			display: none;
		}
	}
</style>
