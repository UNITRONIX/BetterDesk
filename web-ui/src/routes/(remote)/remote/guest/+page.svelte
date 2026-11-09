<!--
  Guest access link (/remote/guest?t=<token>): the devices one link allows,
  until when, and whether the guest may control them or only watch. No
  console session, no quick connect, no folders. GET /api/remote/guest-info
  checks the token (query or the guest cookie) and keeps it in the cookie;
  each Connect opens /remote/<id>?guest=<token>.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getGuestInfo, type GuestDevice, type GuestInfo } from '#lib/api/remote.ts';
	import { formatDate } from '#lib/i18n/format.ts';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import { guestTokenFromSearch } from '#lib/remote/access.ts';
	import { setLanguages } from '#lib/remote/boot.ts';
	import LinkButton from '#lib/remote/LinkButton.svelte';
	import RemoteBrand from '#lib/remote/RemoteBrand.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Table from '#lib/ui/Table.svelte';
	import type { Column } from '#lib/ui/table.ts';

	let info = $state.raw<GuestInfo | null>(null);
	let failed = $state(false);

	const ok = $derived(info?.success ? info : null);
	const page = $derived(info?.page ?? null);
	const expiry = $derived.by(() => {
		const at = ok?.guest.expires_at;
		if (!at) return '';
		const d = new Date(at);
		return Number.isNaN(d.getTime()) ? at : formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
	});

	const name = (d: GuestDevice) => d.display_name || d.hostname || d.id;
	function connectUrl(id: string): string {
		const token = ok?.token ?? '';
		return link(`/remote/${encodeURIComponent(id)}${token ? `?guest=${encodeURIComponent(token)}` : ''}`);
	}

	const columns: Column<GuestDevice>[] = $derived([
		{ id: 'name', label: tf('remote_dashboard.col_name', 'Name'), cell: nameCell, primary: true },
		{ id: 'id', label: tf('remote_dashboard.col_id', 'ID'), cell: idCell },
		{ id: 'status', label: tf('remote_dashboard.col_status', 'Status'), cell: statusCell },
		{
			id: 'actions',
			label: tf('remote.actions', 'Actions'),
			labelHidden: true,
			align: 'actions',
			cell: actionCell
		}
	]);

	onMount(async () => {
		try {
			info = await getGuestInfo(guestTokenFromSearch(location.search));
			if (info.page.languages.length) setLanguages(info.page.languages);
		} catch {
			failed = true;
		}
	});
</script>

{#snippet nameCell(d: GuestDevice)}{name(d)}{/snippet}
{#snippet idCell(d: GuestDevice)}<span class="mono">{d.id}</span>{/snippet}
{#snippet statusCell(d: GuestDevice)}
	<Status
		tone={d.online ? 'good' : 'neutral'}
		label={d.online ? tf('status.online', 'Online') : tf('status.offline', 'Offline')}
	/>
{/snippet}
{#snippet actionCell(d: GuestDevice)}
	<LinkButton
		size="sm"
		href={connectUrl(d.id)}
		aria-label={tf('remote_dashboard.connect_to', 'Connect to {name}', { name: name(d) })}
		>{tf('remote_dashboard.connect', 'Connect')}</LinkButton
	>
{/snippet}

<svelte:head>
	<title>{tf('guest_access.title', 'Guest Remote')} - {page?.appName ?? 'BetterDesk'}</title>
</svelte:head>

<div class="guest">
	<header class="desk-header">
		<span class="desk-brand"
			><RemoteBrand appName={page?.appName ?? 'BetterDesk'} branding={page?.branding ?? null} /></span
		>
	</header>

	<main class="page guest-page">
		{#if info && !info.success}
			<div class="page-head">
				<h1>{tf('guest_access.invalid_title', 'Invalid guest link')}</h1>
				<p class="page-description">{info.error}</p>
			</div>
		{:else}
			<div class="page-head">
				<h1>{tf('guest_access.title', 'Guest Remote')}</h1>
				<p class="page-description">
					{tf('guest_access.subtitle', 'Someone shared these devices with you for a limited time.')}
				</p>
			</div>

			{#if failed}
				<p class="state is-error" role="alert">
					{tf('guest_access.expired', 'This guest link is invalid or expired.')}
				</p>
			{:else if !ok}
				<p class="state">{tf('remote_dashboard.loading', 'Loading devices…')}</p>
			{:else}
				<dl class="facts guest-facts">
					{#if ok.guest.label}
						<dt>{tf('guest_access.fact_link', 'Link')}</dt>
						<dd>{ok.guest.label}</dd>
					{/if}
					<dt>{tf('guest_access.expires', 'Expires')}</dt>
					<dd>{expiry || '—'}</dd>
					<dt>{tf('guest_access.fact_access', 'Access')}</dt>
					<dd>
						{ok.guest.view_only
							? tf('guest_access.access_view_only', 'View only: you can see the screen but not control it.')
							: tf('guest_access.access_full', 'You can see and control the screen.')}
					</dd>
				</dl>

				<section class="section" aria-labelledby="guest-devices">
					<h2 id="guest-devices">{tf('guest_access.devices', 'Devices')}</h2>
					{#if ok.guest.devices.length}
						<Table
							rows={ok.guest.devices}
							{columns}
							key={(d) => d.id}
							label={tf('guest_access.devices', 'Devices')}
						/>
					{:else}
						<p class="state">{tf('guest_access.empty', 'This link does not allow any device.')}</p>
					{/if}
				</section>
			{/if}
		{/if}
	</main>
</div>

<style>
	.guest {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
	}
	.desk-header {
		display: flex;
		align-items: center;
		min-height: var(--topbar-h);
		padding: 0 var(--page-pad);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.desk-brand {
		display: inline-flex;
		min-width: 0;
	}
	.guest-page {
		padding: var(--space-5) var(--page-pad) var(--space-7);
	}
	.guest-facts {
		max-width: var(--measure);
	}
	.state {
		margin: 0;
		color: var(--text-muted);
	}
	.state.is-error {
		color: var(--danger);
	}
</style>
