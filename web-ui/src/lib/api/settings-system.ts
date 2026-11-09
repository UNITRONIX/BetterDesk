/**
 * The system settings tabs: Backup, Updates, Email, Time zones, Advanced
 * (routes/settings.routes.js, commercialization.routes.js for the clock,
 * lib/smtpSettingsHandlers.js). Every write needs server.config; the clock
 * reads need billing.view (or server.config, see BUGS.md "Found by
 * settings-b"). Shapes are the server's, unchanged.
 */

import * as v from 'valibot';
import { ApiError, BoolLike, NumLike, Text, api, clientMessages, wrapped } from './client.ts';
import { RestartItem } from './restart.ts';

const Any = v.unknown();
const Num = v.pipe(
	v.optional(v.nullable(NumLike)),
	v.transform((n) => n ?? 0)
);
const NullableText = v.optional(v.nullable(v.string()), null);

// ── Backup ──

export const BackupStats = v.looseObject({
	users: Num,
	settings: Num,
	folders: Num,
	userGroups: Num,
	deviceGroups: Num,
	strategies: Num,
	backend: Text,
	dbType: Text,
	components: v.optional(
		v.looseObject({
			env: BoolLike,
			goPrivKey: BoolLike,
			goApiKey: BoolLike,
			uploads: Num
		}),
		{}
	)
});
export type BackupStats = v.InferOutput<typeof BackupStats>;

export function getBackupStats(signal?: AbortSignal) {
	return api(wrapped(BackupStats), '/api/settings/backup/stats', { signal });
}

export const Schedule = v.looseObject({
	enabled: BoolLike,
	intervalHours: v.optional(NumLike, 24),
	retentionCount: v.optional(NumLike, 7),
	destinationType: v.pipe(
		v.optional(v.nullable(v.string())),
		v.transform((d): 'local' | 'path' => (d === 'path' ? 'path' : 'local'))
	),
	destinationPath: Text
});
export type Schedule = v.InferOutput<typeof Schedule>;

export const ScheduleStatus = v.looseObject({
	lastAttemptAt: NullableText,
	lastSuccessAt: NullableText,
	lastFile: NullableText,
	lastError: NullableText
});
export type ScheduleStatus = v.InferOutput<typeof ScheduleStatus>;

const ScheduleInfo = wrapped(
	v.looseObject({
		schedule: v.optional(v.nullable(Schedule)),
		status: v.optional(v.nullable(ScheduleStatus))
	})
);

export function getBackupSchedule(signal?: AbortSignal) {
	return api(ScheduleInfo, '/api/settings/backup/schedule', { signal });
}

export interface ScheduleInput {
	enabled: boolean;
	intervalHours: number;
	retentionCount: number;
	destinationType: 'local' | 'path';
	destinationPath: string;
}

export function saveBackupSchedule(input: ScheduleInput) {
	return api(wrapped(v.optional(v.nullable(Schedule))), '/api/settings/backup/schedule', {
		method: 'PUT',
		body: input
	});
}

export function testBackupDestination(input: Pick<ScheduleInput, 'destinationType' | 'destinationPath'>) {
	return api(
		wrapped(v.optional(v.nullable(v.looseObject({ destination: Text })))),
		'/api/settings/backup/destination/test',
		{ method: 'POST', body: input }
	);
}

export function runScheduledBackup() {
	return api(
		wrapped(v.optional(v.nullable(v.looseObject({ filename: Text })))),
		'/api/settings/backup/schedule/run',
		{ method: 'POST' }
	);
}

export const Smb = v.looseObject({
	host: Text,
	share: Text,
	domain: Text,
	username: Text,
	password: Text,
	mountPath: Text
});
export type Smb = v.InferOutput<typeof Smb>;

export function getSmb(signal?: AbortSignal) {
	return api(wrapped(Smb), '/api/settings/backup/smb', { signal });
}

export function saveSmb(input: Smb) {
	return api(wrapped(Any), '/api/settings/backup/smb', { method: 'PUT', body: input });
}

export function testSmb(input: Smb) {
	return api(
		wrapped(v.optional(v.nullable(v.looseObject({ target: Text })))),
		'/api/settings/backup/smb/test',
		{ method: 'POST', body: input }
	);
}

export const RestoreResult = v.looseObject({
	type: Text,
	restored: v.optional(v.array(v.string()), []),
	skipped: v.optional(v.array(v.string()), []),
	warnings: v.optional(v.array(v.string()), []),
	requiresRestart: BoolLike,
	backupDate: NullableText
});
export type RestoreResult = v.InferOutput<typeof RestoreResult>;

/** Upload a .tar.gz archive or an old .json settings file with the parts to restore */
export function restoreBackup(file: File, parts: Record<string, boolean>) {
	const form = new FormData();
	form.append('backup', file);
	for (const [field, on] of Object.entries(parts)) form.append(field, String(on));
	return api(wrapped(RestoreResult), '/api/settings/restore', { method: 'POST', body: form });
}

/**
 * Download a full backup. The server builds the archive in memory and
 * answers with the file, so this waits for all of it; the name comes from
 * Content-Disposition. Errors arrive as JSON.
 */
export async function downloadBackup(): Promise<{ blob: Blob; filename: string }> {
	let res: Response;
	try {
		res = await fetch('/api/settings/backup', { credentials: 'same-origin' });
	} catch {
		throw new ApiError(clientMessages.network, 0);
	}
	if (!res.ok) {
		// The usual error handling (403 sentence, 401 to the sign-in page)
		let body: unknown = null;
		try {
			body = await res.json();
		} catch {
			/* not JSON */
		}
		const message =
			res.status === 403
				? clientMessages.permission
				: body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
					? (body as { error: string }).error
					: clientMessages.failed.replace('{status}', String(res.status));
		throw new ApiError(message, res.status);
	}
	const blob = await res.blob();
	const match = (res.headers.get('Content-Disposition') ?? '').match(/filename="?([^";]+)"?/i);
	const filename = match?.[1] || `betterdesk-backup-${new Date().toISOString().slice(0, 10)}.tar.gz`;
	return { blob, filename };
}

// ── Updates ──

export const Channel = v.looseObject({
	channel: v.optional(v.string(), 'stable'),
	branch: Text,
	owner: Text,
	repo: Text
});
export type Channel = v.InferOutput<typeof Channel>;

export function getUpdateChannel(signal?: AbortSignal) {
	return api(wrapped(Channel), '/api/settings/updates/channel', { signal });
}

export function setUpdateChannel(channel: 'stable' | 'development') {
	return api(
		wrapped(v.optional(v.nullable(v.looseObject({ branch: Text, previousBranch: Text })))),
		'/api/settings/updates/channel',
		{ method: 'POST', body: { channel } }
	);
}

const FileError = v.looseObject({ file: Text, error: Text });
const ServiceError = v.looseObject({ service: Text, error: Text });

export const LastResult = v.looseObject({
	sha: Text,
	savedAt: NullableText,
	failed: v.optional(v.array(FileError), []),
	servicesFailed: v.optional(v.array(ServiceError), []),
	consoleRestartBlocked: NullableText
});
export type LastResult = v.InferOutput<typeof LastResult>;

export function getLastUpdateResult(signal?: AbortSignal) {
	return api(wrapped(v.optional(v.nullable(LastResult), null)), '/api/settings/updates/last-result', {
		signal
	});
}

export const BinaryStatus = v.looseObject({
	stale: BoolLike,
	dockerMode: BoolLike,
	detail: Text
});

export function getServerBinaryStatus(signal?: AbortSignal) {
	return api(wrapped(BinaryStatus), '/api/settings/updates/server-binary/status', { signal });
}

export function rebuildServerBinary() {
	return api(wrapped(Any), '/api/settings/updates/server-binary/rebuild', { method: 'POST' });
}

export const UpdateCheck = v.looseObject({
	localVersion: Text,
	remoteSHA: NullableText,
	updateAvailable: BoolLike,
	baselineEstablished: BoolLike,
	commitsBehind: Num,
	latestMessage: Text,
	latestDate: NullableText,
	dockerShaUnknown: BoolLike,
	deploymentMode: Text,
	dockerImageMode: BoolLike,
	dockerUpdate: v.optional(
		v.nullable(
			v.looseObject({
				commands: v.optional(v.array(v.string())),
				images: v.optional(v.array(v.string()))
			})
		)
	)
});
export type UpdateCheck = v.InferOutput<typeof UpdateCheck>;

export function checkForUpdates() {
	return api(wrapped(UpdateCheck), '/api/settings/updates/check');
}

export const Commit = v.looseObject({ sha: Text, message: Text, author: Text, date: NullableText });
export type Commit = v.InferOutput<typeof Commit>;

export const Changes = v.looseObject({
	commits: v.optional(v.array(Commit), []),
	grouped: v.optional(v.record(v.string(), v.optional(v.nullable(v.array(v.unknown())))), {}),
	totalFiles: Num
});
export type Changes = v.InferOutput<typeof Changes>;

export function getUpdateChanges(sha: string) {
	return api(wrapped(Changes), '/api/settings/updates/changes', { query: { sha } });
}

const CapabilityCheck = v.looseObject({ id: Text, ready: v.optional(v.boolean()), error: Text });
export const Preflight = v.looseObject({
	ready: v.optional(v.nullable(v.boolean()), true),
	issues: v.optional(v.array(v.string()), []),
	warnings: v.optional(v.array(v.string()), []),
	capabilities: v.optional(
		v.nullable(
			v.looseObject({
				groups: v.optional(
					v.record(
						v.string(),
						v.looseObject({
							ready: v.optional(v.boolean()),
							checks: v.optional(v.array(CapabilityCheck), [])
						})
					),
					{}
				)
			})
		)
	)
});
export type Preflight = v.InferOutput<typeof Preflight>;

export function getUpdatePreflight(serverUpdate: { sha: string } | null) {
	return api(wrapped(Preflight), '/api/settings/updates/preflight', {
		query: serverUpdate ? { serverUpdate: 1, sha: serverUpdate.sha } : undefined
	});
}

export const ServerInfo = v.looseObject({
	goAvailable: BoolLike,
	goMeetsMinimum: v.optional(v.nullable(v.boolean())),
	goVersion: Text,
	goSource: Text,
	canInstallGo: BoolLike,
	vendoredGoInstalled: BoolLike,
	binaryPath: Text,
	sourcePresent: BoolLike
});
export type ServerInfo = v.InferOutput<typeof ServerInfo>;

export function getServerBuildInfo() {
	return api(wrapped(ServerInfo), '/api/settings/updates/server-info');
}

const BuildStep = v.optional(
	v.nullable(v.looseObject({ success: v.optional(v.boolean()), error: Text, duration: Num, version: Text }))
);

export const InstallResult = v.looseObject({
	applied: v.optional(v.array(v.unknown()), []),
	failed: v.optional(v.array(FileError), []),
	removed: v.optional(v.array(v.unknown()), []),
	servicesFailed: v.optional(v.array(ServiceError), []),
	needsConsoleRestart: BoolLike,
	consoleRestartBlocked: NullableText,
	serverBuild: BuildStep,
	serverDeploy: BuildStep,
	toolchainInstall: BuildStep,
	autoRebuild: BuildStep,
	agentRebuildQueued: BoolLike,
	agentRebuildDeferred: BoolLike,
	agentRebuildBundles: v.optional(v.unknown()),
	agentSourcesStaged: v.optional(v.unknown()),
	agentSourcePaths: v.optional(v.unknown()),
	agentRebuildRemoteSHA: Text
});
export type InstallResult = v.InferOutput<typeof InstallResult>;

export function installUpdate(remoteSHA: string, createBackup: boolean) {
	return api(wrapped(InstallResult), '/api/settings/updates/install', {
		method: 'POST',
		body: { remoteSHA, createBackup }
	});
}

export const InstallStatus = v.looseObject({
	inProgress: BoolLike,
	localSHA: NullableText,
	lastResult: v.optional(
		v.nullable(
			v.looseObject({
				applied: v.optional(v.unknown()),
				failed: v.optional(v.array(FileError), []),
				servicesFailed: v.optional(v.array(ServiceError), []),
				servicesRestarted: v.optional(v.array(v.unknown()), []),
				consoleRestartBlocked: NullableText,
				serverBuild: BuildStep,
				serverDeploy: BuildStep
			})
		)
	)
});
export type InstallStatus = v.InferOutput<typeof InstallStatus>;

export function getInstallStatus() {
	return api(wrapped(InstallStatus), '/api/settings/updates/install-status');
}

const ConsoleStatus = wrapped(v.looseObject({ status: Text, cacheVersion: Text }));

/** Public liveness probe: answers again once the console process is back */
export function getConsoleStatus() {
	return api(ConsoleStatus, '/api/settings/restart-status', { query: { _: Date.now() } });
}

export const UpdateBackup = v.looseObject({
	name: v.string(),
	timestamp: NullableText,
	sha: Text,
	fileCount: Num,
	filesBackedUp: Num,
	sizeBytes: Num
});
export type UpdateBackup = v.InferOutput<typeof UpdateBackup>;

const UpdateBackupList = wrapped(
	v.pipe(
		v.union([v.array(UpdateBackup), v.looseObject({ backups: v.optional(v.array(UpdateBackup), []) })]),
		v.transform((d) => (Array.isArray(d) ? d : d.backups))
	)
);

export function listUpdateBackups(signal?: AbortSignal) {
	return api(UpdateBackupList, '/api/settings/updates/backups', { signal });
}

export function restoreUpdateBackup(backupName: string) {
	return api(wrapped(Any), '/api/settings/updates/restore', { method: 'POST', body: { backupName } });
}

export function deleteUpdateBackup(name: string) {
	return api(wrapped(Any), `/api/settings/updates/backups/${encodeURIComponent(name)}`, {
		method: 'DELETE'
	});
}

export function pruneUpdateBackups(keep: number) {
	return api(
		wrapped(v.looseObject({ deleted: v.optional(v.array(v.unknown()), []) })),
		'/api/settings/updates/backups/prune',
		{ method: 'POST', body: { keep } }
	);
}

export function getBackupRetention(signal?: AbortSignal) {
	return api(wrapped(v.looseObject({ count: Num, source: Text })), '/api/settings/backup/retention', {
		signal
	});
}

export function setBackupRetention(count: number) {
	return api(wrapped(Any), '/api/settings/backup/retention', { method: 'PUT', body: { count } });
}

// ── Email ──

export const SmtpConfig = v.looseObject({
	configured: BoolLike,
	host: Text,
	port: v.optional(v.nullable(NumLike)),
	secure: BoolLike,
	user: Text,
	from: Text,
	alert_email: Text
});
export type SmtpConfig = v.InferOutput<typeof SmtpConfig>;

/** No { success, data } envelope here */
export function getSmtp(signal?: AbortSignal) {
	return api(SmtpConfig, '/api/settings/email/smtp', { signal });
}

export interface SmtpInput {
	host: string;
	port: number;
	secure: boolean;
	user: string;
	/** Empty keeps the saved password */
	pass: string;
	from: string;
	alert_email: string;
}

export function saveSmtp(input: SmtpInput) {
	return api(Any, '/api/settings/email/smtp', { method: 'PUT', body: input });
}

/** Connects to the saved mail server; answers 200 with success false when it fails */
export function testSmtp() {
	return api(
		v.looseObject({ success: v.optional(v.boolean(), false), error: Text }),
		'/api/settings/email/smtp/test',
		{ method: 'POST', body: {} }
	);
}

// ── Time zones and clock ──

export const ClockSettings = v.looseObject({
	ntp_servers: Text,
	max_skew_ms: v.optional(v.nullable(NumLike)),
	require_synced_clock: v.optional(v.nullable(v.boolean())),
	trust_os_ntp: v.optional(v.nullable(v.boolean())),
	billing_timezone: Text
});
export type ClockSettings = v.InferOutput<typeof ClockSettings>;

export function getClockSettings(signal?: AbortSignal) {
	return api(
		v.looseObject({ settings: v.optional(v.nullable(ClockSettings)), dockerMode: BoolLike }),
		'/api/panel/billing/clock/settings',
		{ signal }
	);
}

export function detectTimezone(signal?: AbortSignal) {
	return api(
		v.looseObject({ timezone: Text, common: v.optional(v.array(v.string()), []) }),
		'/api/panel/billing/clock/detect-timezone',
		{ signal }
	);
}

export interface ClockInput {
	ntp_servers: string;
	max_skew_ms: number;
	require_synced_clock: boolean;
	trust_os_ntp: boolean;
	billing_timezone: string;
}

export function saveClockSettings(input: ClockInput) {
	return api(
		v.looseObject({
			settings: v.optional(v.nullable(ClockSettings)),
			restartRequired: v.optional(v.nullable(RestartItem)),
			dockerMode: BoolLike
		}),
		'/api/panel/billing/clock/settings',
		{ method: 'PUT', body: input }
	);
}

export const TimeSync = v.looseObject({
	synced: BoolLike,
	offset_ms: v.optional(v.nullable(NumLike)),
	ntp_server: Text,
	os_clock_synced: v.optional(v.nullable(v.boolean())),
	last_error: Text
});
export type TimeSync = v.InferOutput<typeof TimeSync>;

export function getTimeSync(signal?: AbortSignal) {
	return api(TimeSync, '/api/panel/billing/timesync/status', { signal });
}

export function checkTimeSync() {
	return api(Any, '/api/panel/billing/timesync/check', { method: 'POST' });
}

// ── Advanced: configuration files ──

export const ConfigFile = v.looseObject({
	id: v.string(),
	path: Text,
	requiresRestart: v.optional(v.string(), 'none'),
	canCreate: BoolLike,
	exists: BoolLike,
	writable: BoolLike,
	size: Num,
	mtime: NullableText
});
export type ConfigFile = v.InferOutput<typeof ConfigFile>;

export function listConfigFiles(signal?: AbortSignal) {
	return api(wrapped(v.array(ConfigFile)), '/api/settings/advanced/files', { signal });
}

export const ConfigFileContent = v.looseObject({
	content: Text,
	path: Text,
	size: Num,
	mtime: NullableText,
	requiresRestart: v.optional(v.string(), 'none')
});
export type ConfigFileContent = v.InferOutput<typeof ConfigFileContent>;

export function readConfigFile(id: string) {
	return api(wrapped(ConfigFileContent), `/api/settings/advanced/files/${encodeURIComponent(id)}`);
}

export function saveConfigFile(id: string, content: string) {
	return api(
		v.looseObject({
			data: v.optional(v.looseObject({ backupPath: NullableText })),
			restartRequired: v.optional(v.nullable(RestartItem))
		}),
		`/api/settings/advanced/files/${encodeURIComponent(id)}`,
		{ method: 'PUT', body: { content } }
	);
}

/** Request text for a failure; a 403 already reads as a sentence */
export function errorText(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}
