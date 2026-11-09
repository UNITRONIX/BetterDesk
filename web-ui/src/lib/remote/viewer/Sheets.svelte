<!--
  The side sheets beside the remote screen: chat (per session, each tab
  keeps its messages) and session info (facts the transport reports; values
  it does not report are left out, refreshed every second). File transfer
  is the wrapped client's own sheet (file-modal.js), mounted into the same
  host. One sheet at a time; the screen gets narrower instead of covered.
-->
<script lang="ts">
	import { tf } from '#lib/i18n/i18n.svelte.ts';
	import { formatDuration, formatNumber } from '#lib/i18n/format.ts';
	import { tabStatus } from '#lib/remote/states.ts';
	import type { Viewer } from '#lib/remote/viewer.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import IconButton from '#lib/ui/IconButton.svelte';
	import Platform from '#lib/ui/Platform.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';

	let { viewer, onclose }: { viewer: Viewer; onclose: () => void } = $props();

	const uid = $props.id();
	const s = $derived(viewer.active);
	let now = $state(Date.now());
	let chatText = $state('');
	let messages = $state<HTMLElement | null>(null);
	let chatInput = $state<HTMLInputElement | null>(null);
	let closeInfo = $state<HTMLButtonElement | null>(null);

	// Session info re-reads the client's numbers every second while it is open
	$effect(() => {
		if (viewer.sheet !== 'info') return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		if (viewer.sheet === 'chat') queueMicrotask(() => chatInput?.focus());
		else if (viewer.sheet === 'info') queueMicrotask(() => closeInfo?.focus());
	});

	// New messages scroll into view
	$effect(() => {
		void s?.chat.length;
		if (messages) messages.scrollTop = messages.scrollHeight;
	});

	const stats = $derived.by(() => {
		void now;
		void s?.statsTick;
		try {
			return s?.client?.getStats?.() ?? null;
		} catch {
			return null;
		}
	});
	const st = $derived(tabStatus(s?.view ?? null));
	const quality = $derived(
		s
			? (
					{
						Best: tf('remote.quality_best', 'Best'),
						Balanced: tf('remote.quality_balanced', 'Balanced'),
						Low: tf('remote.quality_low', 'Low')
					} as Record<string, string>
				)[s.prefs.quality]
			: ''
	);
	const codec = $derived(stats?.video?.codec || stats?.video?.currentCodec || '');

	function send() {
		if (s && viewer.sendChat(s, chatText)) chatText = '';
	}
</script>

{#if s && viewer.sheet === 'info'}
	<aside class="rd-sheet" aria-labelledby="{uid}-info-title">
		<div class="rd-sheet-head">
			<h2 class="rd-sheet-title" id="{uid}-info-title">{tf('remote_viewer.session_info', 'Session info')}</h2>
			<IconButton
				bind:element={closeInfo}
				icon="close"
				label={tf('remote_viewer.close_session_info', 'Close session info')}
				onclick={onclose}
			/>
		</div>
		<div class="rd-sheet-body">
			<dl class="facts">
				<dt>{tf('remote_viewer.info_device', 'Device')}</dt>
				<dd>{s.label}</dd>
				<dt>{tf('remote_viewer.info_id', 'ID')}</dt>
				<dd><ValueCopy value={s.deviceId} /></dd>
				{#if s.platform}
					<dt>{tf('remote_viewer.info_system', 'System')}</dt>
					<dd><Platform platform={s.platform} /></dd>
				{/if}
				<dt>{tf('remote_viewer.info_state', 'State')}</dt>
				<dd><Status tone={st.tone} label={st.label} /></dd>
				{#if s.connectedAt && s.view === 'streaming'}
					<dt>{tf('remote_viewer.info_since', 'Connected since')}</dt>
					<dd>
						<Time
							value={new Date(s.connectedAt)}
							relative={false}
							format={{
								year: undefined,
								month: undefined,
								day: undefined,
								hour: '2-digit',
								minute: '2-digit',
								second: '2-digit'
							}}
						/>
					</dd>
					<dt>{tf('remote_viewer.info_duration', 'Connected for')}</dt>
					<dd>{formatDuration(Math.max(0, now - s.connectedAt) / 1000)}</dd>
				{/if}
				<dt>{tf('remote_viewer.info_route', 'Connection')}</dt>
				<dd>
					{viewer.transport === 'rd'
						? tf('remote_viewer.info_route_relay', 'Through the relay server')
						: tf('remote_viewer.info_route_server', 'Through the server')}
				</dd>
				{#if s.view === 'streaming'}
					<dt>{tf('remote_viewer.info_encryption', 'Encryption')}</dt>
					<dd>
						{#if s.encryptionWarning}<Status tone="warning" label={s.encryptionWarning} />{:else}<Status
								tone="good"
								label={tf('remote_viewer.info_encrypted', 'End-to-end encrypted')}
							/>{/if}
					</dd>
					{#if s.latency}
						<dt>{tf('remote_viewer.info_latency', 'Round trip')}</dt>
						<dd class="tabular">{`${formatNumber(Math.round(s.latency))} ms`}</dd>
					{/if}
					{#if stats?.renderer?.fps !== undefined}
						<dt>{tf('remote_viewer.info_fps', 'Frame rate')}</dt>
						<dd class="tabular">{`${stats.renderer.fps} fps`}</dd>
					{/if}
					{#if stats?.renderer?.remoteWidth}
						<dt>{tf('remote_viewer.info_resolution', 'Screen size')}</dt>
						<dd class="tabular">{stats.renderer.remoteWidth} × {stats.renderer.remoteHeight}</dd>
					{/if}
					{#if codec}
						<dt>{tf('remote_viewer.info_codec', 'Video format')}</dt>
						<dd>{String(codec).toUpperCase()}</dd>
					{/if}
					{#if quality}
						<dt>{tf('remote.image_quality', 'Image quality')}</dt>
						<dd>{quality}</dd>
					{/if}
				{/if}
			</dl>
		</div>
	</aside>
{:else if s && viewer.sheet === 'chat'}
	<aside class="rd-sheet" aria-label={tf('remote_viewer.chat_with', 'Chat with {name}', { name: s.label })}>
		<div class="rd-sheet-head">
			<h2 class="rd-sheet-title">{tf('remote.chat', 'Chat')}</h2>
			<IconButton icon="close" label={tf('remote_viewer.close_chat', 'Close chat')} onclick={onclose} />
		</div>
		<div class="chat-messages" bind:this={messages} aria-live="polite">
			{#each s.chat as m (m.id)}
				<p class={['chat-msg', m.type]}>{m.text}</p>
			{:else}
				<p class="chat-empty">
					{tf(
						'remote_viewer.chat_empty',
						'Your messages appear on the screen of the device. Replies show here.'
					)}
				</p>
			{/each}
		</div>
		<form
			class="chat-input-area"
			onsubmit={(e) => {
				e.preventDefault();
				send();
			}}
		>
			<input
				bind:this={chatInput}
				class="chat-input"
				type="text"
				aria-label={tf('remote.chat_placeholder', 'Type a message')}
				placeholder={tf('remote.chat_placeholder', 'Type a message')}
				bind:value={chatText}
			/>
			<Button type="submit" icon="send">{tf('remote.type_text_send', 'Send')}</Button>
		</form>
	</aside>
{/if}

<style>
	.rd-sheet {
		display: flex;
		flex-direction: column;
		width: var(--sheet-w);
		min-height: 0;
		border-inline-start: 1px solid var(--rule);
		background: var(--bg);
		color: var(--text);
	}
	.rd-sheet-head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		min-height: var(--viewer-bar-h);
		padding: 0 var(--space-2) 0 var(--space-4);
		border-bottom: 1px solid var(--rule);
	}
	.rd-sheet-title {
		margin: 0;
		font-size: var(--text-md);
	}
	.rd-sheet-body {
		flex: 1;
		min-height: 0;
		padding: var(--space-3) var(--space-4);
		overflow-y: auto;
	}
	/* Facts in a sheet: a narrower label column, values wrap */
	.rd-sheet .facts {
		grid-template-columns: minmax(7rem, 40%) minmax(0, 1fr);
	}
	.rd-sheet .facts :global(:is(.status, time)) {
		white-space: normal;
	}
	.tabular {
		font-variant-numeric: tabular-nums;
	}
	.chat-messages {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-2);
		min-height: 0;
		padding: var(--space-3) var(--space-4);
		overflow-y: auto;
	}
	.chat-empty {
		margin: 0;
		color: var(--text-muted);
	}
	.chat-msg {
		max-width: 85%;
		margin: 0;
		align-self: flex-start;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius);
		background: var(--bg-subtle);
		overflow-wrap: anywhere;
	}
	.chat-msg.sent {
		align-self: flex-end;
		background: var(--accent-tint);
	}
	.chat-input-area {
		display: flex;
		flex: none;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-top: 1px solid var(--rule);
	}
	.chat-input {
		box-sizing: border-box;
		flex: 1;
		min-width: 0;
		min-height: var(--control-h);
		padding: 0 var(--space-3);
		border: 1px solid var(--border);
		border-radius: var(--control-radius);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.chat-input:focus-visible {
		outline: var(--focus-ring);
		outline-offset: 1px;
	}
	@media (max-width: 899px) {
		.rd-sheet {
			max-width: 100vw;
			box-shadow: var(--shadow-float);
		}
	}
</style>
