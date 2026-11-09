/**
 * The sign-in page's server calls (routes/auth.routes.js). Nobody is signed
 * in yet, so a 401 here is a wrong password, not a reason to leave the page
 * (allowAnonymous).
 */

import * as v from 'valibot';
import { api } from './client';
import { Language } from './console';

const Slide = v.object({
	id: v.string(),
	slideKey: v.string(),
	imageUrl: v.string(),
	title: v.string(),
	body: v.string(),
	overlay: v.number()
});
export type Slide = v.InferOutput<typeof Slide>;

/** GET /api/auth/login-page: what the page shows before sign-in (no user data) */
export const LoginPage = v.object({
	success: v.literal(true),
	csrfToken: v.string(),
	appName: v.string(),
	appVersion: v.string(),
	desktopMode: v.boolean(),
	/** This browser has a console session (absent on servers before it was added) */
	signedIn: v.optional(v.boolean(), false),
	branding: v.object({
		logoType: v.string(),
		logoSvg: v.string(),
		logoUrl: v.string(),
		logoText: v.string(),
		logoTextAccent: v.string(),
		loginTitle: v.string(),
		loginSubtitle: v.string(),
		loginPromoMode: v.picklist(['classic', 'single', 'slides']),
		loginSlides: v.array(Slide),
		footerText: v.string(),
		showPoweredBy: v.boolean()
	}),
	languages: v.array(Language),
	attestation: v.nullable(
		v.object({ tier: v.string(), brand: v.string(), badgeTitle: v.string(), tierLabel: v.string() })
	)
});
export type LoginPage = v.InferOutput<typeof LoginPage>;
export type LoginBranding = LoginPage['branding'];
export type Attestation = NonNullable<LoginPage['attestation']>;

export function getLoginPage(signal?: AbortSignal): Promise<LoginPage> {
	return api(LoginPage, '/api/auth/login-page', { signal, allowAnonymous: true });
}

/** POST /api/auth/login and /api/auth/totp/verify */
export const SignInResult = v.looseObject({
	success: v.literal(true),
	totpRequired: v.optional(v.boolean(), false),
	redirect: v.optional(v.string())
});
export type SignInResult = v.InferOutput<typeof SignInResult>;

export interface PasswordSignIn {
	username: string;
	password: string;
	remember?: boolean;
	clientFingerprint: string;
	return?: string;
}

export function signIn(body: PasswordSignIn): Promise<SignInResult> {
	return api(SignInResult, '/api/auth/login', { method: 'POST', body, allowAnonymous: true });
}

export type TotpSignIn = ({ code: string } | { recoveryCode: string }) & {
	clientFingerprint: string;
	return?: string;
};

export function verifyTotp(body: TotpSignIn): Promise<SignInResult> {
	return api(SignInResult, '/api/auth/totp/verify', { method: 'POST', body, allowAnonymous: true });
}

/** GET /api/auth/oidc/status: whether single sign-on is on, and whether to start it right away */
export const OidcStatus = v.looseObject({
	enabled: v.optional(v.boolean(), false),
	display_name: v.optional(v.nullable(v.string())),
	prefer_sso: v.optional(v.boolean(), false),
	local_bypass: v.optional(v.boolean(), false)
});
export type OidcStatus = v.InferOutput<typeof OidcStatus>;

export function getOidcStatus(signal?: AbortSignal): Promise<OidcStatus> {
	return api(OidcStatus, '/api/auth/oidc/status', { signal, allowAnonymous: true });
}

/** The browser goes here to sign in with the identity provider (a page, not a fetch) */
export function oidcStartUrl(returnPath: string | null): string {
	return '/api/auth/oidc/authorize' + (returnPath ? '?return_url=' + encodeURIComponent(returnPath) : '');
}
