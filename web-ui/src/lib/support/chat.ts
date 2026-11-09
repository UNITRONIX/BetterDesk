/**
 * Chat rules without state: message, contact and group shapes from the
 * operator socket, who wrote a message, sorting, search, links, quick
 * commands and day separators. ChatState (chat.svelte.ts) and the page use
 * these.
 *
 * Message senders: "operator" (or "panel") is someone in the console; the
 * relay adds their name in from_name. Console users chatting from the
 * desktop app write as "operator:<name>", devices as their ID.
 */

import { parseDate } from '#lib/i18n/format.ts';

export interface ChatFile {
	id: string;
	name: string;
	size: number;
	url: string;
}

export interface ChatMessage {
	id: string;
	from: string;
	from_name: string;
	text: string;
	/** ms */
	timestamp: number;
	conversation_id: string;
	system: boolean;
	file: ChatFile | null;
	reactions: Record<string, string[]>;
	/** Someone has read it (a receipt arrived, or the server says so) */
	read: boolean;
}

export interface Contact {
	id: string;
	name: string;
	online: boolean;
	/** online, away, busy (presence frames), offline */
	status: string;
	/** device or operator */
	role: string;
}

export interface Group {
	/** The conversation id ("group:xxxx") */
	id: string;
	name: string;
	members: number;
}

export interface Conversation {
	messages: ChatMessage[];
	unread: number;
}

/** Most messages kept per conversation (as the old page) */
export const MAX_MESSAGES = 1000;

export const QUICK_REACTIONS = ['👍', '✅', '❤️'] as const;
export const EMOJI_SET = [
	'👍',
	'👎',
	'❤️',
	'😂',
	'😮',
	'😢',
	'🔥',
	'🎉',
	'✅',
	'❌',
	'👏',
	'🤔',
	'💯',
	'⭐',
	'🚀',
	'🐛',
	'🔧',
	'📎',
	'🔒',
	'⚡'
] as const;

export interface QuickCommand {
	action: string;
	/** Asks before it runs (it restarts or shuts the device down) */
	confirm?: boolean;
	label: string;
}

/** Slash commands typed into a device conversation (the old page's set) */
export const QUICK_COMMANDS: Record<string, QuickCommand> = {
	'/screenshot': { action: 'screenshot', label: 'Screenshot' },
	'/restart': { action: 'restart', label: 'Restart', confirm: true },
	'/lock': { action: 'lock', label: 'Lock screen' },
	'/shutdown': { action: 'shutdown', label: 'Shutdown', confirm: true },
	'/deploy': { action: 'deploy', label: 'Deploy script' },
	'/info': { action: 'info', label: 'Device info' }
};

export function parseCommand(text: string): { name: string; def: QuickCommand; args: string } | null {
	if (!text.startsWith('/')) return null;
	const parts = text.trim().split(/\s+/);
	const name = (parts[0] ?? '').toLowerCase();
	const def = QUICK_COMMANDS[name];
	return def ? { name, def, args: parts.slice(1).join(' ') } : null;
}

export type Raw = Record<string, unknown>;
export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export function time(v: unknown): number {
	if (typeof v === 'number' && Number.isFinite(v)) return v;
	const d = parseDate(v);
	return d ? d.getTime() : Date.now();
}

let seq = 0;
/** A local id for messages without one (several in the same millisecond stay apart) */
export function localId(): string {
	return `local-${Date.now()}-${++seq}`;
}

export function normalizeMessage(m: Raw): ChatMessage {
	const file = m.file && typeof m.file === 'object' ? (m.file as Raw) : null;
	const reactions: Record<string, string[]> = {};
	if (m.reactions && typeof m.reactions === 'object') {
		for (const [k, v] of Object.entries(m.reactions as Raw)) {
			if (Array.isArray(v)) reactions[k] = v.map(str);
		}
	}
	const readBy = Array.isArray(m.read_by) ? m.read_by : [];
	return {
		id: m.id !== undefined && m.id !== null && m.id !== '' ? str(m.id) : localId(),
		from: str(m.from ?? m.from_id),
		from_name: str(m.from_name ?? m.operator ?? m.from ?? m.from_id),
		text: str(m.text),
		timestamp: time(m.timestamp ?? m.created_at),
		conversation_id: str(m.conversation_id),
		system: !!m.system,
		file: file
			? { id: str(file.id), name: str(file.name) || 'file', size: Number(file.size) || 0, url: str(file.url) }
			: null,
		reactions,
		read: readBy.length > 0 || m.read === true
	};
}

/** Written from the console. Messages from "operator" carry the writer's name. */
export function isMine(m: Pick<ChatMessage, 'from' | 'from_name'>, me: string): boolean {
	if (m.from !== 'operator' && m.from !== 'panel') return false;
	return !m.from_name || !me || m.from_name === me;
}

/** A person (console user) rather than a device: gets an avatar */
export function isPerson(m: Pick<ChatMessage, 'from'>): boolean {
	return m.from === 'operator' || m.from === 'panel' || m.from.startsWith('operator');
}

/** Go stores group ids as "group:xxxx" and uses that as the conversation id; older ids get "group_" */
export function groupConvId(id: unknown): string {
	const s = str(id);
	return s.startsWith('group:') ? s : 'group_' + s;
}

export function memberCount(members: unknown): number {
	if (Array.isArray(members)) return members.length;
	if (typeof members === 'string')
		return members
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean).length;
	return 0;
}

export function normalizeContact(c: Raw): Contact {
	const online = c.online === true;
	return {
		id: str(c.id),
		name: str(c.name) || str(c.id),
		online,
		status: online ? str(c.status) || 'online' : 'offline',
		role: str(c.role)
	};
}

/** Online first, then by name */
export function sortContacts(list: readonly Contact[], locale?: string): Contact[] {
	const coll = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
	return [...list].sort((a, b) => {
		if (a.online !== b.online) return a.online ? -1 : 1;
		return coll.compare(a.name, b.name);
	});
}

/** online, away, busy or offline: the presence word a contact shows */
export function presenceOf(c: Pick<Contact, 'online' | 'status'>): 'online' | 'away' | 'busy' | 'offline' {
	if (!c.online) return 'offline';
	return c.status === 'away' || c.status === 'busy' ? c.status : 'online';
}

/** Name filter for the list; ignores case */
export function matchesName(name: string, q: string): boolean {
	const s = q.trim().toLowerCase();
	return !s || name.toLowerCase().includes(s);
}

export interface Found {
	id: string;
	conversation_id: string;
	from_name: string;
	text: string;
	timestamp: number;
}

/** Messages in the loaded conversations that contain q (case ignored), newest first, at most 30 */
export function searchLoaded(
	conversations: Record<string, Conversation>,
	q: string,
	extra: readonly Found[] = []
): Found[] {
	const s = q.trim().toLowerCase();
	if (s.length < 2) return [];
	const out: Found[] = [];
	const seen = new Set<string>();
	for (const [convId, conv] of Object.entries(conversations)) {
		for (const m of conv.messages) {
			if (!m.text || !m.text.toLowerCase().includes(s)) continue;
			seen.add(`${convId}|${m.id}`);
			out.push({
				id: m.id,
				conversation_id: convId,
				from_name: m.from_name,
				text: m.text,
				timestamp: m.timestamp
			});
		}
	}
	for (const f of extra) {
		const key = `${f.conversation_id}|${f.id}`;
		if (seen.has(key) || !f.text.toLowerCase().includes(s)) continue;
		seen.add(key);
		out.push(f);
	}
	return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
}

/** Text with http(s) links as separate parts; anything else stays text */
export function linkParts(text: string): { text: string; href?: string }[] {
	const out: { text: string; href?: string }[] = [];
	const re = /(https?:\/\/[^\s<>"']+)/gi;
	let last = 0;
	for (const m of text.matchAll(re)) {
		const at = m.index ?? 0;
		if (at > last) out.push({ text: text.slice(last, at) });
		let href: string | undefined;
		// The pattern only matches http(s); a URL that doesn't parse stays text
		try {
			href = new URL(m[0]).href;
		} catch {
			href = undefined;
		}
		out.push(href ? { text: m[0], href } : { text: m[0] });
		last = at + m[0].length;
	}
	if (last < text.length) out.push({ text: text.slice(last) });
	return out;
}

/** "today", "yesterday" or a date key for the separators between messages */
export function dayOf(ts: number, now = Date.now()): 'today' | 'yesterday' | string {
	const d = new Date(ts);
	const today = new Date(now);
	if (d.toDateString() === today.toDateString()) return 'today';
	const y = new Date(today);
	y.setDate(y.getDate() - 1);
	if (d.toDateString() === y.toDateString()) return 'yesterday';
	return d.toDateString();
}
