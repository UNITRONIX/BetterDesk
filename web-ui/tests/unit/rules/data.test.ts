/** Data loss prevention, USB and drive access, device identity, and who may open the pages */
import { describe, expect, test } from 'vitest';
import type { AttestationRecord } from '../../../src/lib/api/attestation.ts';
import type { DlpEvent, DlpPolicy } from '../../../src/lib/api/dataguard.ts';
import type { RcDevice } from '../../../src/lib/api/resourceControl.ts';
import { isAdminRole } from '../../../src/lib/rules/access.ts';
import {
	attStatus,
	canRevoke,
	canVerify,
	countGroups,
	sortRecords
} from '../../../src/lib/rules/attestation.ts';
import {
	countByAction,
	detailText,
	dgTabFrom,
	eventsPerPolicy,
	filterEvents,
	filterPolicies,
	parseRules,
	rulesText,
	typeOf
} from '../../../src/lib/rules/dataguard.ts';
import {
	changedCategories,
	complianceView,
	filterRcDevices,
	isOnline,
	rcBody,
	rcValuesFrom,
	rulesSummary
} from '../../../src/lib/rules/resourceControl.ts';

describe('who may open the pages', () => {
	test('Policies and Device identity: the four admin roles, as requireAdmin', () => {
		for (const r of ['admin', 'super_admin', 'global_admin', 'server_admin'])
			expect(isAdminRole(r)).toBe(true);
		for (const r of ['operator', 'viewer', 'guest_issuer', '', null, undefined])
			expect(isAdminRole(r)).toBe(false);
	});
});

const policy = (over: Partial<DlpPolicy> = {}): DlpPolicy => ({
	id: '1',
	name: 'Block sticks',
	description: 'No USB storage',
	policy_type: 'usb',
	type: '',
	action: 'block',
	scope: '',
	enabled: true,
	rules: [],
	...over
});
const event = (over: Partial<DlpEvent> = {}): DlpEvent => ({
	device_id: '900100001',
	event_source: 'usb',
	event_type: 'info',
	policy_id: '1',
	policy_name: 'Block sticks',
	action: 'block',
	details: {},
	created_at: '2026-11-09T10:00:00Z',
	...over
});

describe('data loss prevention', () => {
	test('the rules field: empty for none, JSON for a list; only a JSON list is accepted', () => {
		expect(rulesText(undefined)).toBe('');
		expect(rulesText([])).toBe('');
		expect(rulesText([{ key: 'file_ext' }])).toBe('[\n  {\n    "key": "file_ext"\n  }\n]');
		expect(parseRules('')).toEqual([]);
		expect(parseRules(' [{"a":1}] ')).toEqual([{ a: 1 }]);
		expect(parseRules('{"a":1}')).toBeNull();
		expect(parseRules('[oops')).toBeNull();
	});

	test('older rows keep the type in "type"', () => {
		expect(typeOf(policy())).toBe('usb');
		expect(typeOf(policy({ policy_type: '', type: 'clipboard' }))).toBe('clipboard');
	});

	test('the policy search covers name, description, scope and the type label', () => {
		const list = [
			policy(),
			policy({ id: '2', name: 'Clip', description: '', policy_type: 'clipboard', scope: '900100002' })
		];
		const label = (t: string) => (t === 'clipboard' ? 'Zwischenablage' : t);
		expect(filterPolicies(list, 'zwischen', label).map((p) => p.id)).toEqual(['2']);
		expect(filterPolicies(list, '9001000', label).map((p) => p.id)).toEqual(['2']);
		expect(filterPolicies(list, 'no usb', label).map((p) => p.id)).toEqual(['1']);
		expect(filterPolicies(list, ' ', label)).toHaveLength(2);
	});

	test('events filter by action and by device, policy and details', () => {
		const list = [event(), event({ device_id: '2', action: 'log', details: { file: 'report.xlsx' } })];
		expect(filterEvents(list, '', 'log').map((e) => e.device_id)).toEqual(['2']);
		expect(filterEvents(list, 'xlsx', '').map((e) => e.device_id)).toEqual(['2']);
		expect(filterEvents(list, 'xlsx', 'block')).toEqual([]);
		expect(detailText(event({ details: {} }))).toBe('');
		expect(detailText(event({ details: 'plain' }))).toBe('plain');
	});

	test('counts per policy and per action', () => {
		const list = [
			event(),
			event(),
			event({ policy_id: '2', action: 'allow' }),
			event({ policy_id: null, action: 'x' })
		];
		expect(Object.fromEntries(eventsPerPolicy(list))).toEqual({ '1': 2, '2': 1 });
		expect(countByAction(list)).toEqual({ block: 2, log: 0, allow: 1 });
	});

	test('?tab=events opens the events, anything else the policies', () => {
		expect(dgTabFrom('events')).toBe('events');
		expect(dgTabFrom(null)).toBe('policies');
		expect(dgTabFrom('x')).toBe('policies');
	});
});

describe('USB and drive access', () => {
	test('a device without rules shows defaults that allow everything', () => {
		const v = rcValuesFrom(null);
		expect(v.usb).toEqual({ storage_policy: 'allowed', whitelist: '', audit_log: true });
		expect(v.monitors.brightness).toBe(100);
		expect(v.quotas).toMatchObject({ cpu_limit: 100, ram_limit: 100, bandwidth_limit: 0, disk_quota: 0 });
	});

	test('saved rules are shown and saved back in the same shape', () => {
		const saved = {
			usb: { storage_policy: 'whitelist', whitelist: ['0781:5583', '046d:c52b'], audit_log: false },
			disks: { readonly: true, hidden_partitions: ['D:', '/mnt/x'] },
			quotas: { cpu_limit: 50, process_whitelist: ['chrome.exe'] }
		};
		const v = rcValuesFrom(saved);
		expect(v.usb.whitelist).toBe('0781:5583\n046d:c52b');
		expect(rcBody('usb', v)).toEqual(saved.usb);
		expect(rcBody('disks', v)).toEqual({
			readonly: true,
			encryption_required: false,
			smart_monitoring: false,
			hidden_partitions: ['D:', '/mnt/x']
		});
		expect(rcBody('quotas', v)).toEqual({
			cpu_limit: 50,
			ram_limit: 100,
			bandwidth_limit: 0,
			disk_quota: 0,
			process_whitelist: ['chrome.exe']
		});
	});

	test('numbers: empty or negative fall back, fractions are cut', () => {
		const v = rcValuesFrom(null);
		v.monitors.max_count = null;
		v.quotas.bandwidth_limit = -3;
		v.quotas.disk_quota = 2.7;
		expect(rcBody('monitors', v).max_count).toBe(0);
		expect(rcBody('quotas', v)).toMatchObject({ bandwidth_limit: 0, disk_quota: 2 });
	});

	test('only changed kinds of rules are saved', () => {
		const loaded = rcValuesFrom(null);
		const v = rcValuesFrom(null);
		v.optical.policy = 'blocked';
		v.quotas.cpu_limit = 80;
		expect(changedCategories(v, loaded)).toEqual(['optical', 'quotas']);
	});

	const dev = (over: Partial<RcDevice> = {}): RcDevice => ({
		id: '900100001',
		hostname: 'demo-reception-01',
		platform: 'Windows 11 Pro',
		status: 'OFFLINE',
		device_type: 'rustdesk',
		resources: null,
		...over
	});

	test('online from the flag or the status word; search by ID, name or platform', () => {
		expect(isOnline(dev({ status: 'ONLINE' }))).toBe(true);
		expect(isOnline(dev({ online: true }))).toBe(true);
		expect(isOnline(dev())).toBe(false);
		const list = [dev(), dev({ id: '2', hostname: 'mac', platform: 'macOS 15' })];
		expect(filterRcDevices(list, 'MACOS').map((d) => d.id)).toEqual(['2']);
		expect(filterRcDevices(list, '9001').map((d) => d.id)).toEqual(['900100001']);
	});

	test('the rules column says what a device reports, or nothing', () => {
		const t = (k: string) => k.split('.').pop() ?? k;
		expect(rulesSummary(null, t)).toBeNull();
		expect(rulesSummary({ usb: 'na' }, t)).toBeNull();
		expect(rulesSummary({ usb: 'compliant', disks: 'broken' }, t)).toBe(
			'cat_usb: rule_state_compliant, cat_disks: rule_state_noncompliant'
		);
	});

	test('the summary reads both category shapes and both spellings of non-compliant', () => {
		const a = complianceView({
			total_devices: 4,
			compliant: 1,
			noncompliant: 2,
			no_policy: 1,
			categories: { usb: { enforced: 3, total: 4 } }
		});
		expect(a).toMatchObject({ total: 4, compliant: 1, nonCompliant: 2, none: 1 });
		expect(a.rows[0]).toEqual({ key: 'usb', enforced: 3, total: 4, pct: null });
		expect(a.rows).toHaveLength(5);
		const b = complianceView({
			total_devices: 1,
			compliant: 1,
			non_compliant: 0,
			no_policy: 0,
			categories: [{ key: 'usb', pct: 50 }]
		});
		expect(b.rows).toEqual([{ key: 'usb', enforced: 0, total: 0, pct: 50 }]);
	});
});

describe('device identity', () => {
	const rec = (status: string, id = status): AttestationRecord => ({
		device_id: id,
		hostname: '',
		fingerprint: 'fp',
		device_fingerprint: '',
		status,
		last_check: ''
	});

	test('statuses map to groups and tones', () => {
		expect(attStatus('trusted')).toMatchObject({ group: 'verified', tone: 'good' });
		expect(attStatus('mismatch')).toMatchObject({ group: 'failed', tone: 'danger' });
		expect(attStatus('revoked')).toMatchObject({ group: 'failed', tone: 'neutral' });
		expect(attStatus('')).toMatchObject({ group: 'pending', tone: 'waiting' });
	});

	test('problems first, then waiting, then verified; order kept within a group', () => {
		const list = [rec('verified', 'a'), rec('pending', 'b'), rec('mismatch', 'c'), rec('pending', 'd')];
		expect(sortRecords(list).map((r) => r.device_id)).toEqual(['c', 'b', 'd', 'a']);
		expect(countGroups(list)).toEqual({ verified: 1, pending: 2, failed: 1 });
	});

	test('verify and revoke only where they change something', () => {
		expect(canVerify(rec('verified'))).toBe(false);
		expect(canVerify(rec('pending'))).toBe(true);
		expect(canRevoke(rec('revoked'))).toBe(false);
		expect(canRevoke(rec('verified'))).toBe(true);
		expect(canVerify(rec('pending', ''))).toBe(false);
	});
});
