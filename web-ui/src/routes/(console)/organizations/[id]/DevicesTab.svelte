<!--
  Devices tab: the devices assigned to the organization (each opens in the
  device list's panel), and the device groups and user groups linked to it
  (team ID = organization ID). org.manage_devices assigns and removes
  devices; device.edit creates a linked device group.
-->
<script lang="ts">
	import { saveDeviceGroup } from '#lib/api/devices.ts';
	import {
		unassignOrgDevice,
		type OrgDevice,
		type OrgDeviceGroup,
		type OrgUser,
		type OrgUserGroup,
		type Organization
	} from '#lib/api/orgs.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import User from '#lib/ui/User.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import AssignDeviceDialog from './AssignDeviceDialog.svelte';

	interface Props {
		org: Organization;
		devices: OrgDevice[] | null;
		devicesError: string | null;
		members: OrgUser[] | null;
		deviceGroups: OrgDeviceGroup[] | null;
		userGroups: OrgUserGroup[];
		groupsError: string | null;
		ondevices: () => void;
		ongroups: () => void;
	}

	let {
		org,
		devices,
		devicesError,
		members,
		deviceGroups,
		userGroups,
		groupsError,
		ondevices,
		ongroups
	}: Props = $props();

	const canDevices = can('org.manage_devices');
	const canGroups = can('device.edit');

	let assigning = $state(false);

	function userName(id: string): string {
		const u = (members ?? []).find((m) => m.id === id);
		return u ? u.display_name || u.username : id;
	}

	async function unassign(d: OrgDevice) {
		const ok = await confirm({
			title: t('organizations.remove_from_org'),
			message: t('organizations.confirm_unassign_named', { id: d.device_id }),
			confirmLabel: t('organizations.remove_from_org'),
			confirmIcon: ICONS.unlink,
			danger: true
		});
		if (!ok) return;
		try {
			await unassignOrgDevice(org.id, d.device_id);
			toast.success(t('organizations.device_unassigned'));
			ondevices();
		} catch (err) {
			toast.error(`${t('organizations.remove_failed')} ${err instanceof Error ? err.message : ''}`.trim());
		}
	}

	async function createGroup() {
		const name = await prompt({
			title: t('organizations.create_org_device_group'),
			label: t('organizations.group_name'),
			value: org.name ? `${org.name}, ${t('organizations.group_devices_suffix')}` : '',
			hint: t('organizations.link_team_id_hint'),
			required: true,
			confirmLabel: t('actions.create')
		});
		if (name === null) return;
		if (!name.trim()) {
			toast.error(t('organizations.group_name_required'));
			return;
		}
		try {
			await saveDeviceGroup({
				guid: '',
				name: name.trim(),
				source_type: 'manual',
				tag_filter: '',
				allowed_users: '',
				allowed_groups: [],
				team_id: org.id
			});
			toast.success(t('organizations.org_device_group_created'));
			ongroups();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : t('errors.server_error'));
		}
	}

	const deviceColumns = $derived<Column<OrgDevice>[]>([
		{ id: 'device_id', label: t('organizations.device_id'), cell: idCell, sortValue: (d) => d.device_id },
		{
			id: 'department',
			label: t('organizations.department'),
			cell: deptCell,
			sortValue: (d) => d.department
		},
		{ id: 'building', label: t('organizations.building'), cell: buildingCell, sortValue: (d) => d.building },
		{ id: 'location', label: t('organizations.location'), cell: locationCell, sortValue: (d) => d.location },
		{ id: 'assigned', label: t('organizations.assigned_user'), cell: assignedCell },
		...(canDevices
			? [
					{
						id: 'actions',
						label: t('organizations.actions'),
						labelHidden: true,
						cell: deviceMenu,
						align: 'actions' as const
					}
				]
			: [])
	]);

	const groupColumns = $derived<Column<OrgDeviceGroup>[]>([
		{ id: 'name', label: t('organizations.group_name'), cell: groupNameCell, sortValue: (g) => g.name },
		{ id: 'type', label: t('organizations.group_type'), cell: groupTypeCell },
		{
			id: 'members',
			label: t('organizations.group_members'),
			cell: groupCountCell,
			align: 'num',
			sortValue: (g) => g.member_count
		},
		{ id: 'allowed', label: t('organizations.group_allowed_user_groups'), cell: allowedCell }
	]);

	const userGroupColumns = $derived<Column<OrgUserGroup>[]>([
		{ id: 'name', label: t('organizations.group_name'), cell: userGroupNameCell, sortValue: (g) => g.name },
		{
			id: 'members',
			label: t('organizations.group_user_members'),
			cell: userGroupCountCell,
			align: 'num',
			sortValue: (g) => g.member_count
		}
	]);
</script>

{#snippet text(v: string)}{#if v}{v}{:else}<Empty />{/if}{/snippet}

{#snippet idCell(d: OrgDevice)}<a class="mono" href={link(`/devices?open=${encodeURIComponent(d.device_id)}`)}
		>{d.device_id}</a
	>{/snippet}
{#snippet deptCell(d: OrgDevice)}{@render text(d.department)}{/snippet}
{#snippet buildingCell(d: OrgDevice)}{@render text(d.building)}{/snippet}
{#snippet locationCell(d: OrgDevice)}{@render text(d.location)}{/snippet}
{#snippet assignedCell(d: OrgDevice)}{#if d.assigned_user_id}<User
			user={userName(d.assigned_user_id)}
		/>{:else}<Empty />{/if}{/snippet}
{#snippet deviceMenu(d: OrgDevice)}<MenuButton
		kebab
		label={t('organizations.actions_for', { name: d.device_id })}
	>
		<MenuItem class="act-unassign" icon={ICONS.unlink} danger onselect={() => void unassign(d)}
			>{t('organizations.remove_from_org')}</MenuItem
		>
	</MenuButton>{/snippet}

{#snippet groupNameCell(g: OrgDeviceGroup)}<strong>{g.name || g.guid}</strong>{#if g.note}<span
			class="cell-sub">{g.note}</span
		>{/if}{/snippet}
{#snippet groupTypeCell(g: OrgDeviceGroup)}<Tag
		label={(g.source_type || 'manual') === 'tag' && g.tag_filter
			? `${t('organizations.group_type_tag')}: ${g.tag_filter}`
			: t('organizations.group_type_manual')}
	/>{/snippet}
{#snippet groupCountCell(g: OrgDeviceGroup)}{formatNumber(g.member_count)}{/snippet}
{#snippet allowedCell(g: OrgDeviceGroup)}{@render text(
		g.allowed_user_groups
			.map((u) => u.name || u.guid)
			.filter(Boolean)
			.join(', ')
	)}{/snippet}
{#snippet userGroupNameCell(g: OrgUserGroup)}<strong>{g.name || g.guid}</strong>{#if g.note}<span
			class="cell-sub">{g.note}</span
		>{/if}{/snippet}
{#snippet userGroupCountCell(g: OrgUserGroup)}{formatNumber(g.member_count)}{/snippet}

<section class="section" aria-label={t('organizations.devices')}>
	{#if canDevices}
		<div class="section-head">
			<Button class="assign-device" variant="primary" icon={ICONS.add} onclick={() => (assigning = true)}
				>{t('organizations.assign_device')}</Button
			>
		</div>
	{/if}
	{#if devicesError}
		<States kind="error" message={devicesError} onretry={ondevices} />
	{:else if devices && !devices.length}
		<States message={t('organizations.no_devices')} />
	{:else}
		<Table
			rows={devices ?? []}
			columns={deviceColumns}
			key={(d) => d.device_id}
			label={t('organizations.devices')}
			loading={!devices}
		/>
	{/if}
</section>

<section class="section" id="section-device-groups" aria-labelledby="org-groups-title">
	<div class="section-head">
		<h2 id="org-groups-title">{t('organizations.device_groups_tab')}</h2>
		<a href={link('/devices')}>{t('organizations.manage_in_devices')}</a>
	</div>
	<p class="section-note">{t('organizations.device_groups_intro')}</p>
	{#if groupsError}
		<States kind="error" message={groupsError} onretry={ongroups} />
	{:else if !deviceGroups}
		<States kind="loading" />
	{:else}
		<div class="group-head">
			{#if !deviceGroups.length}<p class="none">{t('organizations.no_org_device_groups')}</p>{/if}
			{#if canGroups}
				<Button class="create-group" icon={ICONS.add} onclick={() => void createGroup()}
					>{t('organizations.create_org_device_group')}</Button
				>
			{/if}
		</div>
		{#if deviceGroups.length}
			<Table
				rows={deviceGroups}
				columns={groupColumns}
				key={(g) => g.guid}
				label={t('organizations.device_groups_tab')}
			/>
		{/if}
	{/if}
</section>

{#if deviceGroups}
	<section class="section" aria-labelledby="org-user-groups-title">
		<h3 id="org-user-groups-title">{t('organizations.org_user_groups_title')}</h3>
		<p class="section-note">{t('organizations.org_user_groups_intro')}</p>
		{#if userGroups.length}
			<Table
				rows={userGroups}
				columns={userGroupColumns}
				key={(g) => g.guid}
				label={t('organizations.org_user_groups_title')}
			/>
		{:else}
			<States message={t('organizations.no_org_user_groups')} />
		{/if}
	</section>
{/if}

{#if assigning}
	<AssignDeviceDialog
		orgId={org.id}
		onclose={() => (assigning = false)}
		onsaved={() => {
			assigning = false;
			ondevices();
		}}
	/>
{/if}

<style>
	.section :global(.cell-sub) {
		display: block;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 400;
	}
	.group-head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.none {
		margin: 0 auto 0 0;
		margin-inline: 0 auto;
		color: var(--text-muted);
	}
</style>
