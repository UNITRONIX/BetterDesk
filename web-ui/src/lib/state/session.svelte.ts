/**
 * Who is signed in and what they may do.
 *
 * The server checks every request; `can()` only decides what the UI hides,
 * so an action that would fail with 403 is not offered. Never use it to
 * show something the server would refuse to send anyway.
 */

import * as v from 'valibot';
import { Bootstrap, saveLanguage, type NavSection, type PanelAccess } from '#lib/api/console.ts';
import { ApiError, clientMessages, setCsrfToken } from '#lib/api/client.ts';
import { setStrings, t, has, savedLanguage, switchLanguage } from '#lib/i18n/i18n.svelte.ts';
import { PREF, writePref } from '#lib/util/storage.ts';

export type User = Bootstrap['user'];

class Session {
	user = $state.raw<User | null>(null);
	permissions = $state.raw<readonly string[]>([]);
	/** Panel access policy; null without one (the role alone decides) */
	access = $state.raw<PanelAccess | null>(null);
	/** The page being shown, without the base: the console layout keeps it current */
	path = $state('');
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

const RANK = { none: 0, read: 1, write: 2 } as const;

/** The panel access section a page belongs to: the longest matching rule, as the server's findRule */
function sectionAt(path: string): string | null {
	let best: { length: number; section: string } | null = null;
	for (const rule of session.access?.pages ?? []) {
		const at = rule.path ?? rule.prefix ?? '';
		const hit = rule.path !== undefined ? path === rule.path : path === at || path.startsWith(at + '/');
		if (hit && (!best || at.length > best.length)) best = { length: at.length, section: rule.section };
	}
	return best?.section ?? null;
}

/**
 * Whether the signed-in person may do something here. On a page of a panel
 * access section, the section's level decides the permission it stands for
 * (read or write), as requestHasPermission does on the server.
 */
export function can(permission: string): boolean {
	if (session.isSuperAdmin) return true;
	const access = session.access;
	const section = access ? sectionAt(session.path) : null;
	if (access && section) {
		const entry = access.catalog.find((e) => e.key === section);
		const level = access.sections[section];
		const needed = entry?.write === permission ? 'write' : entry?.read === permission ? 'read' : null;
		if (level && needed) return RANK[level] >= RANK[needed];
	}
	return session.permissions.includes(permission);
}

/** The server's panel access guard refuses this page (its section is not readable) */
export function sectionDenied(path: string): boolean {
	const access = session.access;
	const section = access ? sectionAt(path) : null;
	if (!access || !section) return false;
	const level = access.sections[section];
	return !level || level === 'none';
}

export function canAny(...permissions: string[]): boolean {
	return permissions.some(can);
}

/** Apply a bootstrap response (also used by tests). */
export function applyBootstrap(boot: Bootstrap): void {
	session.raw = boot;
	session.user = boot.user;
	session.permissions = boot.permissions;
	session.access = boot.access ?? null;
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
	// A response body can be read once: take the early requests, so a second
	// start (Try again) asks the server again
	const early = { strings: boot?.strings, session: boot?.session };
	if (boot) {
		boot.strings = undefined;
		boot.session = undefined;
	}
	const [strings, sess] = await Promise.all([
		json(early.strings, boot?.stringsUrl ?? `/api/console/strings/${fallbackLang}`),
		json(early.session, '/api/console/bootstrap')
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
	restoreLanguage(b);
}

/**
 * A language picked in this browser (before signing in, or on another
 * account) comes back when neither the account nor a cookie has one; it is
 * then saved on the account. Otherwise the browser remembers the current one.
 */
function restoreLanguage(b: Bootstrap): void {
	const saved = savedLanguage();
	const cookie = document.cookie.split(';').some((c) => c.trim().startsWith('betterdesk_lang='));
	const known = b.lang.available.some((l) => l.code === saved);
	if (saved && saved !== b.lang.code && known && !cookie && !b.user.preferredLanguage) {
		void switchLanguage(saved, saveLanguage).catch(() => {});
	} else {
		writePref(PREF.lang, b.lang.code);
	}
}

/** Forget everything about the signed-in person (after sign-out) */
export function clearSession(): void {
	session.user = null;
	session.permissions = [];
	session.access = null;
	session.path = '';
	session.isSuperAdmin = false;
	session.nav = [];
	session.raw = null;
	session.ready = false;
	setCsrfToken('');
}
