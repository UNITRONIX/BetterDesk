import * as v from 'valibot';
import { describe, expect, test } from 'vitest';
import { HelpRequest } from '../../../src/lib/api/helpRequests.ts';
import {
	matchesFilter,
	mergeFresh,
	oldestWaiting,
	statusCounts,
	statusTone,
	trend,
	visibleRequests,
	type LocalRequest
} from '../../../src/lib/support/help-requests.ts';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 9, 12, 0, 0);

function req(id: string, status: string, created: number, extra: Partial<LocalRequest> = {}): LocalRequest {
	return {
		id,
		device_id: '9001' + id,
		hostname: 'pc-' + id,
		message: 'help ' + id,
		status,
		accepted_by: '',
		resolved_by: '',
		created_at: created,
		...extra
	};
}

describe('help request schema', () => {
	test('reads what the console sends and turns acknowledged into accepted', () => {
		const r = v.parse(HelpRequest, {
			id: 29,
			device_id: '900100001',
			hostname: null,
			message: 'Printer',
			status: 'acknowledged',
			accepted_by: 'demo_operator',
			created_at: '1794161080000',
			updated_at: 1794162574000
		});
		expect(r).toMatchObject({
			id: '29',
			hostname: '',
			status: 'accepted',
			created_at: 1794161080000,
			updated_at: 1794162574000,
			resolved_by: ''
		});
	});

	test('a list without updated_at counts openings only', () => {
		const r = v.parse(HelpRequest, { id: '1', status: 'resolved', created_at: NOW.getTime() });
		expect('updated_at' in r).toBe(false);
		expect(trend([r], 200, NOW).hasUpdated).toBe(false);
		const withIt = v.parse(HelpRequest, {
			id: '1',
			status: 'resolved',
			created_at: NOW.getTime(),
			updated_at: null
		});
		expect(trend([withIt], 200, NOW).hasUpdated).toBe(true);
	});

	test('an ISO date is read as a time', () => {
		const r = v.parse(HelpRequest, { id: '1', status: 'pending', created_at: '2026-11-09T10:00:00Z' });
		expect(r.created_at).toBe(Date.parse('2026-11-09T10:00:00Z'));
	});
});

describe('filters and order', () => {
	const list = [req('a', 'pending', 3), req('b', 'accepted', 1), req('c', 'resolved', 2)];

	test('open is waiting and accepted; all is everything', () => {
		expect(list.filter((r) => matchesFilter(r, 'open')).map((r) => r.id)).toEqual(['a', 'b']);
		expect(list.filter((r) => matchesFilter(r, 'resolved')).map((r) => r.id)).toEqual(['c']);
		expect(list.filter((r) => matchesFilter(r, '')).length).toBe(3);
	});

	test('oldest first or newest first', () => {
		expect(visibleRequests(list, '', 'oldest', new Set()).map((r) => r.id)).toEqual(['b', 'c', 'a']);
		expect(visibleRequests(list, '', 'newest', new Set()).map((r) => r.id)).toEqual(['a', 'c', 'b']);
	});

	test('a request changed here stays in view under a filter it no longer matches', () => {
		const resolved = [req('a', 'resolved', 3), req('b', 'accepted', 1)];
		expect(visibleRequests(resolved, 'open', 'oldest', new Set()).map((r) => r.id)).toEqual(['b']);
		expect(visibleRequests(resolved, 'open', 'oldest', new Set(['a'])).map((r) => r.id)).toEqual(['b', 'a']);
	});
});

describe('fresh lists', () => {
	test('a local accept survives a poll that still says pending, until the server agrees', () => {
		const local = [req('a', 'accepted', 1, { accepted_by: 'me', local: true })];
		const lagging = mergeFresh(local, [req('a', 'pending', 1)]);
		expect(lagging[0]).toMatchObject({ status: 'accepted', accepted_by: 'me' });
		const agreed = mergeFresh(lagging, [req('a', 'accepted', 1, { accepted_by: 'other' })]);
		expect(agreed[0]).toMatchObject({ status: 'accepted', accepted_by: 'other' });
		expect(agreed[0]?.local).toBeUndefined();
	});

	test('the server moving further wins over the local state', () => {
		const local = [req('a', 'accepted', 1, { local: true })];
		expect(mergeFresh(local, [req('a', 'resolved', 1)])[0]?.status).toBe('resolved');
	});

	test('requests the server no longer lists are gone', () => {
		expect(mergeFresh([req('a', 'pending', 1)], [req('b', 'pending', 2)]).map((r) => r.id)).toEqual(['b']);
	});
});

describe('counts', () => {
	test('per status and the oldest waiting request', () => {
		const list = [
			req('a', 'pending', 5),
			req('b', 'pending', 2),
			req('c', 'accepted', 1),
			req('d', 'resolved', 0)
		];
		expect(statusCounts(list)).toEqual({ pending: 2, accepted: 1, resolved: 1 });
		expect(oldestWaiting(list)?.id).toBe('b');
		expect(oldestWaiting([req('c', 'accepted', 1)])).toBeNull();
	});

	test('tones: waiting, good, neutral', () => {
		expect([statusTone('pending'), statusTone('accepted'), statusTone('resolved')]).toEqual([
			'waiting',
			'good',
			'neutral'
		]);
	});
});

describe('trend', () => {
	test('opened on the day it came in, resolved on the day it last changed', () => {
		const today = NOW.getTime();
		const list = [
			req('a', 'pending', today, { updated_at: null }),
			req('b', 'resolved', today - 2 * DAY, { updated_at: today - DAY }),
			req('c', 'resolved', today - 30 * DAY, { updated_at: today })
		];
		const t = trend(list, 200, NOW);
		expect(t.days.length).toBe(14);
		expect(t.opened.at(-1)).toBe(1);
		expect(t.opened.at(-3)).toBe(1);
		expect(t.resolved.at(-2)).toBe(1);
		expect(t.resolved.at(-1)).toBe(1);
		expect(t.opened.reduce((a, b) => a + b, 0)).toBe(2);
		expect(t.capped).toBe(false);
	});

	test('a full list whose oldest request is inside the window is capped', () => {
		const list = Array.from({ length: 200 }, (_, i) =>
			req(String(i), 'pending', NOW.getTime() - (i % 3) * DAY)
		);
		expect(trend(list, 200, NOW).capped).toBe(true);
		expect(trend(list.slice(0, 199), 200, NOW).capped).toBe(false);
		// A full list that reaches back past the window has every day of it
		const older = [...list.slice(0, 199), req('old', 'resolved', NOW.getTime() - 30 * DAY)];
		expect(trend(older, 200, NOW).capped).toBe(false);
	});
});
