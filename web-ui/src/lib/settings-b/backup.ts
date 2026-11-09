/**
 * Backup tab: what a chosen file is, which parts can be restored, and when
 * the next scheduled backup runs (old settings.js initRestoreSection,
 * renderBackupSide). No DOM.
 */

import type { Schedule, ScheduleStatus } from '#lib/api/settings-system.ts';

export type FileKind = '' | 'archive' | 'json' | 'invalid';

/** A .tar.gz (or .gz) archive, an old .json settings file, or neither */
export function fileKind(name: string | null | undefined): FileKind {
	if (!name) return '';
	const n = name.toLowerCase();
	if (n.endsWith('.json')) return 'json';
	if (n.endsWith('.gz')) return 'archive';
	return 'invalid';
}

export interface RestorePart {
	/** The form field the server reads */
	field: 'restoreDatabase' | 'restoreUploads' | 'restoreSecrets' | 'restoreEnv' | 'restoreGoDb';
	/** Element id (old page) */
	id: string;
	label: string;
	desc: string;
	/** Restoring it needs a service restart */
	restart: boolean;
}

export const RESTORE_PARTS: readonly RestorePart[] = [
	{
		field: 'restoreDatabase',
		id: 'restore-database',
		label: 'settings.backup_tab.opt_database',
		desc: 'settings.backup_tab.opt_database_desc',
		restart: false
	},
	{
		field: 'restoreUploads',
		id: 'restore-uploads',
		label: 'settings.backup_tab.opt_uploads',
		desc: 'settings.backup_tab.opt_uploads_desc',
		restart: false
	},
	{
		field: 'restoreSecrets',
		id: 'restore-secrets',
		label: 'settings.backup_tab.opt_secrets',
		desc: 'settings.backup_tab.opt_secrets_desc',
		restart: true
	},
	{
		field: 'restoreEnv',
		id: 'restore-env',
		label: 'settings.backup_tab.opt_env',
		desc: 'settings.backup_tab.opt_env_desc',
		restart: true
	},
	{
		field: 'restoreGoDb',
		id: 'restore-godb',
		label: 'settings.backup_tab.opt_godb',
		desc: 'settings.backup_tab.opt_godb_desc',
		restart: true
	}
];

/** What an old .json settings file restores (the server's defaults for it) */
export const JSON_RESTORE_ITEMS = [
	'backup.opt_settings',
	'settings.tab_branding',
	'backup.opt_folders',
	'backup.opt_groups',
	'backup.opt_addressbooks'
] as const;

/** The step hint under the file field: what is still missing ('' when nothing) */
export function restoreHint(kind: FileKind, picked: number): string {
	if (!kind) return 'settings.backup_tab.restore_start';
	if (kind === 'archive' && picked === 0) return 'settings.backup_tab.restore_pick_parts';
	return '';
}

/** Restore can start: an old settings file, or an archive with at least one part ticked */
export function canRestore(kind: FileKind, picked: number): boolean {
	return kind === 'json' || (kind === 'archive' && picked > 0);
}

/** Every part goes to the server, ticked or not ('true'/'false', as the old page sent them) */
export function restoreFields(picked: ReadonlySet<RestorePart['field']>): Record<string, boolean> {
	return Object.fromEntries(RESTORE_PARTS.map((p) => [p.field, picked.has(p.field)]));
}

export function restoreNeedsRestart(kind: FileKind, picked: ReadonlySet<RestorePart['field']>): boolean {
	return kind === 'archive' && RESTORE_PARTS.some((p) => p.restart && picked.has(p.field));
}

export type NextBackup = { kind: 'unknown' } | { kind: 'off' } | { kind: 'soon' } | { kind: 'at'; at: Date };

/**
 * When the next scheduled backup runs. The server checks once a minute
 * whether one is due, so anything due within a minute is "soon".
 */
export function nextBackup(
	schedule: Schedule | null | undefined,
	status: ScheduleStatus | null | undefined,
	now: number = Date.now()
): NextBackup {
	if (!schedule) return { kind: 'unknown' };
	if (!schedule.enabled) return { kind: 'off' };
	const last = Date.parse(status?.lastAttemptAt ?? '');
	const due = Number.isFinite(last) ? last + (Number(schedule.intervalHours) || 24) * 3600 * 1000 : now;
	return due <= now + 60 * 1000 ? { kind: 'soon' } : { kind: 'at', at: new Date(due) };
}

/** Schedule choices the old page offered (hours) */
export const INTERVALS = [
	{ value: 1, label: 'backup.schedule_interval_1h' },
	{ value: 6, label: 'backup.schedule_interval_6h' },
	{ value: 12, label: 'backup.schedule_interval_12h' },
	{ value: 24, label: 'backup.schedule_interval_24h' },
	{ value: 168, label: 'backup.schedule_interval_weekly' }
] as const;
