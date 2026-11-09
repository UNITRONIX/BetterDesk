<!--
  Change someone's role inside the organization (one choice, a centred
  dialog).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { setOrgUserRole, type OrgUser } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { orgRoleLabel } from '#lib/people/orgs.ts';
	import { ORG_ROLES } from '#lib/people/users.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		orgId: string;
		member: OrgUser;
		onclose: () => void;
		onsaved: () => void;
	}

	let { orgId, member, onclose, onsaved }: Props = $props();

	const roleOptions = $derived(ORG_ROLES.map((r) => ({ value: r as string, label: orgRoleLabel(r, t) })));

	const form = createForm({
		initial: untrack(() => ({ role: member.role || 'user' })),
		submit: async (v) => {
			await setOrgUserRole(orgId, member.id, v.role);
			toast.success(t('organizations.user_updated'));
			onsaved();
		}
	});
</script>

<Dialog
	title={t('organizations.edit_role')}
	message={member.username}
	beforeclose={() => !form.busy}
	{onclose}
>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Field label={t('organizations.role')}>
			{#snippet children(f)}
				<Select {...f} width="medium" options={roleOptions} bind:value={form.values.role} />
			{/snippet}
		</Field>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}>{t('actions.save')}</Button>
	{/snippet}
</Dialog>
