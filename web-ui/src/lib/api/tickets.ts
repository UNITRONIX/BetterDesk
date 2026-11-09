/**
 * Tickets (routes/tickets.routes.js, mounted at /api/tickets). Reading
 * needs device.view, creating, changing, deleting and attaching
 * device.edit; any reader may comment (internal notes only from roles
 * other than viewer). Answers carry no { success } envelope and errors are
 * { error }. Dates: SQLite writes "2026-11-08 17:54:40" (UTC), due dates
 * are ISO; parseDate reads both.
 */

import * as v from 'valibot';
import { api, BoolLike, NumLike, Ok, Text } from './client.ts';

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
export const TICKET_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export const TICKET_CATEGORIES = ['general', 'hardware', 'software', 'network', 'access', 'other'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/** The largest attachment the server keeps (MAX_ATTACHMENT_SIZE) */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface Ticket {
	id: number;
	title: string;
	description: string;
	status: string;
	priority: string;
	category: string;
	/** '' when the ticket is not about one device */
	device_id: string;
	created_by: string;
	/** '' when nobody has it */
	assigned_to: string;
	sla_due_at: string;
	resolved_at: string;
	closed_at: string;
	created_at: string;
	updated_at: string;
}

export interface TicketComment {
	id: number;
	author: string;
	body: string;
	is_internal: boolean;
	created_at: string;
}

export interface TicketAttachment {
	id: number;
	filename: string;
	mimetype: string;
	size_bytes: number;
	uploaded_by: string;
	created_at: string;
}

export interface TicketDetail extends Ticket {
	comments: TicketComment[];
	attachments: TicketAttachment[];
}

const s = (x: string | undefined): string => x ?? '';

const TicketEntries = {
	id: NumLike,
	title: Text,
	description: Text,
	status: Text,
	priority: Text,
	category: Text,
	device_id: Text,
	created_by: Text,
	assigned_to: Text,
	sla_due_at: Text,
	resolved_at: Text,
	closed_at: Text,
	created_at: Text,
	updated_at: Text
};

type RawTicket = v.InferOutput<v.LooseObjectSchema<typeof TicketEntries, undefined>>;

function clean(o: RawTicket): Ticket {
	return {
		id: o.id,
		title: s(o.title),
		description: s(o.description),
		status: s(o.status),
		priority: s(o.priority),
		category: s(o.category),
		device_id: s(o.device_id),
		created_by: s(o.created_by),
		assigned_to: s(o.assigned_to),
		sla_due_at: s(o.sla_due_at),
		resolved_at: s(o.resolved_at),
		closed_at: s(o.closed_at),
		created_at: s(o.created_at),
		updated_at: s(o.updated_at)
	};
}

export const TicketSchema = v.pipe(v.looseObject(TicketEntries), v.transform(clean));

const CommentSchema = v.pipe(
	v.looseObject({ id: NumLike, author: Text, body: Text, is_internal: BoolLike, created_at: Text }),
	v.transform((c): TicketComment => ({
		id: c.id,
		author: s(c.author),
		body: s(c.body),
		is_internal: c.is_internal ?? false,
		created_at: s(c.created_at)
	}))
);

const AttachmentSchema = v.pipe(
	v.looseObject({
		id: NumLike,
		filename: Text,
		mimetype: Text,
		size_bytes: v.optional(NumLike),
		uploaded_by: Text,
		created_at: Text
	}),
	v.transform((a): TicketAttachment => ({
		id: a.id,
		filename: s(a.filename),
		mimetype: s(a.mimetype),
		size_bytes: a.size_bytes ?? 0,
		uploaded_by: s(a.uploaded_by),
		created_at: s(a.created_at)
	}))
);

const List = v.pipe(
	v.looseObject({ tickets: v.array(TicketSchema) }),
	v.transform((o) => o.tickets)
);

export const DetailSchema = v.pipe(
	v.looseObject({
		...TicketEntries,
		comments: v.optional(v.array(CommentSchema)),
		attachments: v.optional(v.array(AttachmentSchema))
	}),
	v.transform((o): TicketDetail => ({
		...clean(o),
		comments: o.comments ?? [],
		attachments: o.attachments ?? []
	}))
);

/** Every ticket the user may see (viewers: the ones assigned to them) */
export function listTickets(signal?: AbortSignal): Promise<Ticket[]> {
	return api(List, '/api/tickets', { signal });
}

export function getTicket(id: number, signal?: AbortSignal): Promise<TicketDetail> {
	return api(DetailSchema, `/api/tickets/${id}`, { signal });
}

export interface TicketInput {
	title: string;
	description: string;
	priority: string;
	category: string;
	/** Create: optional; edit: '' clears it */
	device_id?: string;
}

const Created = v.looseObject({
	success: v.optional(v.boolean()),
	ticket: v.looseObject({ id: NumLike })
});

export async function createTicket(input: TicketInput): Promise<number> {
	const body: Record<string, unknown> = { ...input };
	if (!input.device_id) delete body.device_id;
	const out = await api(Created, '/api/tickets', { method: 'POST', body });
	return out.ticket.id;
}

export type TicketChanges = Partial<{
	title: string;
	description: string;
	status: string;
	priority: string;
	category: string;
	assigned_to: string | null;
	device_id: string | null;
}>;

export async function updateTicket(id: number, changes: TicketChanges): Promise<void> {
	await api(Ok, `/api/tickets/${id}`, { method: 'PATCH', body: changes });
}

export async function deleteTicket(id: number): Promise<void> {
	await api(Ok, `/api/tickets/${id}`, { method: 'DELETE' });
}

export async function addComment(id: number, body: string, internal: boolean): Promise<void> {
	await api(Ok, `/api/tickets/${id}/comments`, { method: 'POST', body: { body, is_internal: internal } });
}

/** Read a file as base64 (without the data: prefix), as the attachment API takes it */
export function fileToBase64(file: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const url = String(reader.result ?? '');
			resolve(url.slice(url.indexOf(',') + 1));
		};
		reader.onerror = () => reject(reader.error ?? new Error('read failed'));
		reader.readAsDataURL(file);
	});
}

export async function uploadAttachment(id: number, file: File): Promise<void> {
	const data = await fileToBase64(file);
	await api(Ok, `/api/tickets/${id}/attachments`, {
		method: 'POST',
		body: { filename: file.name, data, mimetype: file.type || 'application/octet-stream' }
	});
}

/** The download link of an attachment (a plain link; the server sends it as a file) */
export function attachmentUrl(aid: number): string {
	return `/api/tickets/attachments/${aid}`;
}
