/**
 * Real-time events for people who approve devices (public/js/app.js):
 *
 * - /ws/panel-events (the server checks enrollment.approve on upgrade):
 *   registration_pending, registration_changed and help_request. Each
 *   message goes to the notification list, updates the registration count,
 *   and is passed on as the old window events (betterdesk:panel-event,
 *   registrations:pending-changed, and app:refresh after an approval) for
 *   pages that listen to them.
 * - The number of devices waiting for approval next to "Enrollment
 *   requests" in the sidebar: GET /api/registrations/count at start, every
 *   15 s while the tab is visible, and after each registration event.
 *   Stops after a 401.
 */

import { ApiError } from '#lib/api/client.ts';
import { poll, socket, type LiveSocket } from '#lib/state/live.ts';
import { registrationCount } from './api.ts';

export const COUNT_POLL_MS = 15_000;

class LiveEvents {
	/** Devices waiting for approval, null until known */
	registrations = $state<number | null>(null);
}

export const live = new LiveEvents();

type Listener = (payload: Record<string, unknown>) => void;
// A list of callbacks, not something markup reads
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const listeners = new Set<Listener>();

/** Get every panel event; returns the function that stops it */
export function onPanelEvents(fn: Listener): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

let stopCount: (() => void) | null = null;
let sock: LiveSocket | null = null;

export async function loadRegistrationCount(): Promise<void> {
	try {
		live.registrations = await registrationCount();
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) stopLiveEvents();
		throw err;
	}
}

function dispatch(payload: Record<string, unknown>): void {
	const type = payload.type;
	if (type === 'registration_pending' || type === 'registration_changed') {
		void loadRegistrationCount().catch(() => {});
		window.dispatchEvent(new CustomEvent('registrations:pending-changed', { detail: payload }));
	}
	// An approval creates the device at once; the devices page reloads
	if (type === 'registration_changed')
		window.dispatchEvent(new CustomEvent('app:refresh', { detail: payload }));
	window.dispatchEvent(new CustomEvent('betterdesk:panel-event', { detail: payload }));
	for (const fn of listeners) fn(payload);
}

/** Start the count and the socket (approvers only; the shell checks the permission) */
export function startLiveEvents(): void {
	if (stopCount) return;
	stopCount = poll(loadRegistrationCount, { every: COUNT_POLL_MS });
	sock = socket('/ws/panel-events', {
		onmessage(data) {
			if (data && typeof data === 'object' && !Array.isArray(data)) dispatch(data as Record<string, unknown>);
		}
	});
}

export function stopLiveEvents(): void {
	stopCount?.();
	stopCount = null;
	sock?.close();
	sock = null;
}

export function resetLiveEvents(): void {
	stopLiveEvents();
	live.registrations = null;
	listeners.clear();
}
