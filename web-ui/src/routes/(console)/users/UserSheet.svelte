<!--
  Add or edit a console account: sign-in (username and password for a new
  account; a new password for a local one), email, role, and which devices
  the account may see (user groups, folders, single devices, a client
  policy). A long form, so a side sheet. The role picker shows the roles
  the signed-in person may give, plus the account's current role (locked);
  LDAP accounts take their role from the directory.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { listFolders, type Folder } from '#lib/api/devices.ts';
	import { listStrategies, type Strategy } from '#lib/api/strategies.ts';
	import { createUser, updateUser, type ConsoleUser, type UserGroupRow } from '#lib/api/users.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import PasswordField from '#lib/people/PasswordField.svelte';
	import { passwordProblem, providerOf, roleChoices, splitIds, usernameProblem } from '#lib/people/users.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import User from '#lib/ui/User.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	interface Props {
		/** null: a new account */
		user: ConsoleUser | null;
		groups: UserGroupRow[];
		roleLabel: (role: string) => string;
		providerLabel: (provider: string) => string;
		onclose: () => void;
		onsaved: () => void;
	}

	let { user, groups, roleLabel, providerLabel, onclose, onsaved }: Props = $props();

	const uid = $props.id();
	const editing = untrack(() => !!user);
	const provider = untrack(() => (user ? providerOf(user) : 'local'));
	const isLocal = provider === 'local';
	const choices = $derived(
		roleChoices(session.user?.role, user).map((c) => ({
			value: c.role,
			title: roleLabel(c.role),
			description: t(`users.role_desc_${c.role}`),
			disabled: c.disabled
		}))
	);

	// Folders and client policies, for the device access part (both need device.view)
	let folders = $state.raw<Folder[]>([]);
	let strategies = $state.raw<Strategy[]>([]);
	$effect(() => {
		if (!can('device.view')) return;
		const ctrl = new AbortController();
		listFolders(ctrl.signal).then(
			(f) => (folders = f),
			() => undefined
		);
		listStrategies(ctrl.signal).then(
			(s) => (strategies = s),
			() => undefined
		);
		return () => ctrl.abort();
	});

	const form = createForm({
		initial: untrack(() => ({
			username: '',
			password: '',
			email: user?.email ?? '',
			role: user?.role ?? 'viewer',
			groups: [...(user?.user_groups ?? [])],
			folders: [...(user?.folder_ids ?? [])],
			direct: (user?.peer_grants ?? []).join(', '),
			strategy: user?.strategy_guid ?? ''
		})),
		validate: (v) => {
			const name = editing ? null : usernameProblem(v.username.trim());
			const pw = editing && !isLocal ? null : passwordProblem(v.password, !editing);
			return { username: name ? t(name) : undefined, password: pw ? t(pw) : undefined };
		},
		submit: async (v) => {
			const common = {
				email: v.email.trim(),
				groupGuids: v.groups,
				folderIds: v.folders.map((f) => Number.parseInt(f, 10)).filter(Number.isFinite),
				peerIds: splitIds(v.direct),
				strategyGuid: v.strategy
			};
			if (user) {
				// The role only when it changed: an editor may keep a role they could not give
				await updateUser(user.id, {
					...common,
					...(provider !== 'ldap' && v.role !== user.role ? { role: v.role } : {}),
					...(isLocal && v.password ? { password: v.password } : {})
				});
				toast.success(t('users.user_updated_named', { username: user.username }));
			} else {
				const username = v.username.trim();
				await createUser({ ...common, username, password: v.password, role: v.role });
				toast.success(t('users.user_created_named', { username }));
			}
			onsaved();
		}
	});

	function toggle(list: 'groups' | 'folders', value: string, on: boolean) {
		const cur = form.values[list];
		form.values[list] = on ? [...cur.filter((x) => x !== value), value] : cur.filter((x) => x !== value);
	}

	const strategyOptions = $derived([
		{ value: '', label: t('users.pro_strategy_none') },
		...strategies.map((s) => ({ value: s.guid, label: s.name || s.guid }))
	]);
</script>

{#snippet who()}<User {user} avatar />{/snippet}
{#snippet signIn()}<Tag
		label={isLocal ? t('users.provider_local_account') : providerLabel(provider)}
	/>{/snippet}

<Sheet
	class="user-sheet"
	title={user ? t('users.edit_user_named', { username: user.username }) : t('users.add_user')}
	subtitle={editing ? undefined : t('users.sheet_add_desc')}
	status={form.status.message}
	statusTone={form.status.state === 'error' ? 'error' : 'neutral'}
	beforeclose={() => !form.busy}
	{onclose}
>
	<form id={form.id} class="user-form" onsubmit={form.onsubmit} novalidate>
		{#if user}
			<Facts
				items={[
					{ label: t('users.username'), value: who },
					{ label: t('users.sign_in_with'), value: signIn }
				]}
			/>
			{#if isLocal}
				<PasswordField
					label={t('users.new_password')}
					hint={t('users.password_leave_empty')}
					error={form.errors.password}
					bind:value={form.values.password}
				/>
			{:else}
				<p class="note">{t('users.provider_managed_hint')}</p>
			{/if}
		{:else}
			<Field label={t('users.username')} hint={t('users.username_hint')} error={form.errors.username}>
				{#snippet children(f)}
					<Input
						{...f}
						width="medium"
						maxlength={32}
						autocomplete="off"
						spellcheck="false"
						data-autofocus
						bind:value={form.values.username}
					/>
				{/snippet}
			</Field>
			<PasswordField
				label={t('users.password')}
				hint={t('users.password_hint')}
				error={form.errors.password}
				bind:value={form.values.password}
			/>
		{/if}
		<Field label={t('users.email')} hint={t('users.email_hint')}>
			{#snippet children(f)}
				<Input
					{...f}
					type="email"
					width="host"
					autocomplete="off"
					spellcheck="false"
					bind:value={form.values.email}
				/>
			{/snippet}
		</Field>

		<FormSection title={t('users.role')} id="{uid}-role">
			<ChoiceList
				{choices}
				labelledby="{uid}-role-title"
				describedby="{uid}-role-note"
				name="{uid}-role-choice"
				bind:value={form.values.role}
			/>
			<p class="note" id="{uid}-role-note">{t('users.role_note')}</p>
		</FormSection>

		<FormSection title={t('users.device_access')}>
			<p class="note">{t('users.scope_hint')}</p>
			<fieldset class="group">
				<legend>{t('users.user_groups')}</legend>
				{#if groups.length}
					<ul class="pick">
						{#each groups as g (g.guid)}
							<li>
								<Checkbox
									label={g.name || g.guid}
									checked={form.values.groups.includes(g.guid)}
									onchange={(e) => toggle('groups', g.guid, (e.currentTarget as HTMLInputElement).checked)}
								/>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="note">{t('users.no_user_groups')}</p>
				{/if}
			</fieldset>
			<fieldset class="group" aria-describedby="{uid}-folders-hint">
				<legend>{t('users.user_folders')}</legend>
				{#if folders.length}
					<ul class="pick">
						{#each folders as f (f.id)}
							<li>
								<Checkbox
									label={f.name || String(f.id)}
									checked={form.values.folders.includes(String(f.id))}
									onchange={(e) =>
										toggle('folders', String(f.id), (e.currentTarget as HTMLInputElement).checked)}
								/>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="note">{t('users.no_folders')}</p>
				{/if}
				<p class="note" id="{uid}-folders-hint">{t('users.user_folders_hint')}</p>
			</fieldset>
			<Field label={t('users.user_direct_devices')} hint={t('users.user_direct_devices_hint')}>
				{#snippet children(f)}
					<Input {...f} width="host" spellcheck="false" autocomplete="off" bind:value={form.values.direct} />
				{/snippet}
			</Field>
			<Field label={t('users.pro_strategy_label')} hint={t('users.pro_strategy_hint')}>
				{#snippet children(f)}
					<Select {...f} width="medium" options={strategyOptions} bind:value={form.values.strategy} />
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={onclose}>{t('actions.cancel')}</Button>
		<Button variant="primary" type="submit" form={form.id} busy={form.busy}
			>{user ? t('actions.save') : t('users.create')}</Button
		>
	{/snippet}
</Sheet>

<style>
	.user-form :global(.facts) {
		grid-template-columns: minmax(0, 9rem) minmax(0, 1fr);
		/* rows hang their padding outside, so the labels line up with the field labels */
		margin: 0 calc(-1 * var(--row-pad-x)) var(--space-4);
	}
	.note {
		margin: 0 0 var(--space-4);
		color: var(--text-muted);
		font-size: var(--text-sm);
		max-width: var(--measure);
	}
	.group {
		min-width: 0;
		margin: 0 0 var(--space-4);
		padding: 0;
		border: 0;
	}
	.group legend {
		margin-bottom: var(--space-1);
		padding: 0;
		font-weight: 600;
	}
	.group .note {
		margin: var(--space-1) 0 0;
	}
	.pick {
		max-height: 260px;
		margin: 0;
		overflow-y: auto;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.pick > li {
		border-bottom: 1px solid var(--rule);
	}
	.pick > li > :global(.check-field) {
		padding-block: var(--row-pad-y);
	}
</style>
