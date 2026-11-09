import { describe, expect, test } from 'vitest';
import {
	confirmFor,
	countEntries,
	diskShare,
	entryType,
	filterServices,
	historyChart,
	isRunning,
	joinPath,
	menuActions,
	parentOf,
	permsText,
	recentRun,
	rootWritable,
	serverLine,
	serverState,
	serviceState,
	share,
	tabFrom,
	upFrom
} from '../../../src/lib/serverarea/management.ts';

describe('server management tabs', () => {
	test('?tab= picks the view; unknown or missing is the overview, as the server read it', () => {
		expect(tabFrom('terminal')).toBe('terminal');
		expect(tabFrom('FILES')).toBe('files');
		expect(tabFrom('services')).toBe('services');
		expect(tabFrom('nope')).toBe('overview');
		expect(tabFrom(null)).toBe('overview');
	});
});

describe('server states', () => {
	test('status words and online flags', () => {
		expect(serverState({ status: 'running' })).toBe('running');
		expect(serverState({ online: true })).toBe('running');
		expect(serverState({ status: 'stopped' })).toBe('stopped');
		expect(serverState({ online: false })).toBe('stopped');
		expect(serverState(null)).toBe('unknown');
		expect(serverState({})).toBe('unknown');
	});

	test('running is good, stopped is danger, no answer is a warning, each with its sentence', () => {
		expect(serverLine('hbbs', 'running')).toEqual({
			tone: 'good',
			label: 'status.running',
			meaning: 'server_mgmt.id_running'
		});
		expect(serverLine('hbbr', 'running').meaning).toBe('server_mgmt.relay_running');
		expect(serverLine('hbbs', 'stopped')).toMatchObject({
			tone: 'danger',
			meaning: 'dashboard.status_signal_down'
		});
		expect(serverLine('hbbr', 'stopped').meaning).toBe('dashboard.status_relay_down');
		expect(serverLine('hbbs', 'unknown')).toMatchObject({ tone: 'warning', label: 'status.unknown' });
	});

	test('shares are rounded and kept in 0..100', () => {
		expect(share(37.6)).toBe(38);
		expect(share(-4)).toBe(0);
		expect(share(140)).toBe(100);
		expect(share('x')).toBe(0);
		expect(diskShare({ size: 200, used: 50 })).toBe(25);
		expect(diskShare({ total: 400, used: 100 })).toBe(25);
		expect(diskShare({ used: 5 })).toBe(0);
	});
});

describe('history chart', () => {
	const at = (s: number, cpu = 10, mem = 20) => ({ ts: s * 1000, cpu, mem });

	test('only the samples without a break up to now', () => {
		const run = recentRun([at(0), at(2), at(40), at(42), at(44)]);
		expect(run.map((s) => s.ts / 1000)).toEqual([40, 42, 44]);
	});

	test('at most the last 60 samples', () => {
		const list = Array.from({ length: 90 }, (_, i) => at(i * 2));
		const run = recentRun(list);
		expect(run).toHaveLength(60);
		expect(run[0]?.ts).toBe(30 * 2000);
	});

	test('no chart until there are two samples; averages and peaks over the run', () => {
		expect(historyChart([at(0)])).toBeNull();
		const c = historyChart([at(0, 10, 50), at(2, 30, 70), at(4, 20.4, 60)]);
		expect(c).not.toBeNull();
		expect(c?.cpu).toEqual([10, 30, 20]);
		expect(c?.cpuMax).toBe(30);
		expect(c?.cpuAvg).toBe(20);
		expect(c?.memAvg).toBe(60);
		expect(c?.spanSeconds).toBe(4);
	});
});

describe('files', () => {
	test('entry types', () => {
		expect(entryType({ type: 'dir', isSymlink: false, isDirectory: false })).toBe('dir');
		expect(entryType({ isSymlink: true, isDirectory: true })).toBe('symlink');
		expect(entryType({ isSymlink: false, isDirectory: true })).toBe('dir');
		expect(entryType({ isSymlink: false, isDirectory: false })).toBe('file');
	});

	test('permissions as four octal digits', () => {
		expect(permsText(0o100644)).toBe('0644');
		expect(permsText(493)).toBe('0755');
		expect(permsText(null)).toBe('');
	});

	test('paths: join, parent and one level up (POSIX and Windows)', () => {
		expect(joinPath('/app', 'x')).toBe('/app/x');
		expect(joinPath('/app/', 'x')).toBe('/app/x');
		expect(joinPath('C:\\data', 'x')).toBe('C:\\data\\x');
		expect(parentOf('/app/a.txt')).toBe('/app');
		expect(parentOf('/a.txt')).toBe('/');
		expect(upFrom('/opt/rustdesk/')).toBe('/opt');
		expect(upFrom('/opt')).toBe('/');
		expect(upFrom('/')).toBe('/');
		expect(upFrom('C:\\data\\logs')).toBe('C:\\data');
	});

	test('where files can be changed', () => {
		const mutable = ['/opt/rustdesk', '/app/'];
		expect(rootWritable('/opt/rustdesk', mutable)).toBe(true);
		expect(rootWritable('/app/data', mutable)).toBe(true);
		expect(rootWritable('/opt/rustdesk-other', mutable)).toBe(false);
		expect(rootWritable('/var/log', mutable)).toBe(false);
		expect(rootWritable('/var/log', null)).toBeNull();
	});

	test('folder and file counts', () => {
		expect(
			countEntries([
				{ isDirectory: true, isSymlink: false },
				{ isDirectory: false, isSymlink: false },
				{ isDirectory: true, isSymlink: true }
			])
		).toEqual({ folders: 1, files: 2 });
	});
});

describe('services', () => {
	const svc = (
		over: Partial<{ name: string; description: string; state: string; status: string; sub: string }>
	) => ({
		name: 'betterdesk-server',
		description: 'BetterDesk server',
		state: '',
		status: '',
		sub: '',
		...over
	});

	test('running, failed, stopped and other states', () => {
		expect(isRunning(svc({ state: 'active' }))).toBe(true);
		expect(isRunning(svc({ sub: 'running' }))).toBe(true);
		expect(serviceState(svc({ state: 'active', sub: 'running' }))).toMatchObject({
			tone: 'good',
			sub: 'running'
		});
		expect(serviceState(svc({ state: 'failed' }))).toMatchObject({
			tone: 'danger',
			label: 'server_mgmt.svc_failed'
		});
		expect(serviceState(svc({ state: 'inactive', sub: 'dead' }))).toMatchObject({
			tone: 'neutral',
			label: 'status.stopped',
			sub: 'dead'
		});
		expect(serviceState(svc({ state: 'activating' }))).toMatchObject({ raw: true, label: 'activating' });
		expect(serviceState(svc({}))).toMatchObject({ label: 'status.unknown', raw: false });
	});

	test('search by name and description', () => {
		const list = [
			svc({ name: 'betterdesk-server' }),
			svc({ name: 'betterdesk-console', description: 'Web console' })
		];
		expect(filterServices(list, 'CONSOLE')).toHaveLength(1);
		expect(filterServices(list, 'web')).toHaveLength(1);
		expect(filterServices(list, ' ')).toHaveLength(2);
	});

	test('stop and "don\'t start at boot" ask as dangerous, restart asks, the rest just run', () => {
		expect(confirmFor('stop')).toBe('danger');
		expect(confirmFor('disable')).toBe('danger');
		expect(confirmFor('restart')).toBe('confirm');
		expect(confirmFor('start')).toBe('none');
		expect(confirmFor('enable')).toBe('none');
		expect(menuActions('linux')).toEqual(['reload', 'enable', 'disable']);
		expect(menuActions('win32')).toEqual([]);
	});
});

describe('a sentence around a link or a time', () => {
	test('split at the marker, words kept in the translation order', async () => {
		const { around } = await import('../../../src/lib/serverarea/text.ts');
		expect(around('x.not_loaded', 'link', {}, 'Restarts are listed in {link}.')).toEqual([
			'Restarts are listed in ',
			'.'
		]);
		expect(around('x.not_loaded', 'date', { n: 3 }, '{date}: {n} done')).toEqual(['', ': 3 done']);
		expect(around('x.not_loaded', 'date', {}, 'No marker')).toEqual(['No marker', '']);
	});
});
