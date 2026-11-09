<!--
  The remote client's start page (/remote): connect by ID, then the device
  list with folders, groups and tags, refreshed every 30 seconds while the
  tab is visible. Connect adds a tab to an open viewer (BroadcastChannel
  "betterdesk-remote") or opens one; on phones the RustDesk app opens
  instead; in the desktop app (Tauri) the app opens the session. Needs a
  console session with device.connect (GET /api/remote/desk, which also
  drops a guest link's cookie, as GET /remote did).
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { ApiError } from '#lib/api/client.ts';
	import { enterDesk } from '#lib/api/remote.ts';
	import { formatDate } from '#lib/i18n/format.ts';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { base, link } from '#lib/nav.ts';
	import { isPhone, viewportWidth } from '#lib/remote/capabilities.ts';
	import { can, startSession, session } from '#lib/state/session.svelte.ts';
	import { poll } from '#lib/state/live.ts';
	import AddressBook from '#lib/remote/AddressBook.svelte';
	import LanguageSelect from '#lib/remote/LanguageSelect.svelte';
	import LinkButton from '#lib/remote/LinkButton.svelte';
	import QuickConnect from '#lib/remote/QuickConnect.svelte';
	import RemoteBrand from '#lib/remote/RemoteBrand.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { readPref, writePref } from '#lib/util/storage.ts';

	const VIEW_KEY = 'rd-desk-view';
	const REFRESH_MS = 30_000;

	type Phase = 'starting' | 'ready' | 'denied' | 'error';
	let phase = $state<Phase>('starting');
	let phone = $state(false);
	let view = $state<'list' | 'grid'>(readPref(VIEW_KEY) === 'grid' ? 'grid' : 'list');
	let reload = $state(0);
	let lastSync = $state<Date | null>(null);
	let syncFailed = $state(false);

	interface TauriWindow {
		__BETTERDESK_RDCLIENT_DESKTOP__?: boolean;
		__TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } };
	}
	const tauri = () => (window as unknown as TauriWindow).__TAURI__?.core?.invoke ?? null;
	const desktop = $derived(
		typeof window !== 'undefined' &&
			(!!(window as unknown as TauriWindow).__BETTERDESK_RDCLIENT_DESKTOP__ || !!tauri())
	);

	const user = $derived(session.raw?.user.username ?? '');
	const branding = $derived(session.raw?.branding ?? null);

	/** A wide table can widen the layout viewport on a phone, so the screen width counts too */
	function checkPhone(): boolean {
		if (isPhone()) return true;
		const fine = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
		return !fine && window.screen?.width > 0 && window.screen.width <= 767 && viewportWidth() > 0;
	}

	function openInApp(id: string) {
		location.href = `rustdesk://${encodeURIComponent(id)}`;
	}

	function openViewerTab(id: string) {
		const win = window.open(link(`/remote/${encodeURIComponent(id)}`), '_blank');
		if (!win)
			toast.error(
				tf(
					'remote_dashboard.popup_blocked',
					'The browser blocked the new tab. Allow pop-ups for this site and try again.'
				)
			);
	}

	/** A viewer tab that is already open adds the session as a tab; otherwise open a new one */
	function connect(id: string, name: string) {
		if (phone) return openInApp(id);
		const invoke = tauri();
		if (invoke) {
			invoke('open_session', { deviceId: id, deviceName: name || '' }).catch((err: unknown) => {
				console.error('RdClient desktop session failed:', err);
				toast.error(
					err instanceof Error
						? err.message
						: String(err || tf('remote_dashboard.connect_failed', 'Could not open the remote session.'))
				);
			});
			return;
		}
		if (typeof BroadcastChannel === 'undefined') return openViewerTab(id);
		const bc = new BroadcastChannel('betterdesk-remote');
		let handled = false;
		bc.onmessage = (ev: MessageEvent<{ type?: string }>) => {
			if (ev.data?.type === 'pong' && !handled) {
				handled = true;
				bc.postMessage({ type: 'add-session', deviceId: id, deviceName: name || '' });
				bc.close();
			} else if (ev.data?.type === 'session-added') {
				handled = true;
				bc.close();
			}
		};
		bc.postMessage({ type: 'ping' });
		setTimeout(() => {
			if (handled) return;
			bc.close();
			openViewerTab(id);
		}, 300);
	}

	function onsync(ok: boolean) {
		if (ok) lastSync = new Date();
		syncFailed = !ok;
	}

	const syncText = $derived(
		!lastSync
			? ''
			: syncFailed
				? tf('remote_dashboard.sync_failed_since', 'Could not refresh. The list is from {time}.', {
						time: formatDate(lastSync, {
							hour: '2-digit',
							minute: '2-digit',
							year: undefined,
							month: undefined,
							day: undefined
						})
					})
				: tf('remote_dashboard.updated_at', 'Updated {time}.', {
						time: formatDate(lastSync, {
							hour: '2-digit',
							minute: '2-digit',
							year: undefined,
							month: undefined,
							day: undefined
						})
					})
	);

	async function start() {
		phase = 'starting';
		try {
			if (!session.ready) await startSession();
			// No request the server would refuse: roles without device.connect see why at once
			if (!can('device.connect')) {
				phase = 'denied';
				return;
			}
			await enterDesk();
			phase = 'ready';
		} catch (err) {
			if (err instanceof ApiError && err.status === 401) {
				location.assign(
					`${base}/remote/login?return=${encodeURIComponent(location.pathname + location.search)}`
				);
				return;
			}
			phase = err instanceof ApiError && err.status === 403 ? 'denied' : 'error';
		}
	}

	onMount(() => {
		phone = checkPhone();
		const onResize = () => (phone = checkPhone());
		window.addEventListener('resize', onResize, { passive: true });
		window.addEventListener('betterdesk:posture-change', onResize);
		void start();
		// Background refresh every 30 s while the tab is visible (AddressBook loads the first time itself)
		const stop = poll(
			async () => {
				if (phase === 'ready') reload++;
			},
			{ every: REFRESH_MS, immediate: false }
		);
		return () => {
			stop();
			window.removeEventListener('resize', onResize);
			window.removeEventListener('betterdesk:posture-change', onResize);
		};
	});
</script>

<svelte:head>
	<title>{tf('nav.remote', 'Remote')} - {session.appName}</title>
</svelte:head>

<div class={['desk', desktop && 'is-desktop']}>
	<header class="desk-header">
		<a class="desk-brand" href={link('/devices')}><RemoteBrand appName={session.appName} {branding} /></a>
		<div class="desk-actions">
			{#if user}<span class="desk-user">{user}</span>{/if}
			<LanguageSelect />
			{#if desktop}
				<Button onclick={() => void tauri()?.('open_settings').catch(() => {})}
					>{tf('remote_dashboard.open_settings', 'Settings')}</Button
				>
			{/if}
			<LinkButton variant="ghost" href={link('/devices')} target="_blank" rel="noopener noreferrer"
				>{tf('remote_dashboard.open_panel', 'Open console')}</LinkButton
			>
		</div>
	</header>

	<main class="page page-wide desk-page">
		{#if phase === 'denied'}
			<div class="page-head">
				<h1>{tf('errors.forbidden_title', 'Access denied')}</h1>
				<p class="page-description">
					{tf('errors.forbidden_message', 'You do not have permission to access this page.')}
				</p>
			</div>
			<div>
				<LinkButton variant="primary" href={link('/')}
					>{tf('errors.go_home', 'Go to the overview')}</LinkButton
				>
			</div>
		{:else if phase === 'error'}
			<div class="page-head">
				<h1>{tf('nav.remote', 'Remote')}</h1>
			</div>
			<p class="start-error" role="alert">{tf('shell.start_failed', 'The console could not start.')}</p>
			<div><Button onclick={() => void start()}>{tf('errors.try_again', 'Try again')}</Button></div>
		{:else if phase === 'ready'}
			<div class="desk-top">
				<div class="page-head">
					<h1>{tf('nav.remote', 'Remote')}</h1>
					<p class="page-description">
						{tf('remote_dashboard.page_description', 'Connect to a device in this browser.')}
					</p>
				</div>
				<section class="desk-quick" aria-label={tf('remote_dashboard.quick_connect_title', 'Connect by ID')}>
					<QuickConnect
						{phone}
						hint={tf(
							'remote_dashboard.quick_connect_hint',
							'The ID shown in the RustDesk app on the device.'
						)}
						onconnect={(id) => connect(id, id)}
						onapp={desktop ? null : openInApp}
					/>
				</section>
			</div>

			{#if phone}
				<Notice tone="warning"
					>{tf(
						'remote_dashboard.phone_note',
						'The web viewer needs a larger screen. On this phone, devices open in the RustDesk app.'
					)}</Notice
				>
			{/if}

			<AddressBook
				bind:view
				{phone}
				{reload}
				onconnect={connect}
				onviewchange={(v) => writePref(VIEW_KEY, v)}
				{onsync}
				{syncText}
				{syncFailed}
			/>
		{/if}
	</main>
</div>

<style>
	.desk {
		min-height: 100vh;
		min-height: 100dvh;
		background: var(--bg);
	}
	.desk-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		min-height: var(--topbar-h);
		padding: 0 var(--page-pad);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.desk-brand {
		display: inline-flex;
		min-width: 0;
		color: var(--text);
		text-decoration: none;
	}
	.desk-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: flex-end;
		gap: var(--space-2) var(--space-3);
	}
	.desk-user {
		color: var(--text-muted);
	}
	.desk-page {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-5) var(--page-pad) var(--space-7);
	}
	/* From 1100 px the title and the quick connect share the first line */
	.desk-top {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	@media (min-width: 1100px) {
		.desk-top {
			flex-direction: row;
			align-items: flex-end;
			justify-content: space-between;
		}
		.desk-quick {
			flex: 0 1 34rem;
		}
	}
	.desk-top .page-head {
		margin: 0;
	}
	.start-error {
		color: var(--danger);
	}
	@media (max-width: 640px) {
		.desk-user {
			display: none;
		}
	}
</style>
