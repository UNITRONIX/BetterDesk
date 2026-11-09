/**
 * Short messages after an action: `toast.success(t('devices.saved'))`,
 * `toast.error(message)`, `toast.info(...)`, `toast.warning(...)`.
 * ToastHost (mounted once by the shell) shows them at the end side of the
 * bottom edge. Like the old console (notifications.js): they go away after
 * 5 seconds, errors after 8; 0 keeps one until it is closed. At most
 * MAX_TOASTS are on screen (the oldest goes first); the same message again
 * restarts its time instead of stacking. Time stops while the pointer or
 * focus is on a toast.
 *
 * In a sheet, the result of an action belongs in the sheet's status line;
 * a toast confirms after the sheet has closed (GUIDE section 11).
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
	id: number;
	type: ToastType;
	message: string;
	title?: string;
}

export interface ToastOptions {
	type?: ToastType;
	message: string;
	title?: string;
	/** Milliseconds on screen; 0 keeps it until closed */
	duration?: number;
}

export const MAX_TOASTS = 3;
const DURATION = 5000;
const ERROR_DURATION = 8000;

class Toasts {
	items = $state.raw<ToastItem[]>([]);
}

/** What ToastHost renders, the newest last */
export const toasts = new Toasts();

interface Timer {
	/** Duration 0: stays until closed */
	sticky: boolean;
	remaining: number;
	started: number;
	handle: ReturnType<typeof setTimeout> | null;
}

// Timers are bookkeeping, not something markup reads
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const timers = new Map<number, Timer>();
let nextId = 1;

function run(id: number, timer: Timer) {
	if (timer.sticky) return;
	timer.started = Date.now();
	timer.handle = setTimeout(() => dismiss(id), timer.remaining);
}

function stop(id: number) {
	const timer = timers.get(id);
	if (timer?.handle) clearTimeout(timer.handle);
	timers.delete(id);
}

export function show({ type = 'info', message, title, duration }: ToastOptions): number {
	const ms = duration ?? (type === 'error' ? ERROR_DURATION : DURATION);
	const same = toasts.items.find((x) => x.type === type && x.message === message && x.title === title);
	const id = same?.id ?? nextId++;
	stop(id);
	if (!same) {
		const items = [...toasts.items, { id, type, message, title }];
		for (const old of items.slice(0, Math.max(0, items.length - MAX_TOASTS))) stop(old.id);
		toasts.items = items.slice(-MAX_TOASTS);
	}
	const timer: Timer = { sticky: ms <= 0, remaining: ms, started: 0, handle: null };
	timers.set(id, timer);
	run(id, timer);
	return id;
}

export function dismiss(id: number): void {
	stop(id);
	toasts.items = toasts.items.filter((x) => x.id !== id);
}

export function dismissAll(): void {
	for (const id of timers.keys()) stop(id);
	toasts.items = [];
}

/** Stop the clock while someone reads or reaches the toast */
export function pause(id: number): void {
	const timer = timers.get(id);
	if (!timer?.handle) return;
	clearTimeout(timer.handle);
	timer.handle = null;
	timer.remaining -= Date.now() - timer.started;
}

export function resume(id: number): void {
	const timer = timers.get(id);
	if (!timer || timer.handle || timer.sticky) return;
	// Leave time to move away and back
	timer.remaining = Math.max(timer.remaining, 1500);
	run(id, timer);
}

export const toast = {
	show,
	dismiss,
	dismissAll,
	success: (message: string, title?: string) => show({ type: 'success', message, title }),
	error: (message: string, title?: string) => show({ type: 'error', message, title }),
	warning: (message: string, title?: string) => show({ type: 'warning', message, title }),
	info: (message: string, title?: string) => show({ type: 'info', message, title })
};
