<!--
  The organizations an account belongs to, with its role in each. With
  org.manage_users the sheet also removes it from one and adds it to
  another (organization and role). Without, it only lists them.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { listOrgs, type Organization } from '#lib/api/orgs.ts';
	import {
		addUserToOrg,
		listUserOrgs,
		removeUserFromOrg,
		type ConsoleUser,
		type UserOrg
	} from '#lib/api/users.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { orgRoleLabel } from '#lib/people/orgs.ts';
	import { availableOrgs, ORG_ROLES } from '#lib/people/users.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import Select from '#lib/ui/Select.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import States from '#lib/ui/States.svelte';
	import Tag from '#lib/ui/Tag.svelte';

	interface Props {
		user: ConsoleUser;
		onclose: () => void;
		/** The account's organizations changed (the table's cell follows) */
		onchanged: (orgs: UserOrg[]) => void;
	}

	let { user, onclose, onchanged }: Props = $props();

	const canManage = can('org.manage_users');

	let orgs = $state.raw<UserOrg[] | null>(null);
	let loadError = $state('');
	let all = $state.raw<Organization[]>([]);
	let allFailed = $state(false);
	let status = $state('');
	let statusTone = $state<'neutral' | 'ok' | 'error'>('neutral');
	let busy = $state(false);
	let sheet = $state<HTMLElement | null>(null);

	let pickOrg = $state('');
	let pickRole = $state<string>('user');

	const available = $derived(orgs ? availableOrgs(all, orgs) : []);
	const roleOptions = $derived(ORG_ROLES.map((r) => ({ value: r as string, label: orgRoleLabel(r, t) })));

	async function load() {
		loadError = '';
		try {
			orgs = await listUserOrgs(user.id);
		} catch (err) {
			loadError = err instanceof Error && err.message ? err.message : t('errors.load_orgs_failed');
		}
	}

	$effect(() => {
		untrack(() => {
			void load();
			if (canManage)
				listOrgs().then(
					(o) => (all = o),
					() => (allFailed = true)
				);
		});
	});

	// The picked organization is always one that can still be added
	$effect(() => {
		if (!available.some((o) => o.id === pickOrg)) pickOrg = available[0]?.id ?? '';
	});

	async function refresh() {
		const next = await listUserOrgs(user.id);
		orgs = next;
		onchanged(next);
	}

	async function run(work: () => Promise<void>, done: string) {
		if (busy) return;
		busy = true;
		status = '';
		try {
			await work();
			await refresh();
			status = done;
			statusTone = 'ok';
		} catch (err) {
			status = err instanceof Error ? err.message : t('errors.server_error');
			statusTone = 'error';
		} finally {
			busy = false;
		}
		// A removed row takes its button along: focus stays in the sheet
		await tick();
		if (!sheet?.contains(document.activeElement) || document.activeElement === document.body)
			sheet?.querySelector<HTMLElement>('.add select, .list .btn, .sheet-footer .btn')?.focus();
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		const org = all.find((o) => o.id === pickOrg);
		if (!org) return;
		void run(
			() => addUserToOrg(user.id, org.id, pickRole).then(() => undefined),
			t('users.org_added_named', { org: org.name })
		);
	}

	function remove(org: UserOrg) {
		void run(
			() => removeUserFromOrg(org.id, user.id).then(() => undefined),
			t('users.org_removed_named', { org: org.name })
		);
	}
</script>

<Sheet
	title={t('users.user_organizations', { username: user.username })}
	subtitle={t('users.org_membership_hint')}
	{status}
	{statusTone}
	bind:element={sheet}
	{onclose}
>
	<FormSection title={t('users.org_member_of')}>
		{#if orgs === null && !loadError}
			<States kind="loading" />
		{:else if loadError}
			<States kind="error" message={loadError} onretry={() => void load()} />
		{:else if orgs && orgs.length}
			<RowList>
				{#each orgs as org (org.id)}
					{#snippet roleTag()}<span class="sr-only">{t('organizations.org_role')}: </span><Tag
							label={orgRoleLabel(org.role, t)}
						/>{/snippet}
					{#snippet remover()}<Button
							size="sm"
							variant="danger-quiet"
							disabled={busy}
							onclick={() => remove(org)}
							>{t('actions.remove')}<span class="sr-only"> {org.name}</span></Button
						>{/snippet}
					<ListRow
						title={org.name}
						sub={org.role ? roleTag : undefined}
						actions={canManage ? remover : undefined}
					/>
				{/each}
			</RowList>
		{:else}
			<p class="empty">{t('users.no_organizations')}</p>
		{/if}
	</FormSection>

	{#if canManage && orgs}
		<FormSection title={t('users.add_to_org')}>
			{#if allFailed}
				<Notice tone="danger" message={t('errors.load_orgs_failed')} />
			{:else if !available.length}
				<p class="empty">{all.length ? t('users.all_orgs_assigned') : t('users.no_orgs_exist')}</p>
			{:else}
				<form class="add" onsubmit={add} novalidate>
					<Field label={t('users.organization')}>
						{#snippet children(f)}
							<Select
								{...f}
								width="host"
								options={available.map((o) => ({ value: o.id, label: o.name }))}
								bind:value={pickOrg}
							/>
						{/snippet}
					</Field>
					<Field label={t('organizations.org_role')}>
						{#snippet children(f)}
							<Select {...f} width="medium" options={roleOptions} bind:value={pickRole} />
						{/snippet}
					</Field>
					<div><Button type="submit" {busy}>{t('users.add_to_org_button')}</Button></div>
				</form>
			{/if}
		</FormSection>
	{/if}

	{#snippet footer()}
		<Button onclick={onclose}>{t('actions.close')}</Button>
	{/snippet}
</Sheet>

<style>
	.empty {
		margin: 0;
		color: var(--text-muted);
	}
	.add {
		display: block;
	}
</style>
