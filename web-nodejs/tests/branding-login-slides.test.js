'use strict';

const assert = require('assert');
const brandingService = require('../services/brandingService');

describe('login promo slides branding', () => {
    it('exposes default slides with free first and caps at 10', () => {
        const defaults = brandingService.getDefaultLoginSlides();
        assert.strictEqual(defaults[0].slideKey, 'free');
        assert.strictEqual(defaults.length, 4);
        assert.ok(defaults.every((s) => s.imageUrl.startsWith('/img/login-slides/')));

        const many = Array.from({ length: 15 }, (_, i) => ({
            id: `s${i}`,
            imageUrl: `/uploads/bg-${i}.jpg`,
            title: `T${i}`,
            body: `B${i}`,
            overlay: '40'
        }));
        const sanitized = brandingService.sanitizeLoginSlides(many);
        assert.strictEqual(sanitized.length, brandingService.MAX_LOGIN_SLIDES);
        assert.strictEqual(sanitized[0].title, 'T0');
    });

    it('rejects unsafe slide image URLs and normalizes promo mode', () => {
        const sanitized = brandingService.sanitizeLoginSlides([
            { id: 'bad', imageUrl: 'javascript:alert(1)', title: 'x' },
            { id: 'ok', imageUrl: '/uploads/ok.jpg', title: 'Safe', body: 'Hi', overlay: '99' }
        ]);
        assert.strictEqual(sanitized.length, 1);
        assert.strictEqual(sanitized[0].imageUrl, '/uploads/ok.jpg');
        assert.strictEqual(sanitized[0].overlay, '90');

        assert.strictEqual(brandingService.normalizeLoginPromoMode('classic'), 'classic');
        assert.strictEqual(brandingService.normalizeLoginPromoMode('nope'), 'slides');
        assert.strictEqual(
            brandingService.resolveLoginPromoMode(undefined, { loginBgImageUrl: '/uploads/x.jpg' }, false),
            'slides'
        );
        assert.strictEqual(
            brandingService.resolveLoginPromoMode('single', { loginBgType: 'inherit' }, true),
            'single'
        );
    });
});
