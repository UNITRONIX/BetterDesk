<!--
  Assign a package to a device group, or edit an assignment. New: the
  device group and the package, then optional time, rates and dates
  (empty fields use the package's values). Edit: the group and the package
  stay (shown, not changeable); the time left this month, the rates and
  the dates can change, and empty dates clear them.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createContract, updateContract, type BillingPackage, type Contract } from '#lib/api/billing.ts';
	import { listDeviceGroups } from '#lib/api/devices.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import {
		contractPatch,
		contractValues,
		datesInOrder,
		formatMinutes,
		newContractBody,
		type AssignValues
	} from '#lib/serverarea/billing.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		contract,
		packages,
		onclose,
		onsaved
	}: { contract: Contract | null; packages: BillingPackage[]; onclose: () => void; onsaved: () => void } =
		$props();

	const uid = $props.id();
	let groups = $state.raw<{ value: string; label: string }[]>([]);
	let groupsError = $state('');

	const blank: AssignValues = {
		targetKey: '',
		packageId: '',
		remaining: '',
		hourlyRate: '',
		overageRate: '',
		validFrom: '',
		validUntil: ''
	};

	const form = createForm({
		initial: untrack(() =>
			contract ? contractValues(contract) : { ...blank, packageId: packages[0]?.id ?? '' }
		),
		validate: (v) => {
			const missing = t('commercialization.assign.missing_fields');
			return {
				targetKey: !contract && !v.targetKey ? missing : undefined,
				packageId: !contract && !v.packageId ? missing : undefined,
				validUntil: datesInOrder(v.validFrom, v.validUntil)
					? undefined
					: t('commercialization.ui.dates_order')
			};
		},
		submit: async (v) => {
			try {
				if (contract) await updateContract(contract.id, contractPatch(v));
				else
					await createContract(
						newContractBody(
							v,
							packages.find((p) => p.id === v.packageId)
						)
					);
			} catch (err) {
				throw new FormError(
					err instanceof Error && err.message ? err.message : t('commercialization.ui.save_failed')
				);
			}
			toast.success(
				contract ? t('commercialization.contracts.updated') : t('commercialization.assign.success')
			);
			onsaved();
		}
	});

	$effect(() => {
		if (contract) return;
		listDeviceGroups().then(
			(list) =>
				(groups = list
					.filter((g) => g.guid)
					.map((g) => ({ value: g.guid ?? '', label: g.name || g.guid || '' }))),
			(err: unknown) =>
				(groupsError = tf('commercialization.ui.error_targets', 'Could not load the device groups: {error}', {
					error: err instanceof Error ? err.message : String(err)
				}))
		);
	});

	const targetOptions = $derived(
		contract
			? [{ value: contract.target_key, label: contract.target_name || contract.target_key }]
			: [{ value: '', label: t('commercialization.assign.select_target') }, ...groups]
	);
	const packageOptions = $derived(
		contract
			? [{ value: contract.package_id, label: contract.package_name || contract.package_id }]
			: packages.map((p) => ({ value: p.id, label: `${p.name} (${formatMinutes(p.included_minutes)})` }))
	);
	const targetLabel = $derived(
		contract
			? tf(`commercialization.targets.${contract.target_type}`, contract.target_type)
			: t('commercialization.targets.device_group')
	);
</script>

<Sheet
	title={contract ? t('commercialization.contracts.edit_title') : t('commercialization.assign.title')}
	subtitle={contract
		? tf(
				'commercialization.ui.assignment_edit_desc',
				'The device group and the package stay. Change the time left this month, the rates or the dates.'
			)
		: tf(
				'commercialization.ui.assign_sheet_desc',
				'Sessions on the devices of this group count against the package from now on.'
			)}
	status={groupsError ||
		(form.status.state === 'saving' ? t('commercialization.ui.saving') : form.status.message)}
	statusTone={groupsError || form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field
			label={targetLabel}
			hint={contract ? undefined : t('commercialization.ui.assign_target_hint')}
			error={form.errors.targetKey}
		>
			{#snippet children(f)}
				<Select
					{...f}
					width="host"
					required
					disabled={!!contract}
					options={targetOptions}
					bind:value={form.values.targetKey}
				/>
			{/snippet}
		</Field>
		<Field label={t('commercialization.contracts.package')} error={form.errors.packageId}>
			{#snippet children(f)}
				<Select
					{...f}
					width="host"
					required
					disabled={!!contract}
					options={packageOptions}
					bind:value={form.values.packageId}
				/>
			{/snippet}
		</Field>
		<FormSection title={t('commercialization.ui.section_rates')}>
			<p class="hint" id="{uid}-rates">{t('commercialization.ui.section_rates_note')}</p>
			<Field
				label={t('commercialization.contracts.remaining')}
				hint={t('commercialization.ui.remaining_hint')}
			>
				{#snippet children(f)}
					<Input {...f} width="short" type="number" min={0} step={1} bind:value={form.values.remaining} />
				{/snippet}
			</Field>
			<Field
				label={t('commercialization.contracts.hourly_rate')}
				hint={t('commercialization.ui.hourly_rate_hint')}
			>
				{#snippet children(f)}
					<Input {...f} width="short" type="number" min={0} step={0.01} bind:value={form.values.hourlyRate} />
				{/snippet}
			</Field>
			<Field
				label={t('commercialization.contracts.custom_overage')}
				hint={t('commercialization.ui.overage_override_hint')}
			>
				{#snippet children(f)}
					<Input
						{...f}
						width="short"
						type="number"
						min={0}
						step={0.01}
						bind:value={form.values.overageRate}
					/>
				{/snippet}
			</Field>
		</FormSection>
		<FormSection title={t('commercialization.contracts.validity')}>
			<Field label={t('commercialization.contracts.valid_from')}>
				{#snippet children(f)}
					<Input {...f} width="medium" type="date" bind:value={form.values.validFrom} />
				{/snippet}
			</Field>
			<Field
				label={t('commercialization.contracts.valid_until')}
				hint={t('commercialization.ui.validity_hint')}
				error={form.errors.validUntil}
			>
				{#snippet children(f)}
					<Input {...f} width="medium" type="date" bind:value={form.values.validUntil} />
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('commercialization.form.cancel')}</Button>
		<Button class="assign-save" variant="primary" type="submit" form={form.id} busy={form.busy}
			>{contract ? t('commercialization.actions.save') : t('commercialization.assign.submit')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
