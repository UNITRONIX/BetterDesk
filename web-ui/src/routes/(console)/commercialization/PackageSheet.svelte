<!--
  New or edit a support package: name, description, the time it includes
  each month (an amount in hours or minutes), the rounding step (a custom
  step shows its own field) and the overage rate with its currency.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { savePackage, type BillingPackage } from '#lib/api/billing.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		amountFromMinutes,
		minutesFromAmount,
		ROUNDING_STEPS,
		roundingChoice,
		roundingMinutes
	} from '#lib/serverarea/billing.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		pkg,
		defaultCurrency,
		onclose,
		onsaved
	}: { pkg: BillingPackage | null; defaultCurrency: string; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();

	// svelte-ignore state_referenced_locally
	const amount = amountFromMinutes(pkg ? (pkg.included_minutes ?? 0) : 600);
	// svelte-ignore state_referenced_locally
	const rounding = roundingChoice(pkg ? pkg.rounding_minutes : 10);

	const form = createForm({
		initial: untrack(() => ({
			name: pkg?.name ?? '',
			description: pkg?.description ?? '',
			amount: amount.amount,
			unit: amount.unit as 'hours' | 'minutes',
			rounding: rounding.choice,
			custom: rounding.custom,
			overage: pkg ? String(pkg.overage_rate ?? 0) : '100',
			currency: pkg?.currency || defaultCurrency || 'EUR'
		})),
		validate: (v) => {
			const rate = parseFloat(v.overage);
			return {
				name: v.name.trim() ? undefined : t('commercialization.ui.name_required'),
				overage: Number.isNaN(rate) || rate < 0 ? t('commercialization.ui.rate_required') : undefined
			};
		},
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				description: v.description.trim(),
				included_minutes: minutesFromAmount(v.amount, v.unit),
				overage_rate: parseFloat(v.overage),
				currency: v.currency.trim().toUpperCase() || 'EUR',
				rounding_minutes: roundingMinutes(v.rounding, v.custom)
			};
			try {
				await savePackage(pkg?.id ?? null, body);
			} catch (err) {
				throw new FormError(
					err instanceof Error && err.message ? err.message : t('commercialization.ui.save_failed')
				);
			}
			toast.success(pkg ? t('commercialization.packages.updated') : t('commercialization.packages.created'));
			onsaved();
		}
	});

	const unitOptions = $derived([
		{ value: 'hours' as const, label: t('commercialization.packages.unit_hours') },
		{ value: 'minutes' as const, label: t('commercialization.packages.unit_minutes') }
	]);
	const roundingOptions = $derived([
		...ROUNDING_STEPS.map((s) => ({ value: s as string, label: s })),
		{ value: 'custom', label: t('commercialization.packages.rounding_custom') }
	]);
</script>

<Sheet
	title={pkg ? t('commercialization.packages.edit_title') : t('commercialization.packages.create_title')}
	subtitle={tf(
		'commercialization.ui.package_sheet_desc',
		'Support time a device group gets each month, and the price for time beyond it.'
	)}
	status={form.status.state === 'saving' ? t('commercialization.ui.saving') : form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field
			label={t('commercialization.packages.name')}
			hint={t('commercialization.ui.package_name_hint')}
			error={form.errors.name}
		>
			{#snippet children(f)}
				<Input {...f} maxlength={128} required autocomplete="off" bind:value={form.values.name} />
			{/snippet}
		</Field>
		<Field
			label={t('commercialization.packages.description')}
			hint={t('commercialization.ui.package_description_hint')}
		>
			{#snippet children(f)}
				<Textarea {...f} rows={3} maxlength={512} bind:value={form.values.description} />
			{/snippet}
		</Field>
		<FormSection title={t('commercialization.ui.included_time')}>
			<div class="pair">
				<Field label={t('commercialization.packages.included_amount')}>
					{#snippet children(f)}
						<Input
							{...f}
							describedby="{uid}-amount-hint"
							width="short"
							type="number"
							min={0}
							step={1}
							required
							bind:value={form.values.amount}
						/>
					{/snippet}
				</Field>
				<Field label={t('commercialization.packages.unit')}>
					{#snippet children(f)}
						<Select {...f} width="medium" options={unitOptions} bind:value={form.values.unit} />
					{/snippet}
				</Field>
			</div>
			<p class="hint" id="{uid}-amount-hint">{t('commercialization.ui.included_hint')}</p>
		</FormSection>
		<FormSection title={t('commercialization.ui.section_billing')}>
			<Field label={t('commercialization.packages.rounding')} hint={t('commercialization.ui.rounding_hint')}>
				{#snippet children(f)}
					<Select
						{...f}
						width="medium"
						aria-controls="{uid}-custom"
						options={roundingOptions}
						bind:value={form.values.rounding}
					/>
				{/snippet}
			</Field>
			<ShowWhen id="{uid}-custom" when={form.values.rounding === 'custom'}>
				<Field label={t('commercialization.packages.rounding_custom_value')}>
					{#snippet children(f)}
						<Input {...f} width="short" type="number" min={1} step={1} bind:value={form.values.custom} />
					{/snippet}
				</Field>
			</ShowWhen>
			<div class="pair">
				<Field label={t('commercialization.packages.overage_rate')} error={form.errors.overage}>
					{#snippet children(f)}
						<Input
							{...f}
							describedby="{uid}-overage-hint"
							width="medium"
							type="number"
							min={0}
							step={0.01}
							required
							bind:value={form.values.overage}
						/>
					{/snippet}
				</Field>
				<Field label={t('commercialization.packages.currency')}>
					{#snippet children(f)}
						<Input
							{...f}
							describedby="{uid}-overage-hint"
							width="short"
							maxlength={8}
							required
							autocomplete="off"
							spellcheck="false"
							bind:value={form.values.currency}
						/>
					{/snippet}
				</Field>
			</div>
			<p class="hint" id="{uid}-overage-hint">{t('commercialization.ui.overage_hint')}</p>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('commercialization.form.cancel')}</Button>
		<Button class="package-save" variant="primary" type="submit" form={form.id} busy={form.busy}
			>{pkg ? t('commercialization.actions.save') : t('commercialization.packages.create_submit')}</Button
		>
	{/snippet}
</Sheet>

<style>
	/* Two controls that belong together: amount and unit, rate and currency */
	.pair {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
	}
	.pair > :global(*) {
		margin: 0;
	}
	.hint {
		margin: calc(-1 * var(--space-2)) 0 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
