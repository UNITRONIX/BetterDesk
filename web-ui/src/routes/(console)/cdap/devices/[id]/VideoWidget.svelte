<!--
  A video stream from the device (camera, screen preview): pictures only, no
  input. Connect needs cdap.command, as the video socket checks.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { tf, t } from '#lib/i18n/i18n.svelte.ts';
	import type { Widget } from '#lib/devices-area/cdap/model.ts';
	import { VideoSession, cdapSocketUrl, type StreamState } from '#lib/devices-area/cdap/streams.ts';
	import Button from '#lib/ui/Button.svelte';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		widget: Widget;
		deviceId: string;
		deviceName: string;
		canConnect: boolean;
	}

	let { widget, deviceId, deviceName, canConnect }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let connectBtn = $state<HTMLElement | null>(null);
	let session: VideoSession | null = null;
	let phase = $state<StreamState>('idle');
	let message = $state('');

	const open = $derived(phase === 'open');

	function connect() {
		if (!canvas || session) return;
		const s = new VideoSession(cdapSocketUrl(deviceId, 'video'), widget.id, canvas, (state, msg) => {
			phase = state;
			message = msg ?? '';
			if ((state === 'closed' || state === 'error') && session === s) session = null;
		});
		session = s;
		s.open();
	}

	function disconnect() {
		session?.close();
		session = null;
		void tick().then(() => connectBtn?.focus());
	}

	$effect(() => () => {
		session?.close();
		session = null;
	});

	const overlay = $derived(
		phase === 'connecting'
			? tf('cdap.connecting', 'Connecting…')
			: phase === 'error'
				? message || tf('cdap.stream_failed', 'Could not connect.')
				: t('cdap.disconnected')
	);
</script>

<div class="video-widget">
	<div
		class={['vd-stage', open && 'is-open']}
		role={open ? 'img' : undefined}
		aria-label={open ? tf('cdap.video_label', 'Video from {name}', { name: deviceName }) : undefined}
	>
		<canvas bind:this={canvas} class="vd-canvas" width="640" height="480" aria-hidden="true"></canvas>
		{#if !open}<div class="vd-overlay" aria-live="polite">{overlay}</div>{/if}
	</div>
	{#if canConnect}
		<div class="vd-actions">
			{#if phase === 'open' || phase === 'connecting'}
				<Button size="sm" onclick={disconnect}>{t('remote.disconnect')}</Button>
			{:else}
				<Button bind:element={connectBtn} icon={ICONS.view} onclick={connect}
					>{t('cdap.connect_video')}</Button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.video-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}
	/* Until the stream runs, a short stage with the state in words */
	.vd-stage:not(.is-open) {
		aspect-ratio: auto;
		height: 10rem;
	}
	.vd-stage {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius);
		background: #000;
		aspect-ratio: 16 / 9;
	}
	.vd-canvas {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.vd-overlay {
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
	.vd-actions {
		display: flex;
		justify-content: center;
		padding: var(--space-2);
	}
</style>
