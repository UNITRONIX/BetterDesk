/**
 * My status (online, away, busy) of the signed-in person. Same key and
 * event as the old console (Utils.presence), so the account menu, the chat
 * page and other tabs stay in step.
 */

import { readPref, writePref, PREF } from '#lib/util/storage.ts';

export const PRESENCE_VALUES = ['online', 'away', 'busy'] as const;
export type Presence = (typeof PRESENCE_VALUES)[number] | 'offline';

function valid(v: unknown): v is (typeof PRESENCE_VALUES)[number] {
	return typeof v === 'string' && (PRESENCE_VALUES as readonly string[]).includes(v);
}

class MyPresence {
	status = $state<(typeof PRESENCE_VALUES)[number]>('online');
}

export const myPresence = new MyPresence();
let started = false;

export function initPresence(): void {
	const stored = readPref(PREF.presence);
	myPresence.status = valid(stored) ? stored : 'online';
	if (started) return;
	started = true;
	window.addEventListener('storage', (e) => {
		if (e.key === PREF.presence && valid(e.newValue)) myPresence.status = e.newValue;
	});
	window.addEventListener('bd:presence', (e) => {
		const s = (e as CustomEvent<{ status: unknown }>).detail?.status;
		if (valid(s)) myPresence.status = s;
	});
}

export function setPresence(status: string): void {
	if (!valid(status)) return;
	myPresence.status = status;
	writePref(PREF.presence, status);
	window.dispatchEvent(new CustomEvent('bd:presence', { detail: { status } }));
}
