<!--
  Support package for a device group (billing.manage): assign a package
  that exists, or create one and assign it. All devices in the group share
  the package's minutes. The fields of whichever choice applies show.
-->
<script lang="ts">
	import { assignPackageToGroup, createPackage, listPackages, type Package } from '#lib/api/billing.ts';
	import type { DeviceGroup } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import ShowWhen from '#lib/ui/ShowWhen.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { group, onclose }: { group: DeviceGroup; onclose: () => void } = $props();

	const uid = $props.id();
	let packages = $state.raw<Package[] | null>(null);
	let loadError = $state('');

	type Mode = 'existing' | 'new';
	const form = createForm({
		initial: {
			mode: 'existing' as Mode,
			packageId: '',
			name: '',
			description: '',
			minutes: '600',
			overage: '100',
			currency: 'PLN'
		},
		validate: (v) => ({
			name: v.mode === 'new' && !v.name.trim() ? t('commercialization.packages.prompt_name') : undefined,
			packageId:
				v.mode === 'existing' && !v.packageId ? t('commercialization.contracts.no_packages') : undefined
		}),
		submit: async (v) => {
			let packageId = v.packageId;
			if (v.mode === 'new') {
				const name = v.name.trim();
				await createPackage({
					name,
					description: v.description.trim(),
					included_minutes: parseInt(v.minutes, 10) || 600,
					overage_rate: parseFloat(v.overage) || 0,
					currency: (v.currency || 'PLN').trim().toUpperCase()
				});
				// The create answer has no id: find the package by its name
				const list = await listPackages();
				packageId = list.find((p) => p.name === name)?.id ?? '';
				if (!packageId) throw new FormError(t('errors.server_error'));
			}
			await assignPackageToGroup(group.guid ?? '', packageId);
			toast.success(t('devices.group_commercialization_saved'));
			onclose();
		}
	});

	$effect(() => {
		listPackages().then(
			(list) => {
				packages = list;
				if (!list.length) form.values.mode = 'new';
				else form.values.packageId = list[0]?.id ?? '';
				form.reset(form.values);
			},
			(err: unknown) => (loadError = err instanceof Error ? err.message : String(err))
		);
	});

	const packageOptions = $derived(
		(packages ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.included_minutes ?? 0} min)` }))
	);

	const choices = $derived([
		{
			value: 'existing' as Mode,
			title: t('devices.group_commercialization_assign_existing'),
			description:
				packages && !packages.length
					? tf('devices.group_billing_no_packages', 'There are no packages yet.')
					: undefined,
			disabled: !packages?.length,
			controls: `${uid}-existing`
		},
		{ value: 'new' as Mode, title: t('devices.group_commercialization_create_new'), controls: `${uid}-new` }
	]);
</script>

<Sheet
	title={tf('devices.group_billing_title', 'Support package for {name}', { name: group.name ?? '' })}
	status={loadError || form.status.message}
	statusTone={loadError || form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	{#if packages}
		<form id={form.id} onsubmit={form.onsubmit} novalidate>
			<p class="hint intro">{t('devices.group_commercialization_hint')}</p>
			<div class="block">
				<span class="label" id="{uid}-mode">{t('devices.group_commercialization_mode')}</span>
				<ChoiceList {choices} labelledby="{uid}-mode" bind:value={form.values.mode} />
			</div>
			<ShowWhen id="{uid}-existing" when={form.values.mode === 'existing'}>
				<Field label={t('commercialization.contracts.package')} error={form.errors.packageId}>
					{#snippet children(f)}
						<Select {...f} width="host" options={packageOptions} bind:value={form.values.packageId} />
					{/snippet}
				</Field>
			</ShowWhen>
			<ShowWhen id="{uid}-new" when={form.values.mode === 'new'}>
				<FormSection title={tf('devices.group_billing_new_section', 'New package')}>
					<Field label={t('commercialization.packages.name')} error={form.errors.name}>
						{#snippet children(f)}
							<Input {...f} width="medium" maxlength={128} required bind:value={form.values.name} />
						{/snippet}
					</Field>
					<Field label={t('commercialization.packages.description')}>
						{#snippet children(f)}
							<Textarea {...f} rows={2} maxlength={512} bind:value={form.values.description} />
						{/snippet}
					</Field>
					<Field label={t('commercialization.packages.included_minutes')}>
						{#snippet children(f)}
							<Input
								{...f}
								width="short"
								type="number"
								min={1}
								step={1}
								inputmode="numeric"
								bind:value={form.values.minutes}
							/>
						{/snippet}
					</Field>
					<Field label={t('commercialization.packages.overage_rate')}>
						{#snippet children(f)}
							<Input
								{...f}
								width="short"
								type="number"
								min={0}
								step={0.01}
								inputmode="decimal"
								bind:value={form.values.overage}
							/>
						{/snippet}
					</Field>
					<Field
						label={t('commercialization.packages.currency')}
						hint={tf('devices.group_billing_currency_hint', 'Three-letter code, for example EUR.')}
					>
						{#snippet children(f)}
							<Input
								{...f}
								width="short"
								maxlength={8}
								autocomplete="off"
								spellcheck="false"
								bind:value={form.values.currency}
							/>
						{/snippet}
					</Field>
				</FormSection>
			</ShowWhen>
		</form>
	{:else if !loadError}
		<p class="hint">{t('common.loading')}</p>
	{/if}
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy} disabled={!packages}
			>{t('actions.save')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin-bottom: var(--space-4);
	}
	.label {
		font-weight: 600;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.intro {
		margin-bottom: var(--space-4);
	}
</style>
