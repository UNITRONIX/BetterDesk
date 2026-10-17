'use strict';

const mockDb = {
    getSetting: jest.fn().mockResolvedValue(null),
    setSetting: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../services/database', () => mockDb);
jest.mock('../services/serverManagement', () => ({
    getResourceSnapshot: jest.fn()
}));
jest.mock('../services/betterdeskApi', () => ({
    getServerStats: jest.fn()
}));

const attestation = require('../services/serverAttestation');

describe('Server Attestation badge configuration', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('normalizes custom labels, removes control characters, and clips input', () => {
        const config = attestation.normalizeBadgeConfig({
            badgeTitle: `  Custom\u0000 title ${'x'.repeat(120)}  `,
            tierLabels: {
                bronze: `  Bronze\u0007 ${'y'.repeat(60)}  `,
                iron: '<b>Iron</b>'
            },
            unexpected: 'ignored'
        });

        expect(config.badgeTitle).toHaveLength(attestation.BADGE_TITLE_MAX_LENGTH);
        expect(config.badgeTitle).not.toContain('\u0000');
        expect(config.tierLabels.bronze).toHaveLength(attestation.BADGE_LABEL_MAX_LENGTH);
        expect(config.tierLabels.iron).toBe('<b>Iron</b>');
        expect(config.tierLabels.obsidian).toBe('');
        expect(config).not.toHaveProperty('unexpected');
    });

    it('uses custom labels and translated fallbacks without changing tier ids', () => {
        const presentation = attestation.resolveBadgePresentation({
            badgeTitle: '',
            tierLabels: { bronze: 'Starter', iron: '' }
        }, {
            tier: 'iron',
            brandName: 'Acme Desk',
            translate: (key) => ({
                'server_attestation.tier_iron': 'ŻELAZO',
                'server_attestation.tier_platinum': 'PLATYNA',
                'server_attestation.badge_tooltip': 'Atestacja wydajności'
            }[key] || key)
        });

        expect(presentation.brand).toBe('Acme Desk');
        expect(presentation.tierLabels.bronze).toBe('Starter');
        expect(presentation.tierLabels.iron).toBe('ŻELAZO');
        expect(presentation.tierLabels.platinum).toBe('PLATYNA');
        expect(presentation.tierLabel).toBe('ŻELAZO');
        expect(presentation.badgeTitle).toBe('Atestacja wydajności');
    });

    it('persists the normalized configuration in the existing settings store', async () => {
        const saved = await attestation.saveBadgeConfig({
            badgeTitle: ' Acme Attestation ',
            tierLabels: { bronze: 'Starter' }
        });

        expect(mockDb.setSetting).toHaveBeenCalledWith(
            attestation.BADGE_CONFIG_KEY,
            JSON.stringify({
                badgeTitle: 'Acme Attestation',
                tierLabels: {
                    bronze: 'Starter',
                    iron: '',
                    platinum: '',
                    titanium: '',
                    obsidian: ''
                }
            })
        );
        expect(saved.tierLabels.bronze).toBe('Starter');
        expect((await attestation.getBadgeConfig()).badgeTitle).toBe('Acme Attestation');
    });

    it('publishes only badge display data, never the full benchmark result', () => {
        const summary = attestation.buildPublicSummary({
            tier: 'bronze',
            maxConnections: 12,
            rampSteps: [{ cpu: 99 }],
            baseline: { secret: 'nope' },
            valid: true
        }, {
            brand: 'Acme Desk',
            badgeTitle: 'Acme Attestation',
            tierLabel: 'Starter',
            tierLabels: { bronze: 'Starter' }
        });

        expect(summary).toEqual(expect.objectContaining({
            tier: 'bronze',
            maxConnections: 12,
            brand: 'Acme Desk',
            badgeTitle: 'Acme Attestation',
            tierLabel: 'Starter'
        }));
        expect(summary).not.toHaveProperty('rampSteps');
        expect(summary).not.toHaveProperty('baseline');
    });
});
