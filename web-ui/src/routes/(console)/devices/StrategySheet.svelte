<!--
  Add or edit an access rule: who and where (a user group and a device
  group), the client settings it sets (one row per setting: the client
  decides, on, off) and whether it is applied.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type { DeviceGroup } from '#lib/api/devices.ts';
	import {
		createStrategy,
		STRATEGY_PERMISSIONS,
		updateStrategy,
		type Strategy
	} from '#lib/api/strategies.ts';
	import { listUserGroups, type UserGroup } from '#lib/api/users.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		rule,
		groups,
		onclose,
		onsaved
	}: { rule: Strategy | null; groups: DeviceGroup[]; onclose: () => void; onsaved: () => void } = $props();

	const uid = $props.id();
	let userGroups = $state.raw<UserGroup[]>([]);

	$effect(() => {
		if (!can('device.edit') && !can('user.view')) return;
		listUserGroups().then(
			(g) => (userGroups = g),
			() => (userGroups = [])
		);
	});

	type Choice = '' | 'Y' | 'N';
	const initial = untrack(() => ({
		name: rule?.name ?? '',
		user_group_guid: rule?.user_group_guid ?? '',
		device_group_guid: rule?.device_group_guid ?? '',
		enabled: rule ? rule.enabled : true,
		permissions: Object.fromEntries(
			STRATEGY_PERMISSIONS.map((p) => [p.key, (rule?.permissions[p.key] ?? '') as Choice])
		)
	}));

	const form = createForm({
		initial,
		validate: (v) => ({ name: v.name.trim() ? undefined : t('devices.strategy_name_required') }),
		submit: async (v) => {
			const permissions: Record<string, 'Y' | 'N'> = {};
			for (const [k, val] of Object.entries(v.permissions))
				if (val === 'Y' || val === 'N') permissions[k] = val;
			const body = {
				name: v.name.trim(),
				user_group_guid: v.user_group_guid,
				device_group_guid: v.device_group_guid,
				enabled: v.enabled,
				permissions
			};
			if (rule) await updateStrategy(rule.guid, body);
			else await createStrategy(body);
			toast.success(rule ? t('devices.strategy_updated') : t('devices.strategy_created'));
			onsaved();
		}
	});

	const choices = $derived([
		{ value: '' as Choice, label: t('devices.strategy_perm_default') },
		{ value: 'Y' as Choice, label: t('devices.strategy_perm_allow') },
		{ value: 'N' as Choice, label: t('devices.strategy_perm_deny') }
	]);
</script>

<Sheet
	title={rule ? t('devices.edit_strategy') : t('devices.create_strategy')}
	subtitle={tf(
		'devices.strategy_sheet_desc',
		'Client settings that apply when someone from a user group works on a device in a device group.'
	)}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('devices.strategy_name')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} width="medium" maxlength={80} required bind:value={form.values.name} />
			{/snippet}
		</Field>
		<FormSection title={tf('devices.strategy_section_scope', 'Who and where')}>
			<Field label={t('devices.strategy_user_group')}>
				{#snippet children(f)}
					<Select
						{...f}
						width="host"
						describedby="{uid}-groups-hint"
						options={[
							{ value: '', label: t('devices.strategy_any_user_group') },
							...userGroups.map((g) => ({ value: g.guid, label: g.name || g.guid }))
						]}
						bind:value={form.values.user_group_guid}
					/>
				{/snippet}
			</Field>
			<div class="form-block">
				<Field label={t('devices.strategy_device_group')} id="{uid}-dg">
					{#snippet children(f)}
						<Select
							{...f}
							width="host"
							describedby="{uid}-groups-hint"
							options={[
								{ value: '', label: t('devices.strategy_any_device_group') },
								...groups.map((g) => ({ value: g.guid ?? '', label: g.name || g.guid || '' }))
							]}
							bind:value={form.values.device_group_guid}
						/>
					{/snippet}
				</Field>
				<p class="hint" id="{uid}-groups-hint">{t('devices.strategy_groups_hint')}</p>
			</div>
		</FormSection>
		<FormSection title={t('devices.strategy_permissions')} id="{uid}-perms">
			<p class="hint">{t('devices.strategy_permissions_hint')}</p>
			<div class="perm-grid" role="group" aria-labelledby="{uid}-perms-title">
				{#each STRATEGY_PERMISSIONS as p (p.key)}
					<div class="perm-row">
						<label for="{uid}-{p.key}">{t(p.labelKey)}</label>
						<Select id="{uid}-{p.key}" options={choices} bind:value={form.values.permissions[p.key]} />
					</div>
				{/each}
			</div>
		</FormSection>
		<div class="enabled">
			<Checkbox
				label={t('devices.strategy_enabled_label')}
				hint={tf('devices.strategy_enabled_hint', 'When off, the rule is kept but not applied.')}
				bind:checked={form.values.enabled}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('actions.save')}</Button>
	{/snippet}
</Sheet>

<style>
	.form-block {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.form-block > :global(.form-group) {
		margin: 0;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* One row per client setting: label, then the choice */
	.perm-grid {
		border-top: 1px solid var(--rule);
	}
	.perm-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(9rem, 14rem);
		gap: var(--space-3);
		align-items: center;
		min-height: var(--control-h);
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--rule);
	}
	.enabled {
		margin-top: var(--space-5);
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
</style>
