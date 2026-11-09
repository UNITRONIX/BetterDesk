/**
 * The chat page's state and what a frame from the operator socket
 * (/ws/chat-operator/panel, services/chatRelay.js) does to it. The page
 * owns the socket and the DOM; this turns frames into state and tells the
 * page what to send back (read receipts) or announce (a message in another
 * conversation). Tested without a DOM.
 */

import {
	groupConvId,
	isMine,
	localId,
	memberCount,
	MAX_MESSAGES,
	normalizeContact,
	normalizeMessage,
	str,
	time,
	type ChatMessage,
	type Contact,
	type Conversation,
	type Group,
	type Raw
} from './chat.ts';

export * from './chat.ts';

export interface FrameEffects {
	/** Send a read receipt for these ids in the open conversation */
	receipt?: { conversation_id: string; message_ids: string[] };
	/** A message arrived in a conversation that isn't open */
	notify?: ChatMessage;
	/** A group was created: its name */
	groupCreated?: string;
	/** The open conversation got new messages: scroll to the end */
	scroll?: boolean;
}

export class ChatState {
	contacts = $state.raw<Contact[]>([]);
	groups = $state.raw<Group[]>([]);
	conversations = $state.raw<Record<string, Conversation>>({});
	/** The open conversation and whether it is a group */
	active = $state<string | null>(null);
	activeType = $state<'contact' | 'group'>('contact');
	/** Contacts have arrived at least once */
	contactsLoaded = $state(false);
	typing = $state<{ conversation_id: string; name: string } | null>(null);

	conv(id: string): Conversation {
		return this.conversations[id] ?? { messages: [], unread: 0 };
	}

	private setConv(id: string, conv: Conversation) {
		this.conversations = { ...this.conversations, [id]: conv };
	}

	/** Open a conversation: its unread count goes to 0 */
	open(id: string, type: 'contact' | 'group') {
		this.active = id;
		this.activeType = type;
		const c = this.conv(id);
		this.setConv(id, { messages: c.messages, unread: 0 });
		if (this.typing && this.typing.conversation_id !== id) this.typing = null;
	}

	close() {
		this.active = null;
		this.typing = null;
	}

	/** Add a message (sent here or arrived) */
	add(msg: ChatMessage, opts: { countUnread?: boolean } = {}) {
		const id = msg.conversation_id || 'default';
		const c = this.conv(id);
		if (c.messages.some((m) => m.id === msg.id && !m.id.startsWith('local-'))) return;
		const messages = [...c.messages, msg];
		if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
		this.setConv(id, { messages, unread: c.unread + (opts.countUnread ? 1 : 0) });
	}

	/**
	 * Handle one frame from the socket. `me`: the signed-in username.
	 * `commandResult` words a device's answer to a quick command.
	 */
	handle(
		frame: unknown,
		me: string,
		commandResult: (action: string, result: string) => string = (a, r) => `${a}: ${r}`
	): FrameEffects {
		if (!frame || typeof frame !== 'object') return {};
		const f = frame as Raw;
		switch (f.type) {
			case 'contacts': {
				const list = Array.isArray(f.contacts) ? f.contacts : [];
				this.contacts = list.filter((c): c is Raw => !!c && typeof c === 'object').map(normalizeContact);
				this.contactsLoaded = true;
				return {};
			}
			case 'groups': {
				const list = Array.isArray(f.groups) ? f.groups : [];
				this.groups = list
					.filter((g): g is Raw => !!g && typeof g === 'object')
					.map((g) => ({
						id: groupConvId(g.id),
						name: str(g.name) || str(g.id),
						members: memberCount(g.members)
					}));
				return {};
			}
			case 'group_created':
				return { groupCreated: str(f.name) };
			case 'history': {
				const id = str(f.conversation_id) || 'default';
				const messages = (Array.isArray(f.messages) ? f.messages : [])
					.filter((m): m is Raw => !!m && typeof m === 'object')
					.map((m) => normalizeMessage({ conversation_id: id, ...m }));
				const c = this.conv(id);
				this.setConv(id, { messages, unread: c.unread });
				return { scroll: id === this.active };
			}
			case 'message': {
				const msg = normalizeMessage(f);
				const id = msg.conversation_id || 'default';
				const open = id === this.active;
				this.add({ ...msg, conversation_id: id }, { countUnread: !open && !isMine(msg, me) });
				if (open) {
					if (this.typing?.conversation_id === id) this.typing = null;
					return isMine(msg, me)
						? { scroll: true }
						: { scroll: true, receipt: { conversation_id: id, message_ids: [msg.id] } };
				}
				return isMine(msg, me) ? {} : { notify: msg };
			}
			case 'typing': {
				const id = str(f.conversation_id) || 'default';
				if (id !== this.active) return {};
				this.typing = { conversation_id: id, name: str(f.from_name ?? f.operator ?? f.from) };
				return {};
			}
			case 'read_receipt': {
				const id = str(f.conversation_id);
				if (!id || !Array.isArray(f.message_ids)) return {};
				const ids = f.message_ids.map(str);
				const c = this.conv(id);
				if (!c.messages.some((m) => ids.includes(m.id) && !m.read)) return {};
				this.setConv(id, {
					...c,
					messages: c.messages.map((m) => (ids.includes(m.id) ? { ...m, read: true } : m))
				});
				return {};
			}
			case 'presence': {
				const who = str(f.device_id);
				if (!this.contacts.some((c) => c.id === who)) return {};
				const online = f.online !== false;
				this.contacts = this.contacts.map((c) =>
					c.id === who ? { ...c, online, status: online ? str(f.status) || 'online' : 'offline' } : c
				);
				return {};
			}
			case 'file_share': {
				const id = str(f.conversation_id) || this.active || 'default';
				const fileId = str(f.file_id);
				const msg: ChatMessage = {
					id: fileId || localId(),
					from: str(f.from),
					from_name: str(f.from_name ?? f.from),
					text: '',
					timestamp: time(f.timestamp),
					conversation_id: id,
					system: false,
					file: {
						id: fileId,
						name: str(f.file_name_encrypted) || 'file',
						size: Number(f.file_size) || 0,
						url: str(f.file_url) || `/api/chat/files/${fileId.replace(/[^a-f0-9]/gi, '')}`
					},
					reactions: {},
					read: false
				};
				this.add(msg, { countUnread: id !== this.active });
				return id === this.active ? { scroll: true } : {};
			}
			case 'system_message':
			case 'command_result': {
				const id = str(f.conversation_id) || this.active || 'default';
				const text =
					f.type === 'command_result' ? commandResult(str(f.action), str(f.result ?? f.error)) : str(f.text);
				this.add({
					id: f.id !== undefined ? str(f.id) : localId(),
					from: 'system',
					from_name: '',
					text,
					timestamp: f.timestamp ? time(f.timestamp) : Date.now(),
					conversation_id: id,
					system: true,
					file: null,
					reactions: {},
					read: false
				});
				return id === this.active ? { scroll: true } : {};
			}
			case 'reaction': {
				const id = str(f.conversation_id);
				const target = str(f.message_id);
				const emoji = str(f.emoji);
				if (!id || !target || !emoji) return {};
				const c = this.conv(id);
				const from = str(f.from) || '?';
				this.setConv(id, {
					...c,
					messages: c.messages.map((m) => {
						if (m.id !== target) return m;
						const who = m.reactions[emoji] ?? [];
						return { ...m, reactions: { ...m.reactions, [emoji]: [...who, from] } };
					})
				});
				return {};
			}
			default:
				return {};
		}
	}
}
