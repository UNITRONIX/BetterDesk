'use strict';

const request = require('supertest');
const { createTestApp, withAuth } = require('./helpers');

const mockDb = {
    getSetting: jest.fn(),
    setSetting: jest.fn().mockResolvedValue(undefined),
    logAction: jest.fn().mockResolvedValue(undefined)
};

const mockAttestation = {
    getLastResult: jest.fn().mockResolvedValue({
        tier: 'bronze',
        maxConnections: 12,
        valid: true,
        testedAt: '2026-09-25T00:00:00.000Z'
    }),
    getBadgeConfig: jest.fn().mockResolvedValue({
        badgeTitle: '',
        tierLabels: {
            bronze: 'Starter',
            iron: '',
            platinum: '',
            titanium: '',
            obsidian: ''
        }
    }),
    saveBadgeConfig: jest.fn().mockResolvedValue({
        badgeTitle: 'Custom title',
        tierLabels: {
            bronze: 'Starter',
            iron: 'Iron',
            platinum: 'Platinum',
            titanium: 'Titanium',
            obsidian: 'Obsidian'
        }
    }),
    resolveBadgePresentation: jest.fn((_config, options) => ({
        brand: options.brandName || 'BetterDesk',
        badgeTitle: 'Custom title',
        tierLabel: 'Starter',
        tierLabels: {
            bronze: 'Starter',
            iron: 'Iron',
            platinum: 'Platinum',
            titanium: 'Titanium',
            obsidian: 'Obsidian'
        }
    })),
    getBadgePresentation: jest.fn().mockResolvedValue({
        brand: 'TestDesk',
        badgeTitle: 'Custom title',
        tierLabel: 'Starter',
        tierLabels: { bronze: 'Starter' }
    }),
    buildPublicSummary: jest.fn((result, presentation) => ({
        tier: result?.tier || null,
        maxConnections: result?.maxConnections || 0,
        valid: result?.valid !== false,
        brand: presentation?.brand,
        badgeTitle: presentation?.badgeTitle,
        tierLabel: presentation?.tierLabel,
        tierLabels: presentation?.tierLabels
    })),
    getStatus: jest.fn(() => ({ running: false, phase: 'idle', progress: null, lastResult: null })),
    requestAbort: jest.fn()
};

jest.mock('../services/database', () => mockDb);
jest.mock('../services/serverAttestation', () => mockAttestation);
jest.mock('../services/brandingService', () => ({
    getBranding: jest.fn(() => ({ appName: 'TestDesk' }))
}));
jest.mock('../middleware/auth', () => ({
    requireAuth: (req, _res, next) => next(),
    requirePermission: () => (_req, _res, next) => next()
}));

const routes = require('../routes/server-attestation.routes');

describe('Server Attestation badge routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns the normalized config and resolved presentation to authorized users', async () => {
        const app = createTestApp();
        withAuth(app);
        app.use('/', routes);

        const res = await request(app).get('/api/server-attestation/badge-config');

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.config.tierLabels.bronze).toBe('Starter');
        expect(res.body.presentation.brand).toBe('TestDesk');
    });

    it('persists submitted labels and records an audit event', async () => {
        const app = createTestApp();
        withAuth(app);
        app.use('/', routes);

        const res = await request(app)
            .put('/api/server-attestation/badge-config')
            .send({
                badgeTitle: 'Custom title',
                tierLabels: { bronze: 'Starter' }
            });

        expect(res.status).toBe(200);
        expect(mockAttestation.saveBadgeConfig).toHaveBeenCalledWith({
            badgeTitle: 'Custom title',
            tierLabels: { bronze: 'Starter' }
        });
        expect(mockDb.logAction).toHaveBeenCalledWith(
            1,
            'server_attestation_badge_updated',
            expect.any(String),
            expect.any(String)
        );
        expect(res.body.presentation.brand).toBe('TestDesk');
    });

    it('keeps the public API limited to display fields', async () => {
        const app = createTestApp();
        app.use('/', routes);

        const res = await request(app).get('/api/public/server-attestation');

        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({
            tier: 'bronze',
            brand: 'TestDesk',
            tierLabel: 'Starter'
        }));
        expect(res.body).not.toHaveProperty('rampSteps');
        expect(res.body).not.toHaveProperty('baseline');
        expect(mockAttestation.getBadgePresentation).toHaveBeenCalled();
    });
});
