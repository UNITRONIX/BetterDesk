<!--
  New tokens, shown once: each name above its value with Copy, Copy all for
  several, and where the connection values are. A one-time secret, so a
  centred dialog.
-->
<script lang="ts">
	import type { NewToken } from '#lib/api/tokens.ts';
	import { around } from '#lib/clients/text.ts';
	import { copyAllText } from '#lib/clients/tokens.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import ValueField from '#lib/ui/ValueField.svelte';
	import { Copier } from '#lib/ui/clipboard.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let { tokens, onclose }: { tokens: NewToken[]; onclose: () => void } = $props();

	const copier = new Copier();
	$effect(() => () => copier.dispose());

	const next = $derived(around(t('tokens.created_next'), '{page}'));
</script>

<Dialog
	title={tokens.length > 1 ? t('tokens.tokens_generated') : t('tokens.token_created')}
	size="large"
	class="created-dialog"
	{onclose}
>
	<Notice tone="warning" message={t('tokens.copy_warning')} />
	<dl class="facts created-list">
		{#each tokens as tok, i (i)}
			<dt>{tok.name}</dt>
			<dd><ValueField value={tok.token} label={tok.name} /></dd>
		{/each}
	</dl>
	<p class="next">{next[0]}<a href={link('/keys')}>{t('nav.keys')}</a>{next[1]}</p>
	{#snippet footer()}
		{#if tokens.length > 1}
			<Button icon={ICONS.copy} class="copy-all" onclick={() => void copier.copy(copyAllText(tokens))}
				>{t('tokens.copy_all')}</Button
			>
		{/if}
		<Button variant="primary" onclick={onclose}>{t('common.close')}</Button>
	{/snippet}
</Dialog>

<style>
	/* Name above its value */
	.created-list {
		grid-template-columns: minmax(0, 1fr);
		margin-top: var(--space-4);
	}
	.created-list > dt {
		min-height: 0;
		padding-bottom: 0;
		border-bottom: 0;
	}
	.created-list > dd {
		padding-top: var(--space-1);
	}
	.next {
		margin: var(--space-4) 0 0;
		max-width: var(--measure);
	}
</style>
