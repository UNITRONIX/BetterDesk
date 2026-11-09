<!--
  TCP or UDP relay from a MeshAgent device to a host and port: Connect in
  the footer, then what goes over the connection and a field to send text.
  Enter in host or port connects; Enter in the text field sends it.
  Closing the sheet ends the connection.
-->
<script lang="ts">
	import { meshRelayUrl } from '#lib/api/mesh.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import Field from '#lib/ui/Field.svelte';
	import FormSection from '#lib/ui/FormSection.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import type { DeviceLike } from '../model.ts';

	let { device, udp, settle }: { device: DeviceLike; udp: boolean; settle: (done: true | null) => void } =
		$props();

	const uid = $props.id();
	let host = $state('127.0.0.1');
	let port = $state('3389');
	let text = $state('');
	let portError = $state('');
	let status = $state('');
	let tone = $state<'neutral' | 'ok' | 'error'>('neutral');
	let lines = $state<{ id: number; text: string; error?: boolean }[]>([]);
	let logEl = $state<HTMLElement | null>(null);
	let ws: WebSocket | null = null;
	let ready = false;
	let seq = 0;

	function log(line: string, error = false) {
		lines.push({ id: ++seq, text: line, error });
		queueMicrotask(() => logEl && (logEl.scrollTop = logEl.scrollHeight));
	}

	function say(message: string, t2: 'neutral' | 'ok' | 'error' = 'neutral') {
		status = message;
		tone = t2;
	}

	function disconnect() {
		const s = ws;
		ws = null;
		ready = false;
		s?.close();
	}

	$effect(() => () => disconnect());

	async function connect() {
		const n = Number(port);
		portError = '';
		if (!/^\d+$/.test(port.trim()) || n < 1 || n > 65535) {
			const msg = t('mesh.port_invalid');
			portError = msg;
			log(msg, true);
			say(msg, 'error');
			document.getElementById(`${uid}-port`)?.focus();
			return;
		}
		disconnect();
		const connecting = t('mesh.port_connecting');
		say(connecting);
		try {
			const url = await meshRelayUrl(device.id, udp, host.trim() || '127.0.0.1', n);
			const s = new WebSocket(url);
			s.binaryType = 'arraybuffer';
			ws = s;
			log(connecting);
			s.onmessage = (ev: MessageEvent) => {
				if (typeof ev.data === 'string') {
					if (ev.data === 'c' || ev.data === 'cr') {
						if (!ready) {
							ready = true;
							s.send('14');
							const msg = tf('mesh.port_connected', 'Relay ready');
							log(msg);
							say(msg, 'ok');
						}
						return;
					}
					log('[text] ' + ev.data);
					return;
				}
				const buf = new Uint8Array(ev.data as ArrayBuffer);
				let decoded: string;
				try {
					decoded = new TextDecoder().decode(buf);
				} catch {
					decoded = `[${buf.length} bytes]`;
				}
				log('[rx] ' + decoded);
			};
			s.onerror = () => {
				const msg = t('mesh.port_error');
				log(msg, true);
				say(msg, 'error');
			};
			s.onclose = () => {
				if (ws !== s) return;
				ready = false;
				const msg = t('mesh.port_closed');
				log(msg);
				say(msg);
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(msg, true);
			say(msg, 'error');
		}
	}

	function send() {
		if (!ws || ws.readyState !== WebSocket.OPEN || !ready) {
			say(tf('mesh.port_not_ready', 'Connect first, then send.'), 'error');
			return;
		}
		if (!text) return;
		ws.send(new TextEncoder().encode(text));
		log('[tx] ' + text);
		text = '';
	}

	function onSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (document.activeElement?.id === `${uid}-send`) send();
		else void connect();
	}
</script>

<Sheet
	title={udp
		? tf('mesh.port_udp_title_named', 'UDP port relay through {id}', { id: device.id })
		: tf('mesh.port_tcp_title_named', 'TCP port relay through {id}', { id: device.id })}
	subtitle={tf(
		'mesh.port_sheet_desc',
		"Opens a connection from the device's MeshAgent to a host and port and shows what comes back."
	)}
	{status}
	statusTone={tone}
	onclose={() => settle(true)}
>
	<form id="{uid}-form" onsubmit={onSubmit} novalidate>
		<Field
			label={tf('mesh.port_host', 'Host')}
			hint={tf('mesh.port_host_hint', 'As seen from the device. 127.0.0.1 is the device itself.')}
		>
			{#snippet children(f)}
				<Input {...f} width="host" autocomplete="off" spellcheck="false" bind:value={host} />
			{/snippet}
		</Field>
		<Field id="{uid}-port" label={tf('mesh.port_port', 'Port')} error={portError}>
			{#snippet children(f)}
				<Input {...f} width="short" type="number" min={1} max={65535} inputmode="numeric" bind:value={port} />
			{/snippet}
		</Field>
		<FormSection title={tf('mesh.port_traffic', 'Traffic')} id="{uid}-traffic">
			<!-- The log scrolls; keyboard users reach it to scroll -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="log"
				role="log"
				aria-live="polite"
				aria-labelledby="{uid}-traffic-title"
				tabindex="0"
				bind:this={logEl}
			>
				{#each lines as line (line.id)}
					<div class={['line', line.error && 'is-error']}>{line.text}</div>
				{/each}
			</div>
			<Field
				id="{uid}-send"
				label={tf('mesh.port_send_label', 'Text to send')}
				hint={tf('mesh.port_send_hint', 'Sent as it is once the relay is ready.')}
			>
				{#snippet children(f)}
					<div class="send-row">
						<Input {...f} autocomplete="off" spellcheck="false" bind:value={text} />
						<Button onclick={send}>{t('mesh.port_send')}</Button>
					</div>
				{/snippet}
			</Field>
		</FormSection>
	</form>
	{#snippet footer()}
		<Button class="sheet-footer-start" onclick={() => settle(true)}>{t('actions.close')}</Button>
		<Button variant="primary" type="submit" form="{uid}-form">{t('mesh.port_connect')}</Button>
	{/snippet}
</Sheet>

<style>
	/* Dark in both themes, like the terminal */
	.log {
		min-height: 12rem;
		max-height: 40vh;
		overflow-y: auto;
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		background: #111414;
		color: #e3e6e6;
		font-family: var(--mono);
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.log:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.line.is-error {
		color: #ffb4ab;
	}
	.send-row {
		display: flex;
		gap: var(--space-2);
	}
	.send-row > :global(input) {
		flex: 1;
		min-width: 0;
	}
</style>
