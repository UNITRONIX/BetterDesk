'use strict';

const {
    ALLOWED_BETTERDESK_SERVICES,
    isAllowedBetterDeskService,
    getMutableFileRoots,
} = require('../services/serverManagement');

describe('server management safety boundaries', () => {
    test('allows only BetterDesk service names', () => {
        expect(isAllowedBetterDeskService('betterdesk-server')).toBe(true);
        expect(isAllowedBetterDeskService('betterdesk-console.service')).toBe(true);
        expect(isAllowedBetterDeskService('sshd')).toBe(false);
        expect(ALLOWED_BETTERDESK_SERVICES.has('docker')).toBe(false);
    });

    test('mutation roots are limited to BetterDesk paths', () => {
        const roots = getMutableFileRoots();
        expect(roots.some((root) => root.includes('rustdesk') || root.includes('BetterDesk'))).toBe(true);
        expect(roots).not.toContain('/var/log');
        expect(roots).not.toContain('/tmp');
    });
});
