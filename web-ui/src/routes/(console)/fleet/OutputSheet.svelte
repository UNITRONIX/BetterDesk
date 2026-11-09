<!--
  Output of a task or a workflow run, in a wide details sheet: the text in
  a code block (copy, scrolls with the keyboard). `load` fetches it when
  the sheet opens; `text` shows text the page already has. `actions` go
  before Close in the footer (Retry for a failed task).
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';

	interface Props {
		title: string;
		subtitle?: string;
		text?: string;
		load?: (signal: AbortSignal) => Promise<string>;
		actions?: Snippet;
		onclose: () => void;
	}

	let { title, subtitle, text, load, actions, onclose }: Props = $props();

	let output = $state<string | null>(untrack(() => text ?? null));
	let failed = $state<string | null>(null);

	$effect(() => {
		const fetch = load;
		if (!fetch) return;
		const ctrl = new AbortController();
		untrack(() => {
			fetch(ctrl.signal).then(
				(out) => (output = out || t('fleet.no_output')),
				(err: unknown) => {
					if (err instanceof DOMException && err.name === 'AbortError') return;
					failed = t('fleet.output_failed', { error: err instanceof Error ? err.message : '' });
				}
			);
		});
		return () => ctrl.abort();
	});
</script>

<Sheet {title} {subtitle} wide {onclose}>
	{#if failed}
		<States kind="error" message={failed} />
	{:else if output === null}
		<States kind="loading" message={t('fleet.loading_output')} />
	{:else}
		<CodeBlock code={output} title={t('fleet.task_output')} />
	{/if}
	{#snippet footer()}
		{@render actions?.()}
		<Button onclick={onclose}>{t('fleet.close')}</Button>
	{/snippet}
</Sheet>
