<!--
  Settings › Advanced (server.config). The configuration files: editable
  ones first, read-only ones after, the ones that don't exist on this
  server folded at the end; the editor beside the list (under it on
  phones, both stay in view). A file whose saves need a service restart
  gets a danger zone under the editor. Old page: views/settings.ejs
  "Advanced", settings.js initAdvancedSection.
-->
<script lang="ts">
	import { getPendingRestart } from '#lib/api/restart.ts';
	import {
		errorText,
		listConfigFiles,
		readConfigFile,
		saveConfigFile,
		type ConfigFile
	} from '#lib/api/settings-system.ts';
	import { formatBytes } from '#lib/i18n/format.ts';
	import { has, t } from '#lib/i18n/i18n.svelte.ts';
	import { onRestartCanceled, showRestartPrompt } from '#lib/settings/restart.svelte.ts';
	import {
		fileLabelKey,
		groupFiles,
		isDirty,
		newFileText,
		restartHintKey,
		showsRestart
	} from '#lib/settings-b/advanced.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import DangerZone from '#lib/ui/DangerZone.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Textarea from '#lib/ui/Textarea.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { trackDirty } from '#lib/settings/dirty.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	const allowed = can('server.config');

	let files = $state.raw<ConfigFile[]>([]);
	let listState = $state<'loading' | 'ready' | 'error'>('loading');
	let listError = $state('');

	interface Open {
		id: string;
		path: string;
		size: number;
		mtime: string | null;
		requiresRestart: string;
		/** Not on the server yet: saving creates it */
		created: boolean;
	}
	let open = $state.raw<Open | null>(null);
	let original = $state('');
	let text = $state('');
	let saving = $state(false);
	let loadingFile = $state(false);

	const groups = $derived(groupFiles(files));
	const catalog = $derived(open ? files.find((f) => f.id === open?.id) : undefined);
	const writable = $derived(!!catalog?.writable);
	const dirty = $derived(!!open && isDirty(text, original));
	const restartRow = $derived(
		showsRestart(
			catalog ?? (open ? { requiresRestart: open.requiresRestart, exists: true, canCreate: false } : null)
		)
	);

	const label = (f: { id: string }) => (has(fileLabelKey(f.id)) ? t(fileLabelKey(f.id)) : f.id);

	async function loadList() {
		try {
			files = await listConfigFiles();
			listState = 'ready';
		} catch (err) {
			listError = errorText(err, t('errors.server_error'));
			listState = 'error';
		}
	}

	async function discardOk(): Promise<boolean> {
		if (!dirty) return true;
		return confirm({
			title: t('settings.confirm.advanced_discard_title'),
			message: t('settings.advanced_unsaved_confirm'),
			confirmLabel: t('actions.confirm'),
			danger: true
		});
	}

	async function openFile(id: string, force = false) {
		if (!force && !(await discardOk())) return;
		const f = files.find((x) => x.id === id);
		if (f && !f.exists && f.canCreate) {
			open = {
				id,
				path: f.path ?? '',
				size: 0,
				mtime: null,
				requiresRestart: f.requiresRestart,
				created: true
			};
			original = '';
			text = newFileText(t('settings.advanced_new_file_hint'));
			// The hint line is a start, not a change
			original = text;
			return;
		}
		loadingFile = true;
		try {
			const data = await readConfigFile(id);
			open = {
				id,
				path: data.path ?? f?.path ?? '',
				size: data.size ?? 0,
				mtime: data.mtime,
				requiresRestart: data.requiresRestart,
				created: false
			};
			original = data.content ?? '';
			text = original;
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
		} finally {
			loadingFile = false;
		}
	}

	async function save() {
		if (!open) return;
		if (!writable) {
			toast.error(t('settings.advanced_error_not_writable'));
			return;
		}
		const yes = await confirm({
			title: t('settings.confirm.advanced_save_title'),
			message: t('settings.advanced_save_confirm'),
			confirmLabel: t('settings.advanced_save')
		});
		if (!yes) return;
		const id = open.id;
		saving = true;
		try {
			const resp = await saveConfigFile(id, text);
			original = text;
			toast.success(
				resp.data?.backupPath
					? `${t('settings.advanced_saved')} (${t('settings.advanced_backup_created')})`
					: t('settings.advanced_saved')
			);
			await loadList();
			await openFile(id, true);
			if (resp.restartRequired) showRestartPrompt(resp.restartRequired);
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
		} finally {
			saving = false;
		}
	}

	/** The restart applies saved changes: it asks the restart prompt, or says to save first */
	async function restartServices() {
		if (!(await discardOk())) return;
		if (dirty) {
			text = original;
		}
		try {
			const pending = await getPendingRestart();
			if (pending?.phase === 'pending') {
				showRestartPrompt(pending);
				return;
			}
		} catch {
			/* said below */
		}
		toast.info(t('settings.restart_save_first'));
	}

	$effect(() => {
		if (!allowed) return;
		void loadList();
		const offRefresh = onRefresh(() => void loadList());
		// Cancel in the restart prompt put the previous file back
		const offCancel = onRestartCanceled(() => {
			void loadList();
			if (open) void openFile(open.id, true);
		});
		return () => {
			offRefresh();
			offCancel();
		};
	});

	// Leaving the tab or the page with unsaved changes asks first (the settings page)
	$effect(() => trackDirty(() => dirty));

	function statusParts(f: { size: number }): [string, string] {
		const s = t('settings.advanced_tab.status_file', { size: formatBytes(f.size) });
		const at = s.indexOf('{when}');
		return at < 0 ? [s, ''] : [s.slice(0, at), s.slice(at + '{when}'.length)];
	}
</script>

{#snippet fileStatus(f: ConfigFile)}
	{#if !f.exists}
		{t('settings.advanced_tab.status_new')}
	{:else if !f.writable}
		{t('settings.advanced_tab.status_readonly')}
	{:else}
		{@const [before, after] = statusParts({ size: f.size ?? 0 })}
		{before}<Time value={f.mtime} />{after}
	{/if}
{/snippet}

{#snippet fileRow(f: ConfigFile)}
	<ListRow title={label(f)} current={open?.id === f.id} onclick={() => void openFile(f.id)}>
		{#snippet sub()}{@render fileStatus(f)}{/snippet}
	</ListRow>
{/snippet}

{#if !allowed}
	<States message={t('settings.page.admin_only')} />
{:else}
	<section class="section advanced-config" aria-labelledby="advanced-title">
		<h2 id="advanced-title">{t('settings.advanced_title')}</h2>
		<p class="section-note">{t('settings.advanced_tab.note')}</p>
		<Notice tone="warning" message={t('settings.advanced_warning')} />
		<div class="split advanced-config-layout">
			<div class="split-list">
				<h3 class="files-label" id="advanced-files-label">{t('settings.advanced_files_label')}</h3>
				{#if listState === 'loading'}
					<States kind="loading" />
				{:else if listState === 'error'}
					<States kind="error" message={listError} onretry={() => void loadList()} />
				{:else if !files.length}
					<States message={t('settings.advanced_no_files')} />
				{:else}
					<div class="file-list" role="group" aria-labelledby="advanced-files-label">
						<RowList>
							{#each [...groups.editable, ...groups.readOnly] as f (f.id)}
								{@render fileRow(f)}
							{/each}
						</RowList>
						{#if groups.unavailable.length}
							<div class="missing">
								<Disclosure
									title={t('settings.advanced_tab.missing_title', { n: groups.unavailable.length })}
									level={4}
								>
									<p class="hint">{t('settings.advanced_tab.missing_note')}</p>
									<ul class="missing-list">
										{#each groups.unavailable as f (f.id)}
											<li>
												{label(f)}<span class="cell-sub"><ValueCopy value={f.path} copy={false} /></span>
											</li>
										{/each}
									</ul>
								</Disclosure>
							</div>
						{/if}
					</div>
				{/if}
			</div>
			<div class="split-detail editor">
				{#if open}
					<div class="editor-toolbar">
						<div class="editor-meta">
							<ValueCopy value={open.path} label={t('settings.advanced_tab.editor_label')} />
							<span class="hint">
								{#if open.created}
									{t('settings.advanced_new_file')}
								{:else}
									{@const [before, after] = statusParts(open)}
									{before}<Time value={open.mtime} />{after}
								{/if}
							</span>
						</div>
						<div class="editor-actions">
							<Button
								id="advanced-config-reload"
								size="sm"
								icon="refresh"
								busy={loadingFile}
								onclick={() => open && void openFile(open.id, true)}>{t('settings.advanced_reload')}</Button
							>
							<Button
								id="advanced-config-save"
								size="sm"
								variant="primary"
								disabled={!writable || !dirty}
								busy={saving}
								onclick={save}>{t('settings.advanced_save')}</Button
							>
						</div>
					</div>
					<label class="sr-only" for="advanced-config-textarea"
						>{t('settings.advanced_tab.editor_label')}</label
					>
					<Textarea
						id="advanced-config-textarea"
						class="mono editor-text"
						spellcheck="false"
						disabled={!writable}
						describedby="advanced-config-restart-hint"
						bind:value={text}
					/>
					<p class="field-effect is-restart" id="advanced-config-restart-hint">
						{t(restartHintKey(open.requiresRestart))}
					</p>
				{:else}
					<p class="state">{t('settings.advanced_select_file')}</p>
				{/if}
			</div>
		</div>
	</section>

	{#if open && restartRow}
		<div id="advanced-restart-zone">
			<DangerZone
				title={t('settings.advanced_tab.restart_title')}
				rows={[
					{
						title: t('settings.advanced_tab.restart_row'),
						consequence: t('settings.advanced_tab.restart_desc'),
						action: t('settings.advanced_tab.restart_button'),
						onclick: () => void restartServices()
					}
				]}
			/>
		</div>
	{/if}
{/if}

<style>
	.advanced-config {
		min-width: 0;
	}
	/* List and editor side by side (ui/Split's look); on phones the editor
	   follows the list and both stay in view, as before */
	.split {
		display: grid;
		grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
		min-height: 420px;
		border-top: 1px solid var(--rule);
	}
	.split-list {
		display: flex;
		flex-direction: column;
		border-inline-end: 1px solid var(--rule);
		min-width: 0;
	}
	.split-list :global(.list) {
		margin-inline: 0;
	}
	.files-label {
		padding: var(--space-2) var(--row-pad-x);
		color: var(--text-muted);
		font-weight: 400;
	}
	.missing {
		padding: var(--space-2) var(--row-pad-x);
	}
	.missing-list {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
		color: var(--text-muted);
	}
	.cell-sub {
		display: block;
		overflow-wrap: anywhere;
		font-size: var(--text-sm);
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
		padding-block: var(--space-2);
		padding-inline: var(--space-4) 0;
	}
	.editor-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-3);
	}
	.editor-meta {
		display: flex;
		flex: 1 1 240px;
		flex-direction: column;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.editor-actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.editor :global(.editor-text) {
		flex: 1;
		min-height: 420px;
		padding-block: var(--space-2);
		font-size: var(--text-sm);
		line-height: 1.5;
		white-space: pre;
		overflow: auto;
		resize: vertical;
	}
	.state {
		padding: var(--space-4) 0;
		color: var(--text-muted);
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.field-effect {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.field-effect.is-restart {
		color: var(--warning);
	}
	@media (max-width: 767px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
		.split-list {
			border-inline-end: 0;
			border-bottom: 1px solid var(--rule);
		}
		.editor {
			padding-inline: 0;
		}
	}
</style>
