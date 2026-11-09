<!--
  Sound from the device: Connect (cdap.command, as the audio socket checks)
  plays it, Mute silences it here (the device keeps sending), the level
  shows how loud it is. The page only listens; it never asks for the
  microphone.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { tf, t } from '#lib/i18n/i18n.svelte.ts';
	import { AudioSession, cdapSocketUrl, type StreamState } from '#lib/devices-area/cdap/streams.ts';
	import Button from '#lib/ui/Button.svelte';
	import Status from '#lib/ui/Status.svelte';

	interface Props {
		deviceId: string;
		canConnect: boolean;
	}

	let { deviceId, canConnect }: Props = $props();

	let session: AudioSession | null = null;
	let connectBtn = $state<HTMLElement | null>(null);
	let phase = $state<StreamState>('idle');
	let muted = $state(false);
	let level = $state(0);
	let meter: ReturnType<typeof setInterval> | undefined;

	function connect() {
		if (session) return;
		const s = new AudioSession(cdapSocketUrl(deviceId, 'audio'), (state) => {
			phase = state;
			if (state === 'open') {
				clearInterval(meter);
				meter = setInterval(() => (level = s.level), 100);
			}
			if (state === 'closed' || state === 'error') {
				clearInterval(meter);
				level = 0;
				if (session === s) session = null;
			}
		});
		session = s;
		muted = false;
		s.open();
	}

	function disconnect() {
		session?.close();
		session = null;
		void tick().then(() => connectBtn?.focus());
	}

	function toggleMute() {
		muted = !muted;
		session?.setMuted(muted);
	}

	$effect(() => () => {
		clearInterval(meter);
		session?.close();
		session = null;
	});

	const pct = $derived(Math.min(100, Math.round(level * 300)));
	const tone = $derived(pct > 80 ? 'high' : pct > 40 ? 'medium' : 'low');
	const status = $derived(
		phase === 'open'
			? { tone: 'good', label: t('cdap.audio_streaming') }
			: phase === 'connecting'
				? { tone: 'waiting', label: tf('cdap.connecting', 'Connecting…') }
				: phase === 'error'
					? { tone: 'danger', label: tf('cdap.stream_failed', 'Could not connect.') }
					: { tone: 'neutral', label: t('cdap.disconnected') }
	);
</script>

<div class="audio-widget">
	<div class="au-row">
		<span aria-live="polite"><Status tone={status.tone} label={status.label} /></span>
		<span class="au-level" aria-hidden="true"
			><span class={['au-fill', `is-${tone}`]} style:width="{pct}%"></span></span
		>
		{#if phase === 'open'}
			<Button size="sm" aria-pressed={muted} onclick={toggleMute}>{tf('cdap.mute', 'Mute')}</Button>
		{/if}
	</div>
	{#if canConnect}
		<div class="au-actions">
			{#if phase === 'open' || phase === 'connecting'}
				<Button size="sm" onclick={disconnect}>{t('remote.disconnect')}</Button>
			{:else}
				<Button bind:element={connectBtn} onclick={connect}>{t('cdap.connect_audio')}</Button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.audio-widget {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.au-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
	}
	.au-level {
		display: block;
		flex: 1;
		min-width: 80px;
		height: 6px;
		border-radius: 1px;
		background: var(--hover);
		overflow: hidden;
	}
	.au-fill {
		display: block;
		height: 100%;
		transition: width var(--motion);
	}
	.au-fill.is-low {
		background: var(--success);
	}
	.au-fill.is-medium {
		background: var(--warning);
	}
	.au-fill.is-high {
		background: var(--danger);
	}
	.au-actions {
		display: flex;
		justify-content: center;
		padding: var(--space-2);
	}
</style>
