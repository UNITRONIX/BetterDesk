<!--
  Shows the dialogs opened from code (confirm, prompt, alert in
  dialogs.svelte.ts). The shell mounts it once.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from './Button.svelte';
	import Dialog from './Dialog.svelte';
	import Field from './Field.svelte';
	import Input from './Input.svelte';
	import { dialogRequests, type DialogRequest } from './dialogs.svelte.ts';

	const cancelText = () => tf('actions.cancel', 'Cancel');
	const confirmText = () => tf('actions.confirm', 'Confirm');

	function cancel(d: DialogRequest) {
		if (d.kind === 'confirm') d.settle(false);
		else if (d.kind === 'prompt') d.settle(null);
		else d.settle(undefined);
	}

	function submit(event: SubmitEvent, settle: (answer: string | null) => void) {
		event.preventDefault();
		const value = new FormData(event.currentTarget as HTMLFormElement).get('value');
		settle(typeof value === 'string' ? value : '');
	}
</script>

{#each dialogRequests.items as d (d.id)}
	{#if d.kind === 'confirm'}
		<Dialog title={d.options.title} message={d.options.message} onclose={() => cancel(d)}>
			{#snippet footer()}
				<Button onclick={() => d.settle(false)}>{d.options.cancelLabel ?? cancelText()}</Button>
				<Button
					variant={d.options.danger ? 'danger' : 'primary'}
					icon={d.options.confirmIcon}
					onclick={() => d.settle(true)}>{d.options.confirmLabel ?? confirmText()}</Button
				>
			{/snippet}
		</Dialog>
	{:else if d.kind === 'prompt'}
		<Dialog title={d.options.title} message={d.options.message} onclose={() => cancel(d)}>
			<form id="prompt-{d.id}" onsubmit={(e) => submit(e, d.settle)}>
				<Field label={d.options.label} hint={d.options.hint}>
					{#snippet children(f)}
						<Input
							{...f}
							name="value"
							type={d.options.type ?? 'text'}
							value={d.options.value ?? ''}
							placeholder={d.options.placeholder}
							required={d.options.required}
						/>
					{/snippet}
				</Field>
			</form>
			{#snippet footer()}
				<Button onclick={() => d.settle(null)}>{d.options.cancelLabel ?? cancelText()}</Button>
				<Button variant="primary" type="submit" form="prompt-{d.id}"
					>{d.options.confirmLabel ?? confirmText()}</Button
				>
			{/snippet}
		</Dialog>
	{:else}
		<Dialog title={d.options.title} message={d.options.message} onclose={() => cancel(d)}>
			{#snippet footer()}
				<Button variant="primary" onclick={() => d.settle(undefined)}
					>{d.options.okLabel ?? tf('actions.ok', 'OK')}</Button
				>
			{/snippet}
		</Dialog>
	{/if}
{/each}
