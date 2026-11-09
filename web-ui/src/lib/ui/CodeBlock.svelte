<!--
  Code block: text people copy (a script, a config). A title bar with the
  title and a Copy button, then the text in a pre that scrolls when long
  and can be focused to scroll with the keyboard. Copy copies the whole
  text: a tick for 1.5 s and a toast.
  code: the text. title: what it is ("Install script"); it also names the
  scroll region and describes the Copy button.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import { Copier } from './clipboard.svelte.ts';

	let { code, title }: { code: string; title?: string } = $props();

	const id = $props.id();
	const copier = new Copier();
	$effect(() => () => copier.dispose());
</script>

<div class="code-block-wrap">
	<div class="code-block-head">
		{#if title}<span class="code-block-title" id="{id}-title">{title}</span>{/if}
		<Button
			variant="ghost"
			size="sm"
			icon={copier.copied ? 'check' : 'copy'}
			aria-describedby={title ? `${id}-title` : undefined}
			onclick={() => copier.copy(code)}>{tf('actions.copy', 'Copy')}</Button
		>
	</div>
	<!-- A scrolling region must be reachable with the keyboard -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<pre
		class="code-block"
		tabindex="0"
		role={title ? 'region' : undefined}
		aria-labelledby={title ? `${id}-title` : undefined}>{code}</pre>
</div>

<style>
	.code-block-head {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-bottom: var(--space-1);
	}
	.code-block-title {
		margin-inline-end: auto;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Without a title the button keeps to the end */
	.code-block-head > :global(.btn:first-child) {
		margin-inline-start: auto;
	}
	.code-block {
		margin: 0;
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		color: var(--text);
		font-family: var(--mono);
		font-size: var(--text-sm);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		overflow-x: auto;
		max-height: 420px;
	}
</style>
