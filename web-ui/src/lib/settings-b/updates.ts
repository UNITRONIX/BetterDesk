/**
 * Updates tab: plain rules about a check, its preflight and an install
 * result (old settings.js, "Self-Update"). No DOM, no requests.
 */

import type { Changes, InstallResult, Preflight, ServerInfo, UpdateCheck } from '#lib/api/settings-system.ts';

export type UpdateState = 'idle' | 'checking' | 'uptodate' | 'available' | 'baseline' | 'error';

/** Docker image installs update on the host, not from the page */
export function isDockerMode(check: Pick<UpdateCheck, 'deploymentMode' | 'dockerImageMode'> | null): boolean {
	return !!check && (check.deploymentMode === 'docker-image' || !!check.dockerImageMode);
}

/** What a check found */
export function checkState(check: UpdateCheck): Exclude<UpdateState, 'idle' | 'checking' | 'error'> {
	if (check.baselineEstablished) return 'baseline';
	if (check.updateAvailable) return 'available';
	return 'uptodate';
}

export type ComponentId = 'console' | 'webui' | 'server' | 'agent' | 'scripts' | 'other';

export const COMPONENTS: Readonly<Record<ComponentId, { label: string; auto: boolean }>> = {
	console: { label: 'updates.component_console', auto: true },
	// The new console's sources (web-ui/): part of the console, rebuilt on the server
	webui: { label: 'updates.component_console', auto: true },
	server: { label: 'updates.component_server', auto: true },
	agent: { label: 'updates.component_agent', auto: false },
	scripts: { label: 'updates.component_scripts', auto: true },
	other: { label: 'updates.component_other', auto: false }
};

export interface ComponentRow {
	id: string;
	label: string;
	auto: boolean;
	files: number;
}

/** The changed files per part of BetterDesk, parts without changes left out */
export function componentRows(grouped: Changes['grouped'] | undefined): ComponentRow[] {
	return Object.entries(grouped ?? {})
		.filter(([, files]) => Array.isArray(files) && files.length > 0)
		.map(([id, files]) => {
			const meta = COMPONENTS[id as ComponentId] ?? COMPONENTS.other;
			return { id, label: meta.label, auto: meta.auto, files: files?.length ?? 0 };
		});
}

/** The server part changed: it is built here, so the build tools matter */
export function hasServerUpdate(changes: Changes | null | undefined): boolean {
	return (changes?.grouped?.server?.length ?? 0) > 0;
}

/** Old message about the Go toolchain, said plainly */
export function preflightWarningKey(message: string): string | null {
	if (/toolchain will be (installed|downloaded)/i.test(message) || /below\s+[\d.]+\s*;/i.test(message)) {
		return 'updates.toolchain_will_install';
	}
	return null;
}

export interface PreflightNotice {
	/** Install is blocked by these issues */
	blocked: boolean;
	issues: string[];
	/** Things to know before installing (warnings and capability checks that failed) */
	warnings: string[];
}

/** The notice above the install: null when there is nothing to say */
export function preflightNotice(pf: Preflight | null): PreflightNotice | null {
	if (!pf || pf.ready === null) return null;
	const capability = Object.entries(pf.capabilities?.groups ?? {})
		.filter(([name, group]) => name !== 'health' && group.ready === false)
		.map(([name, group]) => {
			const failed = (group.checks ?? [])
				.filter((c) => c.ready === false)
				.map((c) => `${c.id}: ${c.error || 'blocked'}`)
				.join(', ');
			return `${name}: ${failed || 'blocked'}`;
		});
	const warnings = [...pf.warnings, ...capability];
	if (pf.ready && warnings.length === 0) return null;
	const blocked = !pf.ready && pf.issues.length > 0;
	return { blocked, issues: blocked ? pf.issues : [], warnings };
}

/** Install stays off while the preflight says it can't work */
export function installBlocked(pf: Preflight | null): boolean {
	return !!pf && pf.ready === false;
}

export type ToolsState = { tone: 'good' | 'waiting' | 'warning'; key: string };

/** Can the server part be built on this server? (old checkServerBuildInfo) */
export function buildTools(info: ServerInfo): ToolsState {
	const hasGo = info.goAvailable && info.goMeetsMinimum !== false;
	const needsUpgrade = info.goAvailable && info.goMeetsMinimum === false;
	if (hasGo) return { tone: 'good', key: 'settings.updates_tab.tools_ready' };
	if (needsUpgrade || info.canInstallGo) {
		return {
			tone: 'waiting',
			key: info.vendoredGoInstalled ? 'updates.toolchain_ready' : 'updates.auto_available'
		};
	}
	return { tone: 'warning', key: 'updates.no_method' };
}

/** The toolchain is installed or updated during the update */
export function toolchainWillInstall(info: ServerInfo): boolean {
	const hasGo = info.goAvailable && info.goMeetsMinimum !== false;
	const needsUpgrade = info.goAvailable && info.goMeetsMinimum === false;
	return !!(needsUpgrade || (!hasGo && info.canInstallGo));
}

/** "go version go1.23.4 linux/amd64" → "1.23.4" */
export function goVersionNumber(goVersion: string): string {
	return (goVersion.replace(/^go version\s+/, '').split(/\s+/)[0] ?? '').replace(/^go/, '');
}

/** Where the build tools come from, as a word */
export const GO_SOURCES: Readonly<Record<string, string>> = {
	path: 'settings.updates_tab.tools_system',
	system: 'settings.updates_tab.tools_system',
	vendored: 'settings.updates_tab.tools_console'
};

// ── Install ──

export const PHASES = [
	{ id: 'confirm', key: 'updates.phase_confirm' },
	{ id: 'backup', key: 'updates.phase_backup' },
	{ id: 'console', key: 'updates.phase_console' },
	{ id: 'server', key: 'updates.phase_server' },
	{ id: 'restart', key: 'updates.phase_restart' },
	{ id: 'done', key: 'updates.phase_done' }
] as const;

export type PhaseId = (typeof PHASES)[number]['id'];
export type PhaseState = 'pending' | 'active' | 'done' | 'warning' | 'error' | 'skipped';

const FINISHED: ReadonlySet<PhaseState> = new Set(['done', 'skipped', 'warning', 'error']);

/** Share of finished steps, 0 to 100 */
export function progressPercent(states: Readonly<Record<PhaseId, PhaseState>>): number {
	const done = PHASES.filter((p) => FINISHED.has(states[p.id])).length;
	return Math.round((done / PHASES.length) * 100);
}

/** "Step 3 of 6": the step that runs now, or the last one that changed */
export function currentStep(phase: PhaseId, state: PhaseState): number {
	const idx = PHASES.findIndex((p) => p.id === phase);
	return state === 'pending' ? Math.max(1, idx) : idx + 1;
}

export interface Failures {
	failed?: readonly unknown[];
	servicesFailed?: readonly unknown[];
	consoleRestartBlocked?: string | null;
	restartTimeout?: boolean;
	serverDeploy?: { success?: boolean } | null;
	errorMessage?: string;
}

export function hasUpdateFailures(result: Failures | null | undefined): boolean {
	if (!result) return false;
	return (
		(result.failed?.length ?? 0) > 0 ||
		(result.servicesFailed?.length ?? 0) > 0 ||
		!!result.consoleRestartBlocked ||
		!!result.restartTimeout ||
		result.serverDeploy?.success === false
	);
}

/** Changed web files: the page should load again to show them */
export function needsReload(applied: readonly unknown[] | undefined): boolean {
	return (applied ?? []).some((p) => typeof p === 'string' && /\.(js|css|html|ejs)$/i.test(p));
}

/** The install call lost its connection (proxy timeout), but the update may still run on the server */
export function isRecoverableDisconnect(err: unknown): boolean {
	if (!err || typeof err !== 'object') return false;
	const e = err as { status?: number; message?: string };
	if (e.status === 502 || e.status === 504 || e.status === 0) return true;
	const msg = String(e.message ?? '');
	return /gateway\/proxy timeout/i.test(msg);
}

/** Same commit, also when one side is the short form */
export function shaMatches(a: string | null | undefined, b: string | null | undefined): boolean {
	if (!a || !b) return false;
	const left = a.trim().toLowerCase();
	const right = b.trim().toLowerCase();
	if (!left || !right) return false;
	return left === right || left.startsWith(right.slice(0, 7)) || right.startsWith(left.slice(0, 7));
}

/** The result after the browser lost the install call and the server finished it (old recoverInstallAfterDisconnect) */
export function recoveredResult(
	status: {
		localSHA?: string | null;
		lastResult?: {
			applied?: unknown;
			failed?: InstallResult['failed'];
			servicesFailed?: InstallResult['servicesFailed'];
			consoleRestartBlocked?: string | null;
			serverBuild?: InstallResult['serverBuild'];
			serverDeploy?: InstallResult['serverDeploy'];
		} | null;
	},
	targetSha: string
): InstallResult & { recoveredAfterDisconnect: true } {
	const lr = status.lastResult ?? null;
	const saved = shaMatches(status.localSHA, targetSha);
	const count = typeof lr?.applied === 'number' ? lr.applied : saved ? 1 : 0;
	return {
		applied: Array.from({ length: count }, () => 'recovered'),
		failed: lr?.failed ?? [],
		removed: [],
		servicesFailed: lr?.servicesFailed ?? [],
		needsConsoleRestart: !lr?.consoleRestartBlocked,
		consoleRestartBlocked: lr?.consoleRestartBlocked ?? null,
		serverBuild: lr?.serverBuild ?? null,
		serverDeploy: lr?.serverDeploy ?? null,
		toolchainInstall: null,
		autoRebuild: null,
		agentRebuildQueued: false,
		agentRebuildDeferred: false,
		agentRebuildRemoteSHA: '',
		recoveredAfterDisconnect: true
	};
}

/** Backups to keep: a whole number from 0 (keep all) to 1000 */
export function retentionValid(n: number): boolean {
	return Number.isInteger(n) && n >= 0 && n <= 1000;
}
