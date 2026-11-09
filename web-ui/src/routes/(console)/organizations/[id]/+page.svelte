<!--
  One organization (/organizations/:id). Tabs: Members (people and
  invitations), Devices (assigned devices and linked groups), Address book
  (contacts shared with members) and Settings (stored connection settings,
  every stored value, delete). The side column has its details and what
  belongs to it elsewhere (policies, support packages).

  Each list asks only when the role may read it: members need user.view and
  org.manage_users, invitations org.manage_users; without, the tab says so
  instead of asking. Writes by permission: org.edit (details, settings,
  address book), org.delete, org.manage_users (people, invitations),
  org.manage_devices (devices), device.edit (a new device group).

  URL: #users, #devices, #address-book, #settings keep the open tab;
  #invitations and #device-groups open the tab they are on.
-->
<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { ApiError } from '#lib/api/client.ts';
	import {
		getOrg,
		listContracts,
		listInvitations,
		listOrgDevices,
		listOrgGroups,
		listOrgUsers,
		type Contract,
		type OrgDevice,
		type OrgDeviceGroup,
		type OrgInvitation,
		type OrgUser,
		type OrgUserGroup,
		type Organization
	} from '#lib/api/orgs.ts';
	import { i18n, t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import OrgDialog from '#lib/people/OrgDialog.svelte';
	import { openInvitations, orgContracts } from '#lib/people/orgs.ts';
	import { onRefresh, setPageTitle } from '#lib/shell/page.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Facts from '#lib/ui/Facts.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tabs from '#lib/ui/Tabs.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import AddressBookTab from './AddressBookTab.svelte';
	import DevicesTab from './DevicesTab.svelte';
	import MembersTab from './MembersTab.svelte';
	import SettingsTab from './SettingsTab.svelte';

	const orgId = $derived(page.params.id ?? '');

	const canEdit = can('org.edit');
	const canUsers = can('org.manage_users');
	const canReadMembers = canUsers && can('user.view');
	/** /policies/<id> lets in the administrator roles (requireAdmin in routes/policies.routes.js) */
	const canPolicies = ['super_admin', 'admin', 'global_admin', 'server_admin'].includes(
		session.user?.role ?? ''
	);

	/* ── Tabs in the hash ── */

	const TABS = ['users', 'devices', 'address-book', 'settings'] as const;
	type Tab = (typeof TABS)[number];
	const ALIASES: Record<string, Tab> = { invitations: 'users', 'device-groups': 'devices' };

	function tabFromHash(hash: string): Tab {
		const h = hash.replace(/^#/, '');
		const name = ALIASES[h] ?? h;
		return (TABS as readonly string[]).includes(name) ? (name as Tab) : 'users';
	}

	let tab = $state<Tab>(untrack(() => tabFromHash(page.url.hash)));
	const opened = new SvelteSet<Tab>([untrack(() => tab)]);

	function setTab(next: Tab) {
		tab = next;
		opened.add(next);
	}
	/** The section a legacy hash points at, scrolled to once */
	const jumpTo = untrack(() => {
		const h = page.url.hash.replace(/^#/, '');
		return h === 'invitations' || h === 'device-groups' ? h : null;
	});

	function pickTab(id: string) {
		setTab(tabFromHash(id));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- a one-off address for replaceState
		const url = new URL(location.href);
		url.hash = tab;
		// This page's own address with another tab in the hash
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(url, page.state);
	}

	// A link to another tab of this page (or Back over a hash) changes only the hash
	$effect(() => {
		const onHash = () => setTab(tabFromHash(location.hash));
		window.addEventListener('hashchange', onHash);
		return () => window.removeEventListener('hashchange', onHash);
	});

	$effect(() => {
		if (!jumpTo) return;
		void tick().then(() =>
			requestAnimationFrame(() =>
				document.getElementById(`section-${jumpTo}`)?.scrollIntoView({ block: 'start' })
			)
		);
	});

	/* ── Data ── */

	let org = $state.raw<Organization | null>(null);
	let headerError = $state<string | null>(null);
	let members = $state.raw<OrgUser[] | null>(null);
	let membersError = $state<string | null>(null);
	let invitations = $state.raw<OrgInvitation[] | null>(null);
	let invitationsError = $state<string | null>(null);
	let devices = $state.raw<OrgDevice[] | null>(null);
	let devicesError = $state<string | null>(null);
	let deviceGroups = $state.raw<OrgDeviceGroup[] | null>(null);
	let userGroups = $state.raw<OrgUserGroup[]>([]);
	let groupsError = $state<string | null>(null);
	let contracts = $state.raw<Contract[]>([]);

	const failed = (err: unknown) =>
		err instanceof ApiError && err.status === 403
			? t('organizations.no_permission')
			: t('organizations.loading_failed');

	async function loadHeader(): Promise<boolean> {
		try {
			org = await getOrg(orgId);
			headerError = null;
			return true;
		} catch (err) {
			headerError =
				err instanceof ApiError && err.status === 404
					? t('organizations.org_not_found')
					: t('organizations.org_load_failed');
			return false;
		}
	}

	async function loadMembers() {
		if (!canReadMembers) return;
		try {
			members = await listOrgUsers(orgId);
			membersError = null;
		} catch (err) {
			membersError = failed(err);
		}
	}

	async function loadInvitations() {
		if (!canUsers) return;
		try {
			invitations = await listInvitations(orgId);
			invitationsError = null;
		} catch (err) {
			invitationsError = failed(err);
		}
	}

	async function loadDevices() {
		try {
			devices = await listOrgDevices(orgId);
			devicesError = null;
		} catch (err) {
			devicesError = failed(err);
		}
	}

	async function loadGroups() {
		try {
			const g = await listOrgGroups(orgId);
			deviceGroups = g.deviceGroups;
			userGroups = g.userGroups;
			groupsError = null;
		} catch (err) {
			groupsError = failed(err);
		}
		if (can('billing.view')) {
			listContracts().then(
				(c) =>
					(contracts = orgContracts(
						c,
						orgId,
						(deviceGroups ?? []).map((g) => g.guid)
					)),
				() => undefined // extra context here; the billing page reports its own errors
			);
		}
	}

	async function loadAll() {
		const ok = await loadHeader();
		if (!ok) return;
		// Everything at once: the devices table waits for the members only for their names
		void loadMembers();
		void loadInvitations();
		void loadDevices();
		void loadGroups();
	}

	$effect(() => {
		void orgId;
		untrack(() => void loadAll());
	});
	$effect(() => onRefresh(() => void loadAll()));

	$effect(() => {
		setPageTitle(org?.name || t('organizations.detail'));
		return () => setPageTitle(null);
	});

	/* ── Side column ── */

	const sideCounts = $derived.by(() => {
		// One sentence once every list this role reads has answered (a failed one is left out)
		const pending =
			(canReadMembers && !members && !membersError) ||
			(canUsers && !invitations && !invitationsError) ||
			(!devices && !devicesError);
		if (pending) return '';
		const parts: string[] = [];
		if (members)
			parts.push(
				t(members.length === 1 ? 'organizations.users_count_one' : 'organizations.users_count_other', {
					count: members.length
				})
			);
		if (devices)
			parts.push(
				t(devices.length === 1 ? 'organizations.devices_count_one' : 'organizations.devices_count_other', {
					count: devices.length
				})
			);
		if (invitations) {
			const n = openInvitations(invitations);
			parts.push(
				t(n === 1 ? 'organizations.open_invitations_one' : 'organizations.open_invitations_other', {
					count: n
				})
			);
		}
		if (!parts.length) return '';
		let list: string;
		try {
			list = new Intl.ListFormat(i18n.locale, { style: 'long', type: 'conjunction' }).format(parts);
		} catch {
			list = parts.join(', ');
		}
		return t('organizations.side_counts', { list });
	});

	let editing = $state(false);

	const tabs = $derived([
		{ id: 'users', label: t('organizations.users') },
		{ id: 'devices', label: t('organizations.devices') },
		{ id: 'address-book', label: t('organizations.address_book') },
		{ id: 'settings', label: t('organizations.settings') }
	]);
</script>

{#snippet slugValue()}<ValueCopy value={org?.slug} copy={false} />{/snippet}
{#snippet createdValue()}<Time
		value={org?.created_at}
		relative={false}
		format={{ hour: undefined, minute: undefined }}
	/>{/snippet}
{#snippet idValue()}<ValueCopy value={orgId} label={t('organizations.org_id')} />{/snippet}

<div class="page page-wide org-detail-page">
	<div class="page-head">
		<h1>{org?.name || t('organizations.detail')}</h1>
		{#if canEdit && org}
			<div class="page-actions">
				<Button class="edit-org" icon={ICONS.edit} onclick={() => (editing = true)}>{t('common.edit')}</Button
				>
			</div>
		{/if}
		<p class="page-description">{t('organizations.detail_description')}</p>
	</div>

	{#if headerError}
		<States kind="error" message={headerError} onretry={() => void loadAll()} />
	{:else if !org}
		<States kind="loading" />
	{:else}
		{@const o = org}
		<div class="page-cols">
			<div class="page-main">
				<Tabs {tabs} value={tab} label={t('organizations.detail')} onchange={pickTab}>
					{#snippet children(current)}
						<!-- A tab opened once stays mounted (hidden), so unsaved edits survive a look at another tab -->
						<div class="tab-panel" hidden={current !== 'users'}>
							<MembersTab
								{orgId}
								{members}
								{membersError}
								{invitations}
								{invitationsError}
								onmembers={() => void loadMembers()}
								oninvitations={() => void loadInvitations()}
							/>
						</div>
						{#if opened.has('devices')}
							<div class="tab-panel" hidden={current !== 'devices'}>
								<DevicesTab
									org={o}
									{devices}
									{devicesError}
									{members}
									{deviceGroups}
									{userGroups}
									{groupsError}
									ondevices={() => void loadDevices()}
									ongroups={() => void loadGroups()}
								/>
							</div>
						{/if}
						{#if opened.has('address-book')}
							<div class="tab-panel" hidden={current !== 'address-book'}><AddressBookTab {orgId} /></div>
						{/if}
						{#if opened.has('settings')}
							<div class="tab-panel" hidden={current !== 'settings'}>
								<SettingsTab org={o} {canPolicies} />
							</div>
						{/if}
					{/snippet}
				</Tabs>
			</div>

			<aside class="page-side" aria-labelledby="org-details-title">
				<section class="section" aria-labelledby="org-details-title">
					<h2 id="org-details-title">{t('organizations.details_title')}</h2>
					<p class="side-counts" aria-live="polite">{sideCounts}</p>
					<Facts
						items={[
							{ label: t('organizations.slug'), value: slugValue },
							{ label: t('organizations.created'), value: createdValue },
							{ label: t('organizations.logo_url'), value: o.logo_url },
							{ label: t('organizations.org_id'), value: idValue }
						]}
					/>
				</section>

				{#if canPolicies || contracts.length}
					<section class="section" aria-labelledby="org-related-title">
						<h2 id="org-related-title">{t('organizations.related_title')}</h2>
						<RowList>
							{#if canPolicies}
								<ListRow
									title={t('nav.policies')}
									sub={t('organizations.related_policies_sub')}
									href={link(`/policies/${encodeURIComponent(orgId)}`)}
								/>
							{/if}
							{#each contracts as c (c.id)}
								{#snippet contractSub()}{c.target_type === 'org'
										? t('organizations.billing_for_org')
										: t('organizations.billing_for_group', {
												name: c.target_name || c.target_key
											})}{#if c.status},
										<Status
											tone={c.status}
											label={t(`commercialization.status.${c.status}`) ===
											`commercialization.status.${c.status}`
												? c.status
												: t(`commercialization.status.${c.status}`)}
										/>{/if}{/snippet}
								<ListRow
									title={c.package_name || t('organizations.billing_package')}
									sub={contractSub}
									href={link('/commercialization?tab=packages')}
								/>
							{/each}
						</RowList>
					</section>
				{/if}
			</aside>
		</div>
	{/if}
</div>

{#if editing && org}
	<OrgDialog
		{org}
		onclose={() => (editing = false)}
		onsaved={() => {
			editing = false;
			void loadHeader();
		}}
	/>
{/if}

<style>
	/* The column's gap separates the panel from the tabs; this brings it to
	   the same distance as on the other tabbed pages */
	.tab-panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		margin-top: calc(var(--space-5) - var(--space-6));
	}
	.side-counts {
		margin: 0;
	}
	.side-counts:empty {
		display: none;
	}
</style>
