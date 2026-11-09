/** One e2e account per role. They share E2E_PASSWORD (vault item "BetterDesk dev – e2e test accounts"). */
export const ROLES = {
	admin: 'e2e_admin',
	super_admin: 'e2e_super_admin',
	server_admin: 'e2e_server_admin',
	global_admin: 'e2e_global_admin',
	operator: 'e2e_operator',
	viewer: 'e2e_viewer'
} as const;

export type Role = keyof typeof ROLES;

export const authFile = (role: Role) => `e2e/.auth/${role}.json`;

/** Where the console lives: the root, or the base the build was made for */
export const UI = process.env.BD_UI_BASE ?? '';
