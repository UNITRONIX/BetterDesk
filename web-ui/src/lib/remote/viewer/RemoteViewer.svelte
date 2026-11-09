<!--
  The viewer's frame: the session bar (Back, one tab per device, New
  connection, Controls and Full screen while a picture shows), the controls
  row, the stage (the screens and at most one side sheet beside them), the
  New connection dialog, and on tablets the touch toolbar. Phones get the
  "open in the app" page instead (the web viewer needs a larger screen).

  Keyboard: on the remote screen every key goes to the device, Tab
  included. F8 leaves the screen (opens Controls and focuses it, or the
  current tab while there is no picture). F11 toggles full screen. On the
  tabs, arrows, Home and End move and open, Delete closes. Escape closes an
  open sheet; elsewhere it opens Controls while a picture shows.
-->
<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import type { ViewerData } from '#lib/api/remote.ts';
	import { addFromHash, guestTokenFromSearch, isDeviceId } from '#lib/remote/access.ts';
	import { isMobileViewer, isPhone } from '#lib/remote/capabilities.ts';
	import { tabStatus } from '#lib/remote/states.ts';
	import { SHEET_BUTTONS, Viewer } from '#lib/remote/viewer.svelte.ts';
	import AddressBook from '#lib/remote/AddressBook.svelte';
	import LinkButton from '#lib/remote/LinkButton.svelte';
	import QuickConnect from '#lib/remote/QuickConnect.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import ControlsRow from './ControlsRow.svelte';
	import SessionPanel from './SessionPanel.svelte';
	import Sheets from './Sheets.svelte';

	let { data }: { data: ViewerData } = $props();

	const uid = $props.id();
	// The page builds one viewer per load; its data does not change afterwards
	// svelte-ignore state_referenced_locally
	const viewer = new Viewer({ data, onleave: () => returnToDevices() });

	let phone = $state(false);
	let mobile = $state(false);
	let started = false;
	let controlsBtn = $state<HTMLElement | null>(null);
	let specialOpen = $state(false);
	let bridge = $state<HTMLInputElement | null>(null);
	let pickerReload = $state(0);
	let quickInput = $state<HTMLInputElement | null>(null);

	const active = $derived(viewer.active);
	const guestToken = $derived(guestTokenFromSearch(location.search) || data.guestToken);
	const backLabel = $derived(
		viewer.guest
			? tf('guest_access.back_to_list', 'Back to guest devices')
			: tf('remote.back_to_devices', 'Back to devices')
	);

	/* ── Leaving ── */

	interface TauriWindow {
		__BETTERDESK_RDCLIENT_DESKTOP__?: boolean;
		__TAURI__?: {
			core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
			window?: { getCurrentWindow?: () => { close?: () => Promise<unknown> } };
		};
	}

	/**
	 * The viewer opens in its own tab (window.open from the console): close it
	 * and go back to the console tab rather than piling up console tabs; in
	 * the desktop app, close its window. Guests go back to their link's list.
	 */
	function returnToDevices(): void {
		if (viewer.guest) {
			location.assign(
				link(guestToken ? `/remote/guest?t=${encodeURIComponent(guestToken)}` : '/remote/guest')
			);
			return;
		}
		const w = window as unknown as TauriWindow;
		const invoke = w.__TAURI__?.core?.invoke;
		if (invoke) {
			invoke('close_current_window').catch(() => void w.__TAURI__?.window?.getCurrentWindow?.()?.close?.());
			return;
		}
		if (w.__BETTERDESK_RDCLIENT_DESKTOP__) return;
		try {
			if (window.opener && !window.opener.closed) {
				try {
					window.opener.focus();
				} catch {
					/* another origin */
				}
				window.close();
				setTimeout(() => {
					if (!window.closed) location.assign(link('/devices'));
				}, 150);
				return;
			}
		} catch {
			/* opener not reachable */
		}
		location.assign(link('/devices'));
	}

	function back() {
		viewer.closeAll();
		returnToDevices();
	}

	/* ── Tabs ── */

	function onTabKeydown(e: KeyboardEvent, index: number) {
		const list = viewer.sessions;
		const rtl = document.documentElement.dir === 'rtl';
		let next: number;
		switch (e.key) {
			case 'ArrowRight':
				next = rtl ? index - 1 : index + 1;
				break;
			case 'ArrowLeft':
				next = rtl ? index + 1 : index - 1;
				break;
			case 'Home':
				next = 0;
				break;
			case 'End':
				next = list.length - 1;
				break;
			case 'Delete': {
				e.preventDefault();
				e.stopPropagation();
				const neighbour = list[index + 1] ?? list[index - 1];
				const id = list[index]?.deviceId;
				if (id) viewer.close(id);
				if (neighbour) void tick().then(() => focusTab(neighbour.deviceId));
				return;
			}
			default:
				return;
		}
		e.preventDefault();
		e.stopPropagation();
		if (next < 0) next = list.length - 1;
		if (next >= list.length) next = 0;
		const target = list[next];
		if (!target) return;
		viewer.switchTo(target.deviceId);
		void tick().then(() => focusTab(target.deviceId));
	}

	function focusTab(id: string) {
		document.getElementById(`rd-tab-${id}`)?.focus();
	}

	/* ── Controls, full screen ── */

	async function toggleFullscreen() {
		const root = document.documentElement;
		const nav = navigator as Navigator & { keyboard?: { lock?: () => Promise<void>; unlock?: () => void } };
		if (!document.fullscreenElement) {
			await root.requestFullscreen().catch(() => {});
			await nav.keyboard?.lock?.().catch(() => {});
		} else {
			nav.keyboard?.unlock?.();
			await document.exitFullscreen().catch(() => {});
		}
	}

	function toggleControls() {
		if (viewer.controlsShown) {
			viewer.controlsOpen = false;
			viewer.keepOpen = false;
		} else viewer.controlsOpen = true;
		viewer.resize();
	}

	/* ── New connection ── */

	function openPicker() {
		viewer.pickerOpen = true;
		pickerReload++;
		void tick().then(() => quickInput?.focus());
	}

	function connectFromPicker(id: string, name = '') {
		viewer.pickerOpen = false;
		viewer.open(id, name && name !== id ? name : '');
	}

	/* ── Start ── */

	function start() {
		if (started) return;
		started = true;
		const q = new URLSearchParams(location.search);
		viewer.open(data.deviceId, data.device.name, data.device.platform, {
			filesOnConnect: q.get('panel') === 'files'
		});
		if (!viewer.guest) {
			const extra = addFromHash(location.hash);
			if (extra && extra !== data.deviceId) viewer.open(extra);
		}
	}

	function evaluatePhone() {
		phone = isPhone();
		mobile = isMobileViewer();
		if (!phone) start();
	}

	onMount(() => {
		evaluatePhone();
		const onResize = () => {
			evaluatePhone();
			viewer.resize();
		};
		const onOrientation = () => setTimeout(evaluatePhone, 100);
		window.addEventListener('resize', onResize, { passive: true });
		window.visualViewport?.addEventListener('resize', onResize, { passive: true });
		window.addEventListener('orientationchange', onOrientation);
		window.addEventListener('betterdesk:posture-change', evaluatePhone);

		// F8 leaves the remote screen (capture phase: the screen keeps every other key)
		const onF8 = (e: KeyboardEvent) => {
			if (e.key !== 'F8' || e.ctrlKey || e.altKey || e.metaKey) return;
			e.preventDefault();
			e.stopPropagation();
			if (viewer.chromeVisible) {
				viewer.controlsOpen = true;
				void tick().then(() => controlsBtn?.focus());
			} else if (viewer.activeId) focusTab(viewer.activeId);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'F11') {
				e.preventDefault();
				void toggleFullscreen();
				return;
			}
			if (e.key !== 'Escape' || e.defaultPrevented) return;
			const target = e.target as HTMLElement | null;
			if (viewer.sheet && target?.closest?.('#rd-sheet-host')) {
				const was = viewer.sheet;
				viewer.closeSheet();
				void tick().then(() => document.getElementById(SHEET_BUTTONS[was])?.focus());
				return;
			}
			if (!document.fullscreenElement && viewer.chromeVisible && !document.querySelector('[role="dialog"]'))
				viewer.controlsOpen = true;
		};
		const onFullscreen = () => {
			viewer.fullscreen = !!document.fullscreenElement;
			setTimeout(() => viewer.resize(), 100);
		};
		const onFocus = () => void viewer.syncClipboard();
		const onFilesClosed = () => viewer.onFileSheetClosed();
		// Leaving the page ends the sessions (not when it goes into the back-forward cache)
		const onPageHide = (e: PageTransitionEvent) => {
			if (!e.persisted) viewer.teardown();
		};
		window.addEventListener('keydown', onF8, true);
		document.addEventListener('keydown', onKey);
		document.addEventListener('fullscreenchange', onFullscreen);
		window.addEventListener('focus', onFocus);
		document.addEventListener('rd-file-sheet-closed', onFilesClosed);
		window.addEventListener('pagehide', onPageHide, { capture: true });

		// Other console tabs add a session here instead of opening another viewer tab
		let bc: BroadcastChannel | null = null;
		try {
			bc = new BroadcastChannel('betterdesk-remote');
			bc.onmessage = (ev: MessageEvent<unknown>) => {
				const msg = ev.data as { type?: string; deviceId?: string; deviceName?: string } | null;
				if (!msg || typeof msg !== 'object') return;
				if (msg.type === 'add-session' && msg.deviceId) {
					if (!isDeviceId(msg.deviceId) && !/^[A-Za-z0-9_-]+$/.test(msg.deviceId)) return;
					if (phone) return;
					viewer.open(msg.deviceId, msg.deviceName || '');
					bc?.postMessage({ type: 'session-added', deviceId: msg.deviceId });
					window.focus();
				} else if (msg.type === 'ping') bc?.postMessage({ type: 'pong' });
			};
		} catch {
			bc = null;
		}

		return () => {
			window.removeEventListener('resize', onResize);
			window.visualViewport?.removeEventListener('resize', onResize);
			window.removeEventListener('orientationchange', onOrientation);
			window.removeEventListener('betterdesk:posture-change', evaluatePhone);
			window.removeEventListener('keydown', onF8, true);
			document.removeEventListener('keydown', onKey);
			document.removeEventListener('fullscreenchange', onFullscreen);
			window.removeEventListener('focus', onFocus);
			document.removeEventListener('rd-file-sheet-closed', onFilesClosed);
			window.removeEventListener('pagehide', onPageHide, { capture: true });
			bc?.close();
			viewer.teardown();
		};
	});

	// The screen area changes size with the controls row and the side sheet
	function observeSize(node: HTMLElement): (() => void) | undefined {
		if (typeof ResizeObserver !== 'function') return undefined;
		const ro = new ResizeObserver(() => viewer.resize());
		ro.observe(node);
		return () => ro.disconnect();
	}
</script>

{#if phone}
	<main class="phone-gate">
		<div class="phone-card">
			<h1 class="phone-title">{tf('remote_viewer.phone_title', 'The web viewer needs a larger screen')}</h1>
			<p class="phone-body">
				{tf(
					'remote_viewer.phone_body',
					'On a phone, open this device in the RustDesk app. The app has to be installed on the phone.'
				)}
			</p>
			<p class="phone-id mono">{data.deviceId}</p>
			<div class="phone-actions">
				<LinkButton variant="primary" href="rustdesk://{encodeURIComponent(data.deviceId)}"
					>{tf('remote_viewer.open_in_app', 'Open in RustDesk app')}</LinkButton
				>
				<LinkButton href={link('/remote')}
					>{tf('remote_viewer.back_to_list', 'Back to device list')}</LinkButton
				>
			</div>
		</div>
	</main>
{/if}
<!-- Hidden, not removed, under the phone page: running sessions keep their screens -->
<div
	class={['rd-viewer-shell', viewer.sheet && 'has-sheet', mobile && 'is-mobile']}
	id="rd-viewer-shell"
	hidden={phone}
>
	<div class="session-bar">
		<Button variant="ghost" icon="arrow_back" class="bar-btn bar-back" title={backLabel} onclick={back}
			><span class="bar-label">{backLabel}</span></Button
		>
		<div class="session-tabs" role="tablist" aria-label={tf('remote_viewer.open_sessions', 'Open sessions')}>
			{#each viewer.sessions as s, i (s.deviceId)}
				{@const st = tabStatus(s.view)}
				{@const isActive = s.deviceId === viewer.activeId}
				<div class={['session-tab', isActive && 'active']}>
					<button
						type="button"
						class="tab-select"
						id="rd-tab-{s.deviceId}"
						role="tab"
						aria-selected={isActive}
						aria-controls="rd-panel-{s.deviceId}"
						tabindex={isActive ? 0 : -1}
						title="{s.label}{s.label !== s.deviceId ? ` (${s.deviceId})` : ''}, {st.label}"
						onclick={() => viewer.switchTo(s.deviceId)}
						onkeydown={(e) => onTabKeydown(e, i)}
					>
						<span class="tab-dot status is-{st.tone}" aria-hidden="true"></span>
						<span class="tab-label">{s.label}</span>
						<span class="sr-only">, {st.label}</span>
					</button>
					<!-- Pointer users close with the ×; keyboard users press Delete on the tab -->
					<button
						type="button"
						class="tab-close"
						tabindex="-1"
						aria-hidden="true"
						title={tf('remote_viewer.close_tab_named', 'Close {name}', { name: s.label })}
						onclick={(e) => {
							e.stopPropagation();
							viewer.close(s.deviceId);
						}}><Icon name="close" /></button
					>
				</div>
			{/each}
		</div>
		{#if !viewer.guest}
			<Button
				icon="add"
				class="bar-btn"
				title={tf('remote_viewer.new_connection_hint', 'Connect to another device in a new tab')}
				aria-haspopup="dialog"
				onclick={openPicker}
				><span class="bar-label">{tf('remote.new_connection', 'New connection')}</span></Button
			>
		{/if}
		{#if viewer.chromeVisible && !mobile}
			<div class="bar-controls">
				<Button
					icon="tune"
					class="bar-btn"
					bind:element={controlsBtn}
					title={tf('remote_viewer.controls_hint', 'Show or hide the session controls (F8)')}
					aria-expanded={viewer.controlsShown}
					aria-controls="{uid}-controls"
					onclick={toggleControls}
					><span class="bar-label">{tf('remote_viewer.controls', 'Controls')}</span><Icon
						name={viewer.controlsShown ? 'expand_less' : 'expand_more'}
						class="btn-caret"
					/></Button
				>
				<Button
					icon={viewer.fullscreen ? 'fullscreen_exit' : 'fullscreen'}
					class="bar-btn"
					title={`${
						viewer.fullscreen
							? tf('remote_viewer.exit_fullscreen', 'Exit full screen')
							: tf('remote.fullscreen', 'Full screen')
					} (F11)`}
					onclick={() => void toggleFullscreen()}
					><span class="bar-label"
						>{viewer.fullscreen
							? tf('remote_viewer.exit_fullscreen', 'Exit full screen')
							: tf('remote.fullscreen', 'Full screen')}</span
					></Button
				>
			</div>
		{/if}
	</div>

	{#if viewer.controlsShown && !mobile}
		<ControlsRow {viewer} id="{uid}-controls" />
	{/if}

	<div class="rd-stage">
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="viewer-container" {@attach observeSize} onmousedown={() => void viewer.syncClipboard()}>
			{#each viewer.sessions as s (s.deviceId)}
				<SessionPanel {viewer} session={s} active={s.deviceId === viewer.activeId} />
			{/each}
		</div>
		<!-- The side sheet; file-modal.js mounts the file transfer sheet in here too -->
		<div class="rd-sheet-host" id="rd-sheet-host">
			<Sheets
				{viewer}
				onclose={() => {
					const was = viewer.sheet;
					viewer.closeSheet();
					if (was) void tick().then(() => document.getElementById(SHEET_BUTTONS[was])?.focus());
				}}
			/>
		</div>
	</div>
</div>

{#if mobile && !phone && active?.view === 'streaming'}
	<nav class="mobile-bar" aria-label={tf('remote.mobile_toolbar', 'Remote controls')}>
		<button
			type="button"
			class={['mobile-btn', viewer.mobileMode === 'direct' && 'active']}
			aria-pressed={viewer.mobileMode === 'direct'}
			onclick={() => viewer.setMobileMode('direct')}>{tf('remote.input_mode_touch', 'Touch')}</button
		>
		<button
			type="button"
			class={['mobile-btn', viewer.mobileMode === 'touchpad' && 'active']}
			aria-pressed={viewer.mobileMode === 'touchpad'}
			onclick={() => viewer.setMobileMode('touchpad')}>{tf('remote.input_mode_touchpad', 'Touchpad')}</button
		>
		<button
			type="button"
			class="mobile-btn"
			onclick={() => {
				bridge?.removeAttribute('readonly');
				bridge?.focus({ preventScroll: true });
				bridge?.click();
			}}>{tf('remote.show_keyboard', 'Keyboard')}</button
		>
		<button
			type="button"
			class="mobile-btn"
			aria-expanded={specialOpen}
			aria-controls="{uid}-special"
			onclick={() => (specialOpen = !specialOpen)}>{tf('remote.special_keys', 'Special keys')}</button
		>
		<button type="button" class="mobile-btn" onclick={() => viewer.ctrlAltDel()}
			><span translate="no">Ctrl+Alt+Del</span></button
		>
		<button type="button" class="mobile-btn" onclick={() => void toggleFullscreen()}
			>{tf('remote.fullscreen', 'Full screen')}</button
		>
	</nav>
	{#if specialOpen}
		<div
			class="special-keys"
			id="{uid}-special"
			role="group"
			aria-label={tf('remote.special_keys', 'Special keys')}
		>
			{#each [['Meta', 'Win'], ['Alt+Tab', 'Alt+Tab'], ['PrintScreen', ''], ['Escape', 'Esc']] as [key, text] (key)}
				<Button
					onclick={() => {
						viewer.sendSpecialKey(key as 'Meta' | 'Alt+Tab' | 'PrintScreen' | 'Escape');
						specialOpen = false;
					}}
					>{#if text}<span translate="no">{text}</span>{:else}{tf(
							'remote.special_print_screen',
							'Print Screen'
						)}{/if}</Button
				>
			{/each}
		</div>
	{/if}
	<input
		bind:this={bridge}
		class="keyboard-bridge"
		type="text"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		aria-hidden="true"
		tabindex="-1"
		onkeydown={(e) => viewer.keyFromBridge(e)}
		onkeyup={(e) => viewer.keyFromBridge(e)}
	/>
{/if}

{#if viewer.httpWarning}
	<div class="http-warning" role="status">
		<span
			>{tf(
				'remote.http_warning',
				'HTTP mode: limited to H.264 software decode (~15 FPS). Use HTTPS for full performance (WebCodecs, VP9, 60 FPS).'
			)}</span
		>
		<IconButton
			icon="close"
			label={tf('actions.dismiss', 'Dismiss')}
			onclick={() => (viewer.httpWarning = false)}
		/>
	</div>
{/if}

{#if !viewer.guest}
	<Dialog
		bind:open={viewer.pickerOpen}
		title={tf('remote.session_picker.title', 'Choose device')}
		size="large"
		class="picker-dialog"
	>
		<div class="picker">
			<QuickConnect bind:element={quickInput} onconnect={(id) => connectFromPicker(id)} />
			<AddressBook
				compact
				headingLevel={3}
				reload={pickerReload}
				connected={viewer.connectedIds()}
				onconnect={(id, name) => connectFromPicker(id, name)}
			/>
		</div>
	</Dialog>
{/if}

<style>
	:global(:root) {
		--viewer-bar-h: calc(var(--control-h) + 2 * var(--space-1) + 1px);
		--sheet-w: 380px;
		--sheet-w-files: clamp(440px, 42vw, 900px);
		--mobile-bar-h: 52px;
	}
	.rd-viewer-shell[hidden] {
		display: none;
	}
	.rd-viewer-shell {
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100vh;
		height: 100dvh;
		overflow: hidden;
		background: var(--bg);
	}
	.session-bar {
		position: relative;
		z-index: 220;
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--viewer-bar-h);
		padding: 0 var(--space-2);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
		user-select: none;
	}
	.session-bar :global(.bar-btn) {
		flex-shrink: 0;
	}
	.session-bar :global(.bar-back) {
		padding-inline: var(--space-2) var(--space-3);
	}
	.session-bar :global(.bar-back > .material-icons) {
		color: var(--text-muted);
	}
	.session-bar :global(.bar-back:dir(rtl) > .material-icons) {
		transform: scaleX(-1);
	}
	.session-bar :global(.btn-caret) {
		margin-inline-start: -2px;
		color: var(--text-muted);
		font-size: 18px;
	}
	.session-bar :global(.bar-btn[aria-expanded='true']) {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.bar-controls {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: var(--space-2);
	}
	/* Open sessions: the shared tab style (underline on the selected one) */
	.session-tabs {
		display: flex;
		flex: 1;
		align-self: stretch;
		gap: var(--space-1);
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.session-tab {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		max-width: 260px;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
	}
	.session-tab:hover {
		color: var(--text);
	}
	.session-tab.active {
		border-bottom-color: var(--accent);
		color: var(--text);
	}
	.tab-select {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
		height: var(--control-h);
		padding: 0 var(--space-1) 0 var(--space-2);
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: var(--control-weight);
		cursor: pointer;
	}
	.tab-select:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.tab-label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* The tab's status: the data-display mark only (Status tones); the word is in the tab's name */
	.tab-dot {
		display: inline-flex;
		flex-shrink: 0;
	}
	.tab-dot::before {
		content: '';
		box-sizing: border-box;
		width: 8px;
		height: 8px;
		border: 1.5px solid var(--text-muted);
		border-radius: 50%;
		forced-color-adjust: none;
	}
	.tab-dot.is-good::before {
		border-color: var(--success);
		background: var(--success);
	}
	.tab-dot.is-waiting::before {
		width: 8px;
		height: 10px;
		border: 0;
		border-radius: 0;
		background: var(--accent);
		clip-path: polygon(0 0, 100% 0, 62% 50%, 100% 100%, 0 100%, 38% 50%);
	}
	.tab-dot.is-danger::before {
		border-color: var(--danger);
		border-radius: 1px;
		background: var(--danger);
	}
	.tab-close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		margin-inline-end: var(--space-1);
		padding: 0;
		border: 0;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.tab-close :global(.material-icons) {
		font-size: 18px;
	}
	.tab-close:hover {
		background: var(--hover);
		color: var(--text);
	}
	.rd-stage {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}
	/* The letterbox around the remote picture stays black in every theme */
	.viewer-container {
		position: relative;
		flex: 1;
		min-width: 0;
		overflow: hidden;
		background: #000000;
	}
	.rd-sheet-host {
		display: flex;
		flex: none;
		min-height: 0;
	}
	/* Narrower windows: the bar keeps its icons, the words move into the
	   tooltip and the accessible name (visually hidden, not removed) */
	@media (max-width: 1100px) {
		.session-bar :global(.bar-label) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
			white-space: nowrap;
		}
		.session-bar :global(.bar-btn) {
			width: var(--control-h);
			padding: 0;
		}
		.session-bar :global(.bar-btn .btn-caret) {
			display: none;
		}
	}
	@media (max-width: 900px) {
		.session-tab {
			max-width: 180px;
		}
	}
	/* Below 900 px the sheet lies over the screen's end instead of narrowing it */
	@media (max-width: 899px) {
		.rd-sheet-host {
			position: absolute;
			inset-block: 0;
			inset-inline-end: 0;
			z-index: 160;
			max-width: 100%;
		}
	}

	/* ── The wrapped file transfer sheet (public/js/rdclient/file-modal.js builds its own DOM) ── */
	.rd-sheet-host :global(.file-transfer-modal-overlay) {
		display: flex;
		flex-direction: column;
		width: var(--sheet-w-files);
		max-width: 100vw;
		min-height: 0;
		border-inline-start: 1px solid var(--rule);
		background: var(--bg);
		container-type: inline-size;
	}
	.rd-sheet-host :global(.file-transfer-modal) {
		position: relative;
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		color: var(--text);
		overflow: hidden;
	}
	.rd-sheet-host :global(.ft-modal-header) {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-3);
		min-height: var(--viewer-bar-h);
		padding: 0 var(--space-2) 0 var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	.rd-sheet-host :global(.ft-modal-title) {
		flex: 1;
		min-width: 0;
		margin: 0;
		overflow: hidden;
		font-size: var(--text-md);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-modal-body) {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1.4fr) minmax(0, 1fr) auto;
		min-height: 0;
	}
	.rd-sheet-host :global(.ft-pane-remote) {
		order: 1;
	}
	.rd-sheet-host :global(.ft-pane-local) {
		order: 2;
	}
	.rd-sheet-host :global(.ft-pane-queue) {
		order: 3;
		max-height: 200px;
		border-bottom: 0;
	}
	@container (min-width: 720px) {
		.rd-sheet-host :global(.ft-modal-body) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) auto;
		}
		.rd-sheet-host :global(.ft-pane-local) {
			order: 1;
			border-inline-end: 1px solid var(--rule);
		}
		.rd-sheet-host :global(.ft-pane-remote) {
			order: 2;
		}
		.rd-sheet-host :global(.ft-pane-queue) {
			grid-column: 1 / -1;
		}
	}
	.rd-sheet-host :global(.ft-pane) {
		position: relative;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		border-bottom: 1px solid var(--rule);
	}
	.rd-sheet-host :global(.ft-pane-head) {
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--rule);
		font-weight: 600;
	}
	.rd-sheet-host :global(.ft-pane-toolbar) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	/* The sheet's buttons: the console's button look (components.css .btn, .btn-sm, .icon-btn) */
	.rd-sheet-host :global(.file-transfer-modal .btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: var(--control-h-sm);
		padding: 0 var(--control-pad-x-sm);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: var(--control-weight);
		line-height: var(--control-leading);
		white-space: nowrap;
		cursor: pointer;
	}
	.rd-sheet-host :global(.file-transfer-modal .btn:hover) {
		background: var(--hover);
	}
	.rd-sheet-host :global(.file-transfer-modal .btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.rd-sheet-host :global(.file-transfer-modal .btn-primary) {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.rd-sheet-host :global(.file-transfer-modal .btn-primary:hover) {
		border-color: var(--accent-hover);
		background: var(--accent-hover);
	}
	.rd-sheet-host :global(.file-transfer-modal .btn:focus-visible),
	.rd-sheet-host :global(.file-transfer-modal .icon-btn:focus-visible),
	.rd-sheet-host :global(.ft-local-dropzone:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	.rd-sheet-host :global(.file-transfer-modal .icon-btn) {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--icon-btn-size);
		height: var(--icon-btn-size);
		padding: 0;
		border: 1px solid transparent;
		border-radius: var(--control-radius);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
	.rd-sheet-host :global(.file-transfer-modal .icon-btn:hover) {
		background: var(--hover);
		color: var(--text);
	}
	.rd-sheet-host :global(.file-transfer-modal .icon-btn > .material-icons) {
		font-size: var(--icon-btn-glyph);
	}
	.rd-sheet-host :global(.ft-btn.active) {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.rd-sheet-host :global(.ft-btn-action) {
		margin-inline-start: auto;
	}
	.rd-sheet-host :global(.ft-path) {
		flex-basis: 100%;
		order: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-muted);
		font-family: var(--mono);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-path:empty) {
		display: none;
	}
	.rd-sheet-host :global(.ft-local-body) {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}
	.rd-sheet-host :global(.ft-list) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.rd-sheet-host :global(.ft-row) {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-3);
		border-bottom: 1px solid var(--rule);
		cursor: pointer;
	}
	.rd-sheet-host :global(.ft-row:focus-visible) {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.rd-sheet-host :global(.ft-row:hover) {
		background: var(--bg-subtle);
	}
	.rd-sheet-host :global(.ft-row.selected) {
		background: var(--accent-tint);
	}
	.rd-sheet-host :global(.ft-row-icon) {
		color: var(--text-muted);
	}
	.rd-sheet-host :global(.ft-row-name) {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-row-dir .ft-row-name) {
		font-weight: 600;
	}
	.rd-sheet-host :global(.ft-row-size) {
		flex-shrink: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-variant-numeric: tabular-nums;
	}
	.rd-sheet-host :global(.ft-empty) {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-3);
		color: var(--text-muted);
	}
	.rd-sheet-host :global(.ft-empty .material-icons),
	.rd-sheet-host :global(.ft-queue-empty .material-icons),
	.rd-sheet-host :global(.ft-transfer-icon),
	.rd-sheet-host :global(.ft-context-item .material-icons) {
		display: none;
	}
	.rd-sheet-host :global(.ft-empty.ft-error) {
		color: var(--danger);
	}
	.rd-sheet-host :global(.ft-local-dropzone) {
		display: flex;
		flex: 1;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 160px;
		margin: var(--space-3);
		padding: var(--space-4);
		border: 1px dashed var(--border);
		border-radius: var(--radius);
		text-align: center;
		cursor: pointer;
		user-select: none;
	}
	.rd-sheet-host :global(.ft-local-dropzone.compact) {
		flex: 0 0 auto;
		min-height: 0;
		margin: var(--space-2) var(--space-3);
		padding: var(--space-2) var(--space-3);
	}
	.rd-sheet-host :global(.ft-local-dropzone.compact .ft-dropzone-subtitle),
	.rd-sheet-host :global(.ft-local-dropzone.compact .ft-dropzone-multiple) {
		display: none;
	}
	.rd-sheet-host :global(.ft-local-dropzone:hover:not(.ft-dropzone-disabled)),
	.rd-sheet-host :global(.ft-local-dropzone.ft-dropzone-active) {
		border-color: var(--accent);
		background: var(--accent-tint);
	}
	.rd-sheet-host :global(.ft-local-dropzone.ft-dropzone-disabled) {
		color: var(--text-muted);
		cursor: not-allowed;
	}
	.rd-sheet-host :global(.ft-dropzone-title) {
		font-weight: 600;
	}
	.rd-sheet-host :global(:is(.ft-dropzone-subtitle, .ft-dropzone-multiple, .ft-dropzone-target)) {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.rd-sheet-host :global(.ft-dropzone-target) {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-pane-remote.ft-drag-over) {
		outline: 2px dashed var(--accent);
		outline-offset: -4px;
	}
	.rd-sheet-host :global(.ft-drop-overlay) {
		position: absolute;
		inset: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background: var(--bg-float);
		font-weight: 600;
		text-align: center;
		pointer-events: none;
	}
	.rd-sheet-host :global(.ft-drop-overlay[hidden]) {
		display: none;
	}
	.rd-sheet-host :global(.ft-queue-list) {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.rd-sheet-host :global(.ft-queue-empty) {
		padding: var(--space-4) var(--space-3);
		color: var(--text-muted);
	}
	.rd-sheet-host :global(.ft-transfer-row) {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--rule);
	}
	.rd-sheet-host :global(.ft-transfer-info) {
		flex: 1;
		min-width: 0;
	}
	.rd-sheet-host :global(.ft-transfer-name) {
		margin-bottom: var(--space-1);
		overflow: hidden;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-transfer-folder-tag) {
		color: var(--text-muted);
		font-weight: 400;
	}
	.rd-sheet-host :global(.ft-transfer-bar) {
		height: 6px;
		margin-bottom: var(--space-1);
		border-radius: 1px;
		background: var(--hover);
		overflow: hidden;
	}
	.rd-sheet-host :global(.ft-transfer-fill) {
		width: 0;
		height: 100%;
		background: var(--accent);
		transition: width var(--motion);
	}
	.rd-sheet-host :global(.ft-transfer-fill.indeterminate) {
		width: 30%;
		background: var(--text-muted);
	}
	.rd-sheet-host :global(.ft-transfer-status) {
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rd-sheet-host :global(.ft-transfer-row.done .ft-transfer-status) {
		color: var(--success);
	}
	.rd-sheet-host :global(.ft-transfer-row.error .ft-transfer-status) {
		color: var(--danger);
	}
	.rd-sheet-host :global(.ft-overwrite-dialog) {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-4);
		background: rgba(0, 0, 0, 0.45);
	}
	.rd-sheet-host :global(.ft-overwrite-dialog[hidden]) {
		display: none;
	}
	.rd-sheet-host :global(.ft-overwrite-panel) {
		width: min(420px, 100%);
		padding: var(--space-5);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
	}
	.rd-sheet-host :global(.ft-overwrite-title) {
		margin-bottom: var(--space-2);
		font-size: var(--text-md);
		font-weight: 600;
	}
	.rd-sheet-host :global(.ft-overwrite-message) {
		margin-bottom: var(--space-4);
		color: var(--text-muted);
	}
	.rd-sheet-host :global(.ft-overwrite-actions) {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: var(--space-2);
	}
	/* The file list's context menu is placed on <body>-level coordinates */
	:global(.ft-context-menu) {
		position: fixed;
		z-index: 310;
		min-width: 180px;
		padding: var(--space-1) 0;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
	}
	:global(.ft-context-item) {
		display: flex;
		align-items: center;
		width: 100%;
		min-height: var(--control-h);
		padding: var(--space-1) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--text);
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	:global(.ft-context-item:hover),
	:global(.ft-context-item:focus-visible) {
		background: var(--hover);
	}

	/* ── Phones ── */
	.phone-gate {
		display: flex;
		justify-content: center;
		min-height: 100vh;
		min-height: 100dvh;
		padding: var(--space-6) var(--space-4);
		background: var(--bg);
	}
	.phone-card {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		max-width: 400px;
	}
	.phone-title {
		margin: 0;
		font-size: var(--text-lg);
	}
	.phone-body {
		margin: 0;
		color: var(--text-muted);
	}
	.phone-id {
		margin: 0;
		font-size: var(--text-md);
	}
	.phone-actions {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	/* ── Tablets with touch: input mode and keys along the bottom ── */
	.rd-viewer-shell.is-mobile {
		height: calc(100dvh - var(--mobile-bar-h));
	}
	.mobile-bar {
		position: fixed;
		inset-inline: 0;
		bottom: 0;
		z-index: 1000;
		display: flex;
		align-items: stretch;
		height: var(--mobile-bar-h);
		border-top: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.mobile-btn {
		flex: 1;
		min-width: 44px;
		min-height: 44px;
		padding: 0 var(--space-1);
		border: 0;
		border-top: 2px solid transparent;
		background: transparent;
		color: var(--text);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.mobile-btn.active {
		border-top-color: var(--accent);
		font-weight: 600;
	}
	.mobile-btn:focus-visible {
		outline: var(--focus-ring);
		outline-offset: -2px;
	}
	.special-keys {
		position: fixed;
		inset-inline: 0;
		bottom: var(--mobile-bar-h);
		z-index: 1001;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: var(--space-3);
		border-top: 1px solid var(--rule);
		background: var(--bg-float);
	}
	.keyboard-bridge {
		position: fixed;
		left: -9999px;
		width: 1px;
		height: 1px;
		opacity: 0;
		pointer-events: none;
	}
	.http-warning {
		position: fixed;
		bottom: var(--space-4);
		left: 50%;
		z-index: 210;
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		max-width: min(540px, calc(100vw - 2 * var(--space-4)));
		padding: var(--space-2) var(--space-1) var(--space-2) var(--space-3);
		border: 1px solid var(--rule);
		border-inline-start: 3px solid var(--warning);
		border-radius: var(--radius);
		background: var(--bg-float);
		box-shadow: var(--shadow-float);
		color: var(--text);
		transform: translateX(-50%);
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	:global(.picker-dialog) {
		width: min(1100px, calc(100vw - 2 * var(--space-4)));
	}
</style>
