<!--
  Add someone to the organization: a new account that exists only here
  (username, password, role), or an existing server account (who, role).
  Two ways, picked with tabs at the top of the dialog.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { addOrgMember, createOrgUser, listAvailableUsers, type ServerUser } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { orgRoleLabel } from '#lib/people/orgs.ts';
	import { ORG_ROLES } from '#lib/people/users.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	let { orgId, onclose, onsaved }: { orgId: string; onclose: () => void; onsaved: () => void } = $props();

	let mode = $state<string>('create');
	let available = $state.raw<ServerUser[]>([]);

	$effect(() => {
		untrack(() =>
			listAvailableUsers(orgId).then(
				(u) => (available = u),
				() => (available = [])
			)
		);
	});

	const roleOptions = $derived(ORG_ROLES.map((r) => ({ value: r as string, label: orgRoleLabel(r, t) })));
	function serverRole(r: string): string {
		const key = `users.role_${r}`;
		return t(key) === key ? r : t(key);
	}
	const userOptions = $derived([
		{ value: '', label: t('organizations.select_user_placeholder') },
		...available.map((u) => ({ value: String(u.id), label: `${u.username} (${serverRole(u.role)})` }))
	]);

	const form = createForm({
		initial: { username: '', password: '', role: 'user', userId: '', existingRole: 'user' },
		validate: (v) => {
			if (mode === 'create') {
				const missing = t('organizations.username_password_required');
				return {
					username: v.username.trim() ? undefined : missing,
					password: v.password ? undefined : missing
				};
			}
			return { userId: v.userId ? undefined : t('organizations.select_user_first') };
		},
		submit: async (v) => {
			if (mode === 'create') {
				await createOrgUser(orgId, { username: v.username.trim(), password: v.password, role: v.role });
				toast.success(t('organizations.user_added'));
			} else {
				await addOrgMember(orgId, Number.parseInt(v.userId, 10), v.existingRole);
				toast.success(t('organizations.user_linked'));
			}
			onsaved();
		}
	});
</script>

<Dialog title={t('organizations.add_user')} beforeclose={() => !form.busy} {onclose}>
	<form id={form.id} onsubmit={form.onsubmit} novalidate>
		<Tabs
			tabs={[
				{ id: 'create', label: t('organizations.create_new_user') },
				{ id: 'existing', label: t('organizations.add_existing_user') }
			]}
			bind:value={mode}
			label={t('organizations.add_user')}
		>
			{#snippet children(current)}
				<div class="panel">
					{#if current === 'create'}
						<p class="note">{t('organizations.create_new_user_hint')}</p>
						<Field label={t('organizations.username')} error={form.errors.username}>
							{#snippet children(f)}
								<Input
									{...f}
									width="medium"
									autocomplete="off"
									spellcheck="false"
									bind:value={form.values.username}
								/>
							{/snippet}
						</Field>
						<Field label={t('organizations.password')} error={form.errors.password}>
							{#snippet children(f)}
								<Input
									{...f}
									width="medium"
									type="password"
									autocomplete="new-password"
									bind:value={form.values.password}
								/>
							{/snippet}
						</Field>
						<Field label={t('organizations.role')}>
							{#snippet children(f)}
								<Select {...f} width="medium" options={roleOptions} bind:value={form.values.role} />
							{/snippet}
						</Field>
					{:else if available.length}
						<Field label={t('organizations.select_user')} error={form.errors.userId}>
							{#snippet children(f)}
								<Select {...f} width="host" options={userOptions} bind:value={form.values.userId} />
							{/snippet}
						</Field>
						<Field label={t('organizations.org_role')} hint={t('organizations.link_user_hint')}>
							{#snippet children(f)}
								<Select {...f} width="medium" options={roleOptions} bind:value={form.values.existingRole} />
							{/snippet}
						</Field>
					{:else}
						<p class="note">{t('organizations.no_available_users')}</p>
					{/if}
				</div>
			{/snippet}
		</Tabs>
		<FormStatus status={form.status} />
	</form>
	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.cancel')}</Button>
		<Button
			variant="primary"
			type="submit"
			form={form.id}
			busy={form.busy}
			disabled={mode === 'existing' && !available.length}>{t('organizations.add_user')}</Button
		>
	{/snippet}
</Dialog>

<style>
	.panel {
		padding-top: var(--space-4);
	}
	.note {
		margin: 0 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
