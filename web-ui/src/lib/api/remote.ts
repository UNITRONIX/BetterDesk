/**
 * The remote client's endpoints (routes/remote.routes.js and friends):
 * the viewer's data, the remote sign-in and guest pages, the device
 * password the organisation set, remote target certificates, the work
 * report after a billed session, and the console sign-in calls the
 * remote sign-in page uses.
 */

import * as v from 'valibot';
import { api, request } from './client.ts';
import { Language } from './console.ts';

const Caps = v.looseObject({
	transport: v.optional(v.string(), 'rd'),
	os_agent: v.optional(v.boolean()),
	cdap_connected: v.optional(v.boolean()),
	mesh_connected: v.optional(v.boolean()),
	device_type: v.optional(v.string()),
	mesh_share: v.optional(v.boolean()),
	mesh_view_only: v.optional(v.boolean()),
	remote_target: v.optional(v.boolean()),
	remote_protocol: v.optional(v.string()),
	remote_target_config: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
	guest_access: v.optional(v.boolean()),
	guest_view_only: v.optional(v.boolean()),
	guest_peer_ids: v.optional(v.array(v.string()))
});

export const ViewerData = v.object({
	success: v.literal(true),
	deviceId: v.string(),
	device: v.object({ name: v.string(), platform: v.string() }),
	capabilities: Caps,
	serverPubKey: v.string(),
	connection: v.nullable(v.record(v.string(), v.unknown())),
	guestToken: v.string(),
	mockRemote: v.nullable(v.object({ scenario: v.string() })),
	user: v.nullable(v.object({ id: v.union([v.string(), v.number()]), name: v.string() })),
	/** billing.reports: the work report after a billed session */
	workReports: v.optional(v.boolean(), false),
	csrfToken: v.string()
});
export type ViewerData = v.InferOutput<typeof ViewerData>;

/** The page's query parameters the server reads (guest link, mesh share, transport, dev mock) */
export const VIEWER_QUERY = ['guest', 't', 'mesh_share', 'transport', 'mock', 'scenario'] as const;

/** GET /api/remote/viewer/:id; 401 and 403 come back as ApiError (no sign-in redirect here) */
export function getViewerData(deviceId: string, search: string, signal?: AbortSignal): Promise<ViewerData> {
	const q = new URLSearchParams(search);
	const query: Record<string, string> = {};
	for (const k of VIEWER_QUERY) {
		const val = q.get(k);
		if (val) query[k] = val;
	}
	return api(ViewerData, `/api/remote/viewer/${encodeURIComponent(deviceId)}`, {
		query,
		signal,
		allowAnonymous: true
	});
}

/* ── Pages without a session ── */

export const PublicBranding = v.object({
	logoType: v.nullable(v.string()),
	logoIcon: v.optional(v.string(), ''),
	logoSvg: v.optional(v.string(), ''),
	logoUrl: v.optional(v.string(), ''),
	logoText: v.optional(v.string(), ''),
	logoTextAccent: v.optional(v.string(), '')
});
export type PublicBranding = v.InferOutput<typeof PublicBranding>;

const PageInfo = v.object({
	appName: v.string(),
	appVersion: v.string(),
	branding: PublicBranding,
	languages: v.array(Language),
	csrfToken: v.string()
});
export type PageInfo = v.InferOutput<typeof PageInfo>;

const LoginInfo = v.object({
	...PageInfo.entries,
	success: v.literal(true),
	signedIn: v.boolean(),
	returnUrl: v.string()
});
export type LoginInfo = v.InferOutput<typeof LoginInfo>;

export function getLoginInfo(returnPath: string): Promise<LoginInfo> {
	return api(LoginInfo, '/api/remote/login-info', { query: { return: returnPath }, allowAnonymous: true });
}

export const GuestDevice = v.looseObject({
	id: v.string(),
	display_name: v.optional(v.nullable(v.string())),
	hostname: v.optional(v.nullable(v.string())),
	online: v.optional(v.boolean())
});
export type GuestDevice = v.InferOutput<typeof GuestDevice>;

const GuestOk = v.object({
	success: v.literal(true),
	token: v.string(),
	guest: v.object({
		view_only: v.boolean(),
		expires_at: v.string(),
		label: v.string(),
		devices: v.array(GuestDevice)
	}),
	page: PageInfo
});
const GuestFailed = v.object({
	success: v.literal(false),
	code: v.string(),
	error: v.string(),
	page: PageInfo
});
export type GuestInfo = v.InferOutput<typeof GuestOk> | v.InferOutput<typeof GuestFailed>;

/** GET /api/remote/guest-info: a refused link is an answer (with the page's branding), not an error */
export async function getGuestInfo(token: string): Promise<GuestInfo> {
	try {
		return await api(GuestOk, '/api/remote/guest-info', { query: { t: token }, allowAnonymous: true });
	} catch (err) {
		const data = (err as { data?: unknown }).data;
		const parsed = v.safeParse(GuestFailed, data);
		if (parsed.success) return parsed.output;
		throw err;
	}
}

/** GET /api/remote/desk: device.connect, and drops a guest cookie (as GET /remote did) */
export function enterDesk(): Promise<unknown> {
	return request('/api/remote/desk');
}

/* ── Sign-in (routes/auth.routes.js) ── */

const LoginAnswer = v.looseObject({
	success: v.optional(v.boolean()),
	totpRequired: v.optional(v.boolean()),
	error: v.optional(v.string())
});
export type LoginAnswer = v.InferOutput<typeof LoginAnswer>;

/** POST /api/auth/login; a refusal is an answer with error, not a thrown error */
export async function signIn(username: string, password: string): Promise<LoginAnswer> {
	try {
		return await api(LoginAnswer, '/api/auth/login', {
			method: 'POST',
			body: { username, password },
			allowAnonymous: true
		});
	} catch (err) {
		const parsed = v.safeParse(LoginAnswer, (err as { data?: unknown }).data);
		if (parsed.success && parsed.output.error) return { ...parsed.output, success: false };
		throw err;
	}
}

export async function verifyTotp(code: string): Promise<LoginAnswer> {
	try {
		return await api(LoginAnswer, '/api/auth/totp/verify', {
			method: 'POST',
			body: { code },
			allowAnonymous: true
		});
	} catch (err) {
		const parsed = v.safeParse(LoginAnswer, (err as { data?: unknown }).data);
		if (parsed.success && parsed.output.error) return { ...parsed.output, success: false };
		throw err;
	}
}

/* ── In the viewer ── */

/** The connection password the organisation set for a device, '' when none (or not allowed) */
export async function getConnectPassword(deviceId: string): Promise<string> {
	try {
		const out = await api(
			v.looseObject({ password: v.optional(v.nullable(v.string())) }),
			`/api/devices/${encodeURIComponent(deviceId)}/connect-password`,
			{ allowAnonymous: true }
		);
		return out.password ? String(out.password) : '';
	} catch {
		return '';
	}
}

/** Trust a remote target's certificate fingerprint (RDP/VNC gateway) */
export function acceptCertificate(targetId: string, fingerprint: string): Promise<unknown> {
	return request(`/api/remote-targets/${encodeURIComponent(targetId)}/certificate/accept`, {
		method: 'POST',
		body: { fingerprint }
	});
}

export const PendingBillingSession = v.looseObject({
	id: v.union([v.string(), v.number()]),
	device_id: v.optional(v.nullable(v.string())),
	package_name: v.optional(v.nullable(v.string())),
	billed_minutes: v.optional(v.nullable(v.number())),
	amount_included: v.optional(v.nullable(v.number())),
	amount_overage: v.optional(v.nullable(v.number())),
	currency: v.optional(v.nullable(v.string()))
});
export type PendingBillingSession = v.InferOutput<typeof PendingBillingSession>;

/** The billed session waiting for a work report, or null */
export async function getPendingBillingSession(deviceId: string): Promise<PendingBillingSession | null> {
	try {
		const out = await api(
			v.looseObject({ session: v.optional(v.nullable(PendingBillingSession)) }),
			'/api/panel/billing/sessions/pending',
			{ query: { device_id: deviceId }, allowAnonymous: true }
		);
		return out.session ?? null;
	} catch {
		return null;
	}
}

export const BillingCheck = v.looseObject({
	allowed: v.optional(v.boolean()),
	contract_id: v.optional(v.nullable(v.union([v.string(), v.number()]))),
	package_name: v.optional(v.nullable(v.string())),
	remaining_minutes: v.optional(v.nullable(v.number())),
	org_name: v.optional(v.nullable(v.string())),
	company: v.optional(v.nullable(v.string())),
	device_name: v.optional(v.nullable(v.string()))
});
export type BillingCheck = v.InferOutput<typeof BillingCheck>;

/** The device's support package (for the Work report control), or null */
export async function getBillingCheck(deviceId: string): Promise<BillingCheck | null> {
	try {
		return await api(BillingCheck, '/api/panel/billing/check', {
			query: { device_id: deviceId },
			allowAnonymous: true
		});
	} catch {
		return null;
	}
}

export function submitWorkReport(sessionId: string | number, summary: string): Promise<unknown> {
	return request(`/api/panel/billing/sessions/${encodeURIComponent(String(sessionId))}/report`, {
		method: 'POST',
		body: { summary, category: '', ticket_ref: '' }
	});
}

/** POST /api/i18n/set/:code (also sets the language cookie when nobody is signed in) */
export function saveLanguageChoice(code: string): Promise<unknown> {
	return request(`/api/i18n/set/${encodeURIComponent(code)}`, { method: 'POST', allowAnonymous: true });
}
