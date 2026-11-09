<!--
  Language flag: the Twemoji flag for a language code before its name
  (language menu, sign-in pages, Translations). Decorative (alt=""), the
  name carries the meaning. A language without a mapped flag gets none
  rather than a wrong one. Codes and countries as in
  web-nodejs/views/partials/lang-flag.ejs (en: United Kingdom, pt:
  Portugal, zh-TW: Taiwan); static/img/flags/<code>.svg.
  code: the language code. name: the language name, shown after the flag.
-->
<script lang="ts" module>
	export const FLAG_CODES: ReadonlySet<string> = new Set([
		'ar',
		'cs',
		'da',
		'de',
		'en',
		'es',
		'fi',
		'fr',
		'hi',
		'hu',
		'id',
		'it',
		'ja',
		'ko',
		'nb',
		'nl',
		'pl',
		'pt',
		'ro',
		'sv',
		'th',
		'tr',
		'uk',
		'vi',
		'zh',
		'zh-TW'
	]);
</script>

<script lang="ts">
	import { asset } from '$app/paths';

	let { code, name }: { code: string; name?: string } = $props();

	const src = $derived(FLAG_CODES.has(code) ? asset(`img/flags/${code}.svg` as 'img/flags/en.svg') : '');
</script>

{#snippet flag()}
	{#if src}<img class="lang-flag" {src} alt="" width="20" height="20" />{/if}
{/snippet}

{#if name}
	<span class="lang">{@render flag()}<span class="lang-name">{name}</span></span>
{:else}
	{@render flag()}
{/if}

<style>
	/* The SVG is a 36x36 box with the flag in the middle, so every flag sits
	   on the text's centre line in the same 20px box */
	.lang-flag {
		display: inline-block;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		vertical-align: middle;
	}
	.lang {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
</style>
