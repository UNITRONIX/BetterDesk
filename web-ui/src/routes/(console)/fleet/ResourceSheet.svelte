<!--
  Add or edit a resource (old fleet.js resourceForm): name, type, the
  address (its label and example follow the type), and which devices get
  it. Without fleet on the server the sheet still opens to show what can
  be set, with a note, and Save is off (described by the note).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { RESOURCE_TYPES, saveResource, type Resource } from '#lib/api/fleet.ts';
	import { addressFor } from '#lib/canvas/fleet.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { createForm, FormError } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		/** null: a new resource */
		resource: Resource | null;
		org: string;
		orgName: string;
		unavailable: boolean;
		onclose: () => void;
		onsaved: () => void;
	}

	let { resource, org, orgName, unavailable, onclose, onsaved }: Props = $props();

	const uid = $props.id();
	const noteId = `${uid}-note`;
	const editing = untrack(() => resource);

	const form = createForm({
		initial: {
			name: editing?.name ?? '',
			type: editing?.type || 'printer',
			address: editing?.address || editing?.value || '',
			scope: editing?.scope || 'org',
			scope_value: editing?.scope_value ?? ''
		},
		validate: (v) => ({ name: v.name.trim() ? undefined : t('fleet.name_required') }),
		submit: async (v) => {
			const body = {
				name: v.name.trim(),
				type: v.type,
				address: v.address.trim(),
				scope: v.scope,
				scope_value: v.scope_value.trim()
			};
			try {
				await saveResource(org, editing?.id ?? null, body);
			} catch (err) {
				throw new FormError(t('fleet.save_failed', { error: err instanceof Error ? err.message : '' }));
			}
			toast.success(
				editing
					? t('fleet.resource_saved', { name: body.name })
					: t('fleet.resource_added', { name: body.name })
			);
			onsaved();
		}
	});

	const typeOptions = $derived(
		RESOURCE_TYPES.map((x) => ({ value: x as string, label: t(`fleet.type_${x}`) }))
	);
	const scopeOptions = $derived(
		(['org', 'group', 'device'] as const).map((x) => ({ value: x as string, label: t(`fleet.scope_${x}`) }))
	);
	const address = $derived(addressFor(form.values.type));
</script>

<Sheet
	title={editing ? t('fleet.edit_resource') : t('fleet.add_resource')}
	subtitle={t('fleet.res_sheet_desc', { org: orgName })}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	{onclose}
>
	<form id={form.id} class="fleet-form" onsubmit={form.onsubmit} novalidate>
		{#if unavailable}
			<Notice tone="warning" id={noteId} message={t('fleet.unavailable_dialog')} />
		{/if}
		<Field label={t('fleet.col_name')} hint={t('fleet.res_name_hint')} error={form.errors.name}>
			{#snippet children(f)}<Input
					{...f}
					maxlength={120}
					required
					autocomplete="off"
					bind:value={form.values.name}
				/>{/snippet}
		</Field>
		<Field label={t('fleet.col_type')}>
			{#snippet children(f)}<Select
					{...f}
					width="medium"
					options={typeOptions}
					bind:value={form.values.type}
				/>{/snippet}
		</Field>
		<Field label={t(address.labelKey)} hint={t('fleet.example', { value: address.example })}>
			{#snippet children(f)}<Input
					{...f}
					class="mono"
					width="host"
					autocomplete="off"
					spellcheck="false"
					bind:value={form.values.address}
				/>{/snippet}
		</Field>
		<FormSection title={t('fleet.col_scope')}>
			<Field label={t('fleet.scope_label')}>
				{#snippet children(f)}<Select
						{...f}
						width="medium"
						options={scopeOptions}
						bind:value={form.values.scope}
					/>{/snippet}
			</Field>
			<Field label={t('fleet.scope_value')} hint={t('fleet.scope_value_hint')}>
				{#snippet children(f)}<Input
						{...f}
						width="host"
						autocomplete="off"
						bind:value={form.values.scope_value}
					/>{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('fleet.cancel')}</Button>
		<Button
			variant="primary"
			type="submit"
			form={form.id}
			busy={form.busy}
			disabled={unavailable}
			aria-describedby={unavailable ? noteId : undefined}
			>{editing ? t('fleet.save') : t('fleet.add_resource')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.fleet-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
