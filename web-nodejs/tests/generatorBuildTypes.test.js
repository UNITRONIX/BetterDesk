'use strict';

const {
    PRODUCT_TYPES,
    normalizeProductType,
    isBetterDeskSupportBundle,
    isQueuedBuildStatus,
    normalizeBuildStatus,
} = require('../lib/generatorBuildTypes');

describe('generator build type compatibility', () => {
    test('normalizes legacy product type aliases to betterdesk-support', () => {
        expect(normalizeProductType()).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('agent')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('support_agent')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('support-agent')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('agent_client')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('rdclient')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('betterdesk-support')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
        expect(normalizeProductType('unknown')).toBe(PRODUCT_TYPES.BETTERDESK_SUPPORT);
    });

    test('detects BetterDesk Support v2 bundles vs leftover generator rows', () => {
        expect(isBetterDeskSupportBundle({ branding: { sku: 'betterdesk-support' } })).toBe(true);
        expect(isBetterDeskSupportBundle({ branding: { generator_kind: 'betterdesk-support' } })).toBe(true);
        expect(isBetterDeskSupportBundle({ branding: { generator_version: 2 } })).toBe(true);
        expect(isBetterDeskSupportBundle({ branding: { generator_version: '2' } })).toBe(true);
        expect(isBetterDeskSupportBundle({ branding: '{"sku":"betterdesk-support"}' })).toBe(true);
        expect(isBetterDeskSupportBundle({ branding: {} })).toBe(false);
        expect(isBetterDeskSupportBundle({ branding: { app_name: 'Old Support Agent' } })).toBe(false);
        expect(isBetterDeskSupportBundle({ branding: '{}' })).toBe(false);
        expect(isBetterDeskSupportBundle({ product_type: 'betterdesk-support' })).toBe(false);
        expect(isBetterDeskSupportBundle(null)).toBe(false);
    });

    test('treats queued and legacy pending jobs as the same queue state', () => {
        expect(isQueuedBuildStatus('queued')).toBe(true);
        expect(isQueuedBuildStatus('PENDING')).toBe(true);
        expect(isQueuedBuildStatus('building')).toBe(false);
        expect(normalizeBuildStatus('pending')).toBe('queued');
        expect(normalizeBuildStatus('ready')).toBe('ready');
    });
});
