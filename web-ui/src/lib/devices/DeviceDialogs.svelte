<!--
  Shows the device dialogs and sheets the actions open (ask.svelte.ts).
  ask() mounts this once, on first use.
-->
<script lang="ts">
	import { askRequests } from './ask.svelte.ts';
	import BanDialog from './dialogs/BanDialog.svelte';
	import DeleteDialog from './dialogs/DeleteDialog.svelte';
	import ConnectChoiceDialog from './dialogs/ConnectChoiceDialog.svelte';
	import GuestLinkDialog from './dialogs/GuestLinkDialog.svelte';
	import MeshShareDialog from './dialogs/MeshShareDialog.svelte';
	import MeshCommandDialog from './dialogs/MeshCommandDialog.svelte';
	import LinkPeerDialog from './dialogs/LinkPeerDialog.svelte';
	import MembershipsDialog from './dialogs/MembershipsDialog.svelte';
	import MoveFolderDialog from './dialogs/MoveFolderDialog.svelte';
	import TagsDialog from './dialogs/TagsDialog.svelte';
	import AccessPolicySheet from './dialogs/AccessPolicySheet.svelte';
	import RemoteTargetSheet from './dialogs/RemoteTargetSheet.svelte';
	import MeshTerminalSheet from './dialogs/MeshTerminalSheet.svelte';
	import PortRelaySheet from './dialogs/PortRelaySheet.svelte';
</script>

{#each askRequests.items as r (r.id)}
	{#if r.kind === 'ban'}
		<BanDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'delete'}
		<DeleteDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'connect-choice'}
		<ConnectChoiceDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'guest-link'}
		<GuestLinkDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'mesh-share'}
		<MeshShareDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'mesh-command'}
		<MeshCommandDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'link-peer'}
		<LinkPeerDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'memberships'}
		<MembershipsDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'move-folder'}
		<MoveFolderDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'tags'}
		<TagsDialog {...r.props} settle={r.settle} />
	{:else if r.kind === 'access-policy'}
		<AccessPolicySheet {...r.props} settle={r.settle} />
	{:else if r.kind === 'remote-target'}
		<RemoteTargetSheet {...r.props} settle={r.settle} />
	{:else if r.kind === 'mesh-terminal'}
		<MeshTerminalSheet {...r.props} settle={r.settle} />
	{:else if r.kind === 'port-relay'}
		<PortRelaySheet {...r.props} settle={r.settle} />
	{/if}
{/each}
