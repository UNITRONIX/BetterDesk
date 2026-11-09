<!--
  A new invitation: email (optional), role and how long it is valid (three
  fields, a centred dialog).
-->
<script lang="ts">
	import { createInvitation } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { orgRoleLabel } from '#lib/people/orgs.ts';
	import { ORG_ROLES } from '#lib/people/users.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { orgId, onclose, onsaved }: { orgId: string; onclose: () => void; onsaved: () => void } = $props();

	const roleOptions = $derived(ORG_ROLES.map((r) => ({ value: r as string, label: orgRoleLabel(r, t) })));

	const form = createForm({
		initial: { email: '', role: 'user', hours: 72 as number | string },
		validate: (v) => {
			const n = Number(v.hours);
			return {
				hours: Number.isInteger(n) && n >= 1 && n <= 720 ? undefined : t('organizations.expires_hours_hint')
			};
		},
		submit: async (v) => {
			await createInvitation(orgId, {
				email: v.email.trim(),
				role: v.role,
				expires_in_hours: Number(v.hours) || 72
			});
			toast.success(t('organizations.invitation_created'));
			onsaved();
		}
	});
</script>

<Dialog title={t('organizations.create_invitation')} beforeclose={() => !form.busy} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('organizations.email')} hint={t('organizations.optional')}>
			{#snippet children(f)}
				<Input {...f} type="email" width="host" autocomplete="off" bind:value={form.values.email} />
			{/snippet}
		</Field>
		<Field label={t('organizations.role')}>
			{#snippet children(f)}
				<Select {...f} width="medium" options={roleOptions} bind:value={form.values.role} />
			{/snippet}
		</Field>
		<Field
			label={t('organizations.expires_hours')}
			hint={t('organizations.expires_hours_hint')}
			error={form.errors.hours}
		>
			{#snippet children(f)}
				<Input {...f} type="number" width="short" min={1} max={720} bind:value={form.values.hours} />
			{/snippet}
		</Field>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{t('organizations.create_invitation')}</Button
		>
	{/snippet}
</Dialog>
