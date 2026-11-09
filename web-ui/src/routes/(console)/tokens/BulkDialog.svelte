<!--
  Create several tokens at once: how many (1 to 100), the name they share
  (each gets a number), uses allowed and expiry. Shows them right after.
-->
<script lang="ts">
	import { createTokens, type NewToken } from '#lib/api/tokens.ts';
	import { EXPIRY_CHOICES, EXPIRY_LABELS, bulkCountOk, bulkUsesValue } from '#lib/clients/tokens.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { FormError, createForm } from '#lib/ui/form.svelte.ts';

	let { onclose, onsaved }: { onclose: () => void; onsaved: (created: NewToken[]) => void } = $props();

	const form = createForm({
		initial: { count: '5', prefix: 'Device', max_uses: '1', expires_in: 604800 as number },
		validate: (v) => ({ count: bulkCountOk(v.count) ? undefined : t('tokens.count_range') }),
		submit: async (v) => {
			try {
				onsaved(
					await createTokens({
						count: parseInt(v.count, 10),
						name_prefix: v.prefix.trim() || 'Device',
						max_uses: bulkUsesValue(v.max_uses),
						expires_in: Number(v.expires_in) || 0
					})
				);
			} catch (err) {
				throw new FormError(`${t('tokens.save_failed')} ${err instanceof Error ? err.message : ''}`.trim());
			}
		}
	});

	const expiryOptions = $derived(
		EXPIRY_CHOICES.map((s) => ({ value: s as number, label: t(`tokens.${EXPIRY_LABELS[s]}`) }))
	);
</script>

<Dialog title={t('tokens.bulk_generate')} class="bulk-dialog" {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('tokens.count')} hint={t('tokens.count_range')} error={form.errors.count} width="short">
			{#snippet children(f)}
				<Input {...f} type="number" min={1} max={100} inputmode="numeric" bind:value={form.values.count} />
			{/snippet}
		</Field>
		<Field label={t('tokens.name_prefix')} hint={t('tokens.name_prefix_hint')}>
			{#snippet children(f)}
				<Input {...f} maxlength={100} autocomplete="off" bind:value={form.values.prefix} />
			{/snippet}
		</Field>
		<Field label={t('tokens.max_uses')} width="short">
			{#snippet children(f)}
				<Input {...f} type="number" min={1} inputmode="numeric" bind:value={form.values.max_uses} />
			{/snippet}
		</Field>
		<Field label={t('tokens.expires_in')}>
			{#snippet children(f)}
				<Select {...f} width="medium" options={expiryOptions} bind:value={form.values.expires_in} />
			{/snippet}
		</Field>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('common.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy} class="bulk-save"
			>{t('tokens.generate')}</Button
		>
	{/snippet}
</Dialog>
