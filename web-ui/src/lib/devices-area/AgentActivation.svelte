<!--
  "Scan agent QR" (enrollment.approve), opened from "Pair with code": read the QR code the
  BetterDesk support agent shows, with the camera or from a picture, then
  name the device, pick a folder and activate it. A centred dialog: Cancel,
  and Activate once a code has been read.

  The code is read with the browser's BarcodeDetector. Browsers without it
  (Firefox; Chrome and Edge on Windows and Linux) get one sentence and the
  way to approve the device under Enrollment requests instead. The camera
  stops when a code is read and when the dialog closes, also while the
  browser is still asking for permission.
-->
<script lang="ts">
	import { activateAgent, listPendingAgents } from '#lib/api/dashboard.ts';
	import { listFolders, type Folder } from '#lib/api/devices.ts';
	import { readPairingCode } from '#lib/devices-area/dashboard.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { link } from '#lib/nav.ts';
	import Button from '#lib/ui/Button.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Select from '#lib/ui/Select.svelte';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	let { onclose }: { onclose: () => void } = $props();

	interface DetectedCode {
		rawValue: string;
	}
	interface Detector {
		detect(source: CanvasImageSource | ImageBitmap): Promise<DetectedCode[]>;
	}
	type DetectorClass = new (opts: { formats: string[] }) => Detector;

	const Barcode = (globalThis as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
	const canRead = typeof Barcode === 'function';
	const canCamera = canRead && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

	let open = $state(true);
	let closed = false;
	let video = $state<HTMLVideoElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let nameInput = $state<HTMLInputElement | null>(null);
	let stream: MediaStream | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let cameraOn = $state(false);

	let message = $state('');
	let isError = $state(false);
	let deviceId = $state('');
	let ready = $state(false);
	let done = $state(false);
	let busy = $state(false);
	let name = $state('');
	let folderId = $state(0);
	let folders = $state.raw<Folder[]>([]);

	function say(text: string, error = false) {
		message = text;
		isError = error;
	}

	function stopCamera() {
		if (timer) clearInterval(timer);
		timer = null;
		stream?.getTracks().forEach((track) => track.stop());
		stream = null;
		if (video) video.srcObject = null;
		cameraOn = false;
	}

	async function startCamera() {
		if (!canCamera || !Barcode) {
			say(canRead ? t('dashboard.activate_agent_camera_unavailable') : noReader);
			return;
		}
		say(t('dashboard.activate_agent_scanning'));
		cameraOn = true;
		try {
			const s = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: { ideal: 'environment' } },
				audio: false
			});
			// Closed (or a code read) while the browser asked for the camera: let it go again
			if (closed || deviceId || !video) {
				s.getTracks().forEach((track) => track.stop());
				cameraOn = false;
				return;
			}
			stream = s;
			video.srcObject = s;
			await video.play();
			const detector = new Barcode({ formats: ['qr_code'] });
			timer = setInterval(async () => {
				if (!video || video.readyState < 2 || deviceId) return;
				try {
					const codes = await detector.detect(video);
					const raw = codes[0]?.rawValue;
					if (raw) await handleCode(raw);
				} catch {
					/* a frame may not be available yet */
				}
			}, 250);
		} catch (err) {
			cameraOn = false;
			stopCamera();
			say(
				err instanceof DOMException && err.name === 'NotAllowedError'
					? t('dashboard.activate_agent_camera_denied')
					: t('dashboard.activate_agent_camera_unavailable'),
				true
			);
		}
	}

	async function readImage(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		try {
			if (!file) return;
			if (!Barcode) {
				say(noReader, true);
				return;
			}
			const bitmap = await createImageBitmap(file);
			const codes = await new Barcode({ formats: ['qr_code'] }).detect(bitmap);
			bitmap.close();
			const raw = codes[0]?.rawValue;
			if (!raw) throw new Error('no code');
			await handleCode(raw);
		} catch {
			say(t('dashboard.activate_agent_qr_invalid'), true);
		} finally {
			input.value = '';
		}
	}

	async function handleCode(raw: string) {
		if (deviceId) return;
		const id = readPairingCode(raw, location.host);
		if (!id) {
			say(t('dashboard.activate_agent_qr_invalid'), true);
			return;
		}
		deviceId = id;
		stopCamera();
		say(t('dashboard.activate_agent_loading'));
		try {
			const [pending, list] = await Promise.all([
				listPendingAgents(),
				// Putting it in a folder is optional
				listFolders().catch(() => [] as Folder[])
			]);
			if (closed) return;
			name = pending.find((p) => p.device_id === id)?.hostname || id;
			folders = list;
			ready = true;
			say(t('dashboard.activate_agent_ready'));
			queueMicrotask(() => nameInput?.focus());
		} catch (err) {
			say(err instanceof Error && err.message ? err.message : t('errors.server_error'), true);
		}
	}

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		if (!deviceId || !ready || busy || done) return;
		busy = true;
		say(t('dashboard.activate_agent_submitting'));
		try {
			await activateAgent({
				device_id: deviceId,
				display_name: name.trim(),
				folder_id: Number(folderId) || 0
			});
			done = true;
			say(t('dashboard.activate_agent_success'));
			setTimeout(() => {
				if (closed) return;
				close();
				toast.success(t('dashboard.activate_agent_success'));
			}, 1200);
		} catch (err) {
			say(err instanceof Error && err.message ? err.message : t('errors.server_error'), true);
		} finally {
			busy = false;
		}
	}

	function close() {
		open = false;
		finish();
	}

	function finish() {
		if (closed) return;
		closed = true;
		stopCamera();
		onclose();
	}

	const noReader = $derived(
		tf(
			'dashboard.activate_agent_no_reader',
			"This browser can't read QR codes. Approve the device under {link} instead."
		)
	);

	/** The text before and after {link} */
	function splitLink(text: string): [string, string] {
		const at = text.indexOf('{link}');
		return at < 0 ? [text + ' ', ''] : [text.slice(0, at), text.slice(at + '{link}'.length)];
	}

	// Ask for the camera once the dialog is there; let it go when the dialog goes
	$effect(() => {
		void startCamera();
		return () => {
			closed = true;
			stopCamera();
		};
	});

	const folderOptions = $derived([
		{ value: 0, label: t('dashboard.activate_agent_folder_none') },
		...folders.map((f) => ({ value: f.id, label: f.name || `#${f.id}` }))
	]);
</script>

<Dialog bind:open title={t('pairing.scan_qr_agent')} onclose={finish}>
	<div class="activation">
		<p class="hint">{t('dashboard.activate_agent_qr_hint')}</p>
		{#if canCamera && !deviceId}
			<div class="reader" hidden={!cameraOn}>
				<video bind:this={video} autoplay muted playsinline aria-label={t('pairing.scan_qr_agent')}></video>
			</div>
		{/if}
		{#if canRead && !deviceId}
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				hidden
				tabindex="-1"
				aria-hidden="true"
				onchange={readImage}
			/>
			<div>
				<Button data-autofocus icon={ICONS.upload} onclick={() => fileInput?.click()}
					>{t('dashboard.activate_agent_choose_image')}</Button
				>
			</div>
		{/if}
		<p class={['status', isError && 'is-error']} role="status" aria-live="polite">
			{#if message === noReader}
				<!-- The sentence names the page; the name is the link -->
				{@const [before, after] = splitLink(noReader)}{before}<a href={link('/registrations')}
					>{t('nav.registrations')}</a
				>{after}
			{:else}
				{message}
			{/if}
		</p>
		{#if ready && !done}
			<form class="activation-form" onsubmit={submit} novalidate>
				<Field label={t('dashboard.activate_agent_name')}>
					{#snippet children(f)}
						<Input {...f} maxlength={120} autocomplete="off" bind:element={nameInput} bind:value={name} />
					{/snippet}
				</Field>
				<Field label={t('dashboard.activate_agent_folder')}>
					{#snippet children(f)}
						<Select {...f} width="host" options={folderOptions} bind:value={folderId} />
					{/snippet}
				</Field>
				<button type="submit" hidden tabindex="-1" aria-hidden="true"></button>
			</form>
		{/if}
	</div>
	{#snippet footer()}
		<Button onclick={close}>{t('actions.cancel')}</Button>
		{#if ready && !done}
			<Button variant="primary" {busy} onclick={() => void submit()}
				>{t('dashboard.activate_agent_submit')}</Button
			>
		{/if}
	{/snippet}
</Dialog>

<style>
	.activation {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
	}
	.reader video {
		display: block;
		width: 100%;
		max-height: 320px;
		background: var(--bg-subtle);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}
	.status {
		margin: 0;
		color: var(--text-muted);
	}
	.status:empty {
		display: none;
	}
	.status.is-error {
		color: var(--danger);
	}
	.activation-form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.activation-form :global(.form-group) {
		margin-bottom: 0;
	}
</style>
