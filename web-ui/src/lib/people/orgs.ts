/**
 * The organization pages' rules without a DOM: labels, the slug a name
 * suggests, the stored settings the Settings tab edits, the shared
 * address book (parse, edit as rows, check the JSON), open invitations and
 * the support packages that belong to an organization.
 */

import type { Contract, OrgInvitation, OrgSetting } from '#lib/api/orgs.ts';
import { parseDate } from '#lib/i18n/format.ts';

type T = (key: string, params?: Record<string, string | number>) => string;

/** A role inside an organization ("user" reads as Member); unknown roles as they are */
export function orgRoleLabel(role: string, t: T): string {
	if (!role) return '';
	const key = `organizations.role_${role}`;
	const text = t(key);
	return text === key ? role : text;
}

/** "Harbor Logistics GmbH" → "harbor-logistics-gmbh" (at most 64 characters) */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.substring(0, 64);
}

/* ── Stored settings (Settings tab) ── */

export interface OrgSessionSettings {
	connection_policy: string;
	allow_file_transfer: boolean;
	allow_clipboard: boolean;
	max_session_duration_min: number;
}

export const CONNECTION_POLICIES = ['unattended', 'attended', 'ask_always'] as const;

export const SETTING_DEFAULTS: OrgSessionSettings = {
	connection_policy: 'unattended',
	allow_file_transfer: true,
	allow_clipboard: true,
	max_session_duration_min: 120
};

/** The four settings the tab edits, from the stored key/value rows (missing keys take the defaults) */
export function readSessionSettings(rows: readonly OrgSetting[]): OrgSessionSettings {
	const out = { ...SETTING_DEFAULTS };
	for (const { key, value } of rows) {
		if (key === 'connection_policy' && value) out.connection_policy = value;
		else if (key === 'allow_file_transfer') out.allow_file_transfer = String(value) !== 'false';
		else if (key === 'allow_clipboard') out.allow_clipboard = String(value) !== 'false';
		else if (key === 'max_session_duration_min') {
			const n = Number.parseInt(value, 10);
			out.max_session_duration_min = Number.isFinite(n) ? n : SETTING_DEFAULTS.max_session_duration_min;
		}
	}
	return out;
}

/** The key/value pairs the server stores, in the old order */
export function sessionSettingRows(s: OrgSessionSettings): [string, string][] {
	return [
		['connection_policy', s.connection_policy || SETTING_DEFAULTS.connection_policy],
		['allow_file_transfer', s.allow_file_transfer ? 'true' : 'false'],
		['allow_clipboard', s.allow_clipboard ? 'true' : 'false'],
		[
			'max_session_duration_min',
			String(Number.isFinite(s.max_session_duration_min) ? s.max_session_duration_min : 120)
		]
	];
}

/* ── Invitations ── */

/** Invitations nobody used yet that have not expired */
export function openInvitations(list: readonly OrgInvitation[], now = Date.now()): number {
	return list.filter((i) => {
		if (i.used_at && parseDate(i.used_at)) return false;
		const exp = parseDate(i.expires_at);
		return !(exp && exp.getTime() < now);
	}).length;
}

/* ── Support packages ── */

/** Contracts for this organization or one of its device groups */
export function orgContracts(
	all: readonly Contract[],
	orgId: string,
	groupGuids: readonly string[]
): Contract[] {
	const groups = new Set(groupGuids);
	return all.filter(
		(c) =>
			(c.target_type === 'org' && (c.target_key === orgId || c.org_id === orgId)) ||
			(c.target_type === 'device_group' && groups.has(c.target_key))
	);
}

/* ── Shared address book ── */

export interface BookPeer {
	id: string;
	alias: string;
	tags: string[];
}

export interface Book {
	peers: BookPeer[];
	tags: string[];
}

const splitTags = (text: string) =>
	text
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

export { splitTags };

/** The stored book (JSON text, an object or nothing) as rows; throws on text that is not JSON */
export function parseBook(raw: unknown): Book {
	let data: unknown = raw;
	if (raw === null || raw === undefined || raw === '' || raw === '{}') return { peers: [], tags: [] };
	if (typeof raw === 'string') data = JSON.parse(raw);
	const obj =
		data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
	const peers = Array.isArray(obj.peers)
		? obj.peers.map((p) => {
				const peer = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
				return {
					id: String(peer.id ?? '').trim(),
					alias: String(peer.alias ?? '').trim(),
					tags: Array.isArray(peer.tags) ? peer.tags.map(String) : []
				};
			})
		: [];
	const tags = Array.isArray(obj.tags) ? obj.tags.map(String) : [];
	return { peers, tags };
}

/** What the server stores: peers without an ID are dropped, empty alias and tags left out */
export function bookPayload(book: Book): { peers: Record<string, unknown>[]; tags: string[] } {
	const peers = book.peers
		.map((p) => {
			const entry: Record<string, unknown> = { id: p.id.trim() };
			if (p.alias.trim()) entry.alias = p.alias.trim();
			if (p.tags.length) entry.tags = p.tags;
			return entry;
		})
		.filter((p) => p.id);
	return { peers, tags: book.tags };
}

export type BookError = 'invalid_json' | 'peers_array' | 'tags_array';

/** The JSON editor's text as a book, or why it can't be one */
export function checkBookJson(text: string): { book: Book; payload: unknown } | { error: BookError } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text.trim() || '{}');
	} catch {
		return { error: 'invalid_json' };
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'invalid_json' };
	const obj = parsed as Record<string, unknown>;
	if (obj.peers !== undefined && !Array.isArray(obj.peers)) return { error: 'peers_array' };
	if (obj.tags !== undefined && !Array.isArray(obj.tags)) return { error: 'tags_array' };
	return { book: parseBook(obj), payload: obj };
}

export const BOOK_ERROR_KEYS: Record<BookError, string> = {
	invalid_json: 'organizations.address_book_invalid_json',
	peers_array: 'organizations.address_book_peers_array_required',
	tags_array: 'organizations.address_book_tags_array_required'
};

/** Pretty JSON of a book for the editor */
export function bookJson(book: Book): string {
	return JSON.stringify(bookPayload(book), null, 2);
}

/** Add the organization's devices that are not in the book yet; returns the new book and how many were added */
export function importDevices(
	book: Book,
	devices: readonly { device_id: string; department?: string; location?: string; building?: string }[]
): { book: Book; added: number } {
	const seen = new Set(book.peers.map((p) => p.id.trim()).filter(Boolean));
	const peers = [...book.peers];
	let added = 0;
	for (const d of devices) {
		const id = String(d.device_id || '').trim();
		if (!id || seen.has(id)) continue;
		peers.push({ id, alias: d.department || d.location || d.building || id, tags: [] });
		seen.add(id);
		added++;
	}
	return { book: { peers, tags: book.tags }, added };
}
