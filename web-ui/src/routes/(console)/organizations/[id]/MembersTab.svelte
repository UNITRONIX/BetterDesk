<!--
  Members tab: the people in the organization and the invitations. Both
  lists and every action need org.manage_users (the members list also
  user.view); without, the tab says the role cannot see them.
-->
<script lang="ts">
	import { removeOrgUser, type OrgInvitation, type OrgUser } from '#lib/api/orgs.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { orgRoleLabel } from '#lib/people/orgs.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import User from '#lib/ui/User.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import AddMemberDialog from './AddMemberDialog.svelte';
	import InviteDialog from './InviteDialog.svelte';
	import MemberRoleDialog from './MemberRoleDialog.svelte';

	interface Props {
		orgId: string;
		members: OrgUser[] | null;
		membersError: string | null;
		invitations: OrgInvitation[] | null;
		invitationsError: string | null;
		onmembers: () => void;
		oninvitations: () => void;
	}

	let { orgId, members, membersError, invitations, invitationsError, onmembers, oninvitations }: Props =
		$props();

	const canUsers = can('org.manage_users');
	const canRead = canUsers && can('user.view');

	let adding = $state(false);
	let inviting = $state(false);
	let roleFor = $state.raw<OrgUser | null>(null);

	async function remove(m: OrgUser) {
		const ok = await confirm({
			title: t('organizations.remove_from_org'),
			message: t('organizations.confirm_remove_user_named', { name: m.username }),
			confirmLabel: t('organizations.remove_from_org'),
			confirmIcon: ICONS.unlink,
			danger: true
		});
		if (!ok) return;
		try {
			await removeOrgUser(orgId, m.id);
			toast.success(t('organizations.user_removed'));
			onmembers();
		} catch (err) {
			toast.error(`${t('organizations.remove_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	const memberColumns = $derived<Column<OrgUser>[]>([
		{
			id: 'username',
			label: t('organizations.username'),
			cell: nameCell,
			sortValue: (m) => m.username.toLowerCase()
		},
		{ id: 'email', label: t('organizations.email'), cell: emailCell },
		{ id: 'role', label: t('organizations.role'), cell: roleCell, sortValue: (m) => m.role },
		{
			id: 'last_login',
			label: t('organizations.last_login'),
			cell: lastCell,
			sortValue: (m) => m.last_login ?? ''
		},
		...(canUsers
			? [
					{
						id: 'actions',
						label: t('organizations.actions'),
						labelHidden: true,
						cell: memberMenu,
						align: 'actions' as const
					}
				]
			: [])
	]);

	const inviteColumns = $derived<Column<OrgInvitation>[]>([
		{ id: 'token', label: t('organizations.token'), cell: tokenCell },
		{ id: 'email', label: t('organizations.email'), cell: inviteEmailCell },
		{ id: 'role', label: t('organizations.role'), cell: inviteRoleCell },
		{
			id: 'expires',
			label: t('organizations.expires'),
			cell: expiresCell,
			sortValue: (i) => i.expires_at ?? ''
		},
		{ id: 'used', label: t('organizations.used'), cell: usedCell, sortValue: (i) => i.used_at ?? '' }
	]);
</script>

{#snippet nameCell(m: OrgUser)}<User user={m.username} avatar />{#if m.display_name}<span class="cell-sub"
			>{m.display_name}</span
		>{/if}{/snippet}
{#snippet emailCell(m: OrgUser)}{#if m.email}{m.email}{:else}<Empty />{/if}{/snippet}
{#snippet roleCell(m: OrgUser)}<Tag label={orgRoleLabel(m.role, t)} />{/snippet}
{#snippet lastCell(m: OrgUser)}<Time value={m.last_login} empty={t('users.never')} />{/snippet}
{#snippet memberMenu(m: OrgUser)}<MenuButton
		kebab
		label={t('organizations.actions_for', { name: m.username })}
	>
		<MenuItem class="act-role" icon={ICONS.edit} onselect={() => (roleFor = m)}
			>{t('organizations.edit_role')}</MenuItem
		>
		<MenuDivider />
		<MenuItem class="act-remove" icon={ICONS.unlink} danger onselect={() => void remove(m)}
			>{t('organizations.remove_from_org')}</MenuItem
		>
	</MenuButton>{/snippet}

{#snippet tokenCell(i: OrgInvitation)}<ValueCopy
		value={i.token ? `${i.token.substring(0, 16)}…` : ''}
		copy={false}
	/>{/snippet}
{#snippet inviteEmailCell(i: OrgInvitation)}{#if i.email}{i.email}{:else}<Empty />{/if}{/snippet}
{#snippet inviteRoleCell(i: OrgInvitation)}<Tag label={orgRoleLabel(i.role, t)} />{/snippet}
{#snippet expiresCell(i: OrgInvitation)}<Time value={i.expires_at} relative={false} />{/snippet}
{#snippet usedCell(i: OrgInvitation)}<Time value={i.used_at} empty={t('organizations.not_used')} />{/snippet}

<section class="section" aria-label={t('organizations.users')}>
	{#if canUsers}
		<div class="section-head lead">
			<Button class="add-member" variant="primary" icon={ICONS.add} onclick={() => (adding = true)}
				>{t('organizations.add_user')}</Button
			>
		</div>
	{/if}
	{#if !canRead}
		<States message={t('organizations.no_permission')} />
	{:else if membersError}
		<States kind="error" message={membersError} onretry={onmembers} />
	{:else if members && !members.length}
		<States message={t('organizations.no_users')} />
	{:else}
		<Table
			rows={members ?? []}
			columns={memberColumns}
			key={(m) => m.id}
			label={t('organizations.users')}
			loading={!members}
		/>
	{/if}
</section>

<section class="section" id="section-invitations" aria-labelledby="org-invitations-title">
	<div class="section-head">
		<h2 id="org-invitations-title">{t('organizations.invitations')}</h2>
		{#if canUsers}
			<Button class="create-invite" icon={ICONS.add} onclick={() => (inviting = true)}
				>{t('organizations.create_invitation')}</Button
			>
		{/if}
	</div>
	{#if !canUsers}
		<States message={t('organizations.no_permission')} />
	{:else if invitationsError}
		<States kind="error" message={invitationsError} onretry={oninvitations} />
	{:else if invitations && !invitations.length}
		<States message={t('organizations.no_invitations')} />
	{:else}
		<Table
			rows={invitations ?? []}
			columns={inviteColumns}
			key={(i) => i.id}
			label={t('organizations.invitations')}
			loading={!invitations}
		/>
	{/if}
</section>

{#if adding}
	<AddMemberDialog
		{orgId}
		onclose={() => (adding = false)}
		onsaved={() => {
			adding = false;
			onmembers();
		}}
	/>
{/if}
{#if inviting}
	<InviteDialog
		{orgId}
		onclose={() => (inviting = false)}
		onsaved={() => {
			inviting = false;
			oninvitations();
		}}
	/>
{/if}
{#if roleFor}
	<MemberRoleDialog
		{orgId}
		member={roleFor}
		onclose={() => (roleFor = null)}
		onsaved={() => {
			roleFor = null;
			onmembers();
		}}
	/>
{/if}

<style>
	.section :global(.cell-sub) {
		display: block;
		padding-inline-start: calc(24px + var(--space-2));
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
