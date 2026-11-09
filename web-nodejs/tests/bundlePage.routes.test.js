/**
 * GET /api/d/:publicId/page: what the new agent download page (/d/<id>)
 * shows, the same values the old server-rendered page put into its HTML.
 * Public like the page: the bundle id is the access token; unknown and
 * revoked bundles answer 404. Contact links are only mailto/tel/http(s),
 * the button colour only a readable hex colour.
 */

const request = require('supertest');
const { createTestApp } = require('./helpers');

const BUNDLE = {
    bundle_id: 'b-1',
    slug: 'acme',
    name: 'Acme agent',
    product_type: 'support-agent',
    branding_hash: 'h1',
    revoked: 0,
    branding: JSON.stringify({
        company_name: 'Acme <b>Support</b>',
        short_text: 'Install this, we call you.',
        logo_data_url: 'data:image/png;base64,iVBORw0KGgo=',
        contact_email: 'help@acme.example',
        contact_phone: '+49 30 123',
        contact_url: 'javascript:alert(1)',
        primary_color: '#1d4ed8',
        enrollment_token: 'secret-token-never-public',
        product_label: '',
        hide_product_type: false,
        default_lang: 'de'
    })
};

jest.mock('../services/database', () => ({
    getAgentBundleByPublicId: jest.fn(),
    listAgentBundleBuildsForHash: jest.fn().mockResolvedValue([
        { platform: 'windows', arch: 'x64', format: 'portable', status: 'ready' },
        { platform: 'linux', arch: 'x64', format: 'portable', status: 'failed' }
    ])
}));

jest.mock('../services/clientTemplateWorker', () => ({
    getAvailablePlatforms: jest.fn(() => [
        { platform: 'windows', arch: 'x64', format: 'portable', label: 'Windows x64 (portable)' },
        { platform: 'linux', arch: 'x64', format: 'portable', label: 'Linux x64 (portable)' },
        { platform: 'macos', arch: 'universal', format: 'dmg', label: 'macOS (DMG)' }
    ]),
    getPlatformStatus: jest.fn(() => []),
    getBuildWorkerStatus: jest.fn(() => ({}))
}));

const db = require('../services/database');
const brandingService = require('../services/brandingService');
const generatorRoutes = require('../routes/generator.routes');

function app() {
    const a = createTestApp();
    a.use('/', generatorRoutes);
    return a;
}

describe('GET /api/d/:publicId/page', () => {
    beforeEach(() => {
        db.getAgentBundleByPublicId.mockReset();
    });

    test('answers the page values for a live bundle', async () => {
        db.getAgentBundleByPublicId.mockResolvedValue(BUNDLE);
        const res = await request(app()).get('/api/d/acme/page');
        expect(res.status).toBe(200);
        const d = res.body.data;
        expect(d.publicId).toBe('acme');
        expect(d.companyName).toBe('Acme <b>Support</b>');
        expect(d.shortText).toBe('Install this, we call you.');
        expect(d.logo).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(d.contact).toEqual({ email: 'help@acme.example', phone: '+49 30 123', url: '' });
        expect(d.accent).toBe('#1d4ed8');
        expect(d.product).toEqual({ type: 'betterdesk-support', label: '', hidden: false });
        expect(d.defaultLang).toBe('de');
        expect(d.platforms.map((p) => [p.platform, p.status])).toEqual([
            ['windows', 'ready'], ['linux', 'failed'], ['macos', 'pending']
        ]);
        expect(JSON.stringify(res.body)).not.toContain('secret-token-never-public');
    });

    test('a light primary colour is not used for white button text', async () => {
        db.getAgentBundleByPublicId.mockResolvedValue({
            ...BUNDLE,
            branding: JSON.stringify({ ...JSON.parse(BUNDLE.branding), primary_color: '#ffee00', contact_url: 'https://acme.example/help' })
        });
        const res = await request(app()).get('/api/d/acme/page');
        expect(res.body.data.accent).toBe('');
        expect(res.body.data.contact.url).toBe('https://acme.example/help');
    });

    test('the agent page background from Settings › Appearance comes along', async () => {
        db.getAgentBundleByPublicId.mockResolvedValue(BUNDLE);
        const spy = jest.spyOn(brandingService, 'getBranding').mockReturnValue({
            ...brandingService.getBranding(),
            agentBgType: 'color',
            agentBgColor: '#102030',
            agentShowPoweredBy: 'false'
        });
        const res = await request(app()).get('/api/d/acme/page');
        spy.mockRestore();
        expect(res.body.data.background).toBe('#102030');
        expect(res.body.data.showPoweredBy).toBe(false);
    });

    test('unknown and revoked bundles answer 404', async () => {
        db.getAgentBundleByPublicId.mockResolvedValue(null);
        expect((await request(app()).get('/api/d/nope/page')).status).toBe(404);
        db.getAgentBundleByPublicId.mockResolvedValue({ ...BUNDLE, revoked: 1 });
        expect((await request(app()).get('/api/d/acme/page')).status).toBe(404);
    });
});
