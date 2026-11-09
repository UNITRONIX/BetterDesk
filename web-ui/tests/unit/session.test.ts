import { session, startSession, clearSession } from '#lib/state/session.svelte.ts';

const boot = {
	success: true,
	user: { id: 1, username: 'demo_ui_admin', role: 'admin', preferredLanguage: null, avatarVersion: 'pic-1' },
	permissions: ['device.view'],
	isSuperAdmin: true,
	emergencyMode: false,
	nav: [],
	lang: {
		code: 'en',
		dir: 'ltr',
		stringsUrl: '/api/console/strings/en?v=1',
		available: [{ code: 'en', name: 'English', native: 'English', flag: 'en', rtl: false }]
	},
	branding: {
		appName: 'BetterDesk',
		appDescription: '',
		themeMode: 'system',
		logoType: 'text',
		logoText: 'Acme',
		showPoweredBy: false,
		revision: 1
	},
	palettes: { light: null, dark: null },
	sessionPolicy: null,
	csrfToken: 'token',
	appVersion: '3.0.0'
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

type BootWindow = { __BD_BOOT__?: Record<string, unknown> };

afterEach(() => {
	delete (window as unknown as BootWindow).__BD_BOOT__;
	clearSession();
});

describe('startSession', () => {
	test('uses the requests the boot script started, and asks again on a second start', async () => {
		const fetchMock = vi.fn((url: string) => Promise.resolve(ok(url.includes('strings') ? {} : boot)));
		vi.stubGlobal('fetch', fetchMock);
		(window as unknown as BootWindow).__BD_BOOT__ = {
			lang: 'en',
			dir: 'ltr',
			stringsUrl: '/api/console/strings/en?v=1',
			strings: Promise.resolve(ok({})),
			session: Promise.resolve(ok(boot))
		};

		await startSession();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(session.ready).toBe(true);

		// Try again after a failed start: the early responses are used up
		session.ready = false;
		await startSession();
		expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
			'/api/console/strings/en?v=1',
			'/api/console/bootstrap'
		]);
		expect(session.ready).toBe(true);
		vi.unstubAllGlobals();
	});

	test('the branding details come with the bootstrap, with defaults for missing ones', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((url: string) => Promise.resolve(ok(url.includes('strings') ? {} : boot)))
		);
		await startSession();
		expect(session.raw?.branding).toMatchObject({
			logoType: 'text',
			logoText: 'Acme',
			logoSvg: '',
			footerText: '',
			showPoweredBy: false
		});
		expect(session.user?.avatarVersion).toBe('pic-1');
		vi.unstubAllGlobals();
	});
});
