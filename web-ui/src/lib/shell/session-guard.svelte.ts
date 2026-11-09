/**
 * Session watchdog (public/js/session-guard.js). The server enforces idle
 * and absolute expiry; this keeps the tabs in step and warns before an
 * idle sign-out.
 *
 * - Cross-tab: a tab whose session ended (401, or Sign out) tells the
 *   others through BroadcastChannel "betterdesk-panel-session" and the
 *   storage key "betterdesk.session.expired"; they go to the sign-in page.
 * - Idle: a warning `warnBeforeMs` before `idleTimeoutMs` without
 *   activity (mouse, keys, scroll, touch), with "Stay signed in". At the
 *   end the session is checked once; if it is gone, sign-in.
 * - Every 5 minutes (while the tab is visible) GET /api/auth/verify brings
 *   the policy and the server's last activity.
 */

import { setUnauthorizedHandler } from '#lib/api/client.ts';
import { poll } from '#lib/state/live.ts';
import { verifySession, type SessionInfo } from './api.ts';

export const CHANNEL = 'betterdesk-panel-session';
export const EXPIRED_KEY = 'betterdesk.session.expired';
export const SYNC_MS = 5 * 60_000;
const ACTIVITY = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'] as const;

export interface Policy {
	idleTimeoutMs: number;
	warnBeforeMs: number;
}

const DEFAULT_POLICY: Policy = { idleTimeoutMs: 30 * 60_000, warnBeforeMs: 60_000 };

class Guard {
	/** Seconds left when the warning was shown, or null while it is hidden */
	warning = $state<number | null>(null);
}

export const guard = new Guard();

let channel: BroadcastChannel | null = null;
let policy: Policy = DEFAULT_POLICY;
let lastActivity = Date.now();
let lastMark = 0;
let warnTimer: ReturnType<typeof setTimeout> | null = null;
let expireTimer: ReturnType<typeof setTimeout> | null = null;
let stopSync: (() => void) | null = null;
let started = false;
let leaving = false;

/** The sign-in page with a return path to here (the API client's format) */
export function loginUrl(code: string | null, expired = true): string {
	const parts: string[] = [];
	if (expired) parts.push('expired=1');
	parts.push('return=' + encodeURIComponent(location.pathname + location.search));
	if (code) parts.push('reason=' + encodeURIComponent(code));
	return '/login?' + parts.join('&');
}

/** Tell the other tabs that this session ended */
export function broadcastExpired(code = 'session_expired'): void {
	try {
		localStorage.setItem(EXPIRED_KEY, JSON.stringify({ at: Date.now(), code }));
	} catch {
		/* private mode: the channel still works */
	}
	try {
		channel?.postMessage({ type: 'expired', code });
	} catch {
		/* closed */
	}
}

function onSignInPage(): boolean {
	const p = location.pathname;
	return p.startsWith('/login') || p.startsWith('/remote/login');
}

/** Leave for the sign-in page (once), telling the other tabs first */
export function goLogin(code: string | null = 'session_expired'): void {
	if (leaving || onSignInPage()) return;
	leaving = true;
	broadcastExpired(code ?? 'session_expired');
	location.assign(loginUrl(code));
}

function clearTimers(): void {
	if (warnTimer) clearTimeout(warnTimer);
	if (expireTimer) clearTimeout(expireTimer);
	warnTimer = expireTimer = null;
}

function schedule(): void {
	clearTimers();
	const idle = policy.idleTimeoutMs;
	const untilWarn = Math.max(0, lastActivity + idle - policy.warnBeforeMs - Date.now());
	warnTimer = setTimeout(() => {
		guard.warning = Math.max(1, Math.ceil((lastActivity + idle - Date.now()) / 1000));
	}, untilWarn);
	expireTimer = setTimeout(
		() => {
			// The server decides; a 401 sends the browser to sign-in through the API client
			verifySession().catch(() => goLogin());
		},
		Math.max(0, lastActivity + idle - Date.now()) + 500
	);
}

/** Someone used the page: hide the warning and start the idle clock again */
export function markActivity(): void {
	const now = Date.now();
	// Mouse moves come in bursts; once a second is enough
	if (now - lastMark < 1000 && guard.warning === null) return;
	lastMark = now;
	lastActivity = now;
	guard.warning = null;
	schedule();
}

/** "Stay signed in": activity here and on the server */
export function staySignedIn(): void {
	lastMark = 0;
	markActivity();
	verifySession().catch(() => {});
}

function applyPolicy(info: SessionInfo): void {
	const s = info.session;
	if (!s) return;
	policy = {
		idleTimeoutMs: s.idleTimeoutMs && s.idleTimeoutMs > 0 ? s.idleTimeoutMs : policy.idleTimeoutMs,
		warnBeforeMs: s.warnBeforeMs && s.warnBeforeMs > 0 ? s.warnBeforeMs : policy.warnBeforeMs
	};
	if (s.lastActivityAt) lastActivity = Math.max(lastActivity, s.lastActivityAt);
	schedule();
}

function readPolicy(raw: Record<string, unknown> | null | undefined): Policy {
	const idle = Number(raw?.idleTimeoutMs);
	const warn = Number(raw?.warnBeforeMs);
	return {
		idleTimeoutMs: Number.isFinite(idle) && idle > 0 ? idle : DEFAULT_POLICY.idleTimeoutMs,
		warnBeforeMs: Number.isFinite(warn) && warn > 0 ? warn : DEFAULT_POLICY.warnBeforeMs
	};
}

const onActivity = () => markActivity();
const onStorage = (e: StorageEvent) => {
	if (e.key === EXPIRED_KEY && e.newValue) goLogin();
};

/** Start watching (the shell calls it once the session is known) */
export function startGuard(sessionPolicy: Record<string, unknown> | null | undefined): void {
	if (started) return;
	started = true;
	leaving = false;
	policy = readPolicy(sessionPolicy);
	lastActivity = Date.now();
	// A 401 anywhere also signs out the other tabs (Utils.api did the same)
	setUnauthorizedHandler((code) => goLogin(code));
	try {
		channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
		if (channel) {
			channel.onmessage = (e: MessageEvent<unknown>) => {
				const msg = e.data as { type?: unknown } | null;
				if (msg && msg.type === 'expired') goLogin();
			};
		}
	} catch {
		channel = null;
	}
	window.addEventListener('storage', onStorage);
	for (const evt of ACTIVITY) document.addEventListener(evt, onActivity, { passive: true });
	schedule();
	stopSync = poll(() => verifySession().then(applyPolicy), { every: SYNC_MS, immediate: false });
}

export function stopGuard(): void {
	if (!started) return;
	started = false;
	clearTimers();
	stopSync?.();
	stopSync = null;
	channel?.close();
	channel = null;
	window.removeEventListener('storage', onStorage);
	for (const evt of ACTIVITY) document.removeEventListener(evt, onActivity);
	guard.warning = null;
}
