/**
 * Endpoints the shell calls (the old shell's scripts called the same):
 * notifications (notif-center.js), the registration count (app.js),
 * sign-out and session check (app.js, session-guard.js), people for the
 * global search (ui-search.js), and the branding details and supporters
 * the old layout rendered on the server.
 */

import * as v from 'valibot';
import { api, request, wrapped, BoolLike, Text, NumLike } from '#lib/api/client.ts';

/* ── Notifications: GET /api/bd/notifications, POST .../:id/read, POST .../read-all ── */

const NotifId = v.pipe(v.union([v.string(), v.number()]), v.transform(String));

export interface Notification {
	id: string;
	kind: string;
	title: string;
	hostname: string;
	device_id: string;
	platform: string;
	ip: string;
	message: string;
	link: string;
	status: string;
	read: boolean;
	created_at: string;
}

export const Notification = v.pipe(
	v.looseObject({
		id: NotifId,
		kind: Text,
		title: Text,
		hostname: Text,
		device_id: Text,
		platform: Text,
		ip: Text,
		message: Text,
		link: Text,
		status: Text,
		read: BoolLike,
		created_at: Text
	}),
	v.transform((n): Notification => ({
		id: n.id,
		kind: n.kind ?? '',
		title: n.title ?? '',
		hostname: n.hostname ?? '',
		device_id: n.device_id ?? '',
		platform: n.platform ?? '',
		ip: n.ip ?? '',
		message: n.message ?? '',
		link: n.link ?? '',
		status: n.status ?? '',
		read: n.read ?? false,
		created_at: n.created_at ?? ''
	}))
);

/** `{ items, unread_count }`, or a bare array from older servers */
export const NotificationList = v.union([
	v.looseObject({
		items: v.optional(v.array(Notification), []),
		unread_count: v.optional(v.nullable(v.unknown()))
	}),
	v.pipe(
		v.array(Notification),
		v.transform((items) => ({ items, unread_count: null as unknown }))
	)
]);

export const NOTIFICATION_LIMIT = 10;

export async function listNotifications(
	signal?: AbortSignal
): Promise<{ items: Notification[]; unread: number }> {
	const out = await api(NotificationList, '/api/bd/notifications', {
		query: { limit: NOTIFICATION_LIMIT },
		signal
	});
	const n = Number(out.unread_count);
	const unread =
		out.unread_count !== null && out.unread_count !== undefined && Number.isFinite(n) && n >= 0
			? n
			: out.items.filter((i) => !i.read).length;
	return { items: out.items, unread };
}

export function markNotificationRead(id: string): Promise<unknown> {
	return request(`/api/bd/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export function markAllNotificationsRead(): Promise<unknown> {
	return request('/api/bd/notifications/read-all', { method: 'POST' });
}

/* ── Registrations waiting for approval: GET /api/registrations/count ── */

const Count = v.looseObject({ count: v.optional(v.unknown()) });

export async function registrationCount(signal?: AbortSignal): Promise<number> {
	const out = await api(Count, '/api/registrations/count', { signal });
	const n = Number(out.count);
	return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/* ── Session: POST /api/auth/logout, GET /api/auth/verify ── */

export function logout(): Promise<unknown> {
	return request('/api/auth/logout', { method: 'POST' });
}

const OptionalNum = v.optional(v.nullable(NumLike));

export const SessionInfo = v.looseObject({
	session: v.optional(
		v.looseObject({
			lastActivityAt: OptionalNum,
			idleTimeoutMs: OptionalNum,
			maxAgeMs: OptionalNum,
			warnBeforeMs: OptionalNum
		})
	)
});
export type SessionInfo = v.InferOutput<typeof SessionInfo>;

export function verifySession(): Promise<SessionInfo> {
	return api(SessionInfo, '/api/auth/verify');
}

/* ── People for the global search: GET /api/users ── */

const SearchUserRow = v.looseObject({ username: Text, email: Text, role: Text });
const UserList = wrapped(v.looseObject({ users: v.array(SearchUserRow) }));

export async function listUsersForSearch(
	signal?: AbortSignal
): Promise<{ username: string; email: string; role: string }[]> {
	const out = await api(UserList, '/api/users', { signal });
	return out.users
		.map((u) => ({ username: u.username ?? '', email: u.email ?? '', role: u.role ?? '' }))
		.filter((u) => u.username);
}

/* ── Branding the old layout rendered on the server: GET /api/settings/branding ── */

export const BrandingExtras = v.pipe(
	v.looseObject({
		data: v.looseObject({
			logoType: Text,
			logoIcon: Text,
			logoSvg: Text,
			logoUrl: Text,
			logoText: Text,
			logoTextAccent: Text,
			footerText: Text,
			showPoweredBy: v.optional(v.nullable(v.union([v.string(), v.boolean()])))
		})
	}),
	v.transform(({ data }) => ({
		logoType: data.logoType ?? '',
		logoIcon: data.logoIcon ?? '',
		logoSvg: data.logoSvg ?? '',
		logoUrl: data.logoUrl ?? '',
		logoText: data.logoText ?? '',
		logoTextAccent: data.logoTextAccent ?? '',
		footerText: data.footerText ?? '',
		showPoweredBy: data.showPoweredBy !== 'false' && data.showPoweredBy !== false
	}))
);
export type BrandingExtras = v.InferOutput<typeof BrandingExtras>;

export function getBrandingExtras(signal?: AbortSignal): Promise<BrandingExtras> {
	return api(BrandingExtras, '/api/settings/branding', { signal });
}

/* ── Help panel: project supporters and links (config/supporters.json) ── */

const Url = v.optional(v.nullable(v.string()), '');

export const Supporters = v.looseObject({
	honorary: v.optional(
		v.array(v.looseObject({ name: Text, role: Text, url: Url, logo: Url, blurb: Text })),
		[]
	),
	individuals: v.optional(v.array(v.looseObject({ name: Text, github: Text, githubUrl: Url })), []),
	links: v.optional(
		v.looseObject({
			repo: Url,
			issues: Url,
			sponsors: Url,
			buyMeACoffee: Url,
			sponsorsMd: Url
		}),
		{}
	)
});
export type Supporters = v.InferOutput<typeof Supporters>;

export function getSupporters(signal?: AbortSignal): Promise<Supporters> {
	return api(Supporters, '/api/console/supporters', { signal });
}
