import { describe, expect, test } from 'vitest';
import {
	auditSection,
	bodyFor,
	changedSections,
	invalidNumbers,
	isSet,
	setCount,
	valuesFrom
} from '../../../src/lib/rules/policies.ts';

describe('policy values', () => {
	test('a group never saved shows the old page defaults', () => {
		const v = valuesFrom({});
		expect(v.connection).toEqual({
			mode: 'attended',
			max_session_duration: 480,
			idle_lock_timeout: 15,
			wallpaper: 'show'
		});
		expect(v.features).toEqual({
			allow_file_transfer: true,
			allow_clipboard: true,
			allow_audio: false,
			allow_recording: true
		});
		expect(v.security.password_min_length).toBe(12);
		expect(v.security.password_max_age_days).toBe(90);
		expect(v.update).toEqual({ auto_update: true, channel: 'stable' });
	});

	test('a saved 0 stays 0 and saved switches stay off', () => {
		const v = valuesFrom({
			connection: { max_session_duration: 0, idle_lock_timeout: 0 },
			features: { allow_file_transfer: false, allow_audio: true },
			security: { require_2fa: false, password_max_age_days: 0 },
			update: { auto_update: false }
		});
		expect(v.connection.max_session_duration).toBe(0);
		expect(v.connection.idle_lock_timeout).toBe(0);
		expect(v.features.allow_file_transfer).toBe(false);
		expect(v.features.allow_audio).toBe(true);
		expect(v.security.require_2fa).toBe(false);
		expect(v.security.password_max_age_days).toBe(0);
		expect(v.update.auto_update).toBe(false);
	});

	test('lists become one entry per line (relays, IP ranges) or comma separated (operators)', () => {
		const v = valuesFrom({
			security: { allowed_operators: ['admin', 'helpdesk'] },
			network: { allowed_relay_servers: ['r1:21117', 'r2:21117'], ip_allowlist: ['10.0.0.0/8'] }
		});
		expect(v.security.allowed_operators).toBe('admin, helpdesk');
		expect(v.network.allowed_relay_servers).toBe('r1:21117\nr2:21117');
		expect(v.network.ip_allowlist).toBe('10.0.0.0/8');
	});
});

describe('saving', () => {
	test('only groups that differ from what was loaded are saved', () => {
		const loaded = valuesFrom({});
		const v = valuesFrom({});
		expect(changedSections(v, loaded)).toEqual([]);
		v.security.password_min_length = 16;
		v.update.channel = 'beta';
		expect(changedSections(v, loaded)).toEqual(['security', 'update']);
		// Typing and putting it back is not a change
		v.update.channel = 'stable';
		expect(changedSections(v, loaded)).toEqual(['security']);
	});

	test('the body splits the text fields back into lists, empty lines dropped', () => {
		const v = valuesFrom({});
		v.security.allowed_operators = ' admin ,, helpdesk ';
		v.network.allowed_relay_servers = 'r1:21117\n\n r2:21117 \n';
		v.network.ip_allowlist = '';
		expect(bodyFor('security', v).allowed_operators).toEqual(['admin', 'helpdesk']);
		expect(bodyFor('network', v)).toEqual({
			block_direct_p2p: false,
			allowed_relay_servers: ['r1:21117', 'r2:21117'],
			ip_allowlist: []
		});
		expect(bodyFor('connection', v)).toEqual(v.connection);
	});

	test('whole numbers out of range are refused, only in the groups being saved', () => {
		const v = valuesFrom({});
		v.connection.max_session_duration = 1441;
		v.connection.idle_lock_timeout = 1.5;
		v.security.password_min_length = 5;
		v.security.password_max_age_days = null;
		expect(invalidNumbers(v, ['connection'])).toEqual([
			'connection.max_session_duration',
			'connection.idle_lock_timeout'
		]);
		expect(invalidNumbers(v, ['security'])).toEqual([
			'security.password_min_length',
			'security.password_max_age_days'
		]);
		expect(invalidNumbers(v, ['features', 'update'])).toEqual([]);
		v.connection.max_session_duration = 1440;
		v.connection.idle_lock_timeout = 0;
		expect(invalidNumbers(v, ['connection'])).toEqual([]);
	});
});

describe('group states and the change log', () => {
	test('a group counts as set once it has keys', () => {
		expect(isSet({})).toBe(false);
		expect(isSet(null)).toBe(false);
		expect(isSet({ mode: 'attended' })).toBe(true);
		expect(
			setCount({
				connection: { mode: 'x' },
				features: {},
				security: null,
				network: {},
				update: { channel: 'beta' }
			})
		).toBe(2);
		expect(setCount(null)).toBe(0);
	});

	test('the group of a change comes from its details, then the older fields', () => {
		const base = {
			timestamp: '',
			created_at: '',
			action: '',
			actor: '',
			user: '',
			target: '',
			section: '',
			category: '',
			detail: '',
			description: ''
		};
		expect(auditSection({ ...base, details: { category: 'network' } })).toBe('network');
		expect(auditSection({ ...base, details: null, section: 'update' })).toBe('update');
		expect(auditSection({ ...base, details: null })).toBe('');
	});
});
