<!--
  Console users (/users): the accounts that can sign in, their role, which
  devices and organizations each can reach, and the user groups that share
  device access. A click on a row edits the account (or, without
  user.edit, shows its organizations).

  Data: GET /api/users (one list), then per account its device count
  (/effective-scope) and organizations, four at a time; GET
  /api/panel/user-groups beside it. Actions are offered by permission:
  user.create (and a role the signed-in person may give) to add, user.edit
  to edit, reset passwords and manage groups, user.delete to delete (never
  yourself), org.manage_users to change organizations.

  URL: ?search= fills the search and follows it; #user-groups goes to the
  user groups.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { ApiError } from '#lib/api/client.ts';
	import {
		deleteUser,
		deleteUserGroup,
		getEffectiveScope,
		listConsoleUsers,
		listUserGroupRows,
		listUserOrgs,
		type ConsoleUser,
		type EffectiveScope,
		type UserGroupRow,
		type UserOrg
	} from '#lib/api/users.ts';
	import { plural, t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import NoAccess from '#lib/shell/NoAccess.svelte';
	import {
		assignableRoles,
		DESCRIBED_ROLES,
		eachLimited,
		filterUsers,
		providerOf,
		scopeText
	} from '#lib/people/users.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { myPresence } from '#lib/state/presence.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import SearchField from '#lib/ui/SearchField.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import Toolbar from '#lib/ui/Toolbar.svelte';
	import User from '#lib/ui/User.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import type { Column, SortState } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import ResetPasswordDialog from './ResetPasswordDialog.svelte';
	import UserGroupDialog from './UserGroupDialog.svelte';
	import UserOrgsSheet from './UserOrgsSheet.svelte';
	import UserSheet from './UserSheet.svelte';

	const allowed = can('user.view');
	const canCreate = can('user.create') && assignableRoles(session.user?.role).length > 0;
	const canEdit = can('user.edit');
	const canDelete = can('user.delete');
	const meId = String(session.user?.id ?? '');

	/* ── Labels ── */

	function roleLabel(role: string): string {
		const key = `users.role_${role}`;
		const text = t(key);
		return text === key ? role : text;
	}
	function providerLabel(provider: string): string {
		const key = `users.provider_${provider}`;
		const text = t(key);
		return text === key ? provider : text;
	}

	/* ── Data ── */

	let users = $state.raw<ConsoleUser[]>([]);
	let loaded = $state(false);
	let loadError = $state<string | null>(null);
	let groups = $state.raw<UserGroupRow[]>([]);
	let groupsState = $state<'loading' | 'ok' | 'error'>('loading');
	/** Per account id: its device count, or 'error' */
	const scopes = new SvelteMap<string, EffectiveScope | 'error'>();
	/** Per account id: its organizations, or 'error' */
	const userOrgs = new SvelteMap<string, UserOrg[] | 'error'>();
	let generation = 0;
	/** The per-account requests of the last load; stopped by a new load or by leaving the page */
	let rowRequests: AbortController | null = null;

	async function loadUsers() {
		const gen = ++generation;
		rowRequests?.abort();
		const ctrl = new AbortController();
		rowRequests = ctrl;
		try {
			const list = await listConsoleUsers();
			if (gen !== generation) return;
			users = list;
			loadError = null;
			loaded = true;
			scopes.clear();
			userOrgs.clear();
			// The two extra columns, a few requests at a time
			void eachLimited(list, 4, async (u) => {
				if (ctrl.signal.aborted) return;
				const id = String(u.id);
				const [scope, orgs] = await Promise.all([
					getEffectiveScope(u.id, ctrl.signal).catch(() => 'error' as const),
					listUserOrgs(u.id, ctrl.signal).catch(() => 'error' as const)
				]);
				if (gen !== generation || ctrl.signal.aborted) return;
				scopes.set(id, scope);
				userOrgs.set(id, orgs);
			});
		} catch (err) {
			if (gen !== generation) return;
			loaded = true;
			loadError = err instanceof ApiError && err.status === 403 ? err.message : t('users.list_failed');
		}
	}

	async function loadGroups() {
		try {
			groups = await listUserGroupRows();
			groupsState = 'ok';
		} catch {
			groups = [];
			groupsState = 'error';
		}
	}

	$effect(() => {
		if (!allowed) return;
		untrack(() => {
			void loadUsers();
			void loadGroups();
		});
		const stop = onRefresh(() => {
			void loadUsers();
			void loadGroups();
		});
		return () => {
			stop();
			rowRequests?.abort();
		};
	});

	/* ── Search, in the URL as ?search= ── */

	let searchInput = $state(untrack(() => page.url.searchParams.get('search')?.trim() ?? ''));
	let query = $state(untrack(() => searchInput));

	$effect(() => {
		const v = searchInput.trim();
		if (v === untrack(() => query)) return;
		const timer = setTimeout(() => {
			query = v;
			const url = new URL(location.href);
			if (v) url.searchParams.set('search', v);
			else url.searchParams.delete('search');
			// This page's own address with another ?search=
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			replaceState(url, page.state);
		}, 150);
		return () => clearTimeout(timer);
	});

	const shown = $derived(filterUsers(users, query, roleLabel));
	let sort = $state<SortState | null>(null);

	/* ── #user-groups ── */

	$effect(() => {
		if (!allowed || location.hash !== '#user-groups') return;
		void tick().then(() =>
			requestAnimationFrame(() => {
				const section = document.getElementById('user-groups');
				section?.scrollIntoView({ block: 'start' });
				(
					section?.querySelector<HTMLElement>('.add-group') ?? section?.querySelector<HTMLElement>('h2')
				)?.focus();
			})
		);
	});

	/* ── Sheets and dialogs ── */

	let editing = $state<{ user: ConsoleUser | null } | null>(null);
	let resetFor = $state.raw<ConsoleUser | null>(null);
	let orgsFor = $state.raw<ConsoleUser | null>(null);
	let groupDialog = $state<{ group: UserGroupRow | null } | null>(null);

	function openRow(u: ConsoleUser) {
		if (canEdit) editing = { user: u };
		else orgsFor = u;
	}

	async function removeUser(u: ConsoleUser) {
		const ok = await confirm({
			title: t('users.delete_title'),
			message: t('users.delete_confirm', { username: u.username }),
			confirmLabel: t('users.delete_title'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteUser(u.id);
			toast.success(t('users.deleted_named', { username: u.username }));
			void loadUsers();
			void loadGroups();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	async function removeGroup(g: UserGroupRow) {
		const name = g.name || g.guid;
		const ok = await confirm({
			title: t('users.delete_user_group'),
			message: t('users.delete_user_group_confirm', { name }),
			confirmLabel: t('users.delete_user_group'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deleteUserGroup(g.guid);
			toast.success(t('users.group_deleted_named', { name }));
			await loadGroups();
			void loadUsers();
			// The row and its menu are gone; focus stays in the section
			document.querySelector<HTMLElement>('#user-groups .add-group')?.focus();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('users.group_delete_failed', { name }));
		}
	}

	/* ── Columns ── */

	const hasTwoFactor = $derived(users.some((u) => u.totp_enabled !== undefined && u.totp_enabled !== null));

	const columns = $derived<Column<ConsoleUser>[]>([
		{
			id: 'username',
			label: t('users.username'),
			cell: nameCell,
			primary: true,
			sortValue: (u) => u.username.toLowerCase(),
			class: 'col-name'
		},
		{ id: 'email', label: t('users.email'), cell: emailCell, sortValue: (u) => u.email.toLowerCase() },
		{
			id: 'role',
			label: t('users.role'),
			cell: roleCell,
			sortValue: (u) => roleLabel(u.role),
			class: 'col-nowrap'
		},
		// These two fill in after the list, one request per account: their width is
		// kept from the start so the rows don't grow and move when the text arrives
		{
			id: 'devices',
			label: t('users.column_devices'),
			cell: scopeCell,
			class: 'col-nowrap',
			minWidth: '8rem'
		},
		{ id: 'orgs', label: t('users.column_organizations'), cell: orgsCell, minWidth: '12rem' },
		{
			id: 'two_factor',
			label: t('nav.account_2fa'),
			cell: twoFactorCell,
			visible: hasTwoFactor,
			sortValue: (u) => (u.totp_enabled ? 1 : 0),
			class: 'col-nowrap'
		},
		{
			id: 'last_login',
			label: t('users.last_login'),
			cell: lastCell,
			sortValue: (u) => u.last_login ?? '',
			class: 'col-nowrap'
		},
		{
			id: 'created',
			label: t('users.created'),
			cell: createdCell,
			sortValue: (u) => u.created_at ?? '',
			class: 'col-nowrap'
		},
		{ id: 'actions', label: t('users.actions'), labelHidden: true, cell: actionsCell, align: 'actions' }
	]);

	const groupName = (guid: string) => groups.find((g) => g.guid === guid)?.name || guid;
</script>

{#snippet nameCell(u: ConsoleUser)}
	{@const self = String(u.id) === meId}
	<span class="user-name"
		><User
			user={u}
			avatar
			presence={self ? myPresence.status : undefined}
			presenceLabel={self ? t(`chat.presence_${myPresence.status}`) : undefined}
		/></span
	>
	{#if u.user_groups.length}<span class="cell-sub"
			>{t('users.groups_line', { groups: u.user_groups.map(groupName).join(', ') })}</span
		>{/if}
	{#if self}<span class="cell-sub">{t('users.this_is_you')}</span>{/if}
{/snippet}

{#snippet emailCell(u: ConsoleUser)}{#if u.email}{u.email}{:else}<Empty />{/if}{/snippet}

{#snippet roleCell(u: ConsoleUser)}
	{@const provider = providerOf(u)}
	<span class="tag-set"
		><Tag label={roleLabel(u.role)} />{#if provider !== 'local'}<Tag
				label={providerLabel(provider)}
				title={t('users.provider_account', { provider: providerLabel(provider) })}
			/>{/if}</span
	>
{/snippet}

{#snippet scopeCell(u: ConsoleUser)}
	{@const s = scopeText(scopes.get(String(u.id)))}
	{#if !s.key}<span class="text-muted" aria-hidden="true">…</span><span class="sr-only"
			>{t('common.loading')}</span
		>{:else}<span class={[s.muted && 'text-muted']}>{t(s.key, s.params)}</span>{/if}
{/snippet}

{#snippet orgsCell(u: ConsoleUser)}
	{@const orgs = userOrgs.get(String(u.id))}
	{#if orgs === undefined}<span class="text-muted" aria-hidden="true">…</span><span class="sr-only"
			>{t('common.loading')}</span
		>{:else if orgs === 'error'}<Empty word={t('users.orgs_unknown')} />{:else if !orgs.length}<Empty
			word={t('users.orgs_none')}
		/>{:else}{orgs.map((o) => o.name).join(', ')}{/if}
{/snippet}

{#snippet twoFactorCell(u: ConsoleUser)}<BooleanStatus value={!!u.totp_enabled} />{/snippet}

{#snippet lastCell(u: ConsoleUser)}<Time value={u.last_login} empty={t('users.never')} />{/snippet}

{#snippet createdCell(u: ConsoleUser)}<Time
		value={u.created_at}
		relative={false}
		format={{ hour: undefined, minute: undefined }}
	/>{/snippet}

{#snippet actionsCell(u: ConsoleUser)}
	{@const self = String(u.id) === meId}
	{@const local = providerOf(u) === 'local'}
	{#if !canEdit && !(canDelete && !self)}
		<Button size="sm" onclick={() => (orgsFor = u)}
			>{t('users.organizations')}<span class="sr-only"> {u.username}</span></Button
		>
	{:else}
		<MenuButton kebab label={t('users.actions_for', { username: u.username })}>
			{#if canEdit}
				<MenuItem class="act-edit" icon={ICONS.edit} onselect={() => (editing = { user: u })}
					>{t('users.edit')}</MenuItem
				>
				{#if local}
					<MenuItem class="act-reset" icon={ICONS.password} onselect={() => (resetFor = u)}
						>{t('users.reset_password_menu')}</MenuItem
					>
				{/if}
			{/if}
			<MenuItem class="act-orgs" icon={ICONS.organization} onselect={() => (orgsFor = u)}
				>{t('users.organizations_menu')}</MenuItem
			>
			{#if canDelete && !self}
				<MenuDivider />
				<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void removeUser(u)}
					>{t('users.delete_menu')}</MenuItem
				>
			{/if}
		</MenuButton>
	{/if}
{/snippet}

{#if !allowed}
	<NoAccess />
{:else}
	<div class="page page-wide users-page">
		<div class="page-head">
			<h1>{t('nav.users')}</h1>
			{#if canCreate}
				<div class="page-actions">
					<Button
						class="add-user"
						variant="primary"
						icon={ICONS.add}
						onclick={() => (editing = { user: null })}>{t('users.add_user')}</Button
					>
				</div>
			{/if}
			<p class="page-description">{t('users.page_description')}</p>
		</div>

		<div class="page-cols">
			<div class="page-main">
				<section class="section" aria-labelledby="users-list-title">
					<h2 id="users-list-title" class="sr-only">{t('nav.users')}</h2>
					<Toolbar>
						{#snippet search()}<SearchField
								label={t('users.search_label')}
								bind:value={searchInput}
							/>{/snippet}
					</Toolbar>
					<div class="count-line-row" aria-live="polite">
						{#if loaded && !loadError}
							{#if query && shown.length !== users.length}
								<CountLine
									text={t('users.count_filtered')}
									values={{ shown: shown.length, count: users.length }}
								/>
							{:else}
								<CountLine
									text={plural(users.length, { one: t('users.count_one'), other: t('users.count_many') })}
								/>
							{/if}
						{/if}
					</div>
					<div class="users-table">
						<Table
							rows={shown}
							{columns}
							key={(u) => String(u.id)}
							label={t('nav.users')}
							bind:sort
							onrowclick={openRow}
							loading={!loaded}
							loadingText={t('users.loading_list')}
							error={loadError}
							onretry={() => void loadUsers()}
							emptyText={users.length ? t('users.no_match', { query }) : t('users.empty_text')}
						/>
					</div>
					{#if loaded && !loadError && users.length && !shown.length}
						<div><Button size="sm" onclick={() => (searchInput = '')}>{t('users.clear_search')}</Button></div>
					{/if}
				</section>
			</div>

			<!-- Below the table on most screens: drawn once the list and the groups are
			     in, so it doesn't move down when they arrive -->
			{#if loaded && groupsState !== 'loading'}
				<aside class="page-side" aria-label={t('users.side_label')}>
					<section class="section" id="user-groups" aria-labelledby="user-groups-title">
						<div class="section-head">
							<h2 id="user-groups-title" tabindex="-1">{t('users.user_groups')}</h2>
							{#if canEdit}
								<Button
									class="add-group"
									size="sm"
									icon={ICONS.add}
									onclick={() => (groupDialog = { group: null })}>{t('users.create_user_group')}</Button
								>
							{/if}
						</div>
						<p class="section-note">{t('users.user_groups_note')}</p>
						{#if groupsState === 'error'}
							<States kind="error" message={t('users.groups_failed')} onretry={() => void loadGroups()} />
						{:else if !groups.length}
							<RowList><ListRow empty title={t('users.no_user_groups')} /></RowList>
						{:else}
							<RowList label={t('users.user_groups')}>
								{#each groups as g (g.guid)}
									{@const members = plural(g.member_count, {
										one: t('users.members_one'),
										other: t('users.members_many')
									})}
									{#snippet groupMenu()}<MenuButton
											kebab
											label={t('users.group_actions_for', { name: g.name || g.guid })}
										>
											<MenuItem icon={ICONS.edit} onselect={() => (groupDialog = { group: g })}
												>{t('users.edit')}</MenuItem
											>
											<MenuDivider />
											<MenuItem icon={ICONS.delete} danger onselect={() => void removeGroup(g)}
												>{t('actions.delete')}</MenuItem
											>
										</MenuButton>{/snippet}
									<ListRow
										title={g.name || g.guid}
										sub={g.note ? `${members}, ${g.note}` : members}
										actions={canEdit ? groupMenu : undefined}
									/>
								{/each}
							</RowList>
						{/if}
					</section>

					<section class="section" aria-labelledby="users-roles-title">
						<div class="section-head"><h2 id="users-roles-title">{t('users.roles_title')}</h2></div>
						<dl class="roles">
							{#each DESCRIBED_ROLES as r (r)}
								<div>
									<dt>{roleLabel(r)}</dt>
									<dd>{t(`users.role_desc_${r}`)}</dd>
								</div>
							{/each}
						</dl>
						<p class="section-note">
							{t('users.role_note')}
							{#if session.isSuperAdmin}<a href={link('/permissions')}>{t('users.roles_change_link')}</a>{/if}
						</p>
					</section>

					<Disclosure title={t('users.security_tips_title')}>
						<ul class="tips">
							<li>{t('users.tip_unique_accounts')}</li>
							<li>{t('users.tip_strong_passwords')}</li>
							<li>{t('users.tip_least_role')}</li>
							<li>{t('users.tip_audit_logs')}</li>
						</ul>
					</Disclosure>
				</aside>
			{/if}
		</div>
	</div>

	{#if editing}
		<UserSheet
			user={editing.user}
			{groups}
			{roleLabel}
			{providerLabel}
			onclose={() => (editing = null)}
			onsaved={() => {
				editing = null;
				void loadUsers();
				void loadGroups();
			}}
		/>
	{/if}

	{#if resetFor}
		<ResetPasswordDialog user={resetFor} onclose={() => (resetFor = null)} />
	{/if}

	{#if orgsFor}
		<UserOrgsSheet
			user={orgsFor}
			onclose={() => (orgsFor = null)}
			onchanged={(orgs) => orgsFor && userOrgs.set(String(orgsFor.id), orgs)}
		/>
	{/if}

	{#if groupDialog}
		<UserGroupDialog
			group={groupDialog.group}
			onclose={() => (groupDialog = null)}
			onsaved={() => {
				groupDialog = null;
				void loadGroups();
			}}
		/>
	{/if}
{/if}

<style>
	.count-line-row {
		min-height: 1.5em;
		margin: 0;
	}
	.users-table :global(.user-name) {
		font-weight: 600;
	}
	/* Lines under a name start where the name does, after the avatar */
	.users-table :global(.cell-sub) {
		display: block;
		padding-inline-start: calc(24px + var(--space-2));
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.users-table :global(td.col-nowrap) {
		white-space: nowrap;
	}
	.tag-set {
		display: inline-flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	/* When the table is wider than the page, the row actions stay in view at the end */
	.users-table :global(:is(td, th).actions) {
		position: sticky;
		inset-inline-end: 0;
		background: var(--bg);
	}
	.roles {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
	}
	.roles dt {
		font-weight: 600;
	}
	.roles dd {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.tips {
		margin: 0;
		padding-inline-start: var(--space-5);
	}
	.tips li + li {
		margin-top: var(--space-1);
	}
	h2[tabindex='-1']:focus {
		outline: none;
	}
	/* The table needs about 1,100 px for its columns: the side column goes
	   beside it only on wide screens; below that it follows the table, with
	   its sections next to each other where they fit */
	@media (max-width: 1679px) {
		.users-page .page-cols {
			grid-template-columns: minmax(0, 1fr);
		}
		.users-page .page-side {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
			gap: var(--space-6) var(--space-7);
			align-items: start;
		}
	}
	/* Touch: the name that opens the row gets a 44 px hit area (as on the device list) */
	@media (pointer: coarse) {
		.users-table :global(.row-open) {
			display: inline-flex;
			flex-direction: column;
			justify-content: center;
			min-height: 44px;
		}
	}
</style>
