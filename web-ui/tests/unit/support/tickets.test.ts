import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DetailSchema, TicketSchema, type Ticket } from '../../../src/lib/api/tickets.ts';
import {
	countByStatus,
	createdIsOld,
	filterTickets,
	isFiltered,
	isOverdue,
	openByPriority,
	overdueTickets,
	priorityTone,
	safeKey,
	statusActions,
	statusTone
} from '../../../src/lib/support/tickets.ts';

const NOW = Date.parse('2026-11-09T12:00:00Z');

function ticket(id: number, extra: Partial<Ticket> = {}): Ticket {
	return {
		id,
		title: 'Ticket ' + id,
		description: '',
		status: 'open',
		priority: 'medium',
		category: 'general',
		device_id: '',
		created_by: 'admin',
		assigned_to: '',
		sla_due_at: '',
		resolved_at: '',
		closed_at: '',
		created_at: '2026-11-08 17:54:40',
		updated_at: '',
		...extra
	};
}

describe('ticket schemas', () => {
	test('nulls become empty text and ids numbers', () => {
		const out = v.parse(TicketSchema, {
			id: '47',
			title: 'Kiosk',
			description: null,
			status: 'open',
			priority: 'high',
			category: 'network',
			device_id: null,
			assigned_to: null,
			sla_due_at: '2026-11-09T01:54:40.992Z',
			created_at: '2026-11-08 17:54:40'
		});
		expect(out).toMatchObject({ id: 47, description: '', device_id: '', assigned_to: '', resolved_at: '' });
	});

	test('the detail keeps comments (SQLite 0/1 internal flags) and attachments', () => {
		const d = v.parse(DetailSchema, {
			id: 3,
			title: 'x',
			comments: [
				{ id: 1, author: 'a', body: 'hi', is_internal: 1, created_at: '2026-11-08 10:00:00' },
				{ id: 2, author: 'b', body: 'yo', is_internal: 0, created_at: '2026-11-08 11:00:00' }
			],
			attachments: [
				{ id: 9, filename: 'log.txt', mimetype: 'text/plain', size_bytes: '12', uploaded_by: 'a' }
			]
		});
		expect(d.comments.map((c) => c.is_internal)).toEqual([true, false]);
		expect(d.attachments[0]).toMatchObject({ id: 9, size_bytes: 12 });
		expect(v.parse(DetailSchema, { id: 4, title: 'y' }).comments).toEqual([]);
	});

	test('a ticket without an id is refused', () => {
		expect(v.safeParse(TicketSchema, { title: 'x' }).success).toBe(false);
	});
});

describe('filters', () => {
	const list = [
		ticket(1, { title: 'Printer jam', status: 'open', priority: 'high' }),
		ticket(2, { title: 'VPN', description: 'drops on the PRINTER floor', status: 'resolved' }),
		ticket(47, { title: 'Kiosk', status: 'in_progress', priority: 'critical' })
	];

	test('search looks in title and description, ignoring case', () => {
		expect(filterTickets(list, { status: '', priority: '', search: 'printer' }).map((x) => x.id)).toEqual([
			1, 2
		]);
	});

	test('#47 and 47 find the ticket by number', () => {
		expect(filterTickets(list, { status: '', priority: '', search: '#47' }).map((x) => x.id)).toEqual([47]);
		expect(filterTickets(list, { status: '', priority: '', search: '47' }).map((x) => x.id)).toEqual([47]);
	});

	test('status and priority narrow the list', () => {
		expect(filterTickets(list, { status: 'open', priority: '', search: '' }).map((x) => x.id)).toEqual([1]);
		expect(filterTickets(list, { status: '', priority: 'critical', search: '' }).map((x) => x.id)).toEqual([
			47
		]);
		expect(filterTickets(list, { status: 'open', priority: 'critical', search: '' })).toEqual([]);
	});

	test('a blank search is no filter', () => {
		expect(isFiltered({ status: '', priority: '', search: '  ' })).toBe(false);
		expect(isFiltered({ status: 'closed', priority: '', search: '' })).toBe(true);
	});
});

describe('overdue and counts', () => {
	const list = [
		ticket(1, { sla_due_at: '2026-11-09T10:00:00Z' }),
		ticket(2, { sla_due_at: '2026-11-08T10:00:00Z', status: 'in_progress' }),
		ticket(3, { sla_due_at: '2026-11-08T10:00:00Z', status: 'resolved' }),
		ticket(4, { sla_due_at: '2026-11-10T10:00:00Z' }),
		ticket(5, { status: 'closed', priority: 'critical' })
	];

	test('past due and not done; the most overdue first', () => {
		expect(isOverdue(list[0]!, NOW)).toBe(true);
		expect(isOverdue(list[2]!, NOW)).toBe(false);
		expect(isOverdue(list[3]!, NOW)).toBe(false);
		expect(isOverdue(ticket(9), NOW)).toBe(false);
		expect(overdueTickets(list, NOW).map((x) => x.id)).toEqual([2, 1]);
	});

	test('per status, and open or in progress per priority', () => {
		expect(countByStatus(list)).toEqual({ open: 2, in_progress: 1, resolved: 1, closed: 1 });
		expect(openByPriority(list)).toEqual({ critical: 0, high: 0, medium: 3, low: 0 });
	});

	test('tickets older than a week show a date', () => {
		expect(createdIsOld('2026-11-01 10:00:00', NOW)).toBe(true);
		expect(createdIsOld('2026-11-08 10:00:00', NOW)).toBe(false);
		expect(createdIsOld('', NOW)).toBe(false);
	});
});

describe('status actions', () => {
	test('in the old order, per status', () => {
		const kinds = (st: string, assigned: string, me = 'me') =>
			statusActions({ status: st, assigned_to: assigned }, me).map((a) =>
				a.kind === 'status' ? a.status : a.kind
			);
		expect(kinds('open', '')).toEqual(['in_progress', 'resolved', 'closed', 'assign']);
		expect(kinds('in_progress', 'me')).toEqual(['resolved', 'closed', 'unassign']);
		expect(kinds('resolved', 'other')).toEqual(['closed', 'assign', 'unassign']);
		expect(kinds('closed', '')).toEqual(['assign']);
		expect(kinds('closed', '', '')).toEqual([]);
	});

	test('tones and safe keys', () => {
		expect([
			statusTone('open'),
			statusTone('in_progress'),
			statusTone('resolved'),
			statusTone('closed')
		]).toEqual(['waiting', 'waiting', 'good', 'neutral']);
		expect([
			priorityTone('critical'),
			priorityTone('high'),
			priorityTone('medium'),
			priorityTone('low')
		]).toEqual(['danger', 'danger', 'warning', 'neutral']);
		expect(safeKey('in_progress"><img')).toBe('in_progressimg');
	});
});

describe('ticket API', () => {
	afterEach(() => vi.restoreAllMocks());

	test('PATCH sends only the given changes; uploads send base64 without the data: prefix', async () => {
		const calls: { url: string; init: RequestInit }[] = [];
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
			calls.push({ url: String(url), init: init ?? {} });
			return new Response('{"success":true}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		});
		const api = await import('../../../src/lib/api/tickets.ts');
		await api.updateTicket(7, { device_id: null });
		expect(calls[0]?.url).toBe('/api/tickets/7');
		expect(calls[0]?.init.method).toBe('PATCH');
		expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ device_id: null });

		await api.uploadAttachment(7, new File(['hi'], 'a b.txt', { type: 'text/plain' }));
		expect(calls[1]?.url).toBe('/api/tickets/7/attachments');
		expect(JSON.parse(String(calls[1]?.init.body))).toEqual({
			filename: 'a b.txt',
			data: 'aGk=',
			mimetype: 'text/plain'
		});
	});

	test('a new ticket without a device leaves device_id out', async () => {
		let body: unknown;
		vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
			body = JSON.parse(String(init?.body));
			return new Response('{"success":true,"ticket":{"id":8,"title":"x"}}', {
				status: 201,
				headers: { 'content-type': 'application/json' }
			});
		});
		const api = await import('../../../src/lib/api/tickets.ts');
		const id = await api.createTicket({
			title: 'x',
			description: '',
			priority: 'low',
			category: 'general',
			device_id: ''
		});
		expect(id).toBe(8);
		expect(body).toEqual({ title: 'x', description: '', priority: 'low', category: 'general' });
	});
});
