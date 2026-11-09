<!--
  Add or edit an assignment rule: name and priority, which devices (kind of
  match and its value, with a hint that follows the kind), where they
  connect (relay server, what to use when it can't be reached), and
  whether the rule is on. The page opens it only when there is a relay
  server to point to.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { saveRule, type Relay, type Rule } from '#lib/api/scaling.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { matchHint, MATCH_TYPES } from '#lib/serverarea/scaling.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let {
		rule,
		relays,
		onclose,
		onsaved
	}: { rule: Rule | null; relays: Relay[]; onclose: () => void; onsaved: () => void } = $props();

	const matchLabel = (type: string) => {
		const key = 'scaling.match_' + type;
		const v = t(key);
		return v === key ? type : v;
	};

	const form = createForm({
		initial: untrack(() => ({
			name: rule?.name ?? '',
			priority: String(rule ? rule.priority : 10),
			matchType: rule?.match_type || 'subnet',
			matchValue: rule?.match_value ?? '',
			target: rule?.target_relay || relays[0]?.id || '',
			fallback: rule?.fallback || 'master',
			enabled: rule ? rule.enabled !== false : true
		})),
		validate: (v) => {
			const missing = t('scaling.rule_name_value_required');
			return {
				name: v.name.trim() ? undefined : missing,
				matchValue: v.matchValue.trim() ? undefined : missing
			};
		},
		submit: async (v) => {
			const prio = parseInt(v.priority, 10);
			const body = {
				name: v.name.trim(),
				match_type: v.matchType,
				match_value: v.matchValue.trim(),
				target_relay: v.target,
				fallback: v.fallback,
				priority: Number.isFinite(prio) ? prio : 10,
				enabled: v.enabled
			};
			try {
				await saveRule(rule?.id ?? null, body);
			} catch (err) {
				throw new FormError(
					t('scaling.rule_save_failed_reason', { error: err instanceof Error ? err.message : String(err) })
				);
			}
			toast.success(t('scaling.rule_saved_named', { name: body.name }));
			onsaved();
		}
	});

	const hint = $derived(matchHint(form.values.matchType));
	const typeOptions = $derived(MATCH_TYPES.map((x) => ({ value: x as string, label: matchLabel(x) })));
	const relayOptions = $derived(relays.map((r) => ({ value: r.id, label: r.name || r.id })));
	const fallbackOptions = $derived([
		{ value: 'master', label: t('scaling.fallback_master') },
		{ value: 'nearest', label: t('scaling.fallback_nearest') }
	]);
</script>

<Sheet
	title={rule ? t('scaling.rule_edit') : t('scaling.rule_add')}
	subtitle={tf(
		'scaling.rule_sheet_desc',
		'Sends the devices that match to one relay server. Rules are checked by priority, lowest number first.'
	)}
	status={form.status.state === 'saving' ? tf('scaling.saving', 'Saving…') : form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('scaling.col_rule_name')} error={form.errors.name}>
			{#snippet children(f)}
				<Input {...f} width="host" maxlength={80} required autocomplete="off" bind:value={form.values.name} />
			{/snippet}
		</Field>
		<Field label={t('scaling.col_priority')} hint={t('scaling.rule_priority_hint')}>
			{#snippet children(f)}
				<Input
					{...f}
					width="short"
					type="number"
					min={0}
					max={1000}
					inputmode="numeric"
					bind:value={form.values.priority}
				/>
			{/snippet}
		</Field>
		<Switch
			class="rule-enabled"
			label={tf('scaling.rule_enabled', 'Rule is on')}
			hint={tf('scaling.rule_enabled_hint', 'A rule that is off stays in the list and is skipped.')}
			bind:checked={form.values.enabled}
		/>
		<FormSection title={tf('scaling.rule_section_match', 'Which devices')}>
			<Field label={t('scaling.rule_match_type')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={typeOptions} bind:value={form.values.matchType} />
				{/snippet}
			</Field>
			<Field label={t('scaling.rule_match_value')} hint={tf(hint[0], hint[1])} error={form.errors.matchValue}>
				{#snippet children(f)}
					<Input
						{...f}
						class="mono"
						width="host"
						maxlength={200}
						required
						autocomplete="off"
						spellcheck="false"
						bind:value={form.values.matchValue}
					/>
				{/snippet}
			</Field>
		</FormSection>
		<FormSection title={tf('scaling.rule_section_relay', 'Where they connect')}>
			<Field label={t('scaling.col_target_relay')}>
				{#snippet children(f)}
					<Select {...f} width="host" options={relayOptions} bind:value={form.values.target} />
				{/snippet}
			</Field>
			<Field label={t('scaling.col_fallback')} hint={t('scaling.rule_fallback_hint')}>
				{#snippet children(f)}
					<Select {...f} width="host" options={fallbackOptions} bind:value={form.values.fallback} />
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('scaling.cancel')}</Button>
		<Button class="rule-save" variant="primary" type="submit" form={form.id} busy={form.busy}
			>{rule ? t('scaling.save') : t('scaling.rule_add')}</Button
		>
	{/snippet}
</Sheet>
