/**
 * Settings › General, Appearance and Sign-in (routes/settings.routes.js,
 * auth.routes.js, meshcentral.routes.js, dashboard.routes.js). Request and
 * response shapes are the server's; the schemas only check what the pages
 * read.
 */

import * as v from 'valibot';
import { api, request, wrapped, Ok, Text, BoolLike, NumLike } from './client.ts';
import { RestartItem } from './restart.ts';

const enc = encodeURIComponent;

/** `{ data: X }` or X itself (Go answers proxied as they come) */
function maybeWrapped<S extends v.GenericSchema>(inner: S): v.GenericSchema<unknown, v.InferOutput<S>> {
	return v.pipe(
		v.unknown(),
		v.transform((raw) => {
			const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
			return o.data && typeof o.data === 'object' ? o.data : raw;
		}),
		inner
	) as v.GenericSchema<unknown, v.InferOutput<S>>;
}

const OptNum = v.optional(v.nullable(NumLike));

/* ── General ── */

export const ServerInfo = v.looseObject({
	app: v.optional(v.looseObject({ version: Text })),
	server: v.optional(v.looseObject({ uptime: OptNum })),
	goServer: v.optional(v.nullable(v.looseObject({ version: Text }))),
	paths: v.optional(v.looseObject({ database: Text }))
});
export type ServerInfo = v.InferOutput<typeof ServerInfo>;

/** Versions, database file, uptime; every signed-in person */
export function getServerInfo(signal?: AbortSignal): Promise<ServerInfo> {
	return api(wrapped(ServerInfo), '/api/settings/info', { signal });
}

export const ClientConfig = v.looseObject({
	server_id: Text,
	relay_server: Text,
	api_url: Text,
	endpoint_sources: v.optional(v.nullable(v.looseObject({ host: Text, relay: Text, api: Text })), null),
	phone_unreachable_host: BoolLike
});
export type ClientConfig = v.InferOutput<typeof ClientConfig>;

/** The addresses clients get now (the dashboard's client setup) */
export function getClientConfig(signal?: AbortSignal): Promise<ClientConfig> {
	return api(wrapped(ClientConfig), '/api/dashboard/client-config', { signal });
}

export const PublicEndpoints = v.looseObject({
	public_server_id: Text,
	public_relay_server: Text,
	public_api_url: Text
});
export type PublicEndpoints = v.InferOutput<typeof PublicEndpoints>;

export function getPublicEndpoints(signal?: AbortSignal): Promise<PublicEndpoints> {
	return api(wrapped(PublicEndpoints), '/api/settings/public-endpoints', { signal });
}

export function savePublicEndpoints(body: {
	public_server_id: string;
	public_relay_server: string;
	public_api_url: string;
}): Promise<PublicEndpoints> {
	return api(wrapped(PublicEndpoints), '/api/settings/public-endpoints', { method: 'PUT', body });
}

export interface ConnectionModeSettings {
	mode: 'p2p_first' | 'relay_only';
	p2p_fallback_ms: number;
	same_nat_relay: boolean;
	allow_shared_nat_initiator: boolean;
	logged_in_only_initiator: boolean;
	operator_only_outbound: boolean;
}

export const ConnectionMode = v.looseObject({
	mode: Text,
	p2p_fallback_ms: OptNum,
	same_nat_relay: v.optional(v.nullable(v.boolean())),
	allow_shared_nat_initiator: v.optional(v.nullable(v.boolean())),
	logged_in_only_initiator: v.optional(v.nullable(v.boolean())),
	operator_only_outbound: v.optional(v.nullable(v.boolean())),
	source: Text,
	deployment: Text,
	writable: v.optional(v.nullable(v.boolean())),
	runtime: v.optional(
		v.nullable(
			v.looseObject({ always_use_relay: v.optional(v.nullable(v.boolean())), p2p_fallback_ms: OptNum })
		),
		null
	)
});
export type ConnectionMode = v.InferOutput<typeof ConnectionMode>;

export function getConnectionMode(signal?: AbortSignal): Promise<ConnectionMode> {
	return api(wrapped(ConnectionMode), '/api/settings/connection-mode', { signal });
}

export async function saveConnectionMode(body: ConnectionModeSettings): Promise<RestartItem | null> {
	const out = await api(
		wrapped(v.looseObject({ restartRequired: v.optional(v.nullable(RestartItem), null) })),
		'/api/settings/connection-mode',
		{ method: 'PUT', body }
	);
	return out.restartRequired ?? null;
}

export async function getDeviceScope(signal?: AbortSignal): Promise<'open' | 'restricted'> {
	const out = await api(wrapped(v.looseObject({ mode: Text })), '/api/settings/device-scope', { signal });
	return out.mode === 'restricted' ? 'restricted' : 'open';
}

export function saveDeviceScope(mode: 'open' | 'restricted') {
	return api(Ok, '/api/settings/device-scope', { method: 'POST', body: { mode } });
}

export const AvailabilityHistory = v.looseObject({ enabled: BoolLike, retention_days: OptNum });

export function getAvailabilityHistory(signal?: AbortSignal) {
	return api(wrapped(AvailabilityHistory), '/api/settings/availability-history', { signal });
}

export function saveAvailabilityHistory(enabled: boolean, retentionDays: number) {
	return api(Ok, '/api/settings/availability-history', {
		method: 'POST',
		body: { enabled, retention_days: retentionDays }
	});
}

/* ── MeshCentral ── */

export const MeshStatus = v.looseObject({
	enabled: BoolLike,
	agents_online: OptNum,
	server_id: Text,
	cert_present: BoolLike,
	cert_modified: v.optional(v.nullable(v.union([v.string(), v.number()])))
});
export type MeshStatus = v.InferOutput<typeof MeshStatus>;

/** Off (or not answering): enabled false */
export async function getMeshStatus(signal?: AbortSignal): Promise<MeshStatus> {
	try {
		return await api(maybeWrapped(MeshStatus), '/api/mesh/status', { signal });
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') throw err;
		return v.parse(MeshStatus, { enabled: false });
	}
}

const MeshGroupRow = v.looseObject({ id: Text, name: Text, mesh_id: Text });
export interface MeshGroup {
	id: string;
	name: string;
	/** Made by the server; empty until the group is saved */
	mesh_id: string;
}

export async function getMeshGroups(signal?: AbortSignal): Promise<MeshGroup[]> {
	const out = await api(
		maybeWrapped(v.looseObject({ groups: v.optional(v.nullable(v.array(MeshGroupRow)), []) })),
		'/api/mesh/groups',
		{ signal }
	);
	return (out.groups ?? []).map((g) => ({ id: g.id ?? '', name: g.name ?? '', mesh_id: g.mesh_id ?? '' }));
}

/** The whole list replaces the stored one; a group keeps its MeshID when it is in the list */
export function saveMeshGroups(groups: { id: string; name: string; mesh_id?: string }[]) {
	return request('/api/mesh/groups', { method: 'POST', body: { groups } });
}

export const Recording = v.looseObject({
	id: Text,
	peer_id: Text,
	transport: Text,
	session_type: Text,
	modified: v.optional(v.nullable(v.union([v.string(), v.number()]))),
	size: OptNum
});
export type Recording = v.InferOutput<typeof Recording>;

export async function getRecordings(signal?: AbortSignal): Promise<Recording[]> {
	const out = await api(
		maybeWrapped(v.looseObject({ recordings: v.optional(v.nullable(v.array(Recording)), []) })),
		'/api/session/recordings',
		{ signal }
	);
	return out.recordings ?? [];
}

/** The .msh file for a group (MeshAgent install); name goes into the file */
export function meshDownloadHref(name: string, meshId?: string): string {
	let href = `/api/mesh/download.msh?name=${enc(name.trim() || 'BetterDesk Mesh')}`;
	if (meshId?.trim()) href += `&mesh_id=${enc(meshId.trim())}`;
	return href;
}

export function recordingHref(id: string): string {
	return `/api/mesh/recordings/${enc(id)}`;
}

/* ── Sign-in: your account ── */

export function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
	return api(Ok, '/api/auth/password', {
		method: 'POST',
		body: { currentPassword, newPassword, confirmPassword }
	});
}

export async function getTotpEnabled(signal?: AbortSignal): Promise<boolean> {
	const out = await api(v.looseObject({ enabled: BoolLike }), '/api/auth/totp/status', { signal });
	return out.enabled === true;
}

export const TotpSetup = v.looseObject({ qrCode: Text, secret: Text });

export function setupTotp() {
	return api(TotpSetup, '/api/auth/totp/setup', { method: 'POST' });
}

export async function enableTotp(code: string): Promise<string[]> {
	const out = await api(
		v.looseObject({ recoveryCodes: v.optional(v.nullable(v.array(v.string())), []) }),
		'/api/auth/totp/enable',
		{ method: 'POST', body: { code } }
	);
	return out.recoveryCodes ?? [];
}

export function disableTotp(password: string) {
	return api(Ok, '/api/auth/totp/disable', { method: 'POST', body: { password } });
}

/* ── Sign-in: for everyone ── */

export const Enrollment = v.looseObject({
	mode: Text,
	rich_approve: v.optional(v.nullable(v.boolean())),
	tag_picker: v.optional(v.nullable(v.boolean())),
	pending_count: OptNum
});
export type Enrollment = v.InferOutput<typeof Enrollment>;

export function getEnrollment(signal?: AbortSignal): Promise<Enrollment> {
	return api(wrapped(Enrollment), '/api/settings/enrollment', { signal });
}

export function saveEnrollment(body: { mode: string; rich_approve: boolean; tag_picker: boolean }) {
	return api(wrapped(Enrollment), '/api/settings/enrollment', { method: 'PUT', body });
}

export const ClientSessions = v.looseObject({
	expiry_days: OptNum,
	sliding: v.optional(v.nullable(v.boolean())),
	max_days: OptNum
});

export function getClientSessions(signal?: AbortSignal) {
	return api(wrapped(ClientSessions), '/api/settings/client-sessions', { signal });
}

export function saveClientSessions(body: { expiry_days: number; sliding: boolean; max_days: number }) {
	return api(Ok, '/api/settings/client-sessions', { method: 'PUT', body });
}

/** LDAP as the Go server stores it (GET answers the object itself) */
export type LdapConfig = Record<string, unknown>;

export function getLdap(signal?: AbortSignal): Promise<LdapConfig> {
	return api(v.record(v.string(), v.unknown()), '/api/settings/ldap', { signal });
}

export function saveLdap(body: LdapConfig) {
	return api(Ok, '/api/settings/ldap', { method: 'PUT', body });
}

export const TestResult = v.looseObject({
	success: v.optional(v.nullable(v.boolean())),
	error: Text,
	authorization_endpoint: Text,
	token_endpoint: Text,
	userinfo_endpoint: Text
});
export type TestResult = v.InferOutput<typeof TestResult>;

/** The answer says success or error; it is not an HTTP error */
export function testLdap(body: LdapConfig): Promise<TestResult> {
	return api(TestResult, '/api/settings/ldap/test', { method: 'POST', body });
}

export type OidcConfig = Record<string, unknown>;

export function getOidc(signal?: AbortSignal): Promise<OidcConfig> {
	return api(v.record(v.string(), v.unknown()), '/api/settings/oidc', { signal });
}

export function saveOidc(body: OidcConfig) {
	return api(Ok, '/api/settings/oidc', { method: 'PUT', body });
}

export function testOidc(issuerUrl: string, allowedPrivateCidrs: string): Promise<TestResult> {
	return api(TestResult, '/api/settings/oidc/test', {
		method: 'POST',
		body: { issuer_url: issuerUrl, allowed_private_cidrs: allowedPrivateCidrs }
	});
}

/* ── Appearance ── */

/** The stored appearance: flat keys, strings, colours, slides (brandingService DEFAULT_BRANDING) */
export type Branding = Record<string, unknown>;

export const Readability = v.optional(
	v.nullable(
		v.looseObject({
			issues: v.optional(
				v.array(
					v.looseObject({
						severity: Text,
						messageKey: Text,
						messageParams: v.optional(v.nullable(v.record(v.string(), v.union([v.string(), v.number()])))),
						message: Text
					})
				),
				[]
			)
		})
	),
	null
);
export type Readability = v.InferOutput<typeof Readability>;

const BrandingAnswer = v.looseObject({
	data: v.record(v.string(), v.unknown()),
	readability: Readability,
	revision: v.optional(v.nullable(v.union([v.string(), v.number()])))
});
export type BrandingAnswer = v.InferOutput<typeof BrandingAnswer>;

export function getBranding(signal?: AbortSignal): Promise<BrandingAnswer> {
	return api(BrandingAnswer, '/api/settings/branding', { signal });
}

export function saveBranding(body: Branding): Promise<BrandingAnswer> {
	return api(BrandingAnswer, '/api/settings/branding', { method: 'POST', body });
}

export async function uploadLogo(file: File): Promise<string> {
	const form = new FormData();
	form.append('logo', file);
	const out = await api(v.looseObject({ url: v.string() }), '/api/settings/branding/upload-logo', {
		method: 'POST',
		body: form
	});
	return out.url;
}

export const BackgroundImage = v.looseObject({ name: Text, url: Text });
export type BackgroundImage = v.InferOutput<typeof BackgroundImage>;

export function listBackgrounds(signal?: AbortSignal): Promise<BackgroundImage[]> {
	return api(wrapped(v.array(BackgroundImage)), '/api/settings/branding/backgrounds', { signal });
}

export const UploadedBackground = v.looseObject({
	url: v.string(),
	data: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
	revision: v.optional(v.nullable(v.union([v.string(), v.number()])))
});
export type UploadedBackground = v.InferOutput<typeof UploadedBackground>;

/**
 * Upload a background picture with progress (0-100). With a target
 * (bgImageUrl, loginBgImageUrl ...) the server saves it as that background
 * right away and answers the saved appearance.
 */
export function uploadBackground(
	file: File,
	target: string,
	csrfToken: string,
	onProgress?: (percent: number) => void
): Promise<UploadedBackground> {
	return new Promise((resolve, reject) => {
		const form = new FormData();
		form.append('background', file);
		if (target) form.append('target', target);
		const xhr = new XMLHttpRequest();
		xhr.open('POST', '/api/settings/branding/upload-background');
		xhr.withCredentials = true;
		if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);
		xhr.setRequestHeader('Accept', 'application/json');
		xhr.upload.onprogress = (e) => {
			if (e.lengthComputable && onProgress)
				onProgress(Math.max(1, Math.min(99, Math.round((e.loaded / e.total) * 100))));
		};
		xhr.onload = () => {
			let body: unknown;
			try {
				body = JSON.parse(xhr.responseText);
			} catch {
				body = null;
			}
			const err = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
			if (xhr.status < 200 || xhr.status >= 300) {
				reject(new Error(typeof err === 'string' && err ? err : `HTTP ${xhr.status}`));
				return;
			}
			const parsed = v.safeParse(UploadedBackground, body);
			if (!parsed.success) {
				reject(new Error(`HTTP ${xhr.status}`));
				return;
			}
			onProgress?.(100);
			resolve(parsed.output);
		};
		xhr.onerror = () => reject(new Error('network'));
		xhr.onabort = () => reject(new Error('network'));
		xhr.send(form);
	});
}

export function resetBranding() {
	return api(Ok, '/api/settings/branding/reset', { method: 'POST' });
}

/** The appearance as a theme file (betterdesk-theme.json) */
export function exportBranding(): Promise<unknown> {
	return request('/api/settings/branding/export');
}

export function importBranding(preset: unknown) {
	return api(Ok, '/api/settings/branding/import', { method: 'POST', body: preset });
}

export const BrandingProfile = v.looseObject({
	id: v.union([v.number(), v.string()]),
	name: Text,
	is_active: BoolLike
});
export type BrandingProfile = v.InferOutput<typeof BrandingProfile>;

export function listProfiles(signal?: AbortSignal): Promise<BrandingProfile[]> {
	return api(wrapped(v.array(BrandingProfile)), '/api/settings/branding/profiles', { signal });
}

export function createProfile(name: string, branding: Branding) {
	return api(Ok, '/api/settings/branding/profiles', {
		method: 'POST',
		body: { name, description: '', branding }
	});
}

export function updateProfile(id: number | string, branding: Branding) {
	return api(Ok, `/api/settings/branding/profiles/${enc(String(id))}`, { method: 'PUT', body: { branding } });
}

export function applyProfile(id: number | string) {
	return api(
		v.looseObject({
			data: v.optional(v.nullable(v.record(v.string(), v.unknown()))),
			revision: v.optional(v.nullable(v.union([v.string(), v.number()])))
		}),
		`/api/settings/branding/profiles/${enc(String(id))}/apply`,
		{ method: 'POST' }
	);
}

export async function duplicateProfile(id: number | string, name: string): Promise<string | null> {
	const out = await api(
		v.looseObject({
			data: v.optional(v.nullable(v.looseObject({ id: v.optional(v.union([v.number(), v.string()])) })))
		}),
		`/api/settings/branding/profiles/${enc(String(id))}/duplicate`,
		{ method: 'POST', body: name ? { name } : {} }
	);
	return out.data?.id !== undefined ? String(out.data.id) : null;
}

export function deleteProfile(id: number | string) {
	return api(Ok, `/api/settings/branding/profiles/${enc(String(id))}`, { method: 'DELETE' });
}

export const BuiltinTheme = v.looseObject({ id: v.string(), name: Text, description: Text });
export type BuiltinTheme = v.InferOutput<typeof BuiltinTheme>;

export function listThemes(signal?: AbortSignal): Promise<BuiltinTheme[]> {
	return api(wrapped(v.array(BuiltinTheme)), '/api/settings/themes', { signal });
}

export function applyTheme(id: string) {
	return api(Ok, `/api/settings/themes/${enc(id)}/apply`, { method: 'POST' });
}

export const FontInfo = v.looseObject({ family: v.string(), category: Text, downloaded: BoolLike });
export type FontInfo = v.InferOutput<typeof FontInfo>;

export function searchFonts(
	query: string,
	category: string,
	google: boolean,
	signal?: AbortSignal
): Promise<FontInfo[]> {
	return api(wrapped(v.array(FontInfo)), '/api/settings/fonts', {
		signal,
		query: { q: query, category, source: google ? 'google' : undefined }
	});
}

export const LocalFont = v.looseObject({ family: v.string() });

export function listLocalFonts(signal?: AbortSignal): Promise<{ family: string }[]> {
	return api(wrapped(v.array(LocalFont)), '/api/settings/fonts/local', { signal });
}

export function downloadFont(family: string) {
	return api(Ok, '/api/settings/fonts/download', { method: 'POST', body: { family } });
}

export function deleteFont(family: string) {
	return api(Ok, `/api/settings/fonts/${enc(family)}`, { method: 'DELETE' });
}

export function uploadFont(file: File, family: string) {
	const form = new FormData();
	form.append('font', file);
	form.append('family', family);
	return api(Ok, '/api/settings/fonts/upload', { method: 'POST', body: form });
}
