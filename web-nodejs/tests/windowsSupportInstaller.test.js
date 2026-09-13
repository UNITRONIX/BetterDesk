'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    buildWindowsSupportInstallerScript,
    hasWindowsSupportInstallers,
    writeWindowsSupportInstallers,
} = require('../services/windowsSupportInstaller');

describe('Windows Support installer bundle', () => {
    test('installs the service and uses the scheduled task only for tray', () => {
        const script = buildWindowsSupportInstallerScript();

        expect(script).toContain('--install-service');
        expect(script).toContain('--uninstall-service');
        expect(script).toContain('Register-ScheduledTask');
        expect(script).toContain("New-ScheduledTaskAction -Execute $app -Argument '--tray'");
        expect(script).not.toContain(" -Argument '--service'");
    });

    test('writes both installer entry points to the artifact root', async () => {
        const stageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'betterdesk-installer-'));
        try {
            await writeWindowsSupportInstallers(stageDir);
            expect(hasWindowsSupportInstallers(stageDir)).toBe(true);
            expect(await fs.promises.readFile(
                path.join(stageDir, 'Install-BetterDesk.ps1'),
                'utf8'
            )).toContain('--install-service');
        } finally {
            await fs.promises.rm(stageDir, { recursive: true, force: true });
        }
    });
});
