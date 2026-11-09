/**
 * The two flows that wait on the server: an update install (step by step,
 * recovery after a cut-off call, waiting for the console to restart) and
 * the "restart required" prompt (cancel, restart and follow it, failures,
 * resuming on page load). Requests are fakes; time is the fake clock.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { InstallResult, InstallStatus } from '../../../src/lib/api/settings-system.ts';

vi.mock('#lib/api/restart.ts', () => ({
	getPendingRestart: vi.fn(),
	cancelRestart: vi.fn(),
	confirmRestart: vi.fn(),
	completeRestart: vi.fn(),
	restartStatus: vi.fn()
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock('#lib/ui/toasts.svelte.ts', async (orig) => ({
	...(await orig<typeof import('../../../src/lib/ui/toasts.svelte.ts')>()),
	toast: toastMock
}));

import * as restartApi from '../../../src/lib/api/restart.ts';
import { InstallRun, type InstallDeps } from '../../../src/lib/settings-b/install.svelte.ts';
import {
	POLL_MAX,
	POLL_MS,
	cancelPendingRestart,
	confirmPendingRestart,
	dismissFailedRestart,
	onRestartCanceled,
	resetRestartFlow,
	restartFlow,
	resumeRestart,
	showRestartPrompt
} from '../../../src/lib/settings/restart.svelte.ts';
import RestartPrompt from '../../../src/lib/settings/RestartPrompt.svelte';
import { session } from '../../../src/lib/state/session.svelte.ts';

const api = vi.mocked(restartApi);

function result(over: Partial<InstallResult> = {}): InstallResult {
	return {
		applied: ['web-nodejs/server.js'],
		failed: [],
		removed: [],
		servicesFailed: [],
		needsConsoleRestart: false,
		consoleRestartBlocked: null,
		serverBuild: null,
		serverDeploy: null,
		toolchainInstall: null,
		autoRebuild: null,
		agentRebuildQueued: false,
		agentRebuildDeferred: false,
		agentRebuildRemoteSHA: '',
		...over
	};
}

function deps(over: Partial<InstallDeps> = {}): InstallDeps & { slept: number[] } {
	let clock = 0;
	const slept: number[] = [];
	return {
		install: vi.fn(async () => result()),
		status: vi.fn(async (): Promise<InstallStatus> => ({
			inProgress: false,
			localSHA: null,
			lastResult: null
		})),
		consoleVersion: vi.fn(async () => 'v1'),
		sleep: vi.fn(async (ms: number) => {
			slept.push(ms);
			clock += ms;
		}),
		now: () => clock,
		clock: () => '12:00:00',
		slept,
		...over
	};
}

describe('update install', () => {
	test('without a restart: steps finish, server skipped, success', async () => {
		const d = deps();
		const run = new InstallRun(d);
		await run.run('eb84feff61c2', false, false);
		expect(d.install).toHaveBeenCalledWith('eb84feff61c2', false);
		expect(run.phases).toEqual({
			confirm: 'done',
			backup: 'skipped',
			console: 'done',
			server: 'skipped',
			restart: 'skipped',
			done: 'done'
		});
		expect(run.state).toBe('success_no_reload');
		expect(run.percent).toBe(100);
		expect(run.offersReload).toBe(true); // a .js file changed
		expect(run.log[0]).toBe('[12:00:00] Starting update to eb84fef…');
	});

	test('a console restart is followed until the cache version changes', async () => {
		const versions = ['v1', 'v1', 'v1', 'v2'];
		const d = deps({
			install: vi.fn(async () => result({ needsConsoleRestart: true })),
			consoleVersion: vi.fn(async () => {
				const v = versions.shift();
				if (v === undefined) throw new Error('down');
				return v;
			})
		});
		const run = new InstallRun(d);
		await run.run('eb84fef', true, false);
		expect(run.state).toBe('success_reload');
		expect(run.phases.restart).toBe('done');
		// 8 s grace, then two probes 2 s apart that still saw the old console
		expect(d.slept).toEqual([8000, 2000, 2000]);
	});

	test('a restart that never comes back ends with a warning after 90 probes', async () => {
		const d = deps({
			install: vi.fn(async () => result({ needsConsoleRestart: true })),
			consoleVersion: vi.fn(async () => 'same')
		});
		const run = new InstallRun(d);
		await run.run('eb84fef', true, false);
		expect(run.state).toBe('partial_error');
		expect(run.outcome?.restartTimeout).toBe(true);
		expect(run.phases.restart).toBe('warning');
		expect(d.consoleVersion).toHaveBeenCalledTimes(91);
	});

	test('a blocked console restart is an error step', async () => {
		const d = deps({
			install: vi.fn(async () => result({ needsConsoleRestart: true, consoleRestartBlocked: 'no sudo' }))
		});
		const run = new InstallRun(d);
		await run.run('eb84fef', true, false);
		expect(run.phases.restart).toBe('error');
		expect(run.state).toBe('partial_error');
	});

	test('server part: built, or a failed build is an error step', async () => {
		const ok = new InstallRun(
			deps({ install: vi.fn(async () => result({ serverBuild: { success: true, duration: 61000 } })) })
		);
		await ok.run('eb84fef', true, true);
		expect(ok.phases.server).toBe('done');
		const bad = new InstallRun(
			deps({
				install: vi.fn(async () => result({ serverBuild: { success: false, error: 'go: not found' } }))
			})
		);
		await bad.run('eb84fef', true, true);
		expect(bad.phases.server).toBe('error');
		expect(bad.log.some((l) => l.includes('go: not found'))).toBe(true);
	});

	test('a cut-off call is followed through the install status', async () => {
		const statuses: InstallStatus[] = [
			{ inProgress: true, localSHA: null, lastResult: null },
			{
				inProgress: false,
				localSHA: 'eb84feff61c2',
				lastResult: {
					applied: 4,
					failed: [],
					servicesFailed: [],
					servicesRestarted: [],
					consoleRestartBlocked: null
				}
			}
		];
		const d = deps({
			install: vi.fn(async () => {
				throw Object.assign(new Error('Gateway Timeout'), { status: 504 });
			}),
			status: vi.fn(async () => statuses.shift() ?? statuses[0]!),
			consoleVersion: vi.fn().mockResolvedValueOnce('v1').mockResolvedValue('v2')
		});
		const run = new InstallRun(d);
		await run.run('eb84feff61c2', true, false);
		expect(d.status).toHaveBeenCalledTimes(2);
		expect(run.state).toBe('success_reload');
		expect(run.outcome?.applied).toHaveLength(4);
	});

	test('an install that fails marks the running step and ends in error', async () => {
		const d = deps({
			install: vi.fn(async () => {
				throw Object.assign(new Error('Update failed: disk full'), { status: 500 });
			})
		});
		const run = new InstallRun(d);
		await run.run('eb84fef', true, false);
		expect(run.state).toBe('error');
		expect(run.outcome?.errorMessage).toBe('Update failed: disk full');
		expect(run.phases.backup).toBe('error');
		expect(d.status).not.toHaveBeenCalled();
	});
});

const ITEM = {
	id: 'r1',
	phase: 'pending',
	changes: [{ key: 'billing-clock', label: 'Server time (NTP)' }],
	error: null
};

describe('restart prompt flow', () => {
	beforeEach(() => {
		resetRestartFlow();
		vi.useFakeTimers();
		for (const fn of [
			api.getPendingRestart,
			api.cancelRestart,
			api.confirmRestart,
			api.completeRestart,
			api.restartStatus
		])
			fn.mockReset();
		for (const fn of Object.values(toastMock)) fn.mockReset();
	});
	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	test('a save that needs a restart asks', () => {
		showRestartPrompt(ITEM);
		expect(restartFlow.view).toBe('pending');
		expect(restartFlow.item?.id).toBe('r1');
		showRestartPrompt(null);
		expect(restartFlow.view).toBe('pending');
	});

	test('cancel puts the values back and tells the pages', async () => {
		const seen: string[] = [];
		onRestartCanceled((item) => seen.push(item.id));
		api.cancelRestart.mockResolvedValue({ canceled: true });
		showRestartPrompt(ITEM);
		await cancelPendingRestart();
		expect(api.cancelRestart).toHaveBeenCalledWith('r1');
		expect(restartFlow.view).toBe('hidden');
		expect(seen).toEqual(['r1']);
		expect(toastMock.success).toHaveBeenCalled();
	});

	test('a failed cancel keeps the prompt', async () => {
		api.cancelRestart.mockRejectedValue(new Error('Could not restore'));
		showRestartPrompt(ITEM);
		await cancelPendingRestart();
		expect(restartFlow.view).toBe('pending');
		expect(toastMock.error).toHaveBeenCalledWith('Could not restore');
	});

	test('restart: follows the probe until the services are back', async () => {
		api.confirmRestart.mockResolvedValue({ phase: 'restarting', failed: false, error: null, token: 'tok' });
		api.restartStatus
			.mockRejectedValueOnce(new Error('down'))
			.mockResolvedValueOnce({ data: { phase: 'restarting', ready: false, error: null } })
			.mockResolvedValueOnce({ data: { phase: 'ready', ready: true, error: null } });
		showRestartPrompt(ITEM);
		await confirmPendingRestart();
		expect(restartFlow.view).toBe('restarting');
		expect(restartFlow.restarting).toBe(true);
		await vi.advanceTimersByTimeAsync(POLL_MS * 3);
		expect(api.restartStatus).toHaveBeenCalledTimes(3);
		expect(api.restartStatus).toHaveBeenCalledWith('r1', 'tok');
		expect(restartFlow.view).toBe('ready');
		expect(restartFlow.restarting).toBe(false);
	});

	test('restart that fails on the server, or never answers', async () => {
		api.confirmRestart.mockResolvedValue({
			phase: 'failed',
			failed: true,
			error: 'service_restart_failed_rolled_back',
			token: ''
		});
		showRestartPrompt(ITEM);
		await confirmPendingRestart();
		expect(restartFlow.view).toBe('failed');
		expect(restartFlow.reason).toMatch(/previous values were put back/);

		resetRestartFlow();
		api.confirmRestart.mockResolvedValue({ phase: 'restarting', failed: false, error: null, token: 't' });
		api.restartStatus.mockRejectedValue(new Error('down'));
		showRestartPrompt(ITEM);
		await confirmPendingRestart();
		await vi.advanceTimersByTimeAsync(POLL_MS * POLL_MAX);
		expect(api.restartStatus).toHaveBeenCalledTimes(POLL_MAX);
		expect(restartFlow.view).toBe('failed');
		expect(restartFlow.reason).toMatch(/did not come back/);
	});

	test('keeping the saved values after a failure forgets the restart', async () => {
		api.completeRestart.mockResolvedValue({ completed: true });
		showRestartPrompt({ ...ITEM, phase: 'failed', error: 'rollback_failed' });
		expect(restartFlow.view).toBe('failed');
		await dismissFailedRestart();
		expect(api.completeRestart).toHaveBeenCalledWith('r1');
		expect(restartFlow.view).toBe('hidden');
		expect(toastMock.warning).toHaveBeenCalled();
	});

	test('on page load a waiting, finished or failed restart comes back; a running one does not', async () => {
		api.getPendingRestart.mockResolvedValueOnce({ ...ITEM, phase: 'ready' });
		await resumeRestart();
		expect(restartFlow.view).toBe('ready');
		resetRestartFlow();
		api.getPendingRestart.mockResolvedValueOnce({ ...ITEM, phase: 'restarting' });
		await resumeRestart();
		expect(restartFlow.view).toBe('hidden');
		api.getPendingRestart.mockRejectedValueOnce(new Error('403'));
		await resumeRestart();
		expect(restartFlow.view).toBe('hidden');
	});

	test('the dialog: asks only people with server.config, lists the changes, cancel and restart', async () => {
		vi.useRealTimers();
		session.permissions = ['device.view'];
		session.isSuperAdmin = false;
		render(RestartPrompt);
		expect(api.getPendingRestart).not.toHaveBeenCalled();
		cleanup();

		session.permissions = ['server.config'];
		api.getPendingRestart.mockResolvedValue(ITEM);
		api.cancelRestart.mockResolvedValue({});
		render(RestartPrompt);
		const dialog = await screen.findByRole('dialog');
		expect(api.getPendingRestart).toHaveBeenCalledTimes(1);
		expect(dialog).toHaveTextContent('Server time (NTP)');
		// Waiting for an answer: no close button
		expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: 'Cancel and restore' }));
		expect(api.cancelRestart).toHaveBeenCalledWith('r1');
		expect(screen.queryByRole('dialog')).toBeNull();
	});
});
