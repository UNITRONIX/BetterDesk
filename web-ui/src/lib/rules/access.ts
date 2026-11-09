/**
 * Who may open the Rules pages, as the server checks it. The console has no
 * page gate of its own yet (lib/webUi.js only checks the session for /app),
 * so each page shows the 403 text itself instead of loading data that
 * would fail.
 *
 * - Policies and Device identity: requireAdmin in routes/policies.routes.js,
 *   the four admin roles (super_admin, admin, global_admin, server_admin).
 *   Role overrides don't change that check.
 * - USB and drive access, Data loss prevention: requirePermission('server.config').
 * - Alerts and automation: requireAuth only (pages.routes.js); writes need
 *   server.config, reading and acknowledging need a session.
 */

export const ADMIN_ROLES: ReadonlySet<string> = new Set([
	'super_admin',
	'admin',
	'global_admin',
	'server_admin'
]);

/** requireAdmin in middleware/auth.js */
export function isAdminRole(role: string | null | undefined): boolean {
	return ADMIN_ROLES.has(role ?? '');
}
