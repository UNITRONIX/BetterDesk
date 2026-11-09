/**
 * Who is signed in and what they may do.
 *
 * The server checks every request; `can()` only decides what the UI hides,
 * so an action that would fail with 403 is not offered. Never use it to
 * show something the server would refuse to send anyway.
 */

import * as v from 'valibot';
import { Bootstrap, type NavSection } from '#lib/api/console.ts';
import { ApiError, clientMessages, setCsrfToken } from '#lib/api/client.ts';
import { setStrings, t, has } from '#lib/i18n/i18n.svelte.ts';

export type User = Bootstrap['user'];

class Session {
	user = $state.raw<User | null>(null);
	permissions = $state.raw<readonly string[]>([]);
	isSuperAdmin = $state(false);
	nav = $state.raw<NavSection[]>([]);
	appName = $state('BetterDesk');
	appVersion = $state('');
	emergencyMode = $state(false);
	/** null while loading; an error when the console could not start */
	ready = $state(false);
	error = $state<string | null>(null);
	raw = $state.raw<Bootstrap | null>(null);
}

export const session = new Session();

export function can(permission: string): boolean {
	return session.isSuperAdmin || session.permissions.includes(permission);
}

export function canAny(...permissions: string[]): boolean {
	return permissions.some(can);
}

/** Apply a bootstrap response (also used by tests). */
export function applyBootstrap(boot: Bootstrap): void {
	session.raw = boot;
	session.user = boot.user;
	session.permissions = boot.permissions;
	session.isSuperAdmin = boot.isSuperAdmin;
	session.nav = boot.nav;
	session.appName = boot.branding.appName;
	session.appVersion = boot.appVersion;
	session.emergencyMode = boot.emergencyMode;
	setCsrfToken(boot.csrfToken);
}

/** Copy the client's own messages from the loaded strings */
function localiseClientMessages(): void {
	if (has('errors.no_permission')) clientMessages.permission = t('errors.no_permission');
	if (has('errors.network')) clientMessages.network = t('errors.network');
}

interface BootWindow {
	__BD_BOOT__?: {
		lang: string;
		dir: 'ltr' | 'rtl';
		stringsUrl: string;
		strings?: Promise<Response>;
		session?: Promise<Response>;
	};
}

async function json(
	res: Promise<Response> | undefined,
	url: string
): Promise<{ status: number; body: unknown }> {
	const r = await (res ??
		fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }));
	let body: unknown;
	try {
		body = await r.json();
	} catch {
		body = null;
	}
	return { status: r.status, body };
}

/**
 * Start the console: use the requests /console-boot.js already started (or
 * start them), load strings and session in parallel, apply both.
 * Throws ApiError(401) when nobody is signed in.
 */
export async function startSession(): Promise<void> {
	const boot = (window as unknown as BootWindow).__BD_BOOT__;
	const fallbackLang = document.documentElement.lang || 'en';
	const [strings, sess] = await Promise.all([
		json(boot?.strings, boot?.stringsUrl ?? `/api/console/strings/${fallbackLang}`),
		json(boot?.session, '/api/console/bootstrap')
	]);
	if (sess.status === 401) throw new ApiError('Signed out', 401, { code: 'session_required' });
	if (sess.status !== 200) throw new ApiError(`HTTP ${sess.status}`, sess.status);
	const parsed = v.safeParse(Bootstrap, sess.body);
	if (!parsed.success) throw new ApiError(clientMessages.invalid, 200, { code: 'invalid_response' });
	const b = parsed.output;
	setStrings(
		b.lang.code,
		b.lang.dir,
		(strings.body ?? {}) as Parameters<typeof setStrings>[2],
		b.lang.available
	);
	applyBootstrap(b);
	localiseClientMessages();
	session.ready = true;
}

/** Forget everything about the signed-in person (after sign-out) */
export function clearSession(): void {
	session.user = null;
	session.permissions = [];
	session.isSuperAdmin = false;
	session.nav = [];
	session.raw = null;
	session.ready = false;
	setCsrfToken('');
}
