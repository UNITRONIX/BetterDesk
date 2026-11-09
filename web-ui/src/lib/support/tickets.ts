/**
 * Ticket rules without a DOM: filters, overdue, the side column's counts,
 * tones and the status actions a ticket offers. The page and its tests use
 * these.
 */

import type { Ticket } from '#lib/api/tickets.ts';
import { parseDate } from '#lib/i18n/format.ts';

export type StatusFilter = '' | 'open' | 'in_progress' | 'resolved' | 'closed';
export type PriorityFilter = '' | 'critical' | 'high' | 'medium' | 'low';

export interface TicketFilters {
	status: StatusFilter;
	priority: PriorityFilter;
	search: string;
}

export function isFiltered(f: TicketFilters): boolean {
	return Boolean(f.status || f.priority || f.search.trim());
}

/**
 * The tickets a filter shows. Search looks in the title and the
 * description, ignoring case (as the server's LIKE did); "#47" or "47"
 * also finds ticket 47.
 */
export function filterTickets(list: readonly Ticket[], f: TicketFilters): Ticket[] {
	const q = f.search.trim().toLowerCase();
	const idQuery = /^#?\d+$/.test(q) ? Number(q.replace('#', '')) : null;
	return list.filter((t) => {
		if (f.status && t.status !== f.status) return false;
		if (f.priority && t.priority !== f.priority) return false;
		if (!q) return true;
		if (idQuery !== null && t.id === idQuery) return true;
		return t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q);
	});
}

export function isOverdue(t: Ticket, now = Date.now()): boolean {
	if (t.status === 'resolved' || t.status === 'closed') return false;
	const due = parseDate(t.sla_due_at);
	return !!due && due.getTime() < now;
}

/** Past their due time and not done, most overdue first */
export function overdueTickets(list: readonly Ticket[], now = Date.now()): Ticket[] {
	const due = (t: Ticket) => parseDate(t.sla_due_at)?.getTime() ?? 0;
	return list.filter((t) => isOverdue(t, now)).sort((a, b) => due(a) - due(b));
}

export function countByStatus(
	list: readonly Ticket[]
): Record<'open' | 'in_progress' | 'resolved' | 'closed', number> {
	const c = { open: 0, in_progress: 0, resolved: 0, closed: 0 };
	for (const t of list) if (t.status in c) c[t.status as keyof typeof c]++;
	return c;
}

/** Open and in-progress tickets per priority */
export function openByPriority(
	list: readonly Ticket[]
): Record<'critical' | 'high' | 'medium' | 'low', number> {
	const c = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const t of list) {
		if (t.status !== 'open' && t.status !== 'in_progress') continue;
		if (t.priority in c) c[t.priority as keyof typeof c]++;
	}
	return c;
}

/** Open and in progress wait for someone; resolved is good; closed is over */
export function statusTone(status: string): 'waiting' | 'good' | 'neutral' {
	if (status === 'open' || status === 'in_progress') return 'waiting';
	return status === 'resolved' ? 'good' : 'neutral';
}

/** Priority as a severity */
export function priorityTone(priority: string): 'danger' | 'warning' | 'neutral' {
	if (priority === 'critical' || priority === 'high') return 'danger';
	return priority === 'medium' ? 'warning' : 'neutral';
}

/** Keys are made from server values: keep only letters and underscores */
export function safeKey(value: string): string {
	return value.replace(/[^a-z_]/g, '');
}

export type StatusAction =
	| { kind: 'status'; status: 'in_progress' | 'resolved' | 'closed' }
	| { kind: 'assign' }
	| { kind: 'unassign' };

/** The status and assignee buttons a ticket offers, in the old order */
export function statusActions(t: Pick<Ticket, 'status' | 'assigned_to'>, me: string): StatusAction[] {
	const out: StatusAction[] = [];
	if (t.status === 'open') out.push({ kind: 'status', status: 'in_progress' });
	if (t.status === 'open' || t.status === 'in_progress') out.push({ kind: 'status', status: 'resolved' });
	if (t.status !== 'closed') out.push({ kind: 'status', status: 'closed' });
	if (me && t.assigned_to !== me) out.push({ kind: 'assign' });
	if (t.assigned_to) out.push({ kind: 'unassign' });
	return out;
}

/** Recent tickets show "5h ago"; older than a week the date without the time */
export function createdIsOld(created: string, now = Date.now()): boolean {
	const d = parseDate(created);
	return !!d && now - d.getTime() > 7 * 86_400_000;
}
