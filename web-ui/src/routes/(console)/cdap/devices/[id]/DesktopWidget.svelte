<!--
  The device's screen (lib/devices-area/cdap/desktop.ts has the protocol).
  Connect (cdap.terminal, as the desktop socket checks: it is remote control
  of the device, like its terminal) opens the stream; the picture, the
  pointer and the keys go both ways while the screen has focus.

  Keyboard: the screen is one Tab stop; every key goes to the device, Tab
  and Escape too. Escape then Tab moves focus on (the hint says so).
  Pasting into the screen sends the text to the device. When the device's
  clipboard changes, the page says so and offers Copy; it never writes the
  operator's clipboard on its own (BUGS.md U5).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { tf, t } from '#lib/i18n/i18n.svelte.ts';
	import {
		DesktopSession,
		MOUSE,
		hasVideoDecoder,
		loadMseH264,
		type Monitor,
		type StreamState
	} from '#lib/devices-area/cdap/desktop.ts';
	import { cdapSocketUrl } from '#lib/devices-area/cdap/streams.ts';
	import Button from '#lib/ui/Button.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { copyText } from '#lib/ui/clipboard.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		deviceId: string;
		deviceName: string;
		canConnect: boolean;
	}

	let { deviceId, deviceName, canConnect }: Props = $props();

	const uid = $props.id();
	const hintId = `dt-hint-${uid}`;

	let canvas = $state<HTMLCanvasElement | null>(null);
	let stage = $state<HTMLDivElement | null>(null);
	let connectBtn = $state<HTMLElement | null>(null);
	let session: DesktopSession | null = null;
	let phase = $state<StreamState>('idle');
	let message = $state('');
	let monitors = $state.raw<Monitor[]>([]);
	let activeMonitor = $state(0);
	let deviceClipboard = $state('');
	let sent = $state(false);
	let sentTimer: ReturnType<typeof setTimeout> | undefined;
	let cursor = $state('default');

	const open = $derived(phase === 'open');
	const busy = $derived(phase === 'connecting');

	async function connect() {
		if (!canvas || session) return;
		phase = 'connecting';
		message = '';
		const videoDecoder = hasVideoDecoder();
		const mseH264 = videoDecoder ? false : await loadMseH264();
		const s = new DesktopSession({
			url: cdapSocketUrl(deviceId, 'desktop'),
			canvas,
			env: { videoDecoder, mseH264 },
			events: {
				onstate(state, msg) {
					phase = state;
					message = msg ?? '';
					if (state === 'open') void tick().then(() => stage?.focus());
					if (state === 'closed' || state === 'error') {
						if (session === s) session = null;
						monitors = [];
					}
				},
				onmonitors(list, active) {
					monitors = list;
					activeMonitor = active;
				},
				onclipboard(text) {
					deviceClipboard = text;
				},
				oncursor(css) {
					cursor = css;
				}
			}
		});
		session = s;
		s.open();
	}

	function disconnect() {
		session?.close();
		session = null;
		void tick().then(() => connectBtn?.focus());
	}

	// The device's cursor on the screen (a CSS value built from checked data)
	$effect(() => {
		if (canvas) canvas.style.cursor = cursor;
	});

	// Leaving the page ends the session right away, so the device stops capturing
	$effect(() => {
		const gone = () => session?.close('tab_closed');
		window.addEventListener('pagehide', gone);
		return () => {
			window.removeEventListener('pagehide', gone);
			session?.close();
			session = null;
			clearTimeout(sentTimer);
		};
	});

	// Wheel steps go to the device instead of scrolling the page (needs a non-passive listener)
	$effect(() => {
		const el = canvas;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (session?.wheel(e)) e.preventDefault();
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	/* ── Keys: everything goes to the device; Escape then Tab leaves ── */
	let escArmed = false;
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- keys held down, not drawn
	const keysDown = new Set<string>();

	function onkeydown(e: KeyboardEvent) {
		if (!session?.connected) return;
		if (e.key === 'Tab' && escArmed) {
			escArmed = false;
			return;
		}
		escArmed = e.key === 'Escape';
		e.preventDefault();
		if (e.repeat) return;
		keysDown.add(e.code || e.key);
		session.key(e, true);
	}

	function onkeyup(e: KeyboardEvent) {
		if (!session?.connected) return;
		const k = e.code || e.key;
		if (!keysDown.has(k)) return;
		keysDown.delete(k);
		e.preventDefault();
		session.key(e, false);
	}

	function onpaste(e: ClipboardEvent) {
		if (!session?.connected) return;
		const text = e.clipboardData?.getData('text/plain') ?? '';
		e.preventDefault();
		if (!text) return;
		session.paste(text);
		sent = true;
		clearTimeout(sentTimer);
		sentTimer = setTimeout(() => (sent = false), 1500);
	}

	async function copyFromDevice() {
		if (await copyText(deviceClipboard)) toast.success(t('common.copied'));
		else toast.error(t('common.copy_failed'));
	}

	const monitorOptions = $derived(
		monitors.map((m, i) => ({
			value: m.index,
			label: tf(
				m.primary ? 'cdap.monitor_primary' : 'cdap.monitor_option',
				m.primary ? '{name}, {width} × {height}, main screen' : '{name}, {width} × {height}',
				{
					name: m.name || tf('cdap.monitor_n', 'Screen {n}', { n: i + 1 }),
					width: m.width,
					height: m.height
				}
			)
		}))
	);

	const overlay = $derived(
		phase === 'connecting'
			? tf('cdap.connecting', 'Connecting…')
			: phase === 'error'
				? message || tf('cdap.stream_failed', 'Could not connect.')
				: t('cdap.disconnected')
	);
</script>

<div class="desktop-widget">
	{#if open && (monitors.length > 1 || deviceClipboard || sent)}
		<div class="dt-bar">
			{#if monitors.length > 1}
				<label class="dt-monitor">
					<span class="dt-monitor-label">{tf('cdap.screen', 'Screen')}</span>
					<Select
						small
						options={monitorOptions}
						value={activeMonitor}
						onchange={(e) => {
							activeMonitor = Number((e.currentTarget as HTMLSelectElement).value);
							session?.selectMonitor(activeMonitor);
						}}
					/>
				</label>
			{/if}
			<span class="dt-clip" role="status">
				{#if sent}{t('cdap.clipboard_out')}{:else if deviceClipboard}{tf(
						'cdap.device_clipboard',
						"The device's clipboard changed."
					)}{/if}
			</span>
			{#if deviceClipboard}
				<Button size="sm" icon={ICONS.copy} onclick={() => void copyFromDevice()}
					>{tf('cdap.copy_device_clipboard', 'Copy to my clipboard')}</Button
				>
			{/if}
		</div>
	{/if}
	<!-- The remote screen: while connected, pointer and keys go to the device -->
	<!-- svelte-ignore a11y_no_noninteractive_tabindex (it is role application while it takes focus) -->
	<div
		bind:this={stage}
		class={['dt-stage', open && 'is-open']}
		role={open ? 'application' : undefined}
		aria-label={open ? tf('cdap.desktop_label', 'Screen of {name}', { name: deviceName }) : undefined}
		aria-describedby={open ? hintId : undefined}
		tabindex={open ? 0 : -1}
		{onkeydown}
		{onkeyup}
		{onpaste}
		oncopy={(e) => e.preventDefault()}
	>
		<canvas
			bind:this={canvas}
			class="dt-canvas"
			width="1280"
			height="720"
			aria-hidden="true"
			onmousedown={(e) => {
				if (!session?.connected) return;
				stage?.focus();
				session.mouse(e, MOUSE.down);
				e.preventDefault();
			}}
			onmouseup={(e) => {
				if (!session?.connected) return;
				session.mouse(e, MOUSE.up);
				e.preventDefault();
			}}
			onmousemove={(e) => session?.mouse(e, MOUSE.move)}
			oncontextmenu={(e) => e.preventDefault()}
		></canvas>
		{#if !open}
			<div class="dt-overlay" aria-live="polite">{overlay}</div>
		{/if}
	</div>
	{#if open}
		<p class="dt-hint" id={hintId}>
			{tf(
				'cdap.desktop_hint',
				'Keys go to the device while its screen has focus. Press Escape, then Tab to move on.'
			)}
		</p>
	{/if}
	{#if canConnect}
		<div class="dt-actions">
			{#if open || busy}
				<Button size="sm" onclick={disconnect}>{t('remote.disconnect')}</Button>
			{:else}
				<Button bind:element={connectBtn} icon={ICONS.connect} onclick={() => void connect()}
					>{t('cdap.connect_desktop')}</Button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.desktop-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	.dt-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
		min-height: var(--control-h-sm);
	}
	.dt-monitor {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
	}
	.dt-monitor-label {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dt-clip {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	/* Black stage in both themes, like the remote viewer's letterbox */
	/* Until the stream runs, a short stage with the state in words */
	.dt-stage:not(.is-open) {
		aspect-ratio: auto;
		height: 10rem;
	}
	.dt-stage {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius);
		background: #000;
		aspect-ratio: 16 / 9;
	}
	.dt-canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		cursor: crosshair;
	}
	.dt-stage:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.dt-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--space-3);
		background: #000;
		color: #c9cfcf;
		text-align: center;
		overflow-wrap: anywhere;
	}
	.dt-hint {
		margin: 0;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.dt-actions {
		display: flex;
		justify-content: center;
		padding: var(--space-2);
	}
</style>
