<!--
  Actions: everything a person may do with this device, as a list (title
  and one line on what it does), delete apart at the end. The old panel's
  actions plus the ones the list's row menu had, so every page with the
  panel offers them. Which ones show: panelActions() in panel-logic.ts;
  what they do: actions.svelte.ts.
-->
<script lang="ts">
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Facts from '#lib/ui/Facts.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { ICONS } from '#lib/util/display.ts';
	import * as actions from '../actions.svelte.ts';
	import { panelActions, type ActionId, type PanelDevice } from '../panel-logic.ts';
	import PanelSection from './PanelSection.svelte';

	interface Props {
		device: PanelDevice;
		/** Runs an action; the panel steps aside while it shows a sheet */
		run: (key: string, fn: () => unknown) => void;
		onedit: () => void;
	}

	let { device, run, onedit }: Props = $props();

	const list = $derived(panelActions(device, can));

	interface Def {
		label: string;
		desc?: string;
		icon: string;
		danger?: boolean;
		go: () => unknown;
	}

	const d = $derived(device);
	const defs = $derived<Record<ActionId, Def>>({
		'connect-web': {
			label: t('device_detail.action_connect_web'),
			desc: t('device_detail.action_connect_web_desc'),
			icon: ICONS.connect,
			go: () => actions.connectInBrowser(d)
		},
		'connect-desktop': {
			label: t('device_detail.action_connect_desktop'),
			desc: t('device_detail.action_connect_desktop_desc'),
			icon: ICONS.connect_app,
			go: () => actions.connectInApp(d)
		},
		'cdap-viewer': {
			label: t('actions.cdap_viewer'),
			desc: tf('device_detail.action_cdap_viewer_desc', 'Pictures of the screen instead of a live stream'),
			icon: ICONS.snapshot,
			go: () => actions.openSnapshotViewer(d)
		},
		'guest-access': {
			label: t('guest_access.menu'),
			desc: tf(
				'device_detail.action_guest_desc',
				'A link that works without a console account, for a limited time'
			),
			icon: ICONS.guest_link,
			go: () => actions.createGuestLink([d])
		},
		'mesh-terminal': {
			label: t('mesh.terminal'),
			desc: tf('device_detail.action_mesh_terminal_desc', 'A shell on the device through its MeshAgent'),
			icon: ICONS.terminal,
			go: () => actions.openMeshTerminal(d)
		},
		'mesh-files': {
			label: t('mesh.files'),
			desc: tf('device_detail.action_mesh_files_desc', "The device's files in the remote viewer"),
			icon: ICONS.files,
			go: () => actions.openMeshFiles(d)
		},
		'mesh-run-command': {
			label: t('mesh.run_command'),
			desc: tf('device_detail.action_mesh_command_desc', 'Run one command on the device'),
			icon: ICONS.run,
			go: () => actions.runMeshCommand(d)
		},
		'mesh-link-peer': {
			label: t('mesh.link_peer'),
			icon: ICONS.link,
			go: () => actions.linkMeshPeer(d)
		},
		'mesh-share': {
			label: t('mesh.share_link'),
			desc: tf('device_detail.action_mesh_share_desc', 'A view-only desktop link that needs no sign-in'),
			icon: ICONS.guest_link,
			go: () => actions.meshShareLink(d)
		},
		'mesh-port-tcp': {
			label: t('mesh.port_tcp'),
			desc: tf('device_detail.action_port_desc', 'Reach a port on the device or in its network'),
			icon: ICONS.network_port,
			go: () => actions.openPortRelay(d, false)
		},
		'mesh-port-udp': {
			label: t('mesh.port_udp'),
			desc: tf('device_detail.action_port_desc', 'Reach a port on the device or in its network'),
			icon: ICONS.network_port,
			go: () => actions.openPortRelay(d, true)
		},
		'mesh-power-wake': {
			label: t('mesh.power_wake'),
			icon: ICONS.power_on,
			go: () => actions.meshPower(d, 'wake')
		},
		'mesh-power-sleep': {
			label: t('mesh.power_sleep'),
			icon: ICONS.sleep,
			go: () => actions.meshPower(d, 'sleep')
		},
		'mesh-power-reset': {
			label: t('mesh.power_reset'),
			icon: ICONS.restart,
			go: () => actions.meshPower(d, 'reset')
		},
		'mesh-power-off': {
			label: t('mesh.power_off'),
			icon: ICONS.power_off,
			go: () => actions.meshPower(d, 'off')
		},
		edit: {
			label: t('actions.edit'),
			desc: tf('device_detail.action_edit_fields_desc', 'Change the name, user, note, folder and tags'),
			icon: ICONS.edit,
			go: onedit
		},
		'edit-target': {
			label: t('devices.remote_edit_title'),
			desc: tf('device_detail.action_edit_target_desc', 'Address, sign-in and security settings'),
			icon: ICONS.edit,
			go: () => actions.editRemoteTarget(d)
		},
		groups: {
			label: t('devices.manage_groups'),
			desc: tf('device_detail.action_groups_desc', 'Put the device in a group or take it out'),
			icon: ICONS.groups,
			go: () => actions.manageGroups(d)
		},
		'access-policy': {
			label: t('devices.access_policy'),
			desc: t('devices.access_policy_desc'),
			icon: ICONS.access_policy,
			go: () => actions.editAccessPolicy(d)
		},
		'change-id': {
			label: t('devices.change_id'),
			desc: t('device_detail.action_change_id_desc'),
			icon: ICONS.rename,
			go: () => actions.changeId(d)
		},
		ban: {
			label: t('actions.ban'),
			desc: t('device_detail.action_ban_desc'),
			icon: ICONS.ban,
			go: () => actions.ban(d)
		},
		unban: {
			label: t('actions.unban'),
			desc: t('device_detail.action_unban_desc'),
			icon: ICONS.unban,
			go: () => actions.unban(d)
		},
		delete: {
			label: t('actions.delete'),
			desc: t('device_detail.action_delete_desc'),
			icon: ICONS.delete,
			danger: true,
			go: () => actions.deleteDevice(d)
		},
		'delete-target': {
			label: t('actions.delete'),
			desc: tf('device_detail.action_delete_target_desc', 'Remove the RDP/VNC target from the list'),
			icon: ICONS.delete,
			danger: true,
			go: () => actions.deleteRemoteTarget(d)
		},
		restore: {
			label: t('devices.restore_action'),
			desc: t('devices.restore_confirm', { id: d.id }),
			icon: ICONS.restore,
			go: () => actions.restoreDevice(d)
		},
		'permanent-delete': {
			label: t('devices.permanent_delete_title'),
			desc: t('devices.permanent_delete_confirm', { id: d.id }),
			icon: ICONS.delete_forever,
			danger: true,
			go: () => actions.permanentDelete(d)
		}
	});
</script>

{#snippet group(ids: ActionId[])}
	<ul class="dp-actions">
		{#each ids as id (id)}
			{@const a = defs[id]}
			<li>
				<button
					type="button"
					class={['dp-action', a.danger && 'is-danger']}
					data-action-key={id}
					onclick={() => run(id, a.go)}
				>
					<Icon name={a.icon} />
					<span class="dp-action-text">
						<span class="dp-action-title">{a.label}</span>
						{#if a.desc}<span class="dp-action-desc">{a.desc}</span>{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

{#if device.soft_deleted}
	<p class="dp-muted">{t('devices.delete_reserved_hint')}</p>
	{#if list.deleted.length}
		<PanelSection title={t('devices.restore_action')}>{@render group(list.deleted)}</PanelSection>
	{/if}
{:else}
	{#if list.connect.length}
		<PanelSection title={t('device_detail.section_connect')}>{@render group(list.connect)}</PanelSection>
	{/if}
	{#if list.support}
		<PanelSection title={t('device_detail.support_mode_title')}>
			<Facts
				items={[
					{ label: t('device_detail.support_scope_label'), value: t('device_detail.support_scope') },
					{ label: t('device_detail.support_limits_label'), value: t('device_detail.support_limits') }
				]}
			/>
		</PanelSection>
	{/if}
	{#if list.mesh.length}
		<PanelSection title={t('mesh.device_type')}>{@render group(list.mesh)}</PanelSection>
	{/if}
	{#if list.manage.length}
		<PanelSection title={t('device_detail.section_manage')}>{@render group(list.manage)}</PanelSection>
	{/if}
	{#if list.danger.length}
		<PanelSection title={t('device_detail.danger_zone')} danger>{@render group(list.danger)}</PanelSection>
	{/if}
{/if}

<style>
	.dp-muted {
		margin: 0;
		color: var(--text-muted);
	}
	.dp-actions {
		margin: 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--rule);
	}
	.dp-actions > li {
		border-bottom: 1px solid var(--rule);
	}
	.dp-action {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		width: 100%;
		min-height: var(--row-h);
		padding: var(--space-2) 0;
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.dp-action > :global(.material-icons) {
		flex: none;
		width: 20px;
		margin-top: 1px;
		color: var(--text-muted);
		font-size: 20px;
	}
	.dp-action-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.dp-action-title {
		color: var(--accent);
		font-weight: 600;
	}
	.dp-action:hover .dp-action-title {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.dp-action-desc {
		color: var(--text-muted);
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.dp-action.is-danger .dp-action-title,
	.dp-action.is-danger > :global(.material-icons) {
		color: var(--danger);
	}
</style>
