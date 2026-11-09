<!--
  One remote command: device, type, status, when it was sent (and by whom)
  and finished, then the command text and the agent's result. A wide
  details sheet; it shows the row at once and fills in the latest state.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { getCommand, type Command } from '#lib/api/automation.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { commandTone, labelFor } from '#lib/rules/automation.ts';
	import Button from '#lib/ui/Button.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';

	let { command, onclose }: { command: Command; onclose: () => void } = $props();

	let cmd = $state.raw(untrack(() => command));
	let failed = $state(false);

	$effect(() => {
		const id = command.id;
		const ctrl = new AbortController();
		getCommand(id, ctrl.signal).then(
			(c) => (cmd = c),
			(err: unknown) => {
				if (!(err instanceof DOMException && err.name === 'AbortError')) failed = true;
			}
		);
		return () => ctrl.abort();
	});

	const facts = $derived([
		{ label: t('automation.device'), value: device },
		{ label: t('automation.command_type'), value: type },
		{ label: t('automation.command_status'), value: state },
		{ label: t('automation.sent_at'), value: sent },
		...(cmd.completed_at ? [{ label: t('automation.completed_at'), value: done }] : [])
	]);
</script>

{#snippet device()}<ValueCopy value={cmd.device_id} label={t('automation.device_id')} />{/snippet}
{#snippet type()}<Tag label={labelFor(t, 'cmd_type', cmd.command_type)} />{/snippet}
{#snippet state()}<Status
		tone={commandTone(cmd.status)}
		label={labelFor(t, 'status', cmd.status)}
	/>{/snippet}
{#snippet sent()}<Time value={cmd.created_at} relative={false} />{#if cmd.created_by}<span class="by"
			>{t('automation.sent_by', { name: cmd.created_by })}</span
		>{/if}{/snippet}
{#snippet done()}<Time value={cmd.completed_at} relative={false} />{/snippet}

<Sheet title={t('automation.command_title', { id: cmd.id })} wide {onclose}>
	<div class="cmd-details">
		<Facts items={facts} />
		<CodeBlock title={t('automation.command_payload')} code={cmd.payload} />
		{#if cmd.result}
			<CodeBlock title={t('automation.command_result')} code={cmd.result} />
		{:else}
			<div class="result">
				<h3>{t('automation.command_result')}</h3>
				<p class="muted">{failed ? t('automation.open_failed') : t('automation.no_result_yet')}</p>
			</div>
		{/if}
	</div>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.cmd-details {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.by {
		color: var(--text-muted);
	}
	.result h3 {
		margin: 0 0 var(--space-2);
		font-size: var(--text-sm);
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
</style>
