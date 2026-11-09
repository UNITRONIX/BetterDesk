<!--
  Settings › Backup (server.config). Download a full backup; make backups
  on a schedule (with the network share login); restore from a file. The
  side column has the schedule's state and what a backup made now holds.
  Old page: views/settings.ejs "Backup", settings.js initBackupSection.
-->
<script lang="ts">
	import {
		downloadBackup,
		errorText,
		getBackupSchedule,
		getBackupStats,
		getSmb,
		restoreBackup,
		runScheduledBackup,
		saveBackupSchedule,
		saveSmb,
		testBackupDestination,
		testSmb,
		type BackupStats,
		type RestoreResult,
		type Schedule,
		type ScheduleStatus
	} from '#lib/api/settings-system.ts';
	import { t } from '#lib/i18n/i18n.svelte.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import {
		INTERVALS,
		JSON_RESTORE_ITEMS,
		RESTORE_PARTS,
		canRestore,
		fileKind,
		nextBackup,
		restoreFields,
		restoreHint,
		restoreNeedsRestart,
		type RestorePart
	} from '#lib/settings-b/backup.ts';
	import TabCols from '#lib/settings-b/TabCols.svelte';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Disclosure from '#lib/ui/Disclosure.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import IdFacts, { type IdFact } from '#lib/settings-b/IdFacts.svelte';
	import { trackDirty } from '#lib/settings/dirty.ts';
	import Field from '#lib/ui/Field.svelte';
	import FilePicker from '#lib/ui/FilePicker.svelte';
	import FormStatus from '#lib/ui/FormStatus.svelte';
	import Input from '#lib/ui/Input.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import SaveBar from '#lib/ui/SaveBar.svelte';
	import Select from '#lib/ui/Select.svelte';
	import ShowWhen, { showWhenControl } from '#lib/ui/ShowWhen.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Switch from '#lib/ui/Switch.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import { createForm } from '#lib/ui/form.svelte.ts';

	const allowed = can('server.config');

	/** Sample values in empty fields (paths and host names, the same in every language) */
	const SAMPLE = { path: '/mnt/backups', smbHost: 'nas.example.local' } as const;

	type Line = { message: string; tone: 'neutral' | 'ok' | 'error' };
	const NONE: Line = { message: '', tone: 'neutral' };
	const ok = (message: string): Line => ({ message, tone: 'ok' });
	const fail = (err: unknown): Line => ({ message: errorText(err, t('errors.server_error')), tone: 'error' });

	// ── What a backup holds now ──
	let stats = $state.raw<BackupStats | null>(null);
	let statsError = $state('');

	async function loadStats() {
		try {
			stats = await getBackupStats();
			statsError = '';
		} catch (err) {
			statsError = errorText(err, t('errors.server_error'));
		}
	}

	// ── Download ──
	let downloading = $state(false);
	let downloadLine = $state<Line>(NONE);

	async function download() {
		downloading = true;
		downloadLine = NONE;
		try {
			const { blob, filename } = await downloadBackup();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
			downloadLine = ok(t('settings.backup_tab.downloaded', { name: filename }));
		} catch (err) {
			downloadLine = fail(err);
		} finally {
			downloading = false;
		}
	}

	// ── Schedule ──
	interface ScheduleValues {
		enabled: boolean;
		intervalHours: number;
		retentionCount: number | null;
		destinationType: 'local' | 'path';
		destinationPath: string;
	}
	const fromSchedule = (s: Schedule | null | undefined): ScheduleValues => ({
		enabled: !!s?.enabled,
		intervalHours: Number(s?.intervalHours) || 24,
		retentionCount: Number(s?.retentionCount) || 7,
		destinationType: s?.destinationType === 'path' ? 'path' : 'local',
		destinationPath: s?.destinationPath ?? ''
	});

	let savedSchedule = $state.raw<Schedule | null>(null);
	let scheduleStatus = $state.raw<ScheduleStatus | null>(null);
	let scheduleLine = $state<Line>(NONE);
	let testing = $state(false);
	let running = $state(false);

	const schedule = createForm<ScheduleValues>({
		id: 'scheduled-backup-form',
		initial: fromSchedule(null),
		submit: async (v) => {
			await saveBackupSchedule({
				enabled: v.enabled,
				intervalHours: v.intervalHours,
				retentionCount: Number(v.retentionCount) || 7,
				destinationType: v.destinationType,
				destinationPath: v.destinationPath
			});
			scheduleLine = NONE;
			void refreshSchedule();
		},
		savedMessage: t('backup.schedule_saved')
	});

	async function loadSchedule() {
		try {
			const data = await getBackupSchedule();
			savedSchedule = data.schedule ?? null;
			scheduleStatus = data.status ?? null;
			schedule.reset(fromSchedule(data.schedule));
		} catch (err) {
			scheduleLine = fail(err);
		}
	}

	/** The side column follows the saved schedule; the form keeps what is typed */
	async function refreshSchedule() {
		try {
			const data = await getBackupSchedule();
			savedSchedule = data.schedule ?? savedSchedule;
			scheduleStatus = data.status ?? scheduleStatus;
		} catch {
			/* the side keeps the last known state */
		}
	}

	async function testDestination() {
		testing = true;
		try {
			const r = await testBackupDestination({
				destinationType: schedule.values.destinationType,
				destinationPath: schedule.values.destinationPath
			});
			scheduleLine = ok(`${t('backup.schedule_destination_ok')}: ${r?.destination ?? ''}`);
		} catch (err) {
			scheduleLine = fail(err);
		} finally {
			testing = false;
		}
	}

	async function runNow() {
		running = true;
		try {
			const r = await runScheduledBackup();
			scheduleLine = ok(`${t('backup.schedule_run_success')}: ${r?.filename ?? ''}`);
		} catch (err) {
			scheduleLine = fail(err);
		} finally {
			running = false;
			void refreshSchedule();
		}
	}

	// ── Network share login ──
	let smbOpen = $state(false);
	let smbLine = $state<Line>(NONE);
	let smbTesting = $state(false);

	const smb = createForm({
		id: 'scheduled-backup-smb-form',
		initial: { host: '', share: '', domain: '', username: '', password: '', mountPath: '' },
		submit: async (v) => {
			await saveSmb(v);
			smbLine = NONE;
		},
		savedMessage: t('backup.smb_saved')
	});

	async function loadSmb() {
		try {
			const s = await getSmb();
			smb.reset({
				host: s.host ?? '',
				share: s.share ?? '',
				domain: s.domain ?? '',
				username: s.username ?? '',
				password: s.password ?? '',
				mountPath: s.mountPath ?? ''
			});
			// A saved share login is shown open; an unused one stays folded
			if (s.host) smbOpen = true;
		} catch (err) {
			smbLine = fail(err);
			smbOpen = true;
		}
	}

	async function testShare() {
		smbTesting = true;
		try {
			const r = await testSmb($state.snapshot(smb.values));
			smbLine = ok(`${t('backup.smb_test_success')}: ${r?.target ?? ''}`);
		} catch (err) {
			smbLine = fail(err);
		} finally {
			smbTesting = false;
		}
	}

	// ── Restore: file, parts, Restore, confirm ──
	let files = $state<FileList | null>(null);
	let picked = $state.raw<ReadonlySet<RestorePart['field']>>(new Set());
	let restoring = $state(false);
	let restoreLine = $state<Line>(NONE);
	let result = $state.raw<RestoreResult | null>(null);
	let confirming = $state(false);

	const file = $derived(files?.[0] ?? null);
	const kind = $derived(fileKind(file?.name));
	const hint = $derived(restoreHint(kind, picked.size));
	const startable = $derived(canRestore(kind, picked.size));
	const confirmItems = $derived(
		kind === 'json'
			? JSON_RESTORE_ITEMS.map((k) => t(k))
			: RESTORE_PARTS.filter((p) => picked.has(p.field)).map((p) => t(p.label))
	);
	const fileError = $derived(kind === 'invalid' ? t('backup.invalid_format') : '');

	/** A new file starts without the last result */
	function fileChosen() {
		result = null;
		restoreLine = NONE;
	}

	function togglePart(field: RestorePart['field'], on: boolean) {
		// A new set each time: picked is replaced, never changed in place
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const next = new Set(picked);
		if (on) next.add(field);
		else next.delete(field);
		picked = next;
	}

	async function restore() {
		confirming = false;
		if (!file || !startable) return;
		restoring = true;
		restoreLine = NONE;
		try {
			result = await restoreBackup(file, restoreFields(kind === 'archive' ? picked : new Set()));
			restoreLine = ok(t('backup.restore_success'));
		} catch (err) {
			restoreLine = fail(err);
		} finally {
			restoring = false;
		}
	}

	// ── Side column ──
	const next = $derived(nextBackup(savedSchedule, scheduleStatus));
	const stateFacts = $derived<Fact[]>([
		{ label: t('backup.schedule_last_run'), value: lastRun },
		{ label: t('settings.side.next_backup'), value: nextRun },
		{ label: t('settings.side.backup_kept'), value: savedTo }
	]);
	const num = (n: number | undefined) => (stats ? formatNumber(n ?? 0) : undefined);
	const contentFacts = $derived<IdFact[]>([
		{
			id: 'backup-stat-users',
			label: t('backup.stat_users'),
			value: statsError ? statsFailed : num(stats?.users)
		},
		{ id: 'backup-stat-settings', label: t('backup.stat_settings'), value: num(stats?.settings) },
		{ id: 'backup-stat-folders', label: t('backup.stat_folders'), value: num(stats?.folders) },
		{
			id: 'backup-stat-groups',
			label: t('backup.stat_groups'),
			value: stats ? formatNumber((stats.userGroups ?? 0) + (stats.deviceGroups ?? 0)) : undefined
		},
		{
			id: 'backup-stat-strategies',
			label: t('settings.backup_tab.stat_strategies'),
			value: num(stats?.strategies)
		},
		{
			id: 'backup-stat-backend',
			label: t('settings.backup_tab.stat_backend'),
			value: stats
				? stats.backend === 'betterdesk'
					? t('settings.backup_tab.backend_betterdesk')
					: 'RustDesk'
				: undefined
		},
		{
			id: 'backup-stat-database',
			label: t('backup.stat_database'),
			value: stats ? (stats.dbType === 'postgres' ? 'PostgreSQL' : 'SQLite') : undefined
		},
		{ id: 'backup-stat-keys', label: t('backup.stat_keys'), value: stats ? keysIncluded : undefined },
		{ id: 'backup-stat-env', label: t('backup.stat_env'), value: stats ? envIncluded : undefined },
		{
			id: 'backup-stat-uploads',
			label: t('settings.backup_tab.stat_uploads'),
			value: num(stats?.components.uploads)
		}
	]);

	$effect(() => {
		if (!allowed) return;
		void loadStats();
		void loadSchedule();
		void loadSmb();
		return onRefresh(() => {
			void loadStats();
			void refreshSchedule();
		});
	});

	const intervalOptions = $derived(INTERVALS.map((i) => ({ value: i.value as number, label: t(i.label) })));
	const destinationOptions = $derived([
		{ value: 'local' as const, label: t('backup.schedule_destination_local') },
		{ value: 'path' as const, label: t('backup.schedule_destination_path') }
	]);
	// Leaving the tab with unsaved changes asks first (the settings page)
	$effect(() => trackDirty(() => schedule.dirty));
	$effect(() => trackDirty(() => smb.dirty));

	// One primary on the page: Download, unless a form has unsaved changes
	const anyDirty = $derived(schedule.dirty || smb.dirty);
</script>

{#snippet lastRun()}
	<Time value={scheduleStatus?.lastSuccessAt} empty={t('settings.side.backup_none')} />
{/snippet}
{#snippet nextRun()}
	{#if next.kind === 'off'}
		<Status tone="neutral" label={t('settings.side.backup_off')} />
	{:else if next.kind === 'soon'}
		<Status tone="waiting" label={t('settings.side.backup_soon')} />
	{:else if next.kind === 'at'}
		<Time value={next.at} relative={false} />
	{:else}
		<Time value={null} />
	{/if}
{/snippet}
{#snippet savedTo()}
	{#if savedSchedule?.destinationType === 'path' && savedSchedule.destinationPath}
		<ValueCopy value={savedSchedule.destinationPath} copy={false} />
	{:else}
		{t('backup.schedule_destination_local')}
	{/if}
{/snippet}
{#snippet statsFailed()}
	<Status tone="danger" label={statsError} />
{/snippet}
{#snippet keysIncluded()}
	<BooleanStatus
		value={!!(stats?.components.goPrivKey || stats?.components.goApiKey)}
		on={t('common.yes')}
		off={t('common.no')}
	/>
{/snippet}
{#snippet envIncluded()}
	<BooleanStatus value={!!stats?.components.env} on={t('common.yes')} off={t('common.no')} />
{/snippet}

{#if !allowed}
	<States message={t('settings.page.admin_only')} />
{:else}
	<TabCols sideLabel={t('settings.side.state_title')}>
		{#snippet main()}
			<nav class="settings-toc" aria-label={t('settings.page.on_this_page')}>
				<ul class="toc">
					<li><a href="#backup-create">{t('settings.backup_tab.create_title')}</a></li>
					<li><a href="#scheduled-backup-panel">{t('backup.schedule_title')}</a></li>
					<li><a href="#scheduled-backup-smb-panel">{t('settings.backup_tab.smb_title')}</a></li>
					<li><a href="#backup-restore">{t('settings.backup_tab.restore_title')}</a></li>
				</ul>
			</nav>

			<div class="settings-grid">
				<section class="section" id="backup-create" aria-labelledby="backup-create-title">
					<h2 id="backup-create-title">{t('settings.backup_tab.create_title')}</h2>
					<p class="section-note">{t('settings.backup_tab.create_note')}</p>
					<Notice tone="warning" message={t('backup.security_warning')} />
					<div class="settings-inline-controls">
						<Button
							id="backup-download-btn"
							variant={anyDirty ? 'secondary' : 'primary'}
							icon="download"
							busy={downloading}
							onclick={download}>{downloading ? t('backup.creating') : t('backup.download')}</Button
						>
						<FormStatus message={downloadLine.message} tone={downloadLine.tone} />
					</div>
				</section>

				<div class="settings-stack">
					<section class="section" id="scheduled-backup-panel" aria-labelledby="scheduled-backup-title">
						<h2 id="scheduled-backup-title">{t('backup.schedule_title')}</h2>
						<p class="section-note">{t('settings.backup_tab.schedule_note')}</p>
						<form class="form-column" id={schedule.id} onsubmit={schedule.onsubmit} novalidate>
							<Switch
								id="scheduled-backup-enabled"
								label={t('backup.schedule_enabled')}
								hint={t('settings.backup_tab.schedule_enabled_hint')}
								bind:checked={schedule.values.enabled}
								{...showWhenControl('scheduled-backup-details', schedule.values.enabled)}
							/>
							<ShowWhen
								id="scheduled-backup-details"
								when={schedule.values.enabled}
								class="settings-subfields"
							>
								<Field id="scheduled-backup-interval" label={t('backup.schedule_interval')} width="medium">
									{#snippet children(f)}
										<Select {...f} options={intervalOptions} bind:value={schedule.values.intervalHours} />
									{/snippet}
								</Field>
								<Field
									id="scheduled-backup-retention"
									label={t('backup.schedule_retention')}
									hint={t('settings.backup_tab.retention_hint')}
									width="short"
								>
									{#snippet children(f)}
										<Input
											{...f}
											type="number"
											min="1"
											max="365"
											bind:value={schedule.values.retentionCount}
										/>
									{/snippet}
								</Field>
								<Field id="scheduled-backup-destination-type" label={t('backup.schedule_destination')}>
									{#snippet children(f)}
										<Select
											{...f}
											options={destinationOptions}
											bind:value={schedule.values.destinationType}
											aria-controls="scheduled-backup-path-group"
										/>
									{/snippet}
								</Field>
								<ShowWhen id="scheduled-backup-path-group" when={schedule.values.destinationType === 'path'}>
									<Field
										id="scheduled-backup-path"
										label={t('backup.schedule_destination_path_label')}
										hint={t('backup.schedule_destination_path_hint')}
										width="host"
									>
										{#snippet children(f)}
											<Input
												{...f}
												class="mono"
												placeholder={SAMPLE.path}
												spellcheck="false"
												bind:value={schedule.values.destinationPath}
											/>
										{/snippet}
									</Field>
								</ShowWhen>
							</ShowWhen>
							<FormStatus message={scheduleLine.message} tone={scheduleLine.tone} />
							<p class="field-effect">{t('settings.backup_tab.schedule_effect')}</p>
							<SaveBar form={schedule} label={t('backup.schedule_save')}>
								{#if schedule.values.enabled}
									<Button busy={testing} onclick={testDestination}
										>{t('backup.schedule_test_destination')}</Button
									>
									<Button busy={running} onclick={runNow}
										>{running ? t('backup.creating') : t('settings.backup_tab.run_now')}</Button
									>
								{/if}
							</SaveBar>
						</form>
					</section>

					<Disclosure
						id="scheduled-backup-smb-panel"
						title={t('settings.backup_tab.smb_title')}
						bind:open={smbOpen}
					>
						<p class="section-note smb-note">{t('settings.backup_tab.smb_note')}</p>
						<form class="form-column smb-form" id={smb.id} onsubmit={smb.onsubmit} novalidate>
							<Field id="backup-smb-host" label={t('backup.smb_host')} width="host">
								{#snippet children(f)}
									<Input
										{...f}
										class="mono"
										autocomplete="off"
										spellcheck="false"
										placeholder={SAMPLE.smbHost}
										bind:value={smb.values.host}
									/>
								{/snippet}
							</Field>
							<Field id="backup-smb-share" label={t('backup.smb_share')} width="host">
								{#snippet children(f)}
									<Input {...f} autocomplete="off" spellcheck="false" bind:value={smb.values.share} />
								{/snippet}
							</Field>
							<Field
								id="backup-smb-domain"
								label={t('backup.smb_domain')}
								hint={t('settings.backup_tab.smb_domain_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input {...f} autocomplete="off" spellcheck="false" bind:value={smb.values.domain} />
								{/snippet}
							</Field>
							<Field id="backup-smb-username" label={t('backup.smb_username')} width="host">
								{#snippet children(f)}
									<Input {...f} autocomplete="off" spellcheck="false" bind:value={smb.values.username} />
								{/snippet}
							</Field>
							<Field
								id="backup-smb-password"
								label={t('backup.smb_password')}
								hint={t('backup.smb_password_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input
										{...f}
										type="password"
										autocomplete="new-password"
										bind:value={smb.values.password}
									/>
								{/snippet}
							</Field>
							<Field
								id="backup-smb-mount-path"
								label={t('settings.backup_tab.smb_mount_path')}
								hint={t('settings.backup_tab.smb_mount_path_hint')}
								width="host"
							>
								{#snippet children(f)}
									<Input
										{...f}
										class="mono"
										placeholder={SAMPLE.path}
										spellcheck="false"
										bind:value={smb.values.mountPath}
									/>
								{/snippet}
							</Field>
							<FormStatus message={smbLine.message} tone={smbLine.tone} />
							<p class="field-effect">{t('settings.backup_tab.smb_effect')}</p>
							<SaveBar form={smb} label={t('backup.smb_save')}>
								<Button busy={smbTesting} onclick={testShare}>{t('backup.smb_test')}</Button>
							</SaveBar>
						</form>
					</Disclosure>
				</div>
			</div>

			<section class="danger-zone" id="backup-restore" aria-labelledby="backup-restore-title">
				<h2 id="backup-restore-title">{t('settings.backup_tab.restore_title')}</h2>
				<p class="section-note">{t('settings.backup_tab.restore_note')}</p>
				<div class="form-column restore">
					<Field
						id="restore-file-input"
						label={t('settings.backup_tab.restore_file')}
						hint={t('settings.backup_tab.restore_file_hint')}
					>
						{#snippet children(f)}
							<FilePicker
								{...f}
								accept=".gz,.tar.gz,.json"
								aria-controls="restore-options"
								bind:files
								onchange={fileChosen}
							/>
						{/snippet}
					</Field>
					{#if hint}
						<p class="restore-hint" role="status">{t(hint)}</p>
					{/if}
					<fieldset id="restore-options" class="restore-options" hidden={kind !== 'archive'}>
						<legend>{t('settings.backup_tab.restore_what')}</legend>
						{#each RESTORE_PARTS as part (part.field)}
							<Checkbox
								id={part.id}
								label={t(part.label)}
								hint={t(part.desc)}
								checked={picked.has(part.field)}
								onchange={(e) => togglePart(part.field, e.currentTarget.checked)}
							/>
						{/each}
					</fieldset>
					{#if kind === 'json'}
						<Notice message={t('settings.backup_tab.restore_json_note')} />
					{/if}
					{#if kind}
						<div class="settings-inline-controls">
							<Button
								id="restore-start-btn"
								variant="danger-quiet"
								disabled={!startable}
								busy={restoring}
								onclick={() => (confirming = true)}
								>{restoring
									? t('settings.backup_tab.restoring')
									: t('settings.backup_tab.restore_button')}</Button
							>
							<FormStatus
								message={fileError || restoreLine.message}
								tone={fileError ? 'error' : restoreLine.tone}
							/>
						</div>
					{/if}
					{#if result}
						<div class="restore-result">
							{#if result.restored.length || result.skipped.length || result.backupDate}
								<dl class="facts">
									{#if result.restored.length}
										<dt>{t('backup.restored')}</dt>
										<dd>{result.restored.join(', ')}</dd>
									{/if}
									{#if result.skipped.length}
										<dt>{t('backup.skipped')}</dt>
										<dd>{result.skipped.join(', ')}</dd>
									{/if}
									{#if result.backupDate}
										<dt>{t('backup.backup_date')}</dt>
										<dd><Time value={result.backupDate} relative={false} /></dd>
									{/if}
								</dl>
							{/if}
							{#if result.warnings.length}
								<Notice tone="warning">
									{#each result.warnings as w, i (i)}<p>{w}</p>{/each}
								</Notice>
							{/if}
							{#if result.requiresRestart}
								<Notice tone="warning" message={t('backup.restart_required')} />
							{/if}
						</div>
					{/if}
				</div>
			</section>
		{/snippet}

		{#snippet side()}
			<section class="section" aria-labelledby="backup-side-title">
				<h2 id="backup-side-title">{t('settings.side.state_title')}</h2>
				<Facts items={stateFacts} />
				{#if scheduleStatus?.lastError}
					<p class="state-error">{t('settings.side.backup_failed', { error: scheduleStatus.lastError })}</p>
				{/if}
			</section>
			<section class="section" aria-labelledby="backup-contents-title">
				<h2 id="backup-contents-title">{t('settings.backup_tab.contents_title')}</h2>
				<p class="section-note">{t('settings.backup_tab.contents_note')}</p>
				<IdFacts items={contentFacts} />
			</section>
		{/snippet}
	</TabCols>
{/if}

{#if confirming && file}
	<Dialog title={t('settings.backup_tab.confirm_title')} onclose={() => (confirming = false)}>
		<p>{t('settings.backup_tab.confirm_intro', { file: file.name })}</p>
		<ul class="confirm-list">
			{#each confirmItems as item, i (i)}<li>{item}</li>{/each}
		</ul>
		<p>{t('settings.backup_tab.confirm_undo')}</p>
		{#if restoreNeedsRestart(kind, picked)}
			<Notice tone="warning" message={t('backup.restart_required')} />
		{/if}
		{#snippet footer()}
			<Button onclick={() => (confirming = false)}>{t('actions.cancel')}</Button>
			<Button variant="danger" onclick={restore}>{t('settings.backup_tab.confirm_button')}</Button>
		{/snippet}
	</Dialog>
{/if}

<style>
	/* Contents: a row of links above the forms; on wide screens every section is in view */
	.toc {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.toc a {
		display: inline-flex;
		align-items: center;
		min-height: var(--control-h-sm);
		color: var(--text-muted);
	}
	.toc a:hover {
		color: var(--text);
	}
	@media (pointer: coarse) {
		.toc a {
			min-height: 44px;
		}
	}
	@media (min-width: 1200px) {
		.settings-toc {
			display: none;
		}
	}

	.smb-note {
		margin-top: 0;
	}
	.smb-form {
		margin-top: var(--space-3);
	}

	.danger-zone {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-5);
		border-top: 1px solid var(--rule);
	}
	.danger-zone > h2 {
		color: var(--danger);
	}
	.restore {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.restore :global(.form-group) {
		margin-bottom: 0;
	}
	.restore-hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.restore-options {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.restore-options > legend {
		margin-bottom: var(--space-2);
		font-weight: 600;
	}
	.restore-result {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.state-error {
		color: var(--danger);
	}
	.confirm-list {
		margin: var(--space-2) 0;
		padding-inline-start: 1.25em;
	}
</style>
