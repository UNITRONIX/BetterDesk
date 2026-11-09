/**
 * Settings › Sign-in without a DOM: password rules, LDAP and OIDC values
 * as the form holds them and as the server takes them (old settings.js
 * populateLdapForm / collectLdapData, populateOidcForm / collectOidcData,
 * isValidOidcRedirectUrlClient).
 */

export interface PasswordRule {
	id: 'length' | 'uppercase' | 'lowercase' | 'number';
	met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
	return [
		{ id: 'length', met: password.length >= 8 },
		{ id: 'uppercase', met: /[A-Z]/.test(password) },
		{ id: 'lowercase', met: /[a-z]/.test(password) },
		{ id: 'number', met: /[0-9]/.test(password) }
	];
}

const str = (v: unknown, fallback = ''): string =>
	v === null || v === undefined || v === '' ? fallback : String(v);
const num = (v: unknown, fallback: number): number => {
	const n = parseInt(String(v ?? ''), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
};

export interface LdapValues {
	enabled: boolean;
	host: string;
	port: number | null;
	use_tls: boolean;
	start_tls: boolean;
	skip_tls_verify: boolean;
	conn_timeout_sec: number | null;
	direct_bind: boolean;
	bind_dn: string;
	bind_password: string;
	base_dn: string;
	user_filter: string;
	direct_bind_dn: string;
	user_attr_id: string;
	user_attr_email: string;
	user_attr_name: string;
	group_base_dn: string;
	group_filter: string;
	group_attr_name: string;
	default_role: string;
	group_role_map: string;
}

export function ldapFromServer(d: Record<string, unknown>): LdapValues {
	return {
		enabled: !!d.enabled,
		host: str(d.host),
		port: num(d.port, 389),
		use_tls: !!d.use_tls,
		start_tls: !!d.start_tls,
		skip_tls_verify: !!d.skip_tls_verify,
		conn_timeout_sec: num(d.conn_timeout_sec, 10),
		direct_bind: !!d.direct_bind,
		bind_dn: str(d.bind_dn),
		bind_password: str(d.bind_password),
		base_dn: str(d.base_dn),
		user_filter: str(d.user_filter),
		direct_bind_dn: str(d.direct_bind_dn),
		user_attr_id: str(d.user_attr_id),
		user_attr_email: str(d.user_attr_email),
		user_attr_name: str(d.user_attr_name),
		group_base_dn: str(d.group_base_dn),
		group_filter: str(d.group_filter),
		group_attr_name: str(d.group_attr_name),
		default_role: str(d.default_role, 'viewer'),
		group_role_map: str(d.group_role_map)
	};
}

/** What PUT /api/settings/ldap and the test take: trimmed text, numbers with their defaults */
export function ldapPayload(v: LdapValues) {
	return {
		enabled: v.enabled,
		host: v.host.trim(),
		port: num(v.port, 389),
		use_tls: v.use_tls,
		start_tls: v.start_tls,
		skip_tls_verify: v.skip_tls_verify,
		bind_dn: v.bind_dn.trim(),
		bind_password: v.bind_password.trim(),
		base_dn: v.base_dn.trim(),
		user_filter: v.user_filter.trim(),
		user_attr_id: v.user_attr_id.trim(),
		user_attr_email: v.user_attr_email.trim(),
		user_attr_name: v.user_attr_name.trim(),
		group_base_dn: v.group_base_dn.trim(),
		group_filter: v.group_filter.trim(),
		group_attr_name: v.group_attr_name.trim(),
		default_role: v.default_role.trim(),
		group_role_map: v.group_role_map.trim(),
		direct_bind: v.direct_bind,
		direct_bind_dn: v.direct_bind_dn.trim(),
		conn_timeout_sec: num(v.conn_timeout_sec, 10)
	};
}

export interface OidcValues {
	enabled: boolean;
	display_name: string;
	issuer_url: string;
	allowed_private_cidrs: string;
	client_id: string;
	client_secret: string;
	redirect_url: string;
	panel_url: string;
	scopes: string;
	use_pkce: boolean;
	auto_discovery: boolean;
	allow_signup: boolean;
	prefer_sso: boolean;
	authorization_url: string;
	token_url: string;
	userinfo_url: string;
	claim_username: string;
	claim_email: string;
	claim_name: string;
	claim_groups: string;
	default_role: string;
	group_role_map: string;
}

export function oidcFromServer(d: Record<string, unknown>, origin: string): OidcValues {
	return {
		enabled: !!d.enabled,
		display_name: str(d.display_name),
		issuer_url: str(d.issuer_url),
		allowed_private_cidrs: str(d.allowed_private_cidrs),
		client_id: str(d.client_id),
		client_secret: str(d.client_secret),
		redirect_url: str(d.redirect_url),
		panel_url: str(d.panel_url, origin),
		scopes: str(d.scopes, 'openid profile email'),
		use_pkce: !!d.use_pkce,
		auto_discovery: d.auto_discovery !== false,
		allow_signup: d.allow_signup !== false,
		prefer_sso: d.prefer_sso === true,
		authorization_url: str(d.authorization_url),
		token_url: str(d.token_url),
		userinfo_url: str(d.userinfo_url),
		claim_username: str(d.claim_username, 'preferred_username'),
		claim_email: str(d.claim_email, 'email'),
		claim_name: str(d.claim_name, 'name'),
		claim_groups: str(d.claim_groups, 'groups'),
		default_role: str(d.default_role, 'viewer'),
		group_role_map: str(d.group_role_map)
	};
}

export function oidcPayload(v: OidcValues, origin: string) {
	return {
		enabled: v.enabled,
		display_name: v.display_name.trim(),
		issuer_url: v.issuer_url.trim(),
		allowed_private_cidrs: v.allowed_private_cidrs.trim(),
		client_id: v.client_id.trim(),
		client_secret: v.client_secret.trim(),
		redirect_url: v.redirect_url.trim(),
		panel_url: v.panel_url.trim() || origin,
		scopes: v.scopes.trim(),
		use_pkce: v.use_pkce,
		auto_discovery: v.auto_discovery,
		allow_signup: v.allow_signup,
		prefer_sso: v.prefer_sso,
		authorization_url: v.authorization_url.trim(),
		token_url: v.token_url.trim(),
		userinfo_url: v.userinfo_url.trim(),
		claim_username: v.claim_username.trim(),
		claim_email: v.claim_email.trim(),
		claim_name: v.claim_name.trim(),
		claim_groups: v.claim_groups.trim(),
		default_role: v.default_role.trim(),
		group_role_map: v.group_role_map.trim()
	};
}

const CALLBACK_PATHS = ['/api/auth/oidc/callback', '/api/oidc/callback'];

/** The console's own callback address */
export function suggestedRedirect(origin: string): string {
	return origin.replace(/\/+$/, '') + '/api/auth/oidc/callback';
}

/** http(s) and one of the callback paths (the server checks the same) */
export function validOidcRedirect(raw: string): boolean {
	if (!raw || typeof raw !== 'string') return false;
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
		const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
		return CALLBACK_PATHS.includes(path);
	} catch {
		return false;
	}
}
