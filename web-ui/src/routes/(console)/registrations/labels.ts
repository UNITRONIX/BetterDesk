/** Words for enrollment requests, shared by the page and its sheet */

import { ApiError } from '#lib/api/client.ts';
import { SOURCE_ENROLLMENT, type RequestRow, type RequestStatus } from '#lib/clients/registrations.ts';
import { FormError } from '#lib/ui/form.svelte.ts';
import { formatDate } from '#lib/i18n/format.ts';
import { t } from '#lib/i18n/i18n.svelte.ts';

export function sourceLabel(row: RequestRow): string {
	return row.source === SOURCE_ENROLLMENT
		? t('registrations.source_rustdesk')
		: t('registrations.source_lan');
}

export function statusLabel(status: RequestStatus): string {
	return t(`registrations.status_${status}`);
}

export function statusToneOf(status: RequestStatus): 'good' | 'neutral' | 'waiting' {
	return status === 'approved' ? 'good' : status === 'rejected' ? 'neutral' : 'waiting';
}

/** "by anna, 9 Nov 2026, 10:12", "device banned" added when it was banned */
export function decidedText(row: RequestRow): string {
	if (row.status === 'pending') return '';
	const when = row.decided_at ? formatDate(row.decided_at, {}, '') : '';
	const by = row.decided_by;
	let sub = '';
	if (by && when) sub = t('registrations.decided_by_on', { name: by, date: when });
	else if (by) sub = t('registrations.decided_by', { name: by });
	else if (when) sub = when;
	if (row.banned) sub = sub ? `${sub}, ${t('registrations.also_banned')}` : t('registrations.also_banned');
	return sub;
}

/**
 * What to say when a request failed: the client's own sentence for no
 * permission and no connection, the page's sentence for anything else (the
 * Go server's raw errors mean nothing to the person)
 */
export function failure(err: unknown, key: string): FormError {
	if (err instanceof ApiError && (err.status === 403 || err.status === 0)) return new FormError(err.message);
	return new FormError(t(key));
}

/** Runs a write and turns its failure into the page's sentence */
export async function plainly<T>(run: () => Promise<T>, key: string): Promise<T> {
	try {
		return await run();
	} catch (err) {
		throw failure(err, key);
	}
}

export { around } from '#lib/clients/text.ts';
