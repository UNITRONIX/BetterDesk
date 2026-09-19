'use strict';

const {
    buildWindowsSupportInstallerScript,
} = require('../services/windowsSupportInstaller');

describe('Support Agent installers', () => {
    test('Windows installer honors disabled service and autostart profile', () => {
        const script = buildWindowsSupportInstallerScript({
            installService: false,
            autostart: false,
        });
        expect(script).toContain('$profileInstallsService = $false');
        expect(script).toContain('$profileAutostarts = $false');
        expect(script).toContain('installed without service or autostart');
    });

    test('Windows installer enables the requested service profile', () => {
        const script = buildWindowsSupportInstallerScript({
            installService: true,
            autostart: true,
        });
        expect(script).toContain('$profileInstallsService = $true');
        expect(script).toContain('$profileAutostarts = $true');
        expect(script).toContain('--install-service');
    });
});
