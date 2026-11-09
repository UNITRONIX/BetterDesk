<!--
  Assign a device to the organization: its ID, department and building
  (three fields, a centred dialog).
-->
<script lang="ts">
	import { assignOrgDevice } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { orgId, onclose, onsaved }: { orgId: string; onclose: () => void; onsaved: () => void } = $props();

	const form = createForm({
		initial: { deviceId: '', department: '', building: '' },
		validate: (v) => {
			const id = v.deviceId.trim();
			return {
				deviceId: !id
					? t('organizations.device_id_required')
					: /\s/.test(id)
						? t('organizations.device_id_invalid')
						: undefined
			};
		},
		submit: async (v) => {
			await assignOrgDevice(orgId, {
				device_id: v.deviceId.trim(),
				department: v.department.trim(),
				building: v.building.trim()
			});
			toast.success(t('organizations.device_assigned'));
			onsaved();
		}
	});
</script>

<Dialog title={t('organizations.assign_device')} beforeclose={() => !form.busy} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field
			label={t('organizations.device_id')}
			hint={t('organizations.device_id_hint')}
			error={form.errors.deviceId}
		>
			{#snippet children(f)}
				<Input
					{...f}
					width="medium"
					autocomplete="off"
					spellcheck="false"
					bind:value={form.values.deviceId}
				/>
			{/snippet}
		</Field>
		<Field label={t('organizations.department')}>
			{#snippet children(f)}
				<Input {...f} width="host" bind:value={form.values.department} />
			{/snippet}
		</Field>
		<Field label={t('organizations.building')}>
			{#snippet children(f)}
				<Input {...f} width="host" bind:value={form.values.building} />
			{/snippet}
		</Field>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{t('organizations.assign_device')}</Button
		>
	{/snippet}
</Dialog>
