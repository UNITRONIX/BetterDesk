import { describe, expect, test, vi } from 'vitest';

// A build for another base: link() puts it in front of every page
vi.mock('$app/paths', () => ({ resolve: (p: string) => '/console' + (p || '/') }));

const { link, appPath } = await import('../../src/lib/nav.ts');

describe('link', () => {
	test('pages get the base, query and hash kept', () => {
		expect(link('/devices')).toBe('/console/devices');
		expect(link('/devices?open=900100001')).toBe('/console/devices?open=900100001');
		expect(link('/settings?tab=auth#account-password')).toBe('/console/settings?tab=auth#account-password');
		expect(link('/')).toBe('/console');
		expect(link('/?activateAgent=1')).toBe('/console?activateAgent=1');
		expect(link('/organizations/7')).toBe('/console/organizations/7');
	});
	test('external and protocol-relative links pass through', () => {
		expect(link('https://example.com/x')).toBe('https://example.com/x');
		expect(link('//evil.example/devices')).toBe('//evil.example/devices');
		expect(link('#section')).toBe('#section');
	});
	test('appPath strips the base', () => {
		expect(appPath('/console/devices')).toBe('/devices');
		expect(appPath('/console')).toBe('/');
		expect(appPath('/consoles')).toBe('/consoles');
	});
});

describe('at the root', () => {
	test('every link and path stays as it is', async () => {
		vi.resetModules();
		vi.doMock('$app/paths', () => ({ resolve: (p: string) => p || '/' }));
		const nav = await import('../../src/lib/nav.ts');
		expect(nav.base).toBe('');
		expect(nav.link('/devices?open=1')).toBe('/devices?open=1');
		expect(nav.link('/')).toBe('/');
		expect(nav.appPath('/devices')).toBe('/devices');
	});
});
