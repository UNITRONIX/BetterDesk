<!--
  Settings › Updates (server.config). Check for a newer version and
  install it (step by step in a dialog); the update channel and the
  backups made before updates beside it; the installed and newest version
  in the side column. Docker image installs show the host commands
  instead of Install. Old page: views/settings.ejs "Updates", settings.js
  "Self-Update".
-->
<script lang="ts">
	import {
		checkForUpdates,
		errorText,
		getConsoleStatus,
		getInstallStatus,
		getLastUpdateResult,
		getServerBinaryStatus,
		getServerBuildInfo,
		getUpdateChannel,
		getUpdateChanges,
		getUpdatePreflight,
		installUpdate,
		rebuildServerBinary,
		setUpdateChannel,
		type Changes,
		type Channel,
		type LastResult,
		type Preflight,
		type ServerInfo,
		type UpdateCheck
	} from '#lib/api/settings-system.ts';
	import { formatNumber } from '#lib/i18n/format.ts';
	import { t, tf } from '#lib/i18n/i18n.svelte.ts';
	import { InstallRun } from '#lib/settings-b/install.svelte.ts';
	import TabCols from '#lib/settings-b/TabCols.svelte';
	import UpdateBackups from '#lib/settings-b/UpdateBackups.svelte';
	import UpdateInstall from '#lib/settings-b/UpdateInstall.svelte';
	import {
		GO_SOURCES,
		buildTools,
		checkState,
		componentRows,
		goVersionNumber,
		hasServerUpdate,
		installBlocked,
		isDockerMode,
		preflightNotice,
		preflightWarningKey,
		toolchainWillInstall,
		type UpdateState
	} from '#lib/settings-b/updates.ts';
	import { onRefresh } from '#lib/shell/page.svelte.ts';
	import { can, session } from '#lib/state/session.svelte.ts';
	import BooleanStatus from '#lib/ui/BooleanStatus.svelte';
	import Button from '#lib/ui/Button.svelte';
	import Checkbox from '#lib/ui/Checkbox.svelte';
	import ChoiceList from '#lib/ui/ChoiceList.svelte';
	import CodeBlock from '#lib/ui/CodeBlock.svelte';
	import CountLine from '#lib/ui/CountLine.svelte';
	import Dialog from '#lib/ui/Dialog.svelte';
	import Empty from '#lib/ui/Empty.svelte';
	import Facts, { type Fact } from '#lib/ui/Facts.svelte';
	import IdFacts, { type IdFact } from '#lib/settings-b/IdFacts.svelte';
	import ListRow from '#lib/ui/ListRow.svelte';
	import Notice from '#lib/ui/Notice.svelte';
	import RowList from '#lib/ui/RowList.svelte';
	import States from '#lib/ui/States.svelte';
	import Status from '#lib/ui/Status.svelte';
	import Tag from '#lib/ui/Tag.svelte';
	import Time from '#lib/ui/Time.svelte';
	import ValueCopy from '#lib/ui/ValueCopy.svelte';
	import Version from '#lib/ui/Version.svelte';
	import { confirm } from '#lib/ui/dialogs.svelte.ts';
	import { toast } from '#lib/ui/toasts.svelte.ts';

	const allowed = can('server.config');

	// ── Check ──
	let phase = $state<UpdateState>('idle');
	let stateDetail = $state('');
	let check = $state.raw<UpdateCheck | null>(null);
	let changes = $state.raw<Changes | null>(null);
	let changesFailed = $state(false);
	let preflight = $state.raw<Preflight | null>(null);
	let serverInfo = $state.raw<ServerInfo | null>(null);
	let serverInfoFailed = $state(false);

	const docker = $derived(isDockerMode(check));
	const remoteSha = $derived(phase === 'available' ? (check?.remoteSHA ?? null) : null);
	const serverPart = $derived(hasServerUpdate(changes));
	const notice = $derived(preflightNotice(preflight));
	const blocked = $derived(installBlocked(preflight));

	const headline = $derived(
		{
			idle: t('updates.title'),
			checking: t('updates.checking'),
			uptodate: t('updates.up_to_date'),
			available: t('updates.update_available'),
			baseline: t('updates.baseline_set'),
			error: tf('updates.check_failed', 'Could not check for updates')
		}[phase]
	);
	const description = $derived(
		phase === 'idle'
			? t('settings.updates_tab.idle_note')
			: (phase === 'uptodate' || phase === 'available' || phase === 'error') && stateDetail
				? stateDetail
				: t('settings.updates_tab.desc')
	);

	async function runCheck() {
		phase = 'checking';
		changes = null;
		changesFailed = false;
		preflight = null;
		serverInfo = null;
		serverInfoFailed = false;
		try {
			const data = await checkForUpdates();
			check = data;
			const found = checkState(data);
			if (found === 'available') {
				const behind =
					(data.commitsBehind ?? 0) > 0
						? t('settings.updates_tab.changes_behind', { n: formatNumber(data.commitsBehind) })
						: '';
				const label = isDockerMode(data)
					? t('updates.docker_update_available')
					: t('updates.update_available');
				stateDetail = [data.latestMessage || label, behind && `(${behind})`].filter(Boolean).join(' ');
				phase = 'available';
				if (data.remoteSHA) {
					try {
						changes = await getUpdateChanges(data.remoteSHA);
						if (hasServerUpdate(changes) && !isDockerMode(data)) void loadServerInfo();
					} catch {
						changesFailed = true;
					}
				}
				await refreshPreflight();
			} else {
				stateDetail = found === 'uptodate' ? data.latestMessage || '' : '';
				phase = found;
			}
		} catch (err) {
			stateDetail = errorText(err, t('errors.server_error'));
			phase = 'error';
			toast.error(stateDetail);
		}
	}

	async function refreshPreflight() {
		if (docker || !remoteSha) {
			preflight = null;
			return;
		}
		try {
			preflight = await getUpdatePreflight(serverPart ? { sha: remoteSha } : null);
		} catch {
			preflight = { ready: true, issues: [], warnings: [] };
		}
	}

	async function loadServerInfo() {
		try {
			serverInfo = await getServerBuildInfo();
		} catch {
			serverInfoFailed = true;
		}
	}

	// ── Installed version, channel ──
	let channel = $state.raw<Channel | null>(null);
	let channelChoice = $state<'stable' | 'development'>('stable');
	let channelBusy = $state(false);
	const channelName = (c: string | undefined) =>
		c === 'development'
			? t('settings.updates_tab.channel_development')
			: t('settings.updates_tab.channel_stable');

	async function loadChannel() {
		try {
			channel = await getUpdateChannel();
			channelChoice = channel.channel === 'development' ? 'development' : 'stable';
		} catch {
			channel = null;
		}
	}

	async function channelPicked(next: 'stable' | 'development') {
		const saved = channel?.channel === 'development' ? 'development' : 'stable';
		if (channelBusy || next === saved) return;
		const yes = await confirm({
			title: t('updates.channel_save'),
			message: t('settings.updates_tab.channel_confirm', { to: channelName(next) }),
			confirmLabel: t('updates.channel_save')
		});
		if (!yes) {
			channelChoice = saved;
			return;
		}
		channelBusy = true;
		try {
			const r = await setUpdateChannel(next);
			await loadChannel();
			toast.success(t('updates.channel_saved'));
			// Another branch: what was checked no longer applies
			if (r?.previousBranch && r.previousBranch !== r.branch) {
				phase = 'idle';
				check = null;
				changes = null;
				preflight = null;
			}
		} catch (err) {
			channelChoice = saved;
			toast.error(errorText(err, t('updates.channel_save_failed')));
		} finally {
			channelBusy = false;
		}
	}

	// ── Server program out of date, last install with errors ──
	let stale = $state<{ stale: boolean; detail: string } | null>(null);
	let rebuilding = $state(false);
	let lastResult = $state.raw<LastResult | null>(null);

	async function loadBinaryStatus() {
		try {
			const s = await getServerBinaryStatus();
			stale = s.dockerMode ? null : { stale: !!s.stale, detail: s.detail ?? '' };
		} catch {
			stale = null;
		}
	}

	async function rebuild() {
		rebuilding = true;
		try {
			await rebuildServerBinary();
			toast.success(t('updates.rebuild_server_success'));
			await loadBinaryStatus();
		} catch (err) {
			toast.error(errorText(err, t('updates.rebuild_server_failed')));
		} finally {
			rebuilding = false;
		}
	}

	async function loadLastResult() {
		try {
			const r = await getLastUpdateResult();
			lastResult = r && (r.failed?.length || r.servicesFailed?.length || r.consoleRestartBlocked) ? r : null;
		} catch {
			/* optional */
		}
	}

	// ── Install ──
	let createBackup = $state(true);
	let confirmInstall = $state<{ warnings: string[] } | null>(null);
	let run = $state.raw<InstallRun | null>(null);

	const scopeItems = $derived(
		componentRows(changes?.grouped).map(
			(r) => `${t(r.label)}: ${formatNumber(r.files)} ${t('updates.files')}`
		)
	);

	async function askInstall() {
		if (!remoteSha) {
			toast.error(t('updates.no_version'));
			return;
		}
		let warnings: string[] = [];
		try {
			const pf = await getUpdatePreflight(serverPart ? { sha: remoteSha } : null);
			if (pf.ready === false && pf.issues.length) {
				toast.error(pf.issues.join('; '));
				return;
			}
			warnings = pf.warnings;
		} catch {
			/* the install itself checks again */
		}
		confirmInstall = { warnings };
	}

	function startInstall() {
		confirmInstall = null;
		if (!remoteSha) return;
		const r = new InstallRun({
			install: installUpdate,
			status: getInstallStatus,
			consoleVersion: async () => (await getConsoleStatus()).cacheVersion ?? '',
			sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
			now: () => Date.now(),
			clock: () => new Date().toLocaleTimeString()
		});
		run = r;
		void r.run(remoteSha, createBackup, serverPart).then(() => {
			void loadLastResult();
			void loadBinaryStatus();
		});
	}

	async function retry() {
		const yes = await confirm({
			title: t('updates.retry_update'),
			message: t('updates.retry_confirm'),
			confirmLabel: t('updates.retry_update'),
			confirmIcon: 'retry'
		});
		if (!yes) return;
		run = null;
		startInstall();
	}

	$effect(() => {
		if (!allowed) return;
		void loadChannel();
		void loadBinaryStatus();
		void loadLastResult();
		return onRefresh(() => {
			void loadChannel();
			void loadBinaryStatus();
			void loadLastResult();
		});
	});

	// ── Side column ──
	const sideFacts = $derived<IdFact[]>([
		{ id: 'update-local-version', label: t('updates.current_version'), value: installed },
		{ label: t('updates.channel_title'), value: channelFact },
		{ id: 'update-remote-version', label: t('settings.updates_tab.newest_version'), value: newest },
		...(check && phase !== 'checking' && phase !== 'error'
			? [{ id: 'update-status-badge', label: t('updates.status'), value: statusFact }]
			: [])
	]);
	const toolsFacts = $derived<Fact[]>(
		serverInfo
			? [
					{ label: t('settings.updates_tab.fact_binary'), value: binaryPath },
					{ label: t('settings.updates_tab.fact_source'), value: sourcePresent },
					{ label: t('settings.updates_tab.fact_tools'), value: goTools }
				]
			: []
	);
</script>

{#snippet installed()}
	<Version version={check?.localVersion || session.appVersion} />
{/snippet}
{#snippet channelFact()}
	{#if channel}
		<span class="side-value">
			<span>{channelName(channel.channel)}</span>
			{#if channel.branch}
				<span class="side-sub"
					>{t('settings.updates_tab.channel_source', {
						repo: `${channel.owner || 'UNITRONIX'}/${channel.repo || 'BetterDesk'}`,
						branch: channel.branch
					})}</span
				>
			{/if}
		</span>
	{:else}
		<Empty />
	{/if}
{/snippet}
{#snippet newest()}
	{#if !check}
		<Empty word={t('settings.updates_tab.not_checked')} />
	{:else if !check.remoteSHA && !check.latestDate}
		<Empty />
	{:else}
		<span class="side-value">
			{#if check.latestDate}
				<Time
					value={check.latestDate}
					relative={false}
					format={{ year: 'numeric', month: 'short', day: 'numeric' }}
				/>
			{:else}
				<span class="mono">{check.remoteSHA?.slice(0, 7)}</span>
			{/if}
			{#if check.latestMessage || check.remoteSHA}
				<span class="side-sub"
					>{check.latestMessage}{#if check.latestMessage && check.remoteSHA},
					{/if}{#if check.remoteSHA}<span class="mono">{check.remoteSHA.slice(0, 7)}</span>{/if}</span
				>
			{/if}
		</span>
	{/if}
{/snippet}
{#snippet statusFact()}
	{#if phase === 'baseline'}
		<Status tone="good" label={t('updates.baseline_set')} />
	{:else if phase === 'available'}
		<span class="side-value">
			<Status
				tone="warning"
				label={docker ? t('updates.docker_update_available') : t('updates.update_available')}
			/>
			{#if (check?.commitsBehind ?? 0) > 0}
				<span class="side-sub"
					>{t('settings.updates_tab.changes_behind', { n: formatNumber(check?.commitsBehind) })}</span
				>
			{/if}
		</span>
	{:else}
		<Status
			tone="good"
			label={check?.dockerShaUnknown ? t('updates.docker_sha_unknown') : t('updates.up_to_date')}
		/>
	{/if}
{/snippet}
{#snippet binaryPath()}
	<ValueCopy value={serverInfo?.binaryPath} copy={false} />
{/snippet}
{#snippet sourcePresent()}
	<BooleanStatus value={!!serverInfo?.sourcePresent} on={t('common.yes')} off={t('common.no')} />
{/snippet}
{#snippet goTools()}
	{#if serverInfo?.goAvailable}
		<Version version={goVersionNumber(serverInfo.goVersion ?? '')} />
		{#if serverInfo.goSource}<Tag label={t(GO_SOURCES[serverInfo.goSource] ?? serverInfo.goSource)} />{/if}
	{:else}
		<Empty word={t('settings.updates_tab.tools_missing')} />
	{/if}
{/snippet}

{#if !allowed}
	<States message={t('settings.page.admin_only')} />
{:else}
	<TabCols sideLabel={t('settings.side.state_title')}>
		{#snippet main()}
			<div class="settings-grid">
				<div class="settings-stack">
					<section class="section" aria-labelledby="update-status-headline">
						<h2 id="update-status-headline">{headline}</h2>
						<p class="section-note" role="status">{description}</p>
						<div class="settings-inline-controls">
							<Button
								id="update-check-btn"
								icon="refresh"
								busy={phase === 'checking'}
								onclick={() => void runCheck()}
								>{phase === 'checking' ? t('updates.checking') : t('updates.check_now')}</Button
							>
						</div>
						{#if notice}
							<Notice tone={notice.blocked ? 'danger' : 'info'}>
								{#if notice.blocked}
									<p class="notice-title">{t('updates.preflight_blocked_title')}</p>
									<ul>
										{#each notice.issues as issue, i (i)}<li>{issue}</li>{/each}
									</ul>
								{/if}
								{#if notice.warnings.length}
									<p class="notice-title">
										{notice.blocked
											? t('updates.preflight_warnings_title')
											: t('updates.preflight_info_title')}
									</p>
									{#if !notice.blocked}<p class="hint">{t('updates.preflight_info_note')}</p>{/if}
									<ul>
										{#each notice.warnings as w, i (i)}
											{@const key = preflightWarningKey(w)}
											<li>{key ? t(key) : w}</li>
										{/each}
									</ul>
								{/if}
							</Notice>
						{/if}
						{#if docker}
							<div class="stack">
								<Notice
									title={t('settings.updates_tab.docker_title')}
									message={t('settings.updates_tab.docker_desc')}
								/>
								<CodeBlock
									title={t('settings.updates_tab.docker_commands')}
									code={(
										check?.dockerUpdate?.commands ?? ['docker compose pull', 'docker compose up -d']
									).join('\n')}
								/>
								{#if check?.dockerUpdate?.images?.length}
									<p class="hint">{t('updates.docker_images')}: {check.dockerUpdate.images.join(', ')}</p>
								{/if}
							</div>
						{:else if stale?.stale}
							<div class="stack">
								<Notice
									tone="warning"
									title={t('updates.server_stale_title')}
									message={stale.detail
										? `${t('updates.server_stale_desc')} (${stale.detail})`
										: t('updates.server_stale_desc')}
								/>
								<div>
									<Button id="update-rebuild-server-btn" busy={rebuilding} onclick={rebuild}
										>{rebuilding ? t('updates.rebuilding_server') : t('updates.rebuild_server')}</Button
									>
								</div>
							</div>
						{/if}
						{#if lastResult}
							<Notice tone="danger">
								<p>
									<strong>{t('updates.complete_with_errors')}</strong>
									<span class="mono">{lastResult.sha?.slice(0, 7)}</span>, <Time value={lastResult.savedAt} />
								</p>
								<ul>
									{#each lastResult.failed ?? [] as f, i (i)}<li>{f.file}: {f.error}</li>{/each}
									{#each lastResult.servicesFailed ?? [] as s, i (i)}<li>{s.service}: {s.error}</li>{/each}
									{#if lastResult.consoleRestartBlocked}<li>{lastResult.consoleRestartBlocked}</li>{/if}
								</ul>
							</Notice>
						{/if}
					</section>

					{#if phase === 'available'}
						<section class="section" id="update-details-section" aria-labelledby="update-available-heading">
							<h2 id="update-available-heading">{t('updates.update_available')}</h2>
							<h3>{t('updates.changelog')}</h3>
							{#if changesFailed}
								<States message={t('updates.changes_unavailable')} />
							{:else if !changes}
								<States kind="loading" />
							{:else if !changes.commits.length}
								<States message={t('updates.no_changelog')} />
							{:else}
								<RowList>
									{#each changes.commits.slice(0, 20) as c, i (i)}
										<ListRow title={c.message ?? ''}>
											{#snippet sub()}
												<span class="mono">{c.sha}</span>, {c.author}, <Time value={c.date} />
											{/snippet}
										</ListRow>
									{/each}
								</RowList>
							{/if}
							{#if changes}
								<h3>{t('updates.files_changed')}</h3>
								<div class="table-scroll">
									<table class="data-table">
										<thead>
											<tr>
												<th scope="col">{t('settings.updates_tab.component')}</th>
												<th scope="col" class="is-num">{t('settings.updates_tab.files')}</th>
												<th scope="col">{t('settings.updates_tab.how')}</th>
											</tr>
										</thead>
										<tbody>
											{#each componentRows(changes.grouped) as row (row.id)}
												<tr>
													<td>{t(row.label)}</td>
													<td class="is-num">{formatNumber(row.files)}</td>
													<td>{row.auto ? t('updates.auto') : t('updates.manual')}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
								<CountLine
									text={`${t('updates.total_files')}: {n}`}
									values={{ n: changes.totalFiles ?? 0 }}
								/>
								{#if serverPart}
									<div class="stack">
										<p>
											<strong>{t('updates.include_server')}</strong>
											{#if docker}{:else if serverInfo}
												{@const tools = buildTools(serverInfo)}
												<Status tone={tools.tone} label={t(tools.key)} />
											{:else if serverInfoFailed}
												<Status tone="warning" label={t('updates.go_check_failed')} />
											{:else}
												<Status tone="waiting" label={t('updates.checking_go')} />
											{/if}
										</p>
										<p class="hint">{t('updates.auto_strategy_hint')}</p>
										{#if serverInfo}
											<Facts items={toolsFacts} />
											{#if toolchainWillInstall(serverInfo)}<p class="hint">
													{t('updates.toolchain_will_install')}
												</p>{/if}
										{/if}
									</div>
								{/if}
							{/if}
							<div class="form-column stack">
								<Checkbox
									id="update-backup-toggle"
									label={t('updates.create_backup')}
									bind:checked={createBackup}
								/>
								<p class="field-effect is-restart">{t('settings.updates_tab.install_effect')}</p>
								{#if docker}
									<p class="hint">{t('settings.updates_tab.docker_install_note')}</p>
								{:else}
									<div class="settings-inline-controls">
										<Button
											id="update-install-btn"
											variant="primary"
											icon="system_update"
											disabled={blocked || !remoteSha || (!!run && run.state === 'running')}
											onclick={() => void askInstall()}>{t('updates.install')}</Button
										>
									</div>
									{#if blocked}<p class="hint">{t('updates.install_blocked_hint')}</p>{/if}
								{/if}
							</div>
						</section>
					{/if}
				</div>

				<div class="settings-stack">
					<section
						class="section form-column"
						id="update-channel-panel"
						aria-labelledby="update-channel-title"
					>
						<h2 id="update-channel-title">{t('updates.channel_title')}</h2>
						<p class="section-note">{t('settings.updates_tab.channel_note')}</p>
						<fieldset id="update-channel-select" class="channel" disabled={docker || channelBusy}>
							<legend class="sr-only">{t('updates.channel_title')}</legend>
							<ChoiceList
								name="update-channel"
								labelledby="update-channel-title"
								describedby="update-channel-effect"
								bind:value={channelChoice}
								onchange={(v, on) => on && void channelPicked(v)}
								choices={[
									{
										value: 'stable' as const,
										title: t('settings.updates_tab.channel_stable'),
										description: t('settings.updates_tab.channel_stable_desc')
									},
									{
										value: 'development' as const,
										title: t('settings.updates_tab.channel_development'),
										description: t('settings.updates_tab.channel_development_desc')
									}
								]}
							/>
							<p class="field-effect" id="update-channel-effect">
								{t('settings.updates_tab.channel_effect')}
							</p>
							{#if docker}<p class="hint">{t('settings.updates_tab.channel_docker_note')}</p>{/if}
						</fieldset>
					</section>
					<UpdateBackups />
				</div>
			</div>
		{/snippet}

		{#snippet side()}
			<section class="section" aria-labelledby="updates-side-title">
				<h2 id="updates-side-title">{t('settings.side.state_title')}</h2>
				<IdFacts items={sideFacts} />
			</section>
		{/snippet}
	</TabCols>
{/if}

{#if confirmInstall}
	<Dialog title={t('updates.confirm_title')} onclose={() => (confirmInstall = null)}>
		<p>{t('updates.install_confirm')}</p>
		<ul class="confirm-list">
			<li>{createBackup ? t('updates.confirm_with_backup') : t('updates.confirm_no_backup')}</li>
			{#each scopeItems as item, i (i)}<li>{item}</li>{/each}
			{#if serverPart}<li>{t('updates.auto_strategy_hint')}</li>{/if}
		</ul>
		{#each confirmInstall.warnings as w, i (i)}
			<p class="hint">{w}</p>
		{/each}
		{#snippet footer()}
			<Button onclick={() => (confirmInstall = null)}>{t('actions.cancel')}</Button>
			<Button variant="primary" icon="system_update" onclick={startInstall}>{t('updates.install')}</Button>
		{/snippet}
	</Dialog>
{/if}

{#if run}
	<UpdateInstall {run} onclose={() => (run = null)} onretry={() => void retry()} />
{/if}

<style>
	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.hint {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.mono {
		font-family: var(--mono);
	}
	.notice-title {
		font-weight: 600;
	}
	.settings-stack :global(.notice ul),
	.confirm-list {
		margin: var(--space-1) 0 0;
		padding-inline-start: 1.25em;
	}
	.channel {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}
	.channel :global(.choice-list) {
		margin-inline: calc(-1 * var(--row-pad-x));
	}
	/* The files table (components.css .data-table) */
	.table-scroll {
		max-width: var(--measure);
		overflow-x: auto;
	}
	.data-table {
		width: 100%;
		border-collapse: collapse;
	}
	.data-table th,
	.data-table td {
		padding: var(--row-pad-y) var(--row-pad-x);
		border-bottom: 1px solid var(--rule);
		text-align: start;
	}
	.data-table th {
		color: var(--text-muted);
		font-weight: 600;
		font-size: var(--text-sm);
	}
	.data-table .is-num {
		text-align: end;
		font-variant-numeric: tabular-nums;
	}
</style>
