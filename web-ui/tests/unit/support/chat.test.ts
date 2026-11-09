import { describe, expect, test } from 'vitest';
import {
	ChatState,
	dayOf,
	groupConvId,
	isMine,
	isPerson,
	linkParts,
	matchesName,
	memberCount,
	normalizeMessage,
	parseCommand,
	presenceOf,
	searchLoaded,
	sortContacts,
	type ChatMessage
} from '../../../src/lib/support/chat.svelte.ts';

const ME = 'demo_ui_admin';

function msg(id: string, conv: string, extra: Partial<ChatMessage> = {}): ChatMessage {
	return {
		id,
		from: 'operator:demo_operator',
		from_name: 'demo_operator',
		text: 'hello ' + id,
		timestamp: 1000 + Number(id.replace(/\D/g, '') || 0),
		conversation_id: conv,
		system: false,
		file: null,
		reactions: {},
		read: false,
		...extra
	};
}

describe('messages', () => {
	test('history entries from Go (from_id, created_at) and relay frames read the same', () => {
		const go = normalizeMessage({
			id: 62,
			conversation_id: 'operator:demo_operator',
			from_id: 'operator',
			from_name: 'admin',
			text: 'Can you take it?',
			read: true,
			created_at: '2026-11-07T16:24:40Z'
		});
		expect(go).toMatchObject({ id: '62', from: 'operator', from_name: 'admin', read: true });
		expect(go.timestamp).toBe(Date.parse('2026-11-07T16:24:40Z'));
		const relay = normalizeMessage({
			type: 'message',
			id: 5,
			from: 'operator',
			operator: 'x',
			text: 't',
			timestamp: 7
		});
		expect(relay).toMatchObject({ id: '5', from_name: 'x', timestamp: 7, read: false });
	});

	test('a message from the console is mine only when I wrote it', () => {
		expect(isMine({ from: 'operator', from_name: ME }, ME)).toBe(true);
		expect(isMine({ from: 'operator', from_name: 'admin' }, ME)).toBe(false);
		expect(isMine({ from: 'panel', from_name: '' }, ME)).toBe(true);
		expect(isMine({ from: 'operator:demo_ui_admin', from_name: ME }, ME)).toBe(false);
		expect(isMine({ from: '900100001', from_name: 'pc' }, ME)).toBe(false);
	});

	test('people get avatars, devices do not', () => {
		expect(isPerson({ from: 'operator' })).toBe(true);
		expect(isPerson({ from: 'operator:admin' })).toBe(true);
		expect(isPerson({ from: '900100001' })).toBe(false);
	});

	test('links become parts with an href; javascript: and text stay text', () => {
		expect(linkParts('see https://example.com/a?b=1 now')).toEqual([
			{ text: 'see ' },
			{ text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
			{ text: ' now' }
		]);
		expect(linkParts('javascript:alert(1) <img src=x>')).toEqual([
			{ text: 'javascript:alert(1) <img src=x>' }
		]);
		expect(linkParts('')).toEqual([]);
	});

	test('quick commands', () => {
		expect(parseCommand('/restart now')).toMatchObject({
			name: '/restart',
			args: 'now',
			def: { confirm: true }
		});
		expect(parseCommand('/RESTART')?.name).toBe('/restart');
		expect(parseCommand('/nope')).toBeNull();
		expect(parseCommand('hello /restart')).toBeNull();
	});

	test('days for the separators', () => {
		const now = new Date(2026, 10, 9, 12).getTime();
		expect(dayOf(now - 3600_000, now)).toBe('today');
		expect(dayOf(now - 86_400_000, now)).toBe('yesterday');
		expect(dayOf(now - 3 * 86_400_000, now)).not.toMatch(/today|yesterday/);
	});
});

describe('contacts and groups', () => {
	test('online first, then by name; presence words', () => {
		const list = sortContacts([
			{ id: 'b', name: 'beta', online: false, status: 'offline', role: 'device' },
			{ id: 'c', name: 'Charlie', online: true, status: 'busy', role: 'operator' },
			{ id: 'a', name: 'alpha', online: true, status: 'online', role: 'device' }
		]);
		expect(list.map((c) => c.id)).toEqual(['a', 'c', 'b']);
		expect(list.map(presenceOf)).toEqual(['online', 'busy', 'offline']);
	});

	test('group ids and member counts', () => {
		expect(groupConvId('group:demo0001')).toBe('group:demo0001');
		expect(groupConvId(7)).toBe('group_7');
		expect(memberCount('panel, operator:admin,,operator:x')).toBe(3);
		expect(memberCount(['a', 'b'])).toBe(2);
		expect(memberCount(null)).toBe(0);
	});

	test('names filter ignoring case', () => {
		expect(matchesName('Demo-Reception-01', 'recep')).toBe(true);
		expect(matchesName('x', '  ')).toBe(true);
		expect(matchesName('x', 'y')).toBe(false);
	});
});

describe('search', () => {
	test('loaded messages and server hits, deduplicated, newest first, from 2 characters', () => {
		const convs = {
			a: {
				messages: [msg('1', 'a', { text: 'Printer jam' }), msg('2', 'a', { text: 'nothing' })],
				unread: 0
			},
			b: { messages: [msg('3', 'b', { text: 'the PRINTER again' })], unread: 0 }
		};
		const server = [
			{ id: '1', conversation_id: 'a', from_name: 'x', text: 'Printer jam', timestamp: 1 },
			{ id: '9', conversation_id: 'c', from_name: 'y', text: 'printer server', timestamp: 5000 },
			{ id: '8', conversation_id: 'c', from_name: 'y', text: 'unrelated', timestamp: 6000 }
		];
		expect(searchLoaded(convs, 'printer', server).map((f) => f.id)).toEqual(['9', '3', '1']);
		expect(searchLoaded(convs, 'p')).toEqual([]);
	});
});

describe('frames', () => {
	test('a message in the open conversation is added, scrolled to and read', () => {
		const s = new ChatState();
		s.open('900100001', 'contact');
		const fx = s.handle(
			{
				type: 'message',
				id: 1,
				from: '900100001',
				from_name: 'pc',
				conversation_id: '900100001',
				text: 'hi'
			},
			ME
		);
		expect(s.conv('900100001').messages.map((m) => m.text)).toEqual(['hi']);
		expect(fx).toEqual({ scroll: true, receipt: { conversation_id: '900100001', message_ids: ['1'] } });
		expect(s.conv('900100001').unread).toBe(0);
	});

	test('elsewhere it counts as unread and asks for a notification; opening clears it', () => {
		const s = new ChatState();
		s.open('a', 'contact');
		const fx = s.handle(
			{ type: 'message', id: 2, from: 'operator:x', from_name: 'x', conversation_id: 'b', text: 'yo' },
			ME
		);
		expect(fx.notify?.text).toBe('yo');
		expect(fx.receipt).toBeUndefined();
		expect(s.conv('b').unread).toBe(1);
		s.open('b', 'contact');
		expect(s.conv('b').unread).toBe(0);
	});

	test('my own echo is neither unread nor announced', () => {
		const s = new ChatState();
		const fx = s.handle(
			{ type: 'message', id: 3, from: 'operator', from_name: ME, conversation_id: 'b', text: 'me' },
			ME
		);
		expect(fx).toEqual({});
		expect(s.conv('b').unread).toBe(0);
	});

	test('history replaces the conversation; receipts mark messages read', () => {
		const s = new ChatState();
		s.add(msg('1', 'g'));
		s.handle(
			{
				type: 'history',
				conversation_id: 'g',
				messages: [{ id: 74, from_id: 'operator', from_name: ME, text: 'x' }]
			},
			ME
		);
		expect(s.conv('g').messages.map((m) => m.id)).toEqual(['74']);
		s.handle({ type: 'read_receipt', conversation_id: 'g', message_ids: [74] }, ME);
		expect(s.conv('g').messages[0]?.read).toBe(true);
	});

	test('contacts, groups and presence', () => {
		const s = new ChatState();
		s.handle(
			{ type: 'contacts', contacts: [{ id: 'operator:x', name: 'x', online: true, role: 'operator' }, null] },
			ME
		);
		s.handle(
			{ type: 'groups', groups: [{ id: 'group:1', name: 'On call', members: 'panel,operator:x' }] },
			ME
		);
		expect(s.contactsLoaded).toBe(true);
		expect(s.groups).toEqual([{ id: 'group:1', name: 'On call', members: 2 }]);
		s.handle({ type: 'presence', device_id: 'operator:x', online: true, status: 'away' }, ME);
		expect(s.contacts[0]).toMatchObject({ status: 'away', online: true });
		s.handle({ type: 'presence', device_id: 'operator:x', online: false }, ME);
		expect(presenceOf(s.contacts[0]!)).toBe('offline');
	});

	test('typing shows only for the open conversation', () => {
		const s = new ChatState();
		s.open('a', 'contact');
		s.handle({ type: 'typing', conversation_id: 'b', operator: 'x' }, ME);
		expect(s.typing).toBeNull();
		s.handle({ type: 'typing', conversation_id: 'a', operator: 'x' }, ME);
		expect(s.typing).toEqual({ conversation_id: 'a', name: 'x' });
	});

	test('shared files, command results and reactions', () => {
		const s = new ChatState();
		s.open('d', 'contact');
		s.handle(
			{
				type: 'file_share',
				conversation_id: 'd',
				from: 'd',
				file_id: 'ab12',
				file_name_encrypted: 'log.txt',
				file_size: 12
			},
			ME
		);
		expect(s.conv('d').messages[0]?.file).toEqual({
			id: 'ab12',
			name: 'log.txt',
			size: 12,
			url: '/api/chat/files/ab12'
		});
		s.handle(
			{ type: 'command_result', conversation_id: 'd', action: 'lock', result: 'ok' },
			ME,
			(a, r) => `R ${a} ${r}`
		);
		expect(s.conv('d').messages[1]).toMatchObject({ system: true, text: 'R lock ok' });
		s.handle({ type: 'reaction', conversation_id: 'd', message_id: 'ab12', emoji: '👍', from: 'x' }, ME);
		expect(s.conv('d').messages[0]?.reactions).toEqual({ '👍': ['x'] });
	});

	test('a conversation keeps its last 1,000 messages', () => {
		const s = new ChatState();
		for (let i = 0; i < 1005; i++) s.add(msg(String(i), 'big'));
		const list = s.conv('big').messages;
		expect(list.length).toBe(1000);
		expect(list[0]?.id).toBe('5');
	});

	test('junk frames change nothing', () => {
		const s = new ChatState();
		expect(s.handle(null, ME)).toEqual({});
		expect(s.handle('text', ME)).toEqual({});
		expect(s.handle({ type: 'contacts', contacts: 'x' }, ME)).toEqual({});
		expect(s.contacts).toEqual([]);
	});
});
