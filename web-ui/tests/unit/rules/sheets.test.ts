/**
 * The rule sheet (Alerts and automation) and the policy sheet (Data loss
 * prevention): what they show for a choice, what they refuse, and the body
 * they send.
 */
import { cleanup, render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import RuleSheet from '../../../src/routes/(console)/automation/RuleSheet.svelte';
import PolicySheet from '../../../src/routes/(console)/dataguard/PolicySheet.svelte';
import type { AlertRule } from '../../../src/lib/api/automation.ts';
import type { DlpPolicy } from '../../../src/lib/api/dataguard.ts';
import { dismissAll } from '../../../src/lib/ui/toasts.svelte.ts';

interface Call {
	method: string;
	path: string;
	body: unknown;
}
let calls: Call[] = [];

beforeEach(() => {
	calls = [];
	vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
		const url = new URL(input, location.origin);
		const method = init.method ?? 'GET';
		const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
		calls.push({ method, path: url.pathname, body });
		const data = { success: true };
		return {
			ok: true,
			status: 200,
			redirected: false,
			url: url.href,
			headers: new Headers({ 'content-type': 'application/json' }),
			json: async () => data,
			text: async () => JSON.stringify(data)
		} as unknown as Response;
	});
});

afterEach(() => {
	cleanup();
	dismissAll();
	vi.unstubAllGlobals();
});

const writes = () => calls.filter((c) => c.method !== 'GET');

describe('rule sheet', () => {
	test('custom rules hide comparison and threshold and need no threshold', async () => {
		const user = userEvent.setup();
		const onsaved = vi.fn();
		render(RuleSheet, { rule: null, onclose: () => {}, onsaved });
		const threshold = screen.getByLabelText('automation.condition_value');
		expect(threshold).toBeVisible();
		await user.selectOptions(screen.getByLabelText('automation.condition_type'), 'custom');
		expect(threshold).not.toBeVisible();
		await user.type(screen.getByLabelText('automation.rule_name'), 'Manual');
		await user.click(screen.getByRole('button', { name: 'automation.create_rule' }));
		await vi.waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(writes()).toEqual([
			{
				method: 'POST',
				path: '/api/automation/rules',
				body: expect.objectContaining({
					name: 'Manual',
					condition_type: 'custom',
					condition_value: 0,
					enabled: true
				})
			}
		]);
	});

	test('a threshold is required for measured rules; nothing is sent without it', async () => {
		const user = userEvent.setup();
		render(RuleSheet, { rule: null, onclose: () => {}, onsaved: () => {} });
		await user.type(screen.getByLabelText('automation.rule_name'), 'CPU');
		await user.click(screen.getByRole('button', { name: 'automation.create_rule' }));
		expect(screen.getByLabelText('automation.condition_value')).toHaveAttribute('aria-invalid', 'true');
		expect(writes()).toEqual([]);
	});

	test('editing a disabled rule keeps it disabled and sends PATCH', async () => {
		const user = userEvent.setup();
		const rule: AlertRule = {
			id: '7',
			name: 'Offline',
			description: '',
			enabled: false,
			condition_type: 'offline_duration',
			condition_op: 'gte',
			condition_value: 3600,
			severity: 'warning',
			scope_device_id: '900100001',
			cooldown_secs: 300,
			created_by: '',
			created_at: ''
		};
		const onsaved = vi.fn();
		render(RuleSheet, { rule, onclose: () => {}, onsaved });
		expect(screen.getByLabelText('automation.enabled')).not.toBeChecked();
		await user.click(screen.getByRole('button', { name: 'actions.save' }));
		await vi.waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(writes()[0]).toMatchObject({
			method: 'PATCH',
			path: '/api/automation/rules/7',
			body: { enabled: false, condition_value: 3600, scope_device_id: '900100001' }
		});
	});
});

describe('data loss prevention policy sheet', () => {
	const policy: DlpPolicy = {
		id: '32',
		name: 'Spreadsheets',
		description: '',
		policy_type: 'file_type',
		type: '',
		action: 'log',
		scope: '',
		enabled: true,
		rules: [{ key: 'file_ext', value: '.xlsx' }]
	};

	test('advanced options are open when the policy has rules', () => {
		render(PolicySheet, { policy, onclose: () => {}, onsaved: () => {}, ondeleted: () => {} });
		expect(screen.getByLabelText('dataguard.rules')).toBeVisible();
	});

	test('rules that are not a JSON list are refused, the section opens, nothing is sent', async () => {
		const user = userEvent.setup();
		render(PolicySheet, { policy: null, onclose: () => {}, onsaved: () => {}, ondeleted: () => {} });
		await user.type(screen.getByLabelText('dataguard.policy_name'), 'x');
		const details = document.querySelector('details');
		expect(details?.open).toBe(false);
		details!.open = true;
		await user.type(screen.getByLabelText('dataguard.rules'), '{{"a":1}');
		await user.click(screen.getByRole('button', { name: 'dataguard.create_policy' }));
		expect(screen.getByLabelText('dataguard.rules')).toHaveAttribute('aria-invalid', 'true');
		expect(writes()).toEqual([]);
	});

	test('saving sends the chosen action and the parsed rules', async () => {
		const user = userEvent.setup();
		const onsaved = vi.fn();
		render(PolicySheet, { policy, onclose: () => {}, onsaved, ondeleted: () => {} });
		await user.click(screen.getByLabelText(/dataguard\.action_block/));
		await user.click(screen.getByRole('button', { name: 'dataguard.save_policy' }));
		await vi.waitFor(() => expect(onsaved).toHaveBeenCalled());
		expect(writes()[0]).toMatchObject({
			method: 'PATCH',
			path: '/api/dataguard/policies/32',
			body: { action: 'block', rules: [{ key: 'file_ext', value: '.xlsx' }], policy_type: 'file_type' }
		});
	});
});
