<!--
  Updates › Backups made before updates (old settings.js loadUpdateBackups,
  retention and prune): the copies of the files each update replaced, to
  put back or delete, and how many to keep. Folded by default.
-->
<script lang="ts">
	import {
		deleteUpdateBackup,
		errorText,
		getBackupRetention,
		listUpdateBackups,
		pruneUpdateBackups,
		restoreUpdateBackup,
		setBackupRetention,
		type UpdateBackup
	} from '#lib/api/settings-system.ts';
	import { formatBytes, formatNumber } from '#lib/i18n/format.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import Button from '#lib/ui/Button.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Field from '#lib/ui/Field.svelte';
	import Input from '#lib/ui/Input.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Time from '#lib/ui/Time.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';
	import { retentionValid } from './updates.ts';

	let backups = $state.raw<UpdateBackup[]>([]);
	let listState = $state<'loading' | 'ready' | 'error'>('loading');
	let listError = $state('');
	let keep = $state<number | null>(0);
	let busy = $state<string | null>(null);

	const total = $derived(backups.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0));

	async function load() {
		try {
			backups = await listUpdateBackups();
			listState = 'ready';
		} catch (err) {
			listError = errorText(err, t('errors.server_error'));
			listState = 'error';
		}
	}

	async function loadRetention() {
		try {
			keep = (await getBackupRetention()).count ?? 0;
		} catch {
			keep = 0;
		}
	}

	async function saveRetention() {
		const n = Number(keep);
		if (keep === null || !retentionValid(n)) {
			toast.error(t('updates.retention_invalid'));
			return;
		}
		busy = 'retention';
		try {
			await setBackupRetention(n);
			toast.success(t('updates.retention_saved'));
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
		} finally {
			busy = null;
		}
	}

	async function prune() {
		const n = Number(keep);
		if (!Number.isInteger(n) || n <= 0) {
			toast.error(t('updates.retention_required_for_prune'));
			return;
		}
		const yes = await confirm({
			title: t('settings.updates_tab.prune_now'),
			message: t('updates.prune_confirm', { n }),
			confirmLabel: t('settings.updates_tab.prune_now'),
			danger: true
		});
		if (!yes) return;
		busy = 'prune';
		try {
			const r = await pruneUpdateBackups(n);
			toast.success(t('updates.prune_done', { n: r.deleted?.length ?? 0 }));
			await load();
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
		} finally {
			busy = null;
		}
	}

	async function restore(name: string) {
		const yes = await confirm({
			title: t('settings.updates_tab.restore_files'),
			message: t('updates.restore_confirm'),
			confirmLabel: t('settings.updates_tab.restore_files'),
			danger: true
		});
		if (!yes) return;
		busy = name;
		try {
			await restoreUpdateBackup(name);
			toast.success(t('updates.restore_success'));
			// The console restarts with the restored files
			setTimeout(() => location.reload(), 2000);
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
			busy = null;
		}
	}

	async function remove(name: string) {
		const yes = await confirm({
			title: t('updates.delete'),
			message: t('updates.delete_confirm', { name }),
			confirmLabel: t('updates.delete'),
			danger: true
		});
		if (!yes) return;
		busy = name;
		try {
			await deleteUpdateBackup(name);
			toast.success(t('updates.delete_success'));
			await load();
		} catch (err) {
			toast.error(errorText(err, t('errors.server_error')));
		} finally {
			busy = null;
		}
	}

	$effect(() => {
		void load();
		void loadRetention();
	});
</script>

<Disclosure id="update-backups-panel" title={t('updates.backups_title')}>
	<div class="backups">
		<p class="section-note">{t('settings.updates_tab.backups_note')}</p>
		{#if listState === 'ready' && backups.length}
			<CountLine
				text={t('settings.updates_tab.backups_summary', { size: formatBytes(total) })}
				values={{ count: backups.length }}
			/>
		{/if}
		{#if listState === 'loading'}
			<States kind="loading" />
		{:else if listState === 'error'}
			<States kind="error" message={listError} onretry={() => void load()} />
		{:else if !backups.length}
			<States message={t('updates.no_backups')} />
		{:else}
			<RowList>
				{#each backups as b (b.name)}
					<ListRow title={b.name}>
						{#snippet sub()}
							<Time value={b.timestamp} />{#if b.sha},
								<span class="mono">{b.sha}</span>{/if},
							{formatNumber(b.fileCount || b.filesBackedUp || 0)}
							{t('updates.files')}, {formatBytes(b.sizeBytes ?? 0)}
						{/snippet}
						{#snippet end()}
							<Button size="sm" busy={busy === b.name} onclick={() => void restore(b.name)}
								>{t('settings.updates_tab.restore_files')}</Button
							>
							<Button
								size="sm"
								variant="danger-quiet"
								disabled={busy === b.name}
								onclick={() => void remove(b.name)}>{t('updates.delete')}</Button
							>
						{/snippet}
					</ListRow>
				{/each}
			</RowList>
		{/if}
		<Field
			id="backup-retention-input"
			label={t('settings.updates_tab.retention_label')}
			hint={t('updates.retention_hint')}
		>
			{#snippet children(f)}
				<div class="settings-inline-controls">
					<Input {...f} type="number" width="short" min="0" max="1000" step="1" bind:value={keep} />
					<Button id="backup-retention-save" busy={busy === 'retention'} onclick={saveRetention}
						>{t('settings.updates_tab.retention_save')}</Button
					>
					<Button id="backup-prune-now" busy={busy === 'prune'} onclick={prune}
						>{t('settings.updates_tab.prune_now')}</Button
					>
				</div>
			{/snippet}
		</Field>
	</div>
</Disclosure>

<style>
	.backups {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.backups > .section-note {
		margin-top: 0;
	}
	.settings-inline-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.mono {
		font-family: var(--mono);
	}
</style>
