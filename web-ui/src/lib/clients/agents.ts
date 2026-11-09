/**
 * Support agents (/agents) without a DOM: turning the server's error codes
 * into sentences, the old strings' {{name}} placeholders, and who may open
 * the page. Tested in tests/unit/clients/agents.test.ts.
 */

/** The roles requireAdmin lets through (routes/generator.routes.js; DECISIONS R7) */
export const ADMIN_ROLES: readonly string[] = ['super_admin', 'admin', 'global_admin', 'server_admin'];

export function isAdminRole(role: string | null | undefined): boolean {
	return ADMIN_ROLES.includes(String(role ?? ''));
}

/** Fill the agents strings' {{name}} placeholders (the console's own use {name}) */
export function fill(text: string, values: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? m);
}

/**
 * The import answers "code" or "code:detail" (generic_agent_release_*):
 * the sentence for the code, with the detail in {{detail}} or after it in
 * brackets. Unknown codes and plain messages get the fallback.
 */
export function releaseError(
	raw: string | null | undefined,
	lookup: (key: string) => string | undefined,
	fallback: string
): string {
	const text = String(raw ?? '').trim();
	if (!text) return fallback;
	const colon = text.indexOf(':');
	const code = colon === -1 ? text : text.slice(0, colon);
	const detail = colon === -1 ? '' : text.slice(colon + 1);
	let msg = /^[a-z0-9_]+$/.test(code) ? lookup(`generator.errors.${code}`) : undefined;
	if (!msg) return fallback;
	if (detail) {
		if (msg.includes('{{detail}}')) msg = msg.split('{{detail}}').join(detail);
		else if (!msg.includes(detail)) msg = `${msg} (${detail})`;
	}
	return msg;
}
