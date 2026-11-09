/**
 * Settings B's rules without a DOM: time zones and the billing period,
 * backup restore steps and the next scheduled backup, update checks and
 * install results, configuration file groups, translation rows.
 */
import { describe, expect, test } from 'vitest';
import type { ConfigFile } from '../../../src/lib/api/settings-system.ts';
import {
	groupFiles,
	isDirty,
	newFileText,
	restartHintKey,
	showsRestart
} from '../../../src/lib/settings-b/advanced.ts';
import {
	canRestore,
	fileKind,
	nextBackup,
	restoreFields,
	restoreHint,
	restoreNeedsRestart
} from '../../../src/lib/settings-b/backup.ts';
import {
	buildRows,
	clampCoverage,
	codeFromHash,
	filterRows,
	languageStatus,
	missingAreas,
	showsReviewNote
} from '../../../src/lib/settings-b/languages.ts';
import {
	chosenZone,
	serversGiven,
	skewValid,
	zoneChoices,
	zoneLabel,
	zoneNow,
	zoneOffset
} from '../../../src/lib/settings-b/time.ts';
import {
	buildTools,
	checkState,
	componentRows,
	currentStep,
	goVersionNumber,
	hasServerUpdate,
	hasUpdateFailures,
	installBlocked,
	isDockerMode,
	isRecoverableDisconnect,
	needsReload,
	preflightNotice,
	preflightWarningKey,
	progressPercent,
	recoveredResult,
	retentionValid,
	shaMatches,
	toolchainWillInstall
} from '../../../src/lib/settings-b/updates.ts';

describe('time zones', () => {
	const winter = new Date('2026-01-15T12:00:00Z');

	test('offset of a zone, UTC for UTC, nothing for an unknown name', () => {
		expect(zoneOffset('Europe/Berlin', winter)).toBe('UTC+01:00');
		expect(zoneOffset('Asia/Kolkata', winter)).toBe('UTC+05:30');
		expect(zoneOffset('UTC', winter)).toMatch(/^UTC(\+00:00)?$/);
		expect(zoneOffset('Mars/Olympus', winter)).toBe('');
		expect(zoneOffset('', winter)).toBe('');
	});

	test('choices: known zones, the server list and the saved zone, plain names first, unknown names left out', () => {
		const list = zoneChoices(
			'Europe/Warsaw',
			['Bad/Zone', 'America/New_York'],
			['Europe/Berlin', 'Asia/Tokyo']
		);
		expect(list).toEqual(['UTC', 'America/New_York', 'Asia/Tokyo', 'Europe/Berlin', 'Europe/Warsaw']);
	});

	test('label with the offset, underscores as spaces', () => {
		expect(zoneLabel('America/New_York', winter)).toBe('America/New York (UTC-05:00)');
	});

	test('the custom name wins over the pick', () => {
		expect(chosenZone('  Europe/Paris ', 'UTC')).toBe('Europe/Paris');
		expect(chosenZone('', 'Asia/Tokyo')).toBe('Asia/Tokyo');
		expect(chosenZone('', '')).toBe('UTC');
	});

	test('billing period is the calendar month in that zone', () => {
		// 23:30 UTC on 31 Dec is already January in Tokyo
		const now = new Date('2026-12-31T23:30:00Z');
		const tokyo = zoneNow('Asia/Tokyo', 'en-GB', now);
		expect(tokyo?.start).toBe('1 January 2027');
		expect(tokyo?.end).toBe('31 January 2027');
		expect(tokyo?.next).toBe('1 February 2027');
		const utc = zoneNow('UTC', 'en-GB', now);
		expect(utc?.start).toBe('1 December 2026');
		expect(utc?.next).toBe('1 January 2027');
		expect(zoneNow('Nowhere/Here', 'en', now)).toBeNull();
	});

	test('February has its last day', () => {
		const feb = zoneNow('UTC', 'en-GB', new Date('2028-02-10T00:00:00Z'));
		expect(feb?.end).toBe('29 February 2028');
	});

	test('the server rules for the allowed difference and the time servers', () => {
		expect(skewValid(2000)).toBe(true);
		expect(skewValid(600000)).toBe(true);
		expect(skewValid(600001)).toBe(false);
		expect(skewValid(0)).toBe(false);
		expect(skewValid(Number.NaN)).toBe(false);
		expect(serversGiven(' , pool.ntp.org')).toBe(true);
		expect(serversGiven(' , ')).toBe(false);
	});
});

describe('backup', () => {
	test('file kinds', () => {
		expect(fileKind('betterdesk-backup.tar.gz')).toBe('archive');
		expect(fileKind('OLD.JSON')).toBe('json');
		expect(fileKind('notes.txt')).toBe('invalid');
		expect(fileKind(undefined)).toBe('');
	});

	test('restore one step at a time', () => {
		expect(restoreHint('', 0)).toBe('settings.backup_tab.restore_start');
		expect(restoreHint('archive', 0)).toBe('settings.backup_tab.restore_pick_parts');
		expect(restoreHint('archive', 1)).toBe('');
		expect(restoreHint('json', 0)).toBe('');
		expect(canRestore('archive', 0)).toBe(false);
		expect(canRestore('archive', 2)).toBe(true);
		expect(canRestore('json', 0)).toBe(true);
		expect(canRestore('invalid', 3)).toBe(false);
	});

	test('every part is sent, ticked or not', () => {
		expect(restoreFields(new Set(['restoreEnv']))).toEqual({
			restoreDatabase: false,
			restoreUploads: false,
			restoreSecrets: false,
			restoreEnv: true,
			restoreGoDb: false
		});
	});

	test('keys, the env file and the server database need a restart; console data does not', () => {
		expect(restoreNeedsRestart('archive', new Set(['restoreDatabase', 'restoreUploads']))).toBe(false);
		expect(restoreNeedsRestart('archive', new Set(['restoreGoDb']))).toBe(true);
		expect(restoreNeedsRestart('json', new Set(['restoreSecrets']))).toBe(false);
	});

	test('next scheduled backup', () => {
		const now = Date.parse('2026-11-09T12:00:00Z');
		const on = {
			enabled: true,
			intervalHours: 6,
			retentionCount: 7,
			destinationType: 'local' as const,
			destinationPath: ''
		};
		expect(nextBackup(null, null, now)).toEqual({ kind: 'unknown' });
		expect(nextBackup({ ...on, enabled: false }, null, now)).toEqual({ kind: 'off' });
		// Never ran: due now
		expect(
			nextBackup(on, { lastAttemptAt: null, lastSuccessAt: null, lastFile: null, lastError: null }, now)
		).toEqual({
			kind: 'soon'
		});
		const at = nextBackup(
			on,
			{ lastAttemptAt: '2026-11-09T10:00:00Z', lastSuccessAt: null, lastFile: null, lastError: null },
			now
		);
		expect(at).toEqual({ kind: 'at', at: new Date('2026-11-09T16:00:00Z') });
		// Due within the minute the server waits between checks
		const soon = nextBackup(
			on,
			{ lastAttemptAt: '2026-11-09T06:00:30Z', lastSuccessAt: null, lastFile: null, lastError: null },
			now
		);
		expect(soon).toEqual({ kind: 'soon' });
	});
});

describe('updates', () => {
	const base = {
		localVersion: '3.5.219',
		remoteSHA: 'eb84feff61c2',
		updateAvailable: false,
		baselineEstablished: false,
		commitsBehind: 0,
		latestMessage: '',
		latestDate: null,
		dockerShaUnknown: false,
		deploymentMode: 'native',
		dockerImageMode: false
	};

	test('what a check found', () => {
		expect(checkState({ ...base })).toBe('uptodate');
		expect(checkState({ ...base, updateAvailable: true })).toBe('available');
		expect(checkState({ ...base, updateAvailable: true, baselineEstablished: true })).toBe('baseline');
		expect(isDockerMode({ deploymentMode: 'docker-image', dockerImageMode: false })).toBe(true);
		expect(isDockerMode({ deploymentMode: 'native', dockerImageMode: true })).toBe(true);
		expect(isDockerMode({ deploymentMode: 'native', dockerImageMode: false })).toBe(false);
		expect(isDockerMode(null)).toBe(false);
	});

	test('changed parts with their files, empty parts left out, unknown parts as other', () => {
		const rows = componentRows({ console: ['a', 'b'], server: [], agent: ['x'], weird: ['y'] });
		expect(rows).toEqual([
			{ id: 'console', label: 'updates.component_console', auto: true, files: 2 },
			{ id: 'agent', label: 'updates.component_agent', auto: false, files: 1 },
			{ id: 'weird', label: 'updates.component_other', auto: false, files: 1 }
		]);
		expect(hasServerUpdate({ commits: [], grouped: { server: ['s'] }, totalFiles: 1 })).toBe(true);
		expect(hasServerUpdate({ commits: [], grouped: { server: [] }, totalFiles: 0 })).toBe(false);
	});

	test('preflight notice: blocked with issues, warnings with failed capability checks, nothing when ready', () => {
		expect(preflightNotice(null)).toBeNull();
		expect(preflightNotice({ ready: true, issues: [], warnings: [] })).toBeNull();
		expect(preflightNotice({ ready: false, issues: ['no write access'], warnings: [] })).toEqual({
			blocked: true,
			issues: ['no write access'],
			warnings: []
		});
		const n = preflightNotice({
			ready: true,
			issues: [],
			warnings: ['w1'],
			capabilities: {
				groups: {
					health: { ready: false, checks: [] },
					update: {
						ready: false,
						checks: [
							{ id: 'console-write', ready: false, error: 'EACCES' },
							{ id: 'ok', ready: true }
						]
					}
				}
			}
		});
		expect(n).toEqual({ blocked: false, issues: [], warnings: ['w1', 'update: console-write: EACCES'] });
		expect(installBlocked({ ready: false, issues: [], warnings: [] })).toBe(true);
		expect(installBlocked({ ready: true, issues: [], warnings: [] })).toBe(false);
		expect(installBlocked(null)).toBe(false);
	});

	test('toolchain messages are said plainly', () => {
		expect(preflightWarningKey('Go toolchain will be installed into data/go')).toBe(
			'updates.toolchain_will_install'
		);
		expect(preflightWarningKey('go is below 1.26.9; upgrading')).toBe('updates.toolchain_will_install');
		expect(preflightWarningKey('Disk almost full')).toBeNull();
	});

	test('build tools state', () => {
		const info = {
			goAvailable: false,
			goMeetsMinimum: false,
			goVersion: '',
			goSource: '',
			canInstallGo: false,
			vendoredGoInstalled: false,
			binaryPath: '',
			sourcePresent: false
		};
		expect(buildTools({ ...info, goAvailable: true, goMeetsMinimum: true })).toEqual({
			tone: 'good',
			key: 'settings.updates_tab.tools_ready'
		});
		expect(buildTools({ ...info, canInstallGo: true })).toEqual({
			tone: 'waiting',
			key: 'updates.auto_available'
		});
		expect(buildTools({ ...info, canInstallGo: true, vendoredGoInstalled: true }).key).toBe(
			'updates.toolchain_ready'
		);
		expect(buildTools({ ...info, goAvailable: true, goMeetsMinimum: false }).tone).toBe('waiting');
		expect(buildTools(info)).toEqual({ tone: 'warning', key: 'updates.no_method' });
		expect(toolchainWillInstall({ ...info, canInstallGo: true })).toBe(true);
		expect(
			toolchainWillInstall({ ...info, goAvailable: true, goMeetsMinimum: true, canInstallGo: true })
		).toBe(false);
		expect(goVersionNumber('go version go1.23.4 linux/amd64')).toBe('1.23.4');
	});

	test('failures and reloads', () => {
		expect(hasUpdateFailures({ failed: [], servicesFailed: [] })).toBe(false);
		expect(hasUpdateFailures({ failed: [{}] })).toBe(true);
		expect(hasUpdateFailures({ servicesFailed: [{}] })).toBe(true);
		expect(hasUpdateFailures({ consoleRestartBlocked: 'no sudo' })).toBe(true);
		expect(hasUpdateFailures({ restartTimeout: true })).toBe(true);
		expect(hasUpdateFailures({ serverDeploy: { success: false } })).toBe(true);
		expect(hasUpdateFailures(null)).toBe(false);
		expect(needsReload(['web-nodejs/public/js/app.js'])).toBe(true);
		expect(needsReload(['README.md', { file: 'x' }])).toBe(false);
	});

	test('a cut-off install call may still finish on the server', () => {
		expect(isRecoverableDisconnect({ status: 504, message: '' })).toBe(true);
		expect(isRecoverableDisconnect({ status: 0, message: 'network' })).toBe(true);
		expect(isRecoverableDisconnect({ status: 500, message: 'Gateway/proxy timeout' })).toBe(true);
		expect(isRecoverableDisconnect({ status: 400, message: 'Valid remoteSHA is required' })).toBe(false);
		expect(isRecoverableDisconnect(null)).toBe(false);
		expect(shaMatches('EB84FEFF61C25595', 'eb84fef')).toBe(true);
		expect(shaMatches('eb84fef', '1a2b3c4')).toBe(false);
		// A short form on either side
		expect(shaMatches('eb84feff61c2', 'eb84f')).toBe(true);
		expect(shaMatches('eb84f', 'eb84feff61c2')).toBe(true);
		expect(shaMatches(null, 'eb84fef')).toBe(false);
	});

	test('the result after a recovered install', () => {
		const r = recoveredResult(
			{
				localSHA: 'eb84feff',
				lastResult: { applied: 3, failed: [{ file: 'a', error: 'x' }], consoleRestartBlocked: null }
			},
			'eb84feff61c2'
		);
		expect(r.applied).toHaveLength(3);
		expect(r.failed).toEqual([{ file: 'a', error: 'x' }]);
		expect(r.needsConsoleRestart).toBe(true);
		const none = recoveredResult({ localSHA: 'eb84feff', lastResult: null }, 'eb84feff61c2');
		expect(none.applied).toHaveLength(1);
		const blocked = recoveredResult(
			{ localSHA: null, lastResult: { consoleRestartBlocked: 'no' } },
			'eb84fef'
		);
		expect(blocked.applied).toHaveLength(0);
		expect(blocked.needsConsoleRestart).toBe(false);
	});

	test('progress: finished steps count, step number', () => {
		const states = {
			confirm: 'done',
			backup: 'skipped',
			console: 'active',
			server: 'pending',
			restart: 'pending',
			done: 'pending'
		} as const;
		expect(progressPercent(states)).toBe(33);
		expect(
			progressPercent({ ...states, console: 'error', server: 'warning', restart: 'done', done: 'done' })
		).toBe(100);
		expect(currentStep('console', 'active')).toBe(3);
		expect(currentStep('console', 'pending')).toBe(2);
		expect(currentStep('confirm', 'pending')).toBe(1);
	});

	test('backups to keep', () => {
		expect(retentionValid(0)).toBe(true);
		expect(retentionValid(1000)).toBe(true);
		expect(retentionValid(1001)).toBe(false);
		expect(retentionValid(2.5)).toBe(false);
		expect(retentionValid(-1)).toBe(false);
	});
});

describe('configuration files', () => {
	const file = (over: Partial<ConfigFile>): ConfigFile => ({
		id: 'x',
		path: '/x',
		requiresRestart: 'none',
		canCreate: false,
		exists: true,
		writable: true,
		size: 1,
		mtime: null,
		...over
	});

	test('editable first (existing before new), read-only after, missing apart', () => {
		const g = groupFiles([
			file({ id: 'ro', writable: false }),
			file({ id: 'new', exists: false, canCreate: true }),
			file({ id: 'gone', exists: false, canCreate: false }),
			file({ id: 'rw' })
		]);
		expect(g.editable.map((f) => f.id)).toEqual(['rw', 'new']);
		expect(g.readOnly.map((f) => f.id)).toEqual(['ro']);
		expect(g.unavailable.map((f) => f.id)).toEqual(['gone']);
	});

	test('restart hint and the restart row', () => {
		expect(restartHintKey('console')).toBe('settings.advanced_restart_console');
		expect(restartHintKey('goserver')).toBe('settings.advanced_restart_goserver');
		expect(restartHintKey('none')).toBe('settings.advanced_restart_none');
		expect(restartHintKey('weird')).toBe('settings.advanced_restart_generic');
		expect(showsRestart(file({ requiresRestart: 'console' }))).toBe(true);
		expect(showsRestart(file({ requiresRestart: 'none' }))).toBe(false);
		expect(showsRestart(file({ requiresRestart: 'console', exists: false, canCreate: false }))).toBe(false);
		expect(showsRestart(null)).toBe(false);
		expect(newFileText('New file')).toBe('# New file\n');
		expect(isDirty('a', 'a')).toBe(false);
		expect(isDirty('a\n', 'a')).toBe(true);
	});
});

describe('translations', () => {
	const lang = { error: null, is_reference: false, missing_keys: 0, needs_review: false };

	test('status tones', () => {
		expect(languageStatus({ ...lang, error: 'bad json' })).toEqual({
			tone: 'danger',
			key: 'languages.status_error'
		});
		expect(languageStatus({ ...lang, is_reference: true, missing_keys: 3 }).key).toBe(
			'languages.status_reference'
		);
		expect(languageStatus({ ...lang, missing_keys: 2, needs_review: true }).tone).toBe('warning');
		expect(languageStatus({ ...lang, needs_review: true }).tone).toBe('waiting');
		expect(languageStatus(lang)).toEqual({ tone: 'good', key: 'languages.status_complete' });
		expect(showsReviewNote({ ...lang, missing_keys: 2, needs_review: true })).toBe(true);
		expect(showsReviewNote({ ...lang, needs_review: true })).toBe(false);
		expect(clampCoverage(140)).toBe(100);
		expect(clampCoverage(null)).toBe(0);
	});

	test('a language code in the address', () => {
		expect(codeFromHash('#de')).toBe('de');
		expect(codeFromHash('#zh-TW')).toBe('zh-TW');
		expect(codeFromHash('#zh%2DTW')).toBe('zh-TW');
		expect(codeFromHash('#backup-create')).toBeNull();
		expect(codeFromHash('')).toBeNull();
		expect(codeFromHash('#%E0%A4%A')).toBeNull();
	});

	test('rows: missing keys are marked even though the merged texts fill them with English', () => {
		const en = { _meta: { name: 'English' }, a: { one: 'One', two: 'Two' }, b: 'Bee' };
		const de = { _meta: { name: 'Deutsch' }, a: { one: 'Eins', two: 'Two' }, b: 'Biene' };
		const rows = buildRows(en, de, {
			missing: [
				{ key: 'a.two', en_value: 'Two' },
				{ key: 'c.new', en_value: 'New' }
			]
		});
		expect(rows).toEqual([
			{ key: 'a.one', en: 'One', value: 'Eins', missing: false },
			{ key: 'a.two', en: 'Two', value: '', missing: true },
			{ key: 'b', en: 'Bee', value: 'Biene', missing: false },
			{ key: 'c.new', en: 'New', value: '', missing: true }
		]);
		// English: its own texts
		expect(buildRows(en, null, null).map((r) => r.value)).toEqual(['One', 'Two', 'Bee']);
	});

	test('search and filter, areas of missing texts', () => {
		const rows = [
			{ key: 'settings.a', en: 'Save', value: 'Speichern', missing: false },
			{ key: 'settings.b', en: 'Close', value: '', missing: true },
			{ key: 'devices.c', en: 'Ban', value: '', missing: true },
			{ key: 'settings.d', en: 'Open', value: '', missing: true }
		];
		expect(filterRows(rows, 'all', 'SPEICH').map((r) => r.key)).toEqual(['settings.a']);
		expect(filterRows(rows, 'missing', '').map((r) => r.key)).toEqual([
			'settings.b',
			'devices.c',
			'settings.d'
		]);
		expect(filterRows(rows, 'missing', 'settings.').map((r) => r.key)).toEqual(['settings.b', 'settings.d']);
		expect(missingAreas(rows)).toEqual([
			{ area: 'settings', count: 2 },
			{ area: 'devices', count: 1 }
		]);
	});
});
