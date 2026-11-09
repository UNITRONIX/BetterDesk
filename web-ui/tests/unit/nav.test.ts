import { describe, expect, test, vi } from 'vitest';

vi.mock('$app/paths', () => ({ resolve: (p: string) => '/app' + (p || '/') }));

const { link, appPath, isPorted, matchesPorted } = await import('../../src/lib/nav.ts');

describe('link', () => {
	test('ported pages get the base, query and hash kept', () => {
		expect(link('/devices')).toBe('/app/devices');
		expect(link('/devices?open=900100001')).toBe('/app/devices?open=900100001');
		expect(link('/settings?tab=auth#account-password')).toBe('/app/settings?tab=auth#account-password');
		expect(link('/')).toBe('/app');
		expect(link('/?activateAgent=1')).toBe('/app?activateAgent=1');
	});
	test('pages still in the old console, old aliases and API paths keep their URL', () => {
		// Fleet tasks move with the canvas tools; until then it is an old page
		expect(link('/fleet?tab=tasks')).toBe('/fleet?tab=tasks');
		expect(isPorted('/fleet')).toBe(false);
		expect(link('/remote-dashboard')).toBe('/remote-dashboard');
		expect(link('/api/mesh/download.msh')).toBe('/api/mesh/download.msh');
	});
	test('a page with an id in its path is listed as /path/*', () => {
		const list = ['/organizations', '/organizations/*', '/cdap/devices/*'];
		expect(matchesPorted(list, '/organizations')).toBe(true);
		expect(matchesPorted(list, '/organizations/7')).toBe(true);
		expect(matchesPorted(list, '/cdap/devices/plc-1')).toBe(true);
		expect(matchesPorted(list, '/cdap/devices')).toBe(false);
		expect(matchesPorted(list, '/organizationsx')).toBe(false);
		expect(matchesPorted(['/devices'], '/devices/x')).toBe(false);
	});
	test('external and protocol-relative links pass through', () => {
		expect(link('https://example.com/x')).toBe('https://example.com/x');
		expect(link('//evil.example/devices')).toBe('//evil.example/devices');
	});
	test('appPath strips the base', () => {
		expect(appPath('/app/devices')).toBe('/devices');
		expect(appPath('/app')).toBe('/');
		expect(appPath('/application')).toBe('/application');
	});
});
