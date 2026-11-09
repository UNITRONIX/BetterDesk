/**
 * The bell in the top bar (public/js/notif-center.js): help requests and
 * devices asking to join, newest first, at most ten; unread ones counted.
 *
 * Loaded at start, every 30 s while the tab is visible (poll() pauses in a
 * hidden tab), when the list opens, and when the panel events say something
 * changed. After a 401 polling stops (the API client sends the browser to
 * the sign-in page).
 */

import { ApiError } from '#lib/api/client.ts';
import { poll } from '#lib/state/live.ts';
import {
	NOTIFICATION_LIMIT,
	listNotifications,
	markAllNotificationsRead,
	markNotificationRead,
	type Notification
} from './api.ts';

export const POLL_MS = 30_000;

class Notifications {
	items = $state.raw<Notification[]>([]);
	unread = $state(0);
	loaded = $state(false);
	failed = $state(false);
}

export const notifications = new Notifications();

let stopPoll: (() => void) | null = null;
let inflight: Promise<void> | null = null;

/** Load the list now (one request at a time) */
export function loadNotifications(): Promise<void> {
	inflight ??= (async () => {
		try {
			const { items, unread } = await listNotifications();
			notifications.items = items;
			notifications.unread = unread;
			notifications.loaded = true;
			notifications.failed = false;
		} catch (err) {
			// Keep what was shown; with nothing to show, the list says so and offers a retry
			notifications.failed = true;
			if (err instanceof ApiError && err.status === 401) stopNotifications();
			throw err;
		} finally {
			inflight = null;
		}
	})();
	return inflight;
}

/** Start polling (the shell calls it once) */
export function startNotifications(): void {
	if (stopPoll) return;
	stopPoll = poll(loadNotifications, { every: POLL_MS });
}

export function stopNotifications(): void {
	stopPoll?.();
	stopPoll = null;
}

/** Forget everything (sign-out) */
export function resetNotifications(): void {
	stopNotifications();
	notifications.items = [];
	notifications.unread = 0;
	notifications.loaded = false;
	notifications.failed = false;
}

export async function markRead(id: string): Promise<void> {
	const item = notifications.items.find((i) => i.id === id);
	if (!item || item.read) return;
	await markNotificationRead(id);
	notifications.items = notifications.items.map((i) => (i.id === id ? { ...i, read: true } : i));
	notifications.unread = Math.max(0, notifications.unread - 1);
}

export async function markAllRead(): Promise<void> {
	await markAllNotificationsRead();
	notifications.items = notifications.items.map((i) => ({ ...i, read: true }));
	notifications.unread = 0;
}

/** A panel event (/ws/panel-events) arrived */
export function onPanelEvent(payload: Record<string, unknown>): void {
	const type = payload.type;
	if (type === 'registration_pending' || type === 'registration_changed') {
		// The server is the source of truth for read state and the count
		void loadNotifications().catch(() => {});
		return;
	}
	if (type !== 'help_request') return;
	const status = typeof payload.status === 'string' ? payload.status : '';
	// Accepted or resolved: not a new request; reload instead of adding an unread row
	if (status && status !== 'pending' && status !== 'open') {
		void loadNotifications().catch(() => {});
		return;
	}
	const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');
	const ts = Number(payload.timestamp);
	// Turned into text right away; nothing reads the Date itself
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const createdAt = new Date(Number.isFinite(ts) && ts > 0 ? ts : Date.now()).toISOString();
	const item: Notification = {
		id: str(payload.id) || String(Date.now()),
		kind: 'help_request',
		title: str(payload.hostname) || str(payload.device_name) || str(payload.device_id),
		hostname: str(payload.hostname) || str(payload.device_name),
		device_id: str(payload.device_id),
		platform: str(payload.platform),
		ip: '',
		message: str(payload.message) || str(payload.description),
		link: '/help-requests',
		status: status || 'pending',
		read: false,
		created_at: createdAt
	};
	const rest = notifications.items.filter((i) => i.id !== item.id);
	if (rest.length === notifications.items.length) notifications.unread += 1;
	notifications.items = [item, ...rest].slice(0, NOTIFICATION_LIMIT);
	notifications.loaded = true;
}

/* ── How a row reads (notif-center.js describe()) ── */

export interface NotificationView {
	isRegistration: boolean;
	/** Old URL the row opens */
	link: string;
	name: string;
	deviceId: string;
	platform: string;
	detail: string;
}

function looksLikeAddress(part: string): boolean {
	return /^\d{1,3}(\.\d{1,3}){3}$/.test(part) || /^[0-9a-f]*:[0-9a-f:.]*$/i.test(part);
}

/** Only console paths: a link from the server never leaves the console or runs script */
function safeLink(link: string, fallback: string): string {
	return link.startsWith('/') && !link.startsWith('//') && !link.includes('\\') ? link : fallback;
}

/**
 * Registration items carry "ID · platform · address" in their message;
 * newer servers also send platform and ip as fields.
 */
export function describe(item: Notification): NotificationView {
	const isRegistration = item.kind === 'registration' || item.id.startsWith('registration:');
	const deviceId = item.device_id;
	const title = item.title;
	const name = item.hostname || (title && title !== deviceId ? title : '');
	if (isRegistration) {
		const parts = item.message
			.split(' · ')
			.map((p) => p.trim())
			.filter(Boolean);
		if (parts[0] && parts[0] === deviceId) parts.shift();
		const platform = item.platform || parts.find((p) => !looksLikeAddress(p)) || '';
		const ip = item.ip || parts.find(looksLikeAddress) || '';
		return {
			isRegistration,
			link: safeLink(item.link, '/registrations'),
			name,
			deviceId,
			platform,
			detail: [platform, ip].filter(Boolean).join(', ')
		};
	}
	return {
		isRegistration,
		link: safeLink(item.link, '/help-requests'),
		name: name || (deviceId ? '' : title),
		deviceId,
		platform: item.platform,
		detail: item.message
	};
}
