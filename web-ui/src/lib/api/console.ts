/** /api/console/*: what the console needs before it can render (routes/console.routes.js) */

import * as v from 'valibot';
import { api, request } from './client';

export const NavPage = v.object({
	page: v.string(),
	href: v.string(),
	text: v.string(),
	group: v.string(),
	core: v.boolean(),
	keywords: v.string(),
	external: v.boolean(),
	countId: v.nullable(v.string())
});
export type NavPage = v.InferOutput<typeof NavPage>;

export const NavSection = v.object({
	id: v.string(),
	icon: v.string(),
	text: v.string(),
	pages: v.array(NavPage)
});
export type NavSection = v.InferOutput<typeof NavSection>;

export const Language = v.object({
	code: v.string(),
	name: v.string(),
	native: v.string(),
	flag: v.string(),
	rtl: v.boolean()
});

const Palette = v.nullable(v.record(v.string(), v.string()));

export const Bootstrap = v.object({
	success: v.literal(true),
	user: v.object({
		id: v.union([v.number(), v.string()]),
		username: v.string(),
		role: v.string(),
		preferredLanguage: v.nullable(v.string()),
		avatarVersion: v.nullable(v.union([v.string(), v.number()]))
	}),
	permissions: v.array(v.string()),
	isSuperAdmin: v.boolean(),
	emergencyMode: v.boolean(),
	nav: v.array(NavSection),
	lang: v.object({
		code: v.string(),
		dir: v.picklist(['ltr', 'rtl']),
		stringsUrl: v.string(),
		available: v.array(Language)
	}),
	branding: v.object({
		appName: v.string(),
		appDescription: v.string(),
		themeMode: v.string(),
		logoType: v.nullable(v.string()),
		revision: v.union([v.string(), v.number()])
	}),
	palettes: v.object({ light: Palette, dark: Palette }),
	sessionPolicy: v.nullable(v.looseObject({})),
	csrfToken: v.string(),
	appVersion: v.string()
});
export type Bootstrap = v.InferOutput<typeof Bootstrap>;

export function getBootstrap(): Promise<Bootstrap> {
	return api(Bootstrap, '/api/console/bootstrap');
}

export function saveLanguage(code: string): Promise<unknown> {
	return request(`/api/i18n/set/${encodeURIComponent(code)}`, { method: 'POST' });
}
