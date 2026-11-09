import * as v from 'valibot';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DbStats, ResolveResult } from '../../../src/lib/api/toolkit.ts';
import {
	certTone,
	containerRunning,
	diskPercent,
	dnsRows,
	groupFromHash,
	inRange,
	strength,
	urlWithGroup,
	validPort,
	visibleGroups,
	visibleTools,
	withScheme
} from '../../../src/lib/support/toolkit.ts';

const grants =
	(...p: string[]) =>
	(perm: string) =>
		p.includes(perm);

describe('tools per role', () => {
	test('a viewer (metrics.view, no device.connect) keeps SSL, DNS records, crypto, encoding and the server group', () => {
		const tools = visibleTools(grants('metrics.view')).map((t) => t.id);
		expect(tools).not.toContain('ping');
		expect(tools).not.toContain('wol');
		expect(tools).toEqual(
			expect.arrayContaining(['ssl', 'whois', 'speed', 'hash', 'base64', 'processes', 'logs'])
		);
		expect(visibleGroups(visibleTools(grants('metrics.view')))).toEqual([
			'network',
			'crypto',
			'encoding',
			'system'
		]);
	});

	test('without metrics.view the server group goes', () => {
		const tools = visibleTools(grants('device.connect'));
		expect(visibleGroups(tools)).toEqual(['network', 'crypto', 'encoding']);
		expect(tools.map((t) => t.id)).toContain('ping');
		expect(tools.map((t) => t.id)).not.toContain('speed');
	});

	test('the hash picks a shown group, else the first', () => {
		expect(groupFromHash('#crypto', ['network', 'crypto'])).toBe('crypto');
		expect(groupFromHash('#system', ['network', 'crypto'])).toBe('network');
		expect(groupFromHash('', [])).toBeNull();
		expect(urlWithGroup('http://x/app/toolkit?a=1', 'encoding').toString()).toBe(
			'http://x/app/toolkit?a=1#encoding'
		);
	});
});

describe('input checks', () => {
	test('ports and ranges', () => {
		expect([
			validPort(443),
			validPort('22'),
			validPort(0),
			validPort(65536),
			validPort('1.5'),
			validPort('')
		]).toEqual([true, true, false, false, false, false]);
		expect([inRange(4, 4, 128), inRange(129, 4, 128), inRange('50', 10, 200)]).toEqual([true, false, true]);
	});

	test('a bare host gets https://', () => {
		expect(withScheme('example.com')).toBe('https://example.com');
		expect(withScheme(' http://a.b ')).toBe('http://a.b');
		expect(withScheme('HTTPS://A')).toBe('HTTPS://A');
	});
});

describe('reading results', () => {
	test('certificate days and password strength', () => {
		expect([certTone(-1), certTone(7), certTone(8), certTone(30), certTone(31)]).toEqual([
			'error',
			'error',
			'warning',
			'warning',
			'ok'
		]);
		expect([strength(128).key, strength(60).key, strength(59).key]).toEqual([
			'very_strong',
			'strong',
			'weak'
		]);
		expect(strength(59).tone).toBe('error');
	});

	test('DNS records in the old order, MX worded', () => {
		const rows = dnsRows(
			{
				dns: {
					MX: [
						{ exchange: 'mx.a', priority: 10 },
						{ exchange: '', priority: 0 }
					],
					A: ['1.2.3.4'],
					TXT: ['v=spf1']
				}
			},
			(h, p) => `${h} (${p})`,
			'none'
		);
		expect(rows).toEqual([
			{ type: 'A', value: '1.2.3.4' },
			{ type: 'MX', value: 'mx.a (10)' },
			{ type: 'MX', value: 'none' },
			{ type: 'TXT', value: 'v=spf1' }
		]);
	});

	test('disks and containers', () => {
		expect(diskPercent(50, 200)).toBe(25);
		expect(diskPercent(5, 0)).toBe(0);
		expect(containerRunning({ state: 'exited', status: 'Up 3 hours' })).toBe(true);
		expect(containerRunning({ state: 'exited', status: 'Exited (0)' })).toBe(false);
	});

	test('resolve and database answers in either shape', () => {
		expect(v.parse(ResolveResult, { host: 'a', ip: '1.1.1.1' })).toEqual({
			host: 'a',
			addresses: ['1.1.1.1']
		});
		expect(v.parse(ResolveResult, { addresses: ['1', '2'] }).addresses).toEqual(['1', '2']);
		expect(v.parse(DbStats, { type: 'SQLite', tables: { peers: '3' }, size: 1024 })).toEqual({
			type: 'SQLite',
			size: '1024',
			last_backup: '',
			tables: [{ name: 'peers', count: 3 }]
		});
	});
});

describe('toolkit API', () => {
	afterEach(() => vi.restoreAllMocks());

	test('a remote failure answered as 200 { success: false } becomes an error with the reason', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('{"success":false,"error":"certificate has expired"}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const tk = await import('../../../src/lib/api/toolkit.ts');
		await expect(tk.ssl('a', 443)).rejects.toThrow('certificate has expired');
	});

	test('a toolkit answer is unwrapped from data', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response('{"success":true,"data":{"algorithm":"sha256","hash":"abc"}}', {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		const tk = await import('../../../src/lib/api/toolkit.ts');
		expect((await tk.hash('x', 'sha256')).hash).toBe('abc');
	});
});
