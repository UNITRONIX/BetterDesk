<!--
  A file browser widget, in two modes:
  - From the widget state (no session): the folder and entries the device
    reports. A folder or Up sends a "browse" command (cdap.command); the
    device answers in its next state.
  - Live (Browse files, cdap.files as the files socket checks): the files
    socket lists folders, downloads, uploads and deletes (with a
    confirmation). Each request goes only over the socket (the old page also
    sent a browse command for every click).
  Folders are buttons, so they open with one click or Enter (they opened on
  double-click only).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { formatBytes } from '#lib/i18n/format.ts';
	import { i18n, t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { fileIcon, readEntries, type FileEntry, type Widget } from '#lib/devices-area/cdap/model.ts';
	import { FileSession, cdapSocketUrl, type StreamState } from '#lib/devices-area/cdap/streams.ts';
	import Button from '#lib/ui/Button.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';

	interface Props {
		widget: Widget;
		value: unknown;
		deviceId: string;
		/** cdap.command: browse through commands */
		canBrowse: boolean;
		/** cdap.files: the live file browser */
		canConnect: boolean;
		oncommand: (widget: Widget, action: string, value: unknown) => Promise<boolean>;
	}

	let { widget, value, deviceId, canBrowse, canConnect, oncommand }: Props = $props();

	let session: FileSession | null = null;
	let connectBtn = $state<HTMLElement | null>(null);
	let uploadInput = $state<HTMLInputElement | null>(null);
	let phase = $state<StreamState>('idle');
	let livePath = $state('/');
	let liveEntries = $state.raw<FileEntry[]>([]);
	let loading = $state(false);
	let status = $state('');
	let statusError = $state(false);

	const live = $derived(phase === 'open');

	const fromState = $derived.by(() => {
		const v =
			value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
		return {
			path: typeof v.path === 'string' && v.path ? v.path : '/',
			entries: readEntries(v.entries, i18n.locale),
			has: Array.isArray(v.entries)
		};
	});

	const path = $derived(live ? livePath : fromState.path);
	const entries = $derived(live ? liveEntries : fromState.entries);
	const canNavigate = $derived(live || canBrowse);

	function say(text: string, error = false) {
		status = text;
		statusError = error;
	}

	function connect() {
		if (session) return;
		const s = new FileSession(
			cdapSocketUrl(deviceId, 'files'),
			(state, msg) => {
				phase = state;
				if (state === 'error') say(msg || tf('cdap.stream_failed', 'Could not connect.'), true);
				if (state === 'closed' || state === 'error') {
					loading = false;
					if (session === s) session = null;
				}
			},
			{
				onloading(p) {
					livePath = p;
					loading = true;
				},
				onlist(p, list) {
					livePath = p;
					liveEntries = list;
					loading = false;
				},
				onerror(m) {
					loading = false;
					say(m || tf('cdap.files_failed', 'The device could not do that.'), true);
				},
				ondownload(name, bytes) {
					const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
					const a = document.createElement('a');
					a.href = url;
					a.download = name;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => URL.revokeObjectURL(url), 5000);
					say(tf('cdap.file_downloaded', '{name} downloaded.', { name }));
				}
			},
			i18n.locale
		);
		session = s;
		say('');
		s.open();
	}

	function disconnect() {
		session?.close();
		session = null;
		liveEntries = [];
		void tick().then(() => connectBtn?.focus());
	}

	$effect(() => () => {
		session?.close();
		session = null;
	});

	function enter(e: FileEntry) {
		say('');
		if (live) session?.enter(e.name);
		else void oncommand(widget, 'browse', e.name);
	}

	function up() {
		say('');
		if (live) session?.up();
		else void oncommand(widget, 'browse', '..');
	}

	async function remove(e: FileEntry) {
		const ok = await confirm({
			title: tf('cdap.delete_file_title', 'Delete {name}?', { name: e.name }),
			message: tf('cdap.delete_file_message', 'It is deleted on the device and cannot be restored here.'),
			confirmLabel: t('actions.delete'),
			danger: true
		});
		if (ok) session?.remove(e.name);
	}

	function upload(ev: Event) {
		const input = ev.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		for (const file of files) {
			const reader = new FileReader();
			reader.onload = () => {
				const data = typeof reader.result === 'string' ? (reader.result.split(',')[1] ?? '') : '';
				session?.upload(file.name, data);
			};
			reader.readAsDataURL(file);
		}
		if (files.length) say(tf('cdap.uploading', 'Uploading the files to the device…'));
	}
</script>

<div class="file-widget">
	<div class="fw-bar">
		<span class="fw-path mono" title={path}>{path}</span>
		{#if canNavigate}
			<Button size="sm" icon="arrow_upward" disabled={path === '/'} onclick={up}
				>{tf('cdap.up_folder', 'Up one folder')}</Button
			>
		{/if}
	</div>
	<ul class="fw-list" aria-label={path} aria-busy={loading || undefined}>
		{#if live && loading && !entries.length}
			<li class="fw-note">{tf('cdap.folder_loading', 'Loading the folder…')}</li>
		{:else if !entries.length}
			<li class="fw-note">
				{live || fromState.has ? tf('cdap.folder_empty', 'This folder is empty.') : t('cdap.disconnected')}
			</li>
		{/if}
		{#each entries as e (e.name)}
			<li class="fw-entry">
				<Icon name={fileIcon(e)} />
				{#if e.dir && canNavigate}
					<button type="button" class="fw-name fw-open" onclick={() => enter(e)}>{e.name}</button>
				{:else}
					<span class="fw-name">{e.name}</span>
				{/if}
				<span class="fw-meta">
					{#if !e.dir && e.size !== null}{formatBytes(e.size)}{/if}
					{#if live && e.modified}<Time value={e.modified} />{/if}
				</span>
				{#if live}
					<span class="fw-actions">
						{#if !e.dir}
							<Button
								size="sm"
								variant="ghost"
								icon={ICONS.download}
								aria-label={tf('cdap.download_named', 'Download {name}', { name: e.name })}
								onclick={() => session?.download(e.name)}>{t('file_transfer.download')}</Button
							>
						{/if}
						<Button
							size="sm"
							variant="danger-quiet"
							icon={ICONS.delete}
							aria-label={tf('cdap.delete_named', 'Delete {name}', { name: e.name })}
							onclick={() => void remove(e)}>{t('actions.delete')}</Button
						>
					</span>
				{/if}
			</li>
		{/each}
	</ul>
	<p class={['fw-status', statusError && 'is-error']} role="status">{status}</p>
	{#if canConnect}
		<div class="fw-actions-row">
			{#if live}
				<input
					bind:this={uploadInput}
					type="file"
					multiple
					class="sr-only"
					tabindex="-1"
					aria-hidden="true"
					onchange={upload}
				/>
				<Button size="sm" icon={ICONS.upload} onclick={() => uploadInput?.click()}
					>{t('cdap.upload_file')}</Button
				>
				<Button size="sm" onclick={disconnect}>{t('remote.disconnect')}</Button>
			{:else if phase === 'connecting'}
				<Button size="sm" busy>{tf('cdap.connecting', 'Connecting…')}</Button>
			{:else}
				<Button bind:element={connectBtn} icon={ICONS.files} onclick={connect}
					>{t('cdap.connect_files')}</Button
				>
			{/if}
		</div>
	{/if}
</div>

<style>
	.file-widget {
		display: flex;
		flex-direction: column;
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}
	.fw-bar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--rule);
		background: var(--bg-subtle);
	}
	.fw-path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text-muted);
		font-size: var(--text-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fw-list {
		max-height: 260px;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		list-style: none;
	}
	.fw-entry {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--control-h-sm);
		padding: var(--space-1) var(--space-2);
		border-bottom: 1px solid var(--rule);
	}
	.fw-entry :global(.material-symbols-outlined) {
		color: var(--text-muted);
		font-size: 18px;
	}
	.fw-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fw-open {
		padding: 0;
		border: 0;
		background: none;
		color: var(--link, var(--accent));
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	.fw-open:hover {
		text-decoration: underline;
	}
	.fw-open:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	.fw-meta {
		display: flex;
		flex-shrink: 0;
		gap: var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
		white-space: nowrap;
	}
	.fw-actions {
		display: flex;
		flex-shrink: 0;
		gap: 2px;
	}
	.fw-note {
		padding: var(--space-3);
		color: var(--text-muted);
	}
	.fw-status {
		min-height: 0;
		margin: 0;
		padding: 0 var(--space-2);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.fw-status:not(:empty) {
		padding: var(--space-2);
		border-bottom: 1px solid var(--rule);
	}
	.fw-status.is-error {
		color: var(--danger);
	}
	.fw-actions-row {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: var(--space-2);
		padding: var(--space-2);
	}
	@media (pointer: coarse) {
		.fw-open {
			min-height: 44px;
		}
	}
	@media (max-width: 640px) {
		.fw-entry {
			flex-wrap: wrap;
		}
	}
</style>
