import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError } from '../../../src/lib/api/client.ts';
import {
	ComplianceRow,
	fleetAvailability,
	isUnavailable,
	listResources,
	listTasks,
	Resource,
	Task,
	taskOutput
} from '../../../src/lib/api/fleet.ts';
import {
	addressFor,
	complianceSummary,
	filterResources,
	filterTasks,
	resourceActive,
	resourceTypeKey,
	scopeKey,
	score,
	scoreLevel,
	tabFrom,
	taskNumbers,
	taskProblem,
	taskSchedule,
	urlForTab
} from '../../../src/lib/canvas/fleet.ts';

const task = (extra: Partial<Task> = {}): Task => v.parse(Task, { id: 1, name: 'Patch', ...extra });
const resource = (extra: Partial<Resource> = {}): Resource =>
	v.parse(Resource, { id: 1, name: 'Printer', ...extra });

function reply(status: number, body: unknown) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.unstubAllGlobals());

describe('tabs', () => {
	test('?tab= picks a tab; anything else is Resources', () => {
		expect(tabFrom('builder')).toBe('builder');
		expect(tabFrom('nope')).toBe('resources');
		expect(tabFrom(null)).toBe('resources');
		expect(urlForTab(new URL('http://x/fleet?a=1'), 'compliance').search).toBe('?a=1&tab=compliance');
	});
});

describe('resources', () => {
	test('type and scope names; an unknown one shows as it is', () => {
		expect(resourceTypeKey('network_drive')).toBe('fleet.type_network_drive');
		expect(resourceTypeKey('fax')).toBeNull();
		expect(scopeKey('')).toBe('fleet.scope_org');
		expect(scopeKey('device')).toBe('fleet.scope_device');
		expect(scopeKey('site')).toBeNull();
	});

	test('active unless the server says otherwise', () => {
		expect(resourceActive(resource())).toBe(true);
		expect(resourceActive(resource({ active: false }))).toBe(false);
		expect(resourceActive(resource({ active: 0 }))).toBe(false);
	});

	test('the type filter', () => {
		const list = [resource({ type: 'dns' }), resource({ id: '2', type: 'vpn' })];
		expect(filterResources(list, 'vpn').map((r) => r.id)).toEqual(['2']);
		expect(filterResources(list, '')).toHaveLength(2);
	});

	test('the address label and example follow the type', () => {
		expect(addressFor('dns')).toEqual({ labelKey: 'fleet.address_dns', example: '8.8.8.8, 1.1.1.1' });
		expect(addressFor('vpn').labelKey).toBe('fleet.address_vpn');
		expect(addressFor('printer')).toEqual({ labelKey: 'fleet.address', example: '\\\\server\\printer' });
	});
});

describe('tasks', () => {
	test('search looks at the name and the devices', () => {
		const list = [
			task({ name: 'Patch Tuesday', targets: 'pc-1' }),
			task({ id: '2', name: 'Reboot', device_id: 'KIOSK-7' })
		];
		expect(filterTasks(list, 'tues').map((x) => x.id)).toEqual(['1']);
		expect(filterTasks(list, 'kiosk').map((x) => x.id)).toEqual(['2']);
		expect(filterTasks(list, '  ')).toHaveLength(2);
	});

	test('schedules: right away, cron, once at a time', () => {
		expect(taskSchedule(task())).toEqual({ kind: 'immediate' });
		expect(taskSchedule(task({ schedule_type: 'cron', cron: '0 3 * * *' }))).toEqual({
			kind: 'cron',
			value: '0 3 * * *'
		});
		const once = taskSchedule(task({ schedule_type: 'once', schedule_value: '2026-11-10T08:00' }));
		expect(once.kind === 'once' && once.date?.getHours()).toBe(8);
		const bad = taskSchedule(task({ schedule_type: 'once', schedule_value: 'soon' }));
		expect(bad).toEqual({ kind: 'once', value: 'soon', date: null });
	});

	test('the form asks for a name, devices, then a time unless it runs right away', () => {
		const ok = { name: 'a', targets: 'b', schedule_type: 'immediate', schedule_value: '' };
		expect(taskProblem(ok)).toBeNull();
		expect(taskProblem({ ...ok, name: '' })?.key).toBe('fleet.name_required');
		expect(taskProblem({ ...ok, targets: '' })?.key).toBe('fleet.targets_required');
		expect(taskProblem({ ...ok, schedule_type: 'cron' })).toEqual({
			field: 'schedule',
			key: 'fleet.schedule_required'
		});
	});

	test('retries and time limit: empty or invalid become 0 and 300', () => {
		expect(taskNumbers('2', '600')).toEqual({ retries: 2, timeout: 600 });
		expect(taskNumbers('', 'x')).toEqual({ retries: 0, timeout: 300 });
	});
});

describe('compliance', () => {
	test('levels: 80 and up meets the rules, 50 and up a warning, else critical', () => {
		expect([scoreLevel(80), scoreLevel(79), scoreLevel(50), scoreLevel(49)]).toEqual([
			'good',
			'warning',
			'warning',
			'danger'
		]);
		expect(score({ score: 140 })).toBe(100);
		expect(score({ score: null })).toBe(0);
	});

	test('the summary line', () => {
		const rows = [90, 85, 60, 10].map((s) => v.parse(ComplianceRow, { device_id: 'd' + s, score: s }));
		expect(complianceSummary(rows)).toEqual({ count: 4, compliant: 2, warning: 1, critical: 1, score: 61 });
		expect(complianceSummary([])).toEqual({ count: 0, compliant: 0, warning: 0, critical: 0, score: 0 });
	});
});

describe('fleet API', () => {
	test('lists come bare, as { data } or under their key', async () => {
		for (const body of [
			[{ id: 1, name: 'A' }],
			{ data: [{ id: 1, name: 'A' }] },
			{ resources: [{ id: 1, name: 'A' }] }
		]) {
			vi.stubGlobal(
				'fetch',
				vi.fn(async () => reply(200, body))
			);
			const list = await listResources('org-1');
			expect(list.map((r) => [r.id, r.name, r.type])).toEqual([['1', 'A', '']]);
		}
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(200, { tasks: [{ id: 'x', name: null, retries: '2' }] }))
		);
		expect((await listTasks(''))[0]).toMatchObject({ id: 'x', name: '', retries: '2' });
	});

	test('a 404 from Go means the server offers no fleet tasks', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(404, { error: 'not found' }))
		);
		const err = await listResources('org-1').catch((e: unknown) => e);
		expect(isUnavailable(err)).toBe(true);
		expect(isUnavailable(new ApiError('x', 500))).toBe(false);
	});

	test('availability: the console answers, or null when it is older than the question', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(200, { success: true, available: false }))
		);
		expect(await fleetAvailability()).toBe(false);
		const calls = vi.fn(async () => reply(404, { error: 'Not found' }));
		vi.stubGlobal('fetch', calls);
		expect(await fleetAvailability()).toBeNull();
		expect(String((calls.mock.calls[0] as unknown[] | undefined)?.[0])).toContain(
			'/api/panel/fleet/availability'
		);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(403, { error: 'Permission denied: org.manage_devices' }))
		);
		await expect(fleetAvailability()).rejects.toBeInstanceOf(ApiError);
	});

	test('task output is output or log', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => reply(200, { log: 'done\n' }))
		);
		expect(await taskOutput('7')).toBe('done\n');
	});
});
