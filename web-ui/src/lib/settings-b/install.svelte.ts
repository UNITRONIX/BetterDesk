/**
 * One update install, step by step (old settings.js installUpdate,
 * finishInstallUi, pollConsoleRestart). The dialog (UpdateInstall.svelte)
 * draws this state; the requests come in as deps so tests can run it.
 *
 * Steps: confirmation, backup, console files, server, restart, done. The
 * install call can outlive a proxy: when it is cut off, the server's
 * install status is asked every 3 s for up to 10 minutes. When the
 * console restarts itself, the status probe is asked every 2 s (90 times)
 * until the console answers with a new cache version.
 */

import type { InstallResult, InstallStatus } from '#lib/api/settings-system.ts';
import { tf } from '#lib/i18n/i18n.svelte.ts';
import {
	PHASES,
	currentStep,
	hasUpdateFailures,
	isRecoverableDisconnect,
	needsReload,
	progressPercent,
	recoveredResult,
	shaMatches,
	type Failures,
	type PhaseId,
	type PhaseState
} from './updates.ts';

export interface InstallDeps {
	install: (sha: string, createBackup: boolean) => Promise<InstallResult>;
	status: () => Promise<InstallStatus>;
	/** The console's cache version now (changes when it restarted) */
	consoleVersion: () => Promise<string>;
	sleep: (ms: number) => Promise<void>;
	now: () => number;
	/** Time of day for the log lines */
	clock: () => string;
}

export type RunState = 'running' | 'success_reload' | 'success_no_reload' | 'partial_error' | 'error';

export type Outcome = Failures & {
	applied?: readonly unknown[];
	removed?: readonly unknown[];
	serverBuild?: InstallResult['serverBuild'];
	errorMessage?: string;
};

export const RECOVERY_MAX_MS = 600_000;
export const RECOVERY_STEP_MS = 3000;
export const RESTART_STEP_MS = 2000;
export const RESTART_MAX = 90;

function allPending(): Record<PhaseId, PhaseState> {
	return Object.fromEntries(PHASES.map((p) => [p.id, 'pending'])) as Record<PhaseId, PhaseState>;
}

const say = (key: string, fallback: string, params?: Record<string, string | number>) =>
	tf(key, fallback, params);

export class InstallRun {
	phases = $state<Record<PhaseId, PhaseState>>(allPending());
	detail = $state('');
	step = $state(1);
	log = $state<string[]>([]);
	state = $state<RunState>('running');
	outcome = $state.raw<Outcome | null>(null);
	readonly percent = $derived(progressPercent(this.phases));

	#deps: InstallDeps;
	#stopped = false;

	constructor(deps: InstallDeps) {
		this.#deps = deps;
	}

	/** The dialog closed or the page left: stop waiting */
	stop(): void {
		this.#stopped = true;
	}

	setPhase(id: PhaseId, state: PhaseState, detail?: string): void {
		this.phases = { ...this.phases, [id]: state };
		if (detail) this.detail = detail;
		this.step = currentStep(id, state);
	}

	logLine(line: string): void {
		this.log = [...this.log, `[${this.#deps.clock()}] ${line}`];
	}

	async run(sha: string, createBackup: boolean, hasServerUpdate: boolean): Promise<void> {
		this.#stopped = false;
		this.phases = allPending();
		this.log = [];
		this.outcome = null;
		this.state = 'running';
		this.detail = say('updates.preparing', 'Preparing…');
		let before = '';
		try {
			before = await this.#deps.consoleVersion();
		} catch {
			/* unknown: any answer after the restart counts */
		}
		this.setPhase('confirm', 'done');
		if (createBackup) this.setPhase('backup', 'active', say('updates.creating_backup', 'Creating backup…'));
		else
			this.setPhase('backup', 'skipped', say('updates.backup_skipped', 'Backup skipped (per user choice)'));
		if (!hasServerUpdate)
			this.setPhase('console', 'active', say('updates.downloading', 'Downloading files…'));
		this.logLine(`Starting update to ${sha.slice(0, 7)}…`);

		let result: InstallResult & { recoveredAfterDisconnect?: boolean };
		try {
			try {
				result = await this.#deps.install(sha, createBackup);
			} catch (err) {
				if (!isRecoverableDisconnect(err)) throw err;
				const msg = say(
					'updates.proxy_timeout_recovering',
					'Gateway/proxy timeout — checking whether the update is still running on the server…'
				);
				this.logLine(msg);
				this.setPhase('console', 'active', msg);
				result = await this.#recover(sha);
			}
		} catch (err) {
			const message =
				err instanceof Error && err.message
					? err.message
					: say('updates.install_failed', 'Update installation failed');
			const active = PHASES.find((p) => this.phases[p.id] === 'active');
			if (active) this.setPhase(active.id, 'error', message);
			this.logLine(`ERROR: ${message}`);
			this.#end('error', { errorMessage: message });
			return;
		}
		await this.#finish(result, hasServerUpdate, before);
	}

	async #recover(sha: string): Promise<InstallResult & { recoveredAfterDisconnect: true }> {
		const started = this.#deps.now();
		let sawRunning = false;
		while (this.#deps.now() - started < RECOVERY_MAX_MS && !this.#stopped) {
			try {
				const st = await this.#deps.status();
				if (st.inProgress) {
					if (!sawRunning)
						this.logLine(say('updates.install_still_running', 'Update is still running on the server…'));
					sawRunning = true;
					this.setPhase(
						'console',
						'active',
						say('updates.install_still_running', 'Update is still running on the server…')
					);
				} else if (sawRunning || shaMatches(st.localSHA, sha)) {
					this.logLine(
						say(
							'updates.install_recovered',
							'Update finished on the server after the browser connection dropped'
						)
					);
					return recoveredResult(st, sha);
				}
			} catch {
				// The console may be restarting in the middle: keep waiting
				this.setPhase('restart', 'active', say('updates.restarting', 'Waiting for console to restart…'));
			}
			await this.#deps.sleep(RECOVERY_STEP_MS);
		}
		throw new Error(
			say(
				'updates.install_recovery_timeout',
				'Timed out waiting for the update to finish after a gateway disconnect.'
			)
		);
	}

	async #finish(
		result: InstallResult & { recoveredAfterDisconnect?: boolean },
		hasServerUpdate: boolean,
		before: string
	): Promise<void> {
		for (const p of ['backup', 'console'] as const) {
			if (this.phases[p] !== 'done' && this.phases[p] !== 'skipped') this.setPhase(p, 'done');
		}
		const deployFailed = result.serverDeploy?.success === false;
		if (hasServerUpdate) {
			if (result.toolchainInstall) {
				this.logLine(
					result.toolchainInstall.success
						? `Go toolchain ready: ${result.toolchainInstall.version ?? ''}`.trim()
						: `Go toolchain install failed: ${result.toolchainInstall.error || 'unknown'}`
				);
			}
			if (result.serverBuild) {
				if (result.serverBuild.success && !deployFailed) {
					const secs = result.serverBuild.duration ? Math.round(result.serverBuild.duration / 1000) : 0;
					const built = say('updates.server_built', 'Server binary compiled');
					const detail = secs ? `${built}, ${secs} s` : built;
					this.setPhase('server', 'done', detail);
					this.logLine(detail);
				} else if (result.serverBuild.success && deployFailed) {
					const detail = say('updates.server_deploy_failed', 'Server deploy failed');
					this.setPhase('server', 'error', detail);
					this.logLine(`${detail}: ${result.serverDeploy?.error ?? ''}`);
				} else {
					const detail = say('updates.server_build_failed', 'Server compilation failed');
					this.setPhase('server', 'error', detail);
					this.logLine(`${detail}: ${result.serverBuild.error ?? ''}`);
				}
			} else if (result.recoveredAfterDisconnect) {
				this.setPhase('server', 'done', say('updates.install_recovered', 'Update finished on the server'));
			} else {
				this.setPhase('server', 'skipped', say('updates.server_skipped', 'Go server skipped'));
			}
			if (result.autoRebuild?.success) {
				this.logLine(`${say('updates.server_built', 'Server binary compiled')} (auto-rebuild)`);
				this.setPhase('server', 'done', say('updates.server_built', 'Server binary compiled'));
			} else if (result.autoRebuild?.error) {
				this.logLine(`Auto-rebuild: ${result.autoRebuild.error}`);
			}
		} else {
			this.setPhase('server', 'skipped', say('updates.server_skipped', 'Go server skipped'));
		}

		this.logLine(
			`${say('updates.applied', 'Applied')}: ${result.applied?.length ?? 0}, ${say('updates.failed', 'Failed')}: ${
				result.failed?.length ?? 0
			}, ${say('updates.removed', 'Removed')}: ${result.removed?.length ?? 0}`
		);
		if (result.agentRebuildDeferred) {
			this.logLine(
				`Support Agent rebuild deferred until the console restarts (${result.agentRebuildRemoteSHA?.slice(0, 7) || 'pending'}).`
			);
		} else if (result.agentRebuildQueued) {
			this.logLine(
				say('updates.agent_rebuild_queued', 'Support Agent generator rebuild queued.')
					.replace('{{count}}', String(result.agentRebuildBundles ?? '?'))
					.replace('{{staged}}', String(result.agentSourcesStaged ?? 0))
					.replace('{{paths}}', String(result.agentSourcePaths ?? 0))
			);
		}
		for (const f of result.failed ?? []) {
			this.logLine(
				f.file === 'support-agent-source-sync'
					? `${say('updates.agent_source_sync_failed', 'Support Agent source sync failed.')} ${f.error ?? ''}`
					: `${f.file}: ${f.error ?? ''}`
			);
		}
		for (const s of result.servicesFailed ?? []) this.logLine(`${s.service}: ${s.error ?? ''}`);

		if (result.needsConsoleRestart && !result.consoleRestartBlocked) {
			this.setPhase('restart', 'active', say('updates.restarting', 'Waiting for console to restart…'));
			this.logLine(say('updates.console_will_restart', 'Console process will restart now…'));
			// systemd/NSSM need a few seconds to replace the process
			await this.#deps.sleep(result.recoveredAfterDisconnect ? 2000 : 8000);
			await this.#waitForRestart(result, before);
		} else if (result.consoleRestartBlocked) {
			this.setPhase('restart', 'error', result.consoleRestartBlocked);
			this.logLine(result.consoleRestartBlocked);
			this.setPhase(
				'done',
				'done',
				say('updates.complete_with_errors', 'The update finished, but some steps failed.')
			);
			this.#end(hasUpdateFailures(result) ? 'partial_error' : 'success_no_reload', result);
		} else {
			this.setPhase('restart', 'skipped', say('updates.no_restart_needed', 'No restart required'));
			this.setPhase('done', 'done', say('updates.complete', 'Update applied'));
			this.#end(hasUpdateFailures(result) ? 'partial_error' : 'success_no_reload', result);
		}
	}

	async #waitForRestart(result: InstallResult, before: string): Promise<void> {
		for (let attempt = 1; attempt <= RESTART_MAX && !this.#stopped; attempt++) {
			this.setPhase(
				'restart',
				'active',
				`${say('updates.restarting', 'Waiting for console to restart…')} (${attempt}/${RESTART_MAX})`
			);
			try {
				const version = await this.#deps.consoleVersion();
				if (!(before && version && version === before)) {
					const done = say('updates.restart_complete', 'Console restarted successfully');
					this.setPhase('restart', 'done', done);
					this.setPhase('done', 'done', say('updates.complete', 'Update applied'));
					this.logLine(done);
					const merged = { ...result, restartTimeout: false };
					this.#end(hasUpdateFailures(merged) ? 'partial_error' : 'success_reload', merged);
					return;
				}
			} catch {
				// Still down
			}
			await this.#deps.sleep(RESTART_STEP_MS);
		}
		if (this.#stopped) return;
		const late = say('updates.restart_timeout', 'The console did not come back in time.');
		this.setPhase('restart', 'warning', late);
		this.setPhase('done', 'done', say('updates.complete', 'Update applied'));
		this.logLine(late);
		this.#end('partial_error', { ...result, restartTimeout: true });
	}

	#end(state: RunState, outcome: Outcome): void {
		this.outcome = outcome;
		this.state = state;
	}

	/** Changed web files: offer to load the page again */
	get offersReload(): boolean {
		return (
			this.state === 'success_reload' ||
			(this.state === 'success_no_reload' && needsReload(this.outcome?.applied))
		);
	}
}
