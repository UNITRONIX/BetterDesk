/**
 * Global search (public/js/ui-search.js): pages from the navigation the
 * server sent (with their keywords and earlier names), devices and people.
 * Every word typed must match somewhere; case and accents don't matter.
 * Pure functions; SearchDialog.svelte does the loading and the keyboard.
 */

import type { SearchPage } from './nav-model.ts';

export const MAX_PAGES = 6;
export const MAX_DEVICES = 8;
export const MAX_USERS = 5;

export interface SearchDevice {
	id: string;
	hostname?: string;
	display_name?: string;
	alias?: string;
	username?: string;
	user?: string;
	platform?: string;
	os?: string;
	tags?: string[] | string;
	note?: string;
	online?: boolean;
	banned?: boolean;
}

export interface SearchUser {
	username: string;
	email?: string;
	role?: string;
}

export type ResultKind = 'page' | 'device' | 'user';

export interface SearchResult {
	kind: ResultKind;
	title: string;
	/** Second line: section › group, or ID and platform */
	sub: string;
	/** Old URL; the dialog passes it through link() */
	href: string;
	external: boolean;
	/** For devices: online, offline or banned (the dialog translates it) */
	state?: 'online' | 'offline' | 'banned';
	/** For devices: the ID, shown in monospace */
	id?: string;
}

/** Lower case without accents, so "Geräte" matches "gerate" */
export function norm(s: unknown): string {
	return String(s ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '');
}

export function words(query: string): string[] {
	return norm(query).split(/\s+/).filter(Boolean);
}

function matches(hay: unknown[], ws: string[]): boolean {
	const h = norm(hay.filter((x) => x !== undefined && x !== null).join(' '));
	return ws.every((w) => h.includes(w));
}

export function searchAll(
	query: string,
	data: {
		pages: readonly SearchPage[];
		devices?: readonly SearchDevice[] | null;
		users?: readonly SearchUser[] | null;
	}
): SearchResult[] {
	const ws = words(query);
	if (!ws.length) return [];
	const first = ws[0] as string;
	const out: SearchResult[] = [];

	data.pages
		.filter((p) => matches([p.text, p.section, p.group, p.keywords], ws))
		// Titles that start with the first word come first; otherwise the nav order stays
		.map((p, i) => ({ p, i, lead: norm(p.text).startsWith(first) ? 0 : 1 }))
		.sort((a, b) => a.lead - b.lead || a.i - b.i)
		.slice(0, MAX_PAGES)
		.forEach(({ p }) =>
			out.push({
				kind: 'page',
				title: p.text,
				sub: [p.section, p.group].filter(Boolean).join(' › '),
				href: p.href,
				external: p.external
			})
		);

	(data.devices ?? [])
		.filter((d) => {
			const tags = Array.isArray(d.tags) ? d.tags.join(' ') : (d.tags ?? '');
			return matches(
				[d.id, d.hostname, d.display_name, d.alias, d.username, d.user, d.platform, d.os, tags, d.note],
				ws
			);
		})
		.slice(0, MAX_DEVICES)
		.forEach((d) =>
			out.push({
				kind: 'device',
				title: d.display_name || d.hostname || d.id,
				id: d.id,
				sub: d.platform || d.os || '',
				state: d.banned ? 'banned' : d.online ? 'online' : 'offline',
				href: `/devices?search=${encodeURIComponent(d.id)}&open=${encodeURIComponent(d.id)}`,
				external: false
			})
		);

	(data.users ?? [])
		.filter((u) => matches([u.username, u.email, u.role], ws))
		.slice(0, MAX_USERS)
		.forEach((u) =>
			out.push({
				kind: 'user',
				title: u.username,
				sub: [u.email, u.role].filter(Boolean).join(', '),
				href: `/users?search=${encodeURIComponent(u.username)}`,
				external: false
			})
		);

	return out;
}

/** Results grouped by kind, in order, for the listbox groups */
export function groupResults(
	results: readonly SearchResult[]
): { kind: ResultKind; items: { r: SearchResult; index: number }[] }[] {
	const groups: { kind: ResultKind; items: { r: SearchResult; index: number }[] }[] = [];
	results.forEach((r, index) => {
		let g = groups.at(-1);
		if (!g || g.kind !== r.kind) {
			g = { kind: r.kind, items: [] };
			groups.push(g);
		}
		g.items.push({ r, index });
	});
	return groups;
}

/** Ctrl+K / Cmd+K anywhere; "/" when focus is not in a field and no modifier is held */
export function isSearchShortcut(
	e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>
): boolean {
	if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) return true;
	if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return false;
	const el = e.target instanceof Element ? e.target : null;
	return !el?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
}
