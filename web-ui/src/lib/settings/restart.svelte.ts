/**
 * The "restart required" flow (old restart-flow.js and the copy in
 * settings.js). A save that needs a service restart answers with
 * `restartRequired`; the page hands it to showRestartPrompt(). The prompt
 * (RestartPrompt.svelte, mounted once by the shell) asks: restart now, or
 * cancel and put the previous values back. A restart is followed with the
 * public status probe until the services are back, then the person signs
 * in again. A prompt left open on another page comes back on the next page
 * load (resumeRestart).
 *
 *   import { showRestartPrompt, onRestartCanceled } from '#lib/settings/restart.svelte.ts';
 *   if (result.restartRequired) showRestartPrompt(result.restartRequired);
 *   $effect(() => onRestartCanceled(() => reload()));
 *
 * Only people with server.config can have a restart waiting.
 */

import {
	cancelRestart,
	completeRestart,
	confirmRestart,
	getPendingRestart,
	restartStatus,
	type RestartItem
} from '#lib/api/restart.ts';
import { tf } from '#lib/i18n/i18n.svelte.ts';
import { toast } from '#lib/ui/toasts.svelte.ts';

export type RestartView = 'hidden' | 'pending' | 'restarting' | 'ready' | 'failed';

/** How often and how long the status probe is asked (2 s, 90 times: 3 minutes) */
export const POLL_MS = 2000;
export const POLL_MAX = 90;

class RestartFlow {
	item = $state.raw<RestartItem | null>(null);
	view = $state<RestartView>('hidden');
	/** The status line under the message */
	status = $state('');
	/** Why the restart failed, in plain words */
	reason = $state('');
	busy = $state(false);
	/** True from the confirmed restart until the services answer; sockets and polls may wait */
	restarting = $state(false);
}

export const restartFlow = new RestartFlow();

// Callbacks, not something markup reads
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const canceledListeners = new Set<(item: RestartItem) => void>();

/** Called after a cancel put the previous values back (reload what the page shows). Returns the unsubscribe. */
export function onRestartCanceled(fn: (item: RestartItem) => void): () => void {
	canceledListeners.add(fn);
	return () => canceledListeners.delete(fn);
}

/** Server error codes as sentences */
export function restartReason(code: string | null | undefined): string {
	switch (code) {
		case 'service_restart_failed_rolled_back':
			return tf(
				'settings.restart_prompt.reason_rolled_back',
				'The services could not be restarted, so the previous values were put back.'
			);
		case 'service_restart_failed_rollback_failed':
			return tf(
				'settings.restart_prompt.reason_rollback_failed',
				'The services could not be restarted, and the previous values could not be put back.'
			);
		case 'rollback_failed':
		case 'restart_rollback_failed':
			return tf('settings.restart_prompt.rollback_failed', 'Could not put the previous values back.');
		case 'restart_timeout':
			return tf(
				'settings.restart_prompt.timeout',
				'The services did not come back in time. Check the service logs (systemd or NSSM), then reload this page.'
			);
		case '':
		case null:
		case undefined:
			return tf('settings.restart_prompt.failed_status', 'The restart failed.');
		default:
			return code;
	}
}

/** Ask about a restart a save just registered */
export function showRestartPrompt(item: RestartItem | null | undefined): void {
	if (!item?.id) return;
	if (item.phase && item.phase !== 'pending') {
		show(item);
		return;
	}
	stopPolling();
	restartFlow.item = item;
	restartFlow.reason = '';
	restartFlow.status = tf('settings.restart_prompt.waiting', 'Waiting for your answer.');
	restartFlow.view = 'pending';
}

function show(item: RestartItem): void {
	restartFlow.item = item;
	if (item.phase === 'pending') showRestartPrompt(item);
	else if (item.phase === 'ready') showReady();
	else if (item.phase === 'failed') showFailed(item.error);
}

/** On page load: a restart left waiting, finished or failed comes back */
export async function resumeRestart(): Promise<void> {
	try {
		const item = await getPendingRestart();
		// A 'restarting' one can't be followed without its token (show() skips it); the next load shows its end
		if (item) show(item);
	} catch {
		/* the prompt is a helper; the page works without it */
	}
}

function showReady(): void {
	stopPolling();
	restartFlow.restarting = false;
	restartFlow.reason = '';
	restartFlow.status = tf('settings.restart_prompt.ready_status', 'Restart finished.');
	restartFlow.view = 'ready';
}

function showFailed(code: string | null | undefined): void {
	stopPolling();
	restartFlow.restarting = false;
	if (restartFlow.item) restartFlow.item = { ...restartFlow.item, phase: 'failed' };
	restartFlow.reason = restartReason(code);
	restartFlow.status = '';
	restartFlow.view = 'failed';
}

function message(err: unknown, fallback: string): string {
	return err instanceof Error && err.message ? err.message : fallback;
}

/** Cancel: the server puts the previous values back */
export async function cancelPendingRestart(): Promise<void> {
	const item = restartFlow.item;
	if (!item || restartFlow.busy) return;
	restartFlow.busy = true;
	try {
		await cancelRestart(item.id);
		restartFlow.item = null;
		restartFlow.view = 'hidden';
		toast.success(
			tf('settings.restart_prompt.canceled', 'The changes were cancelled and the previous values are back.')
		);
		for (const fn of canceledListeners) fn(item);
		window.dispatchEvent(new CustomEvent('betterdesk:restart-canceled', { detail: item }));
	} catch (err) {
		toast.error(
			message(err, tf('settings.restart_prompt.rollback_failed', 'Could not put the previous values back.'))
		);
	} finally {
		restartFlow.busy = false;
	}
}

/** Restart now (also "Try again" after a failure) */
export async function confirmPendingRestart(): Promise<void> {
	const item = restartFlow.item;
	if (!item || restartFlow.busy) return;
	restartFlow.busy = true;
	try {
		const result = await confirmRestart(item.id);
		if (result.phase === 'failed' || result.failed) {
			showFailed(result.error);
			return;
		}
		restartFlow.restarting = true;
		restartFlow.reason = '';
		restartFlow.status = tf('settings.restart_prompt.stopping', 'Stopping and starting the services…');
		restartFlow.view = 'restarting';
		startPolling(item.id, result.token ?? '');
	} catch (err) {
		showFailed(message(err, ''));
	} finally {
		restartFlow.busy = false;
	}
}

let timer: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
	if (timer) clearTimeout(timer);
	timer = null;
}

function startPolling(id: string, token: string): void {
	stopPolling();
	let attempts = 0;
	const step = async () => {
		attempts++;
		restartFlow.status = tf(
			'settings.restart_prompt.checking',
			'Checking whether the services are back ({n} of {max})',
			{ n: attempts, max: POLL_MAX }
		);
		try {
			const { data } = await restartStatus(id, token);
			if (restartFlow.view !== 'restarting') return;
			if (data.ready || data.phase === 'ready') {
				showReady();
				return;
			}
			if (data.phase === 'failed') {
				showFailed(data.error);
				return;
			}
		} catch {
			// The console is meant to be unreachable while it restarts
		}
		if (restartFlow.view !== 'restarting') return;
		if (attempts >= POLL_MAX) {
			showFailed('restart_timeout');
			return;
		}
		timer = setTimeout(step, POLL_MS);
	};
	timer = setTimeout(step, POLL_MS);
}

/** After a finished restart: forget it, then sign in again (the session may be gone) */
export async function finishAndSignIn(): Promise<void> {
	const item = restartFlow.item;
	restartFlow.busy = true;
	try {
		if (item) await completeRestart(item.id);
	} catch {
		// A changed session secret ends the old session; signing in is the way on
	}
	location.assign('/login');
}

/** After a failure: keep the saved values and stop asking */
export async function dismissFailedRestart(): Promise<void> {
	const item = restartFlow.item;
	if (!item || restartFlow.busy) return;
	restartFlow.busy = true;
	try {
		await completeRestart(item.id);
		restartFlow.item = null;
		restartFlow.view = 'hidden';
		toast.warning(
			tf(
				'settings.restart_prompt.dismissed',
				'The saved values were kept. The services still need a restart outside the console.'
			)
		);
	} catch (err) {
		toast.error(message(err, tf('settings.restart_prompt.failed_status', 'The restart failed.')));
	} finally {
		restartFlow.busy = false;
	}
}

/** Close the failure dialog without answering (it comes back on the next page load) */
export function hideRestartPrompt(): void {
	if (restartFlow.view === 'failed') restartFlow.view = 'hidden';
}

/** Tests: back to the start */
export function resetRestartFlow(): void {
	stopPolling();
	restartFlow.item = null;
	restartFlow.view = 'hidden';
	restartFlow.status = '';
	restartFlow.reason = '';
	restartFlow.busy = false;
	restartFlow.restarting = false;
	canceledListeners.clear();
}
