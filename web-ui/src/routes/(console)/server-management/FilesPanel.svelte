<!--
  Files (?tab=files): the folders the console may open on its machine.
  A path bar, Up one level, Refresh and New folder above the list; a click
  on a folder opens it, a click on a file opens it in the editor sheet, a
  link opens what it points to. Each row's menu: Open (files), Rename,
  Delete. Beside the list, the folders the console may open, each one
  click away, with whether files can be changed there.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import {
		deletePath,
		getServerInfo,
		listFiles,
		makeFolder,
		readFile,
		renamePath,
		type FileContent,
		type FileEntry
	} from '#lib/api/serverManagement.ts';
	import { formatBytes } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import {
		countEntries,
		entryType,
		joinPath,
		parentOf,
		permsText,
		rootWritable,
		upFrom
	} from '#lib/serverarea/management.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import MenuButton from '#lib/ui/MenuButton.svelte';
	import MenuDivider from '#lib/ui/MenuDivider.svelte';
	import MenuItem from '#lib/ui/MenuItem.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Table from '#lib/ui/Table.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { confirm, prompt } from '#lib/ui/dialogs.svelte.ts';
	import type { Column } from '#lib/ui/table.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { ICONS } from '#lib/util/display.ts';
	import FileEditor from './FileEditor.svelte';

	const uid = $props.id();

	let cwd = $state('');
	let pathInput = $state('');
	let entries = $state.raw<FileEntry[]>([]);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let roots = $state.raw<string[] | null>(null);
	let mutable = $state.raw<string[] | null>(null);
	let rootsError = $state(false);

	let editing = $state.raw<{ file: FileContent; requested: string } | null>(null);

	let inflight: AbortController | null = null;

	async function refresh(path?: string) {
		const target = path || pathInput.trim() || cwd || '/';
		inflight?.abort();
		const ctrl = new AbortController();
		inflight = ctrl;
		loading = true;
		loadError = null;
		try {
			const data = await listFiles(target, ctrl.signal);
			if (inflight !== ctrl) return;
			cwd = data.cwd || target;
			pathInput = cwd;
			entries = data.entries;
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') return;
			if (inflight !== ctrl) return;
			pathInput = target;
			entries = [];
			loadError = t('server_mgmt.files_open_error', { error: message(err) });
		} finally {
			if (inflight === ctrl) loading = false;
		}
	}

	const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

	// Start in the first folder the console may open
	$effect(() => {
		untrack(() => {
			void (async () => {
				let start = '/';
				try {
					const info = await getServerInfo();
					roots = info.fileRoots;
					mutable = info.mutableFileRoots;
					if (info.fileRoots[0]) start = info.fileRoots[0];
				} catch {
					rootsError = true;
					roots = [];
				}
				await refresh(start);
			})();
		});
	});

	/* ── Opening ── */

	async function openFile(path: string) {
		try {
			const file = await readFile(path);
			editing = { file, requested: path };
		} catch (err) {
			toast.error(t('server_mgmt.read_failed_reason', { error: message(err) }));
		}
	}

	/** A link opens what it points to: a folder, or else the file */
	async function openLink(path: string) {
		try {
			const data = await listFiles(path);
			cwd = data.cwd || path;
			pathInput = cwd;
			entries = data.entries;
			loadError = null;
		} catch {
			await openFile(path);
		}
	}

	function openEntry(e: FileEntry) {
		const type = entryType(e);
		if (type === 'dir') void refresh(e.path);
		else if (type === 'file') void openFile(e.path);
		else void openLink(e.path);
	}

	/* ── Changes ── */

	async function rename(e: FileEntry) {
		const next = await prompt({
			title: t('server_mgmt.files_rename_title', { name: e.name }),
			label: t('server_mgmt.files_rename_prompt'),
			value: e.name,
			required: true,
			confirmLabel: t('server_mgmt.files_rename')
		});
		const name = next?.trim();
		if (!name || name === e.name) return;
		try {
			await renamePath(e.path, joinPath(parentOf(e.path), name));
			toast.success(t('server_mgmt.files_renamed', { name }));
			void refresh(cwd);
		} catch (err) {
			toast.error(t('server_mgmt.rename_failed_reason', { error: message(err) }));
		}
	}

	async function remove(e: FileEntry) {
		const ok = await confirm({
			title: t('server_mgmt.delete_title', { name: e.name }),
			message: t('server_mgmt.delete_body', { path: e.path }),
			confirmLabel: t('actions.delete'),
			confirmIcon: ICONS.delete,
			danger: true
		});
		if (!ok) return;
		try {
			await deletePath(e.path);
			toast.success(t('server_mgmt.files_deleted', { name: e.name }));
			void refresh(cwd);
		} catch (err) {
			toast.error(t('server_mgmt.delete_failed_reason', { error: message(err) }));
		}
	}

	async function mkdir() {
		const raw = await prompt({
			title: t('server_mgmt.files_mkdir'),
			label: t('server_mgmt.mkdir_prompt'),
			required: true,
			confirmLabel: t('server_mgmt.mkdir_confirm')
		});
		const name = raw?.trim();
		if (!name) return;
		try {
			await makeFolder(joinPath(cwd || '/', name));
			toast.success(t('server_mgmt.files_folder_created', { name }));
			void refresh(cwd);
		} catch (err) {
			toast.error(t('server_mgmt.mkdir_failed_reason', { error: message(err) }));
		}
	}

	/* ── Table ── */

	const counts = $derived(countEntries(entries));
	let menuFor = $state<string | null>(null);

	const columns = $derived<Column<FileEntry>[]>([
		{
			id: 'name',
			label: t('server_mgmt.files_name'),
			cell: nameCell,
			primary: true,
			class: 'col-name'
		},
		{ id: 'size', label: t('server_mgmt.files_size'), cell: sizeCell, align: 'num', class: 'col-size' },
		{ id: 'mtime', label: t('server_mgmt.files_mtime'), cell: timeCell, class: 'col-time' },
		{ id: 'perms', label: t('server_mgmt.files_perms'), cell: permsCell, class: 'col-perms' },
		{
			id: 'actions',
			label: t('common.actions'),
			labelHidden: true,
			cell: actionsCell,
			align: 'actions'
		}
	]);
</script>

{#snippet nameCell(e: FileEntry)}
	{@const type = entryType(e)}
	{#if type === 'dir'}<span class="dir-name">{e.name}/</span>{:else}<span class="file-name">{e.name}</span
		>{#if type === 'symlink'}
			<Tag label={t('server_mgmt.files_link')} />{/if}{/if}
{/snippet}

{#snippet sizeCell(e: FileEntry)}
	{#if entryType(e) !== 'dir'}{formatBytes(e.size ?? 0) || '0 B'}{/if}
{/snippet}

{#snippet timeCell(e: FileEntry)}<Time value={e.mtime} />{/snippet}

{#snippet permsCell(e: FileEntry)}
	{@const p = permsText(e.mode)}
	{#if p}<ValueCopy value={p} copy={false} />{:else}<Empty />{/if}
{/snippet}

{#snippet actionsCell(e: FileEntry)}
	<MenuButton
		kebab
		label={t('server_mgmt.files_actions_for', { name: e.name })}
		bind:open={() => menuFor === e.path, (v) => (menuFor = v ? e.path : menuFor === e.path ? null : menuFor)}
	>
		{#if entryType(e) === 'file'}
			<MenuItem class="act-open" icon={ICONS.open} onselect={() => void openFile(e.path)}
				>{t('server_mgmt.files_open')}</MenuItem
			>
		{/if}
		<MenuItem class="act-rename" icon={ICONS.rename} onselect={() => void rename(e)}
			>{t('server_mgmt.files_rename')}…</MenuItem
		>
		<MenuDivider />
		<MenuItem class="act-delete" icon={ICONS.delete} danger onselect={() => void remove(e)}
			>{t('actions.delete')}…</MenuItem
		>
	</MenuButton>
{/snippet}

<div class="page-cols">
	<section class="section page-main" aria-label={t('server_mgmt.tab_files')}>
		<form
			class="pathbar"
			role="search"
			onsubmit={(e) => {
				e.preventDefault();
				void refresh();
			}}
		>
			<label class="label" for="{uid}-path">{t('server_mgmt.files_path_label')}</label>
			<div class="pathrow">
				<Input
					id="{uid}-path"
					class="path-input"
					spellcheck="false"
					autocomplete="off"
					bind:value={pathInput}
				/>
				<Button type="submit" class="files-go" icon={ICONS.files}>{t('server_mgmt.files_go')}</Button>
			</div>
		</form>
		<div class="toolbar">
			<Button
				class="files-up"
				disabled={!cwd || upFrom(cwd) === cwd}
				onclick={() => void refresh(upFrom(cwd))}>{t('server_mgmt.files_up')}</Button
			>
			<Button class="files-refresh" icon={ICONS.refresh} onclick={() => void refresh(cwd)}
				>{t('actions.refresh')}</Button
			>
			<span class="toolbar-end">
				<Button class="files-mkdir" icon={ICONS.add} disabled={!cwd} onclick={() => void mkdir()}
					>{t('server_mgmt.files_mkdir')}</Button
				>
			</span>
		</div>
		<div class="count" aria-live="polite">
			{#if !loading && !loadError}<CountLine text={t('server_mgmt.files_count')} values={counts} />{/if}
		</div>
		<div class="files-table">
			<Table
				rows={entries}
				{columns}
				key={(e) => e.path}
				label={t('server_mgmt.tab_files')}
				onrowclick={openEntry}
				rowClass={(e) => `type-${entryType(e)}`}
				{loading}
				loadingText={t('server_mgmt.files_loading')}
				error={loadError}
				onretry={() => void refresh()}
				emptyText={t('server_mgmt.files_empty')}
			/>
		</div>
	</section>

	<aside class="page-side" aria-labelledby="{uid}-roots">
		<section class="section">
			<div class="section-head"><h2 id="{uid}-roots">{t('server_mgmt.files_roots_title')}</h2></div>
			<p class="section-note">{t('server_mgmt.files_roots_note')}</p>
			{#if roots === null}
				<States kind="loading" message={t('server_mgmt.files_roots_loading')} />
			{:else if rootsError}
				<p class="muted">{t('server_mgmt.files_roots_error')}</p>
			{:else if !roots.length}
				<p class="muted">{t('server_mgmt.files_roots_none')}</p>
			{:else}
				<div class="roots">
					<RowList label={t('server_mgmt.files_roots_title')}>
						{#each roots as r (r)}
							{@const writable = rootWritable(r, mutable)}
							<ListRow
								title={r}
								sub={writable === null
									? undefined
									: t(writable ? 'server_mgmt.root_writable' : 'server_mgmt.root_readonly')}
								chevron
								current={cwd === r}
								onclick={() => void refresh(r)}
							/>
						{/each}
					</RowList>
				</div>
			{/if}
		</section>
	</aside>
</div>

{#if editing}
	<FileEditor
		file={editing.file}
		requested={editing.requested}
		onclose={() => (editing = null)}
		onsaved={() => void refresh(cwd)}
	/>
{/if}

<style>
	.pathbar {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.label {
		font-weight: 600;
	}
	.pathrow {
		display: flex;
		gap: var(--space-2);
		max-width: 720px;
	}
	.pathrow :global(.path-input) {
		flex: 1;
		min-width: 0;
		font-family: var(--mono);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.toolbar-end {
		margin-inline-start: auto;
	}
	.count {
		margin: 0;
		min-height: 1.5em;
		color: var(--text-muted);
	}
	.files-table :global(.dir-name) {
		font-weight: 600;
	}
	.files-table :global(.file-name),
	.files-table :global(.dir-name) {
		overflow-wrap: anywhere;
	}
	/* Phones: names stay readable; the table scrolls sideways instead */
	.files-table :global(td.col-name),
	.files-table :global(th.col-name) {
		min-width: 14ch;
	}
	.files-table :global(:is(td, th).col-size),
	.files-table :global(:is(td, th).col-perms) {
		white-space: nowrap;
	}
	.muted {
		margin: 0;
		color: var(--text-muted);
	}
	/* Paths are read exactly: monospace; long ones wrap */
	.roots :global(.row-title) {
		font-family: var(--mono);
		overflow-wrap: anywhere;
	}
	@media (pointer: coarse) {
		.files-table :global(.row-open) {
			min-height: 44px;
		}
	}
</style>
