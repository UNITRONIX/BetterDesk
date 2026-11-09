/**
 * BetterDesk Console - Branding CSS & Profiles Tests
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createTestApp } = require('./helpers');

const mockBranding = {
    appName: 'TestDesk',
    colors: { bgPrimary: '#111111', accentBlue: '#3366ff' },
    fontHeading: '',
    fontBody: '',
    bgType: 'none',
    loginBgType: 'inherit',
    customCss: ''
};

jest.mock('../services/database', () => ({
    logAction: jest.fn().mockResolvedValue(undefined),
    getBrandingConfig: jest.fn().mockResolvedValue([]),
    getBrandingConfigRevision: jest.fn().mockResolvedValue('rev-1'),
    saveBrandingConfigBatch: jest.fn().mockResolvedValue(undefined),
    resetBrandingConfig: jest.fn().mockResolvedValue(undefined),
    listBrandingProfiles: jest.fn().mockResolvedValue([
        { id: 1, name: 'Default', description: '', is_active: 1, created_at: '', updated_at: '' }
    ]),
    getBrandingProfile: jest.fn().mockResolvedValue({
        id: 1,
        name: 'Default',
        description: '',
        data: JSON.stringify({ version: '1.0', type: 'betterdesk-theme', branding: mockBranding }),
        is_active: 1
    }),
    createBrandingProfile: jest.fn().mockResolvedValue(2),
    updateBrandingProfile: jest.fn().mockResolvedValue(undefined),
    setActiveBrandingProfile: jest.fn().mockResolvedValue(undefined),
    deleteBrandingProfile: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../middleware/rateLimiter', () => ({
    apiLimiter: (_req, _res, next) => next()
}));

jest.mock('../services/fontService', () => ({
    searchFonts: jest.fn(() => []),
    searchGoogleFonts: jest.fn(() => []),
    listLocalFonts: jest.fn(() => []),
    downloadFont: jest.fn(async () => ({ success: true })),
    deleteLocalFont: jest.fn(() => true),
    registerUploadedFont: jest.fn(async () => ({ family: 'Custom', downloaded: true })),
    generateFontCss: jest.fn(() => ''),
    sanitizeFontName: jest.fn((n) => String(n).toLowerCase().replace(/\s+/g, '-'))
}));

const brandingService = require('../services/brandingService');
const database = require('../services/database');
const config = require('../config/config');
const settingsRoutes = require('../routes/settings.routes');

describe('Branding routes', () => {
    let app;

    beforeAll(async () => {
        brandingService.invalidateCache();
        await brandingService.loadBranding();
    });

    beforeEach(() => {
        app = createTestApp();
        app.use((req, _res, next) => {
            req.session.userId = 1;
            req.session.user = { id: 1, username: 'admin', role: 'admin' };
            next();
        });
        app.use('/', settingsRoutes);
        jest.clearAllMocks();
    });

    describe('GET /css/branding.css', () => {
        it('returns text/css with :root overrides when branding has colors', async () => {
            const css = brandingService.generateThemeCss();
            jest.spyOn(brandingService, 'generateThemeCss').mockReturnValue(css || ':root { --bg-primary: #111111; }\n');

            const res = await request(app).get('/css/branding.css');

            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/css/);
            expect(res.text).toMatch(/:root/);
            expect(res.text).toMatch(/--surface-glass-blur|--bg-primary/);

            brandingService.generateThemeCss.mockRestore();
        });
    });

    describe('GET /api/settings/branding/profiles', () => {
        it('lists profiles for authenticated users', async () => {
            const res = await request(app).get('/api/settings/branding/profiles');
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    describe('POST /api/settings/branding/profiles/:id/duplicate', () => {
        it('returns a new profile id and copies the saved profile data', async () => {
            const res = await request(app)
                .post('/api/settings/branding/profiles/1/duplicate')
                .send({});

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ success: true, data: { id: 2 } });
            expect(database.createBrandingProfile).toHaveBeenCalledWith(
                'Default (copy)',
                '',
                expect.objectContaining({
                    type: 'betterdesk-theme',
                    branding: mockBranding
                })
            );
        });

        it('suffixes the duplicate name when the default copy already exists', async () => {
            database.listBrandingProfiles.mockResolvedValueOnce([
                { id: 1, name: 'Default', is_active: 1 },
                { id: 2, name: 'Default (copy)', is_active: 0 }
            ]);

            const res = await request(app)
                .post('/api/settings/branding/profiles/1/duplicate')
                .send({});

            expect(res.status).toBe(200);
            expect(database.createBrandingProfile).toHaveBeenCalledWith(
                'Default (copy) 2',
                '',
                expect.any(Object)
            );
        });
    });

    describe('GET /api/settings/appearance', () => {
        it('returns the versioned appearance model with readability status', async () => {
            const res = await request(app).get('/api/settings/appearance');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.type).toBe('betterdesk-appearance');
            expect(res.body.data.version).toBe('2.0');
            expect(res.body.data.identity.appName).toBeTruthy();
            expect(res.body.readability).toHaveProperty('ok');
        });
    });

    describe('GET /api/settings/themes', () => {
        it('returns distinct display names for built-in presets', async () => {
            const res = await request(app).get('/api/settings/themes');

            expect(res.status).toBe(200);
            expect(res.body.data.map(theme => theme.name)).toEqual(expect.arrayContaining([
                'BetterDesk Dark',
                'BetterDesk Light',
                'insolve Core Server'
            ]));
        });
    });

    describe('POST /api/settings/branding/upload-background', () => {
        it('lists uploaded managed background images', async () => {
            const uploadsDir = path.join(config.dataDir, 'uploads');
            fs.mkdirSync(uploadsDir, { recursive: true });
            const fileName = 'bg-0123456789abcdef.png';
            const filePath = path.join(uploadsDir, fileName);
            fs.writeFileSync(filePath, Buffer.from('managed-background'));

            try {
                const res = await request(app).get('/api/settings/branding/backgrounds');

                expect(res.status).toBe(200);
                expect(res.body.success).toBe(true);
                expect(res.body.data).toEqual(expect.arrayContaining([
                    expect.objectContaining({
                        name: fileName,
                        url: `/uploads/${fileName}`
                    })
                ]));
            } finally {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            }
        });

        it('accepts a multipart background image upload', async () => {
            const res = await request(app)
                .post('/api/settings/branding/upload-background')
                .attach('background', Buffer.from('not-a-real-png-but-valid-route-test'), {
                    filename: 'wallpaper.png',
                    contentType: 'image/png'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.url).toMatch(/^\/uploads\/bg-[0-9a-f]{16}\.png$/);

            const uploaded = path.join(config.dataDir, 'uploads', path.basename(res.body.url));
            if (fs.existsSync(uploaded)) fs.unlinkSync(uploaded);
        });

        it('applies uploaded console background atomically when target is provided', async () => {
            const res = await request(app)
                .post('/api/settings/branding/upload-background')
                .field('target', 'bgImageUrl')
                .attach('background', Buffer.from('new-wallpaper-content'), {
                    filename: 'new-wallpaper.png',
                    contentType: 'image/png'
                });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.applied).toBe(true);
            expect(database.saveBrandingConfigBatch).toHaveBeenCalledWith(expect.arrayContaining([
                expect.objectContaining({ key: 'bgImageUrl', value: res.body.url }),
                expect.objectContaining({ key: 'bgType', value: 'image' })
            ]));

            const uploaded = path.join(config.dataDir, 'uploads', path.basename(res.body.url));
            if (fs.existsSync(uploaded)) fs.unlinkSync(uploaded);
        });
    });
});

describe('brandingService.generateThemeCss', () => {
    it('returns a CSS string', () => {
        const css = brandingService.generateThemeCss();
        expect(typeof css).toBe('string');
    });

    it('includes glass surface CSS variables by default', () => {
        const css = brandingService.generateThemeCss();
        expect(css).toMatch(/--surface-glass-blur/);
        expect(css).toMatch(/--surface-glass-bg-secondary/);
        expect(css).toMatch(/--sidebar-glass-bg-rail/);
        expect(css).toMatch(/--sidebar-glass-bg-flyout/);
    });

    it('includes semantic appearance aliases for rebuilt UI components', () => {
        const css = brandingService.generateThemeCss();
        expect(css).toMatch(/--color-primary: var\(--accent-blue\)/);
        expect(css).toMatch(/--color-surface: var\(--bg-secondary\)/);
        expect(css).toMatch(/--focus-ring-color: var\(--accent-blue-muted\)/);
    });

    it('places console wallpaper behind the whole app shell', async () => {
        database.getBrandingConfig.mockResolvedValueOnce([
            { key: 'bgType', value: 'image' },
            { key: 'bgImageUrl', value: '/uploads/bg-test.jpg' },
            { key: 'bgOverlay', value: '20' },
            { key: 'bgSize', value: 'cover' }
        ]);
        brandingService.invalidateCache();
        await brandingService.loadBranding();

        try {
            const css = brandingService.generateThemeCss();
            expect(css).toMatch(/body\.app-page::before/);
            expect(css).toMatch(/background: url\("\/uploads\/bg-test\.jpg"\)/);
            expect(css).toMatch(/z-index: 0/);
            expect(css).toMatch(/body\.app-page \.app-layout/);
            expect(css).toMatch(/body\.app-page \.ux35-shell/);
            expect(css).toMatch(/body\.app-page \.main-content,\s*\nbody\.app-page \.ux35-content \{ background: transparent; \}/);
        } finally {
            database.getBrandingConfig.mockResolvedValue([]);
            brandingService.invalidateCache();
            await brandingService.loadBranding();
        }
    });

    it('exposes a safe public appearance contract for RdClient', () => {
        const appearance = brandingService.getPublicAppearance();
        expect(appearance.product).toBe('betterdesk-appearance');
        expect(appearance.version).toBe('2.0');
        expect(appearance.palette.primary).toBeTruthy();
        expect(appearance.background).toHaveProperty('type');
        expect(appearance).not.toHaveProperty('customCss');
    });

    it('reports readability problems for low-contrast palettes', () => {
        const readability = brandingService.assessAppearanceReadability({
            ...brandingService.DEFAULT_BRANDING,
            colors: {
                ...brandingService.DEFAULT_BRANDING.colors,
                bgPrimary: '#000000',
                bgSecondary: '#000000',
                textPrimary: '#111111'
            }
        });
        expect(readability.ok).toBe(false);
        expect(readability.issues.some(issue => issue.id === 'page-text')).toBe(true);
    });

});

describe('BetterDesk favicon and logo', () => {
    const faviconFile = fs.readFileSync(path.join(__dirname, '..', 'public', 'favicon.svg'), 'utf8');

    async function loadWith(rows) {
        database.getBrandingConfig.mockResolvedValueOnce(rows);
        brandingService.invalidateCache();
        await brandingService.loadBranding();
    }

    afterEach(async () => {
        database.getBrandingConfig.mockResolvedValue([]);
        brandingService.invalidateCache();
        await brandingService.loadBranding();
    });

    it('default favicon is the BetterDesk mark from public/favicon.svg, whatever the palette', async () => {
        await loadWith([
            { key: 'colors', value: JSON.stringify({ accentBlue: '#123456', bgPrimary: '"/><script>alert(1)</script>' }) }
        ]);
        const svg = brandingService.generateFavicon();
        expect(svg).toBe(faviconFile);
        // The mark alone, cropped to its shapes (no tile), in both colour sets
        expect(svg).toContain('viewBox="9.5 9.5 45 45"');
        expect(svg).not.toContain('#141616');
        expect(svg).toContain('.s{fill:#1f6feb}.c{fill:#4d8f06}.o{fill:#0f9e96}');
        expect(svg).toContain('@media (prefers-color-scheme: dark){.s{fill:#58a6ff}.c{fill:#a3e635}.o{fill:#3fd0c4}}');
        expect(svg).toContain('clip-path="url(#bdf)"');
        expect(svg).not.toMatch(/<text|#123456|<script/);
    });

    it('a custom favicon from the branding settings wins over the mark', async () => {
        const custom = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#ff0000"/></svg>';
        await loadWith([{ key: 'faviconSvg', value: custom }]);
        expect(brandingService.generateFavicon()).toBe(custom);
    });

    it('serves the favicon as SVG on /branding/favicon.svg', async () => {
        const app = createTestApp();
        app.use('/', settingsRoutes);
        const res = await request(app).get('/branding/favicon.svg');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
        expect(Buffer.from(res.body).toString('utf8')).toBe(faviconFile);
    });

    it('strips scripts and event handlers from a saved favicon', async () => {
        await brandingService.saveBranding({
            faviconSvg: '<svg onload="alert(1)"><script>alert(1)</script><rect width="4" height="4"/></svg>'
        });
        const entries = database.saveBrandingConfigBatch.mock.calls.at(-1)[0];
        const saved = entries.find((e) => e.key === 'faviconSvg').value;
        expect(saved).not.toMatch(/script|onload/i);
        expect(saved).toContain('<rect');
    });

    it('defaults and "reset to defaults" land on the BetterDesk logo', async () => {
        expect(brandingService.DEFAULT_BRANDING.logoType).toBe('default');
        await brandingService.resetBranding();
        expect(brandingService.getBranding().logoType).toBe('default');
        for (const preset of ['default', 'light']) {
            const theme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', `${preset}.json`), 'utf8'));
            expect(theme.branding.logoType).toBe('default');
        }
        const insolve = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'themes', 'insolve.json'), 'utf8'));
        expect(insolve.branding.logoType).toBe('text');
    });

    it.each([
        ['the Material icon "dns"', [{ key: 'logoType', value: 'icon' }, { key: 'logoIcon', value: 'dns' }]],
        ['the old logo image', [{ key: 'logoType', value: 'image' }, { key: 'logoUrl', value: '/img/betterdesk_icon.png' }]],
        ['an image type without an image', [{ key: 'logoType', value: 'image' }, { key: 'logoUrl', value: '' }]]
    ])('treats %s, the old default, as the BetterDesk logo', async (_label, rows) => {
        await loadWith(rows);
        expect(brandingService.getBranding().logoType).toBe('default');
    });

    it.each([
        ['text', [{ key: 'logoType', value: 'text' }, { key: 'logoText', value: 'Acme' }]],
        ['icon', [{ key: 'logoType', value: 'icon' }, { key: 'logoIcon', value: 'cloud' }]],
        ['image', [{ key: 'logoType', value: 'image' }, { key: 'logoUrl', value: '/uploads/logo-abc.png' }]],
        ['svg', [{ key: 'logoType', value: 'svg' }, { key: 'logoSvg', value: '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>' }]]
    ])('keeps an own %s logo', async (type, rows) => {
        await loadWith(rows);
        expect(brandingService.getBranding().logoType).toBe(type);
    });
});
