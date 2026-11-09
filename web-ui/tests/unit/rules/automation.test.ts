import { describe, expect, test } from 'vitest';
import type { AlertRule } from '../../../src/lib/api/automation.ts';
import {
	commandTone,
	isAcknowledged,
	labelFor,
	ruleBody,
	ruleValues,
	severityTone,
	tabFrom,
	truncate,
	unitKey,
	urlForTab
} from '../../../src/lib/rules/automation.ts';

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
	id: '7',
	name: 'CPU high',
	description: '',
	enabled: false,
	condition_type: 'cpu_usage',
	condition_op: 'gte',
	condition_value: 90,
	severity: 'critical',
	scope_device_id: null,
	cooldown_secs: 300,
	created_by: 'admin',
	created_at: '',
	...over
});

describe('tabs in the URL', () => {
	test('unknown or missing ?tab= opens the rules', () => {
		expect(tabFrom(null)).toBe('rules');
		expect(tabFrom('nope')).toBe('rules');
		expect(tabFrom('alerts')).toBe('alerts');
		expect(tabFrom('commands')).toBe('commands');
	});

	test('rules drops the parameter, the others set it, other parameters stay', () => {
		const url = new URL('http://x/app/automation?tab=alerts&q=1');
		expect(urlForTab(url, 'rules').search).toBe('?q=1');
		expect(urlForTab(url, 'commands').searchParams.get('tab')).toBe('commands');
		expect(urlForTab(url, 'commands').searchParams.get('q')).toBe('1');
	});
});

describe('rule form', () => {
	test('a new rule starts enabled; an edited one keeps its state (P2)', () => {
		expect(ruleValues(null).enabled).toBe(true);
		expect(ruleValues(rule({ enabled: false })).enabled).toBe(false);
		expect(ruleValues(rule({ enabled: true })).enabled).toBe(true);
	});

	test('the body sends the enabled switch as it is', () => {
		const check = ruleBody({ ...ruleValues(null), name: 'x', condition_value: 80, enabled: false });
		expect(check.ok && check.body.enabled).toBe(false);
	});

	test('name and threshold are required, except the threshold of a custom rule', () => {
		expect(ruleBody({ ...ruleValues(null), name: '  ', condition_value: 1 })).toEqual({
			ok: false,
			field: 'name'
		});
		expect(ruleBody({ ...ruleValues(null), name: 'x', condition_value: null })).toEqual({
			ok: false,
			field: 'condition_value'
		});
		const custom = ruleBody({
			...ruleValues(null),
			name: 'x',
			condition_type: 'custom',
			condition_value: null
		});
		expect(custom.ok && custom.body.condition_value).toBe(0);
	});

	test('an empty device scope means all devices; text is trimmed', () => {
		const check = ruleBody({
			...ruleValues(null),
			name: ' Disk ',
			description: ' d ',
			condition_value: 0,
			scope_device_id: '  '
		});
		expect(check.ok && check.body).toMatchObject({
			name: 'Disk',
			description: 'd',
			condition_value: 0,
			scope_device_id: null
		});
	});
});

describe('display', () => {
	test('severities and command states map to the five tones', () => {
		expect(severityTone('critical')).toBe('danger');
		expect(severityTone('high')).toBe('danger');
		expect(severityTone('warning')).toBe('warning');
		expect(severityTone('info')).toBe('neutral');
		expect(commandTone('failed')).toBe('danger');
		expect(commandTone('completed')).toBe('good');
		expect(commandTone('pending')).toBe('waiting');
		expect(commandTone('cancelled')).toBe('neutral');
	});

	test('the threshold unit follows what the rule watches', () => {
		expect(unitKey('cpu_usage')).toBe('automation.unit_percent');
		expect(unitKey('offline_duration')).toBe('automation.unit_seconds');
		expect(unitKey('custom')).toBeNull();
	});

	test('unknown values show as they are', () => {
		const t = (k: string) => (k === 'automation.op_gt' ? 'Greater than' : k);
		expect(labelFor(t, 'op', 'gt')).toBe('Greater than');
		expect(labelFor(t, 'op', 'between')).toBe('between');
	});

	test('an alert is acknowledged by the flag or the time', () => {
		expect(isAcknowledged({ acknowledged: false, acknowledged_at: '' })).toBe(false);
		expect(isAcknowledged({ acknowledged: true, acknowledged_at: '' })).toBe(true);
		expect(isAcknowledged({ acknowledged: false, acknowledged_at: '2026-11-09 10:00:00' })).toBe(true);
	});

	test('long payloads are cut for the table', () => {
		expect(truncate('a'.repeat(41))).toBe('a'.repeat(40) + '…');
		expect(truncate('short')).toBe('short');
	});
});
