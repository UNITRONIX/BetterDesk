<!--
  Create or edit a data loss prevention policy: name and description, what
  it covers (transfer type, devices, and the rules JSON under Advanced
  options, open by itself when the policy has rules or the JSON is
  refused), the action (block, log, allow) and whether devices get it.
  Editing also offers Delete; its confirm sits on top of the sheet, so
  cancelling keeps unsaved edits.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { createDlpPolicy, deleteDlpPolicy, updateDlpPolicy, type DlpPolicy } from '#lib/api/dataguard.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { DLP_ACTIONS, DLP_TYPES, parseRules, rulesText, typeLabel, typeOf } from '#lib/rules/dataguard.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let {
		policy,
		onclose,
		onsaved,
		ondeleted
	}: { policy: DlpPolicy | null; onclose: () => void; onsaved: () => void; ondeleted: () => void } = $props();

	const uid = $props.id();

	const initial = untrack(() => {
		const type = policy ? typeOf(policy) : 'usb';
		return {
			name: policy?.name ?? '',
			description: policy?.description ?? '',
			policy_type: (DLP_TYPES as readonly string[]).includes(type) ? type : 'usb',
			scope: policy?.scope ?? '',
			rules: rulesText(policy?.rules),
			action: policy && (DLP_ACTIONS as readonly string[]).includes(policy.action) ? policy.action : 'log',
			enabled: policy ? policy.enabled : true
		};
	});
	let advancedOpen = $state(untrack(() => !!initial.rules));

	const form = createForm({
		initial,
		validate: (v) => {
			const rules = parseRules(v.rules);
			if (rules === null) advancedOpen = true;
			return {
				name: v.name.trim() ? undefined : t('dataguard.name_required'),
				rules: rules === null ? t('dataguard.invalid_rules') : undefined
			};
		},
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				description: v.description.trim(),
				policy_type: v.policy_type,
				action: v.action,
				scope: v.scope.trim() || null,
				rules: parseRules(v.rules) ?? [],
				enabled: v.enabled
			};
			try {
				if (policy) await updateDlpPolicy(policy.id, body);
				else await createDlpPolicy(body);
			} catch (err) {
				throw new FormError(
					`${t('dataguard.save_failed')} ${err instanceof Error ? err.message : ''}`.trim()
				);
			}
			toast.success(
				policy
					? t('dataguard.policy_saved', { name: body.name })
					: t('dataguard.policy_created', { name: body.name })
			);
			onsaved();
		}
	});

	let deleting = $state(false);
	let deleteError = $state('');

	async function remove() {
		if (!policy) return;
		const ok = await confirm({
			title: t('dataguard.delete_policy'),
			message: t('dataguard.delete_confirm_message', { name: policy.name }),
			confirmLabel: t('dataguard.delete_policy'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		deleting = true;
		deleteError = '';
		try {
			await deleteDlpPolicy(policy.id);
			toast.success(t('dataguard.policy_deleted', { name: policy.name }));
			ondeleted();
		} catch (err) {
			deleteError = `${t('dataguard.delete_failed')} ${err instanceof Error ? err.message : ''}`.trim();
		} finally {
			deleting = false;
		}
	}

	const typeOptions = $derived(DLP_TYPES.map((x) => ({ value: x, label: typeLabel(t, x) })));
	const actionChoices = $derived(
		DLP_ACTIONS.map((a) => ({
			value: a,
			title: t(`dataguard.action_${a}`),
			description: t(`dataguard.action_${a}_desc`)
		}))
	);
	const statusText = $derived(deleteError || form.status.message);
</script>

<Sheet
	title={policy ? t('dataguard.edit_policy') : t('dataguard.create_policy')}
	subtitle={t('dataguard.policy_sheet_desc')}
	status={statusText}
	statusTone={deleteError || form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('dataguard.policy_name')} error={form.errors.name} width="host">
			{#snippet children(f)}
				<Input {...f} required autocomplete="off" bind:value={form.values.name} />
			{/snippet}
		</Field>
		<Field label={t('dataguard.policy_desc')} hint={t('dataguard.desc_hint')}>
			{#snippet children(f)}<Textarea {...f} rows={2} bind:value={form.values.description} />{/snippet}
		</Field>
		<FormSection title={t('dataguard.section_covers')}>
			<Field label={t('dataguard.transfer_type')} hint={t('dataguard.type_hint')} width="host">
				{#snippet children(f)}<Select
						{...f}
						options={typeOptions}
						bind:value={form.values.policy_type}
					/>{/snippet}
			</Field>
			<Field label={t('dataguard.scope')} hint={t('dataguard.scope_help')}>
				{#snippet children(f)}
					<Input {...f} class="mono" autocomplete="off" spellcheck={false} bind:value={form.values.scope} />
				{/snippet}
			</Field>
			<!-- Matching rules are rarely needed: closed unless the policy has some -->
			<Disclosure title={t('dataguard.advanced')} level={4} bind:open={advancedOpen}>
				<Field label={t('dataguard.rules')} hint={t('dataguard.rules_hint')} error={form.errors.rules}>
					{#snippet children(f)}
						<Textarea
							{...f}
							class="mono"
							rows={4}
							spellcheck={false}
							dir="ltr"
							bind:value={form.values.rules}
						/>
					{/snippet}
				</Field>
			</Disclosure>
		</FormSection>
		<FormSection title={t('dataguard.action')} id="{uid}-action">
			<ChoiceList
				labelledby="{uid}-action-title"
				name="{uid}-action"
				choices={actionChoices}
				bind:value={form.values.action}
			/>
		</FormSection>
		<div class="enabled">
			<Checkbox
				label={t('dataguard.enabled')}
				effect={t('dataguard.enabled_effect')}
				bind:checked={form.values.enabled}
			/>
		</div>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		{#if policy}
			<Button variant="danger-quiet" icon={ICONS.delete} busy={deleting} onclick={() => void remove()}
				>{t('dataguard.delete_policy')}…</Button
			>
		{/if}
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{policy ? t('dataguard.save_policy') : t('dataguard.create_policy')}</Button
		>
	{/snippet}
</Sheet>

<style>
	/* Addresses, IDs, lists and JSON in the monospace font */
	form :global(.form-input.mono) {
		font-family: var(--mono);
	}
	.enabled {
		margin-top: var(--space-5);
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
</style>
