<!--
  The frame of the public download pages (/portal, /d/<id>): one centred
  column of 720 px on the page background, without the console shell. With
  an admin-chosen background (Settings › Appearance › agent page) the column
  gets the page colour and a border, so the text stays readable on it.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** A CSS background value from the server (colour, gradient or url()), or '' */
		background?: string;
		/** A readable hex colour for the primary button, or '' */
		accent?: string;
		children: Snippet;
	}

	let { background = '', accent = '', children }: Props = $props();
</script>

<div
	class={['dl-page', background && 'has-background', accent && 'has-accent']}
	style:--dl-background={background || undefined}
	style:--dl-accent={accent || undefined}
>
	<main class="dl-main">
		<div class="dl-content">{@render children()}</div>
	</main>
</div>

<style>
	.dl-page {
		min-height: 100vh;
		min-height: 100dvh;
	}
	.has-background {
		background: var(--dl-background);
		background-position: center;
		background-repeat: no-repeat;
		background-size: cover;
		background-attachment: fixed;
	}
	.dl-main {
		display: flex;
		justify-content: center;
		padding: var(--space-7) var(--space-4) var(--space-6);
	}
	.dl-content {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		width: 100%;
		max-width: 720px;
	}
	.has-background .dl-content {
		align-self: flex-start;
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg);
	}
	/* The bundle's colour on buttons only; links keep the console accent, tuned for both themes */
	.has-accent :global(.btn-primary),
	.has-accent :global(.btn-primary:hover) {
		border-color: var(--dl-accent);
		background: var(--dl-accent);
		color: #ffffff;
	}
	@media (max-width: 640px) {
		.dl-main {
			padding-top: var(--space-5);
		}
	}
</style>
