'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

function loadUpdateService({ dataDir, gotoToolchain } = {}) {
    jest.resetModules();
    if (gotoToolchain !== undefined) {
        process.env.BETTERDESK_GOTOOLCHAIN = gotoToolchain;
    } else {
        delete process.env.BETTERDESK_GOTOOLCHAIN;
    }

    jest.doMock('../config/config', () => ({
        isDocker: false,
        dataDir,
        appVersion: '3.0.0-test',
    }));

    // eslint-disable-next-line global-require
    return require('../services/updateService');
}

describe('updateService spawnPromise / Go env / install status (#464)', () => {
    let tmpRoot;
    let dataDir;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-update-464-'));
        dataDir = path.join(tmpRoot, 'data');
        fs.mkdirSync(dataDir, { recursive: true });
        delete process.env.BETTERDESK_GOTOOLCHAIN;
    });

    afterEach(() => {
        jest.resetModules();
        jest.dontMock('../config/config');
        delete process.env.BETTERDESK_GOTOOLCHAIN;
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('buildEnvWithGo sets GOTOOLCHAIN=local by default', () => {
        const updateService = loadUpdateService({ dataDir });
        const env = updateService.buildEnvWithGo('go');
        expect(env.GOTOOLCHAIN).toBe('local');
        expect(env.CGO_ENABLED).toBe('0');
    });

    it('buildEnvWithGo honors BETTERDESK_GOTOOLCHAIN override', () => {
        const updateService = loadUpdateService({ dataDir, gotoToolchain: 'auto' });
        const env = updateService.buildEnvWithGo('go');
        expect(env.GOTOOLCHAIN).toBe('auto');
    });

    it('spawnPromise rejects with timedOut after opts.timeout', async () => {
        const updateService = loadUpdateService({ dataDir });
        const node = process.execPath;
        await expect(
            updateService.spawnPromise(node, ['-e', 'setInterval(()=>{}, 1000)'], { timeout: 200 })
        ).rejects.toMatchObject({
            timedOut: true,
            message: expect.stringMatching(/timed out after 200ms/),
        });
    }, 10000);

    it('spawnPromise times out with killSignal escalation', async () => {
        const updateService = loadUpdateService({ dataDir });
        const node = process.execPath;
        await expect(
            updateService.spawnPromise(
                node,
                ['-e', 'setInterval(()=>{}, 1000)'],
                { timeout: 150, killSignal: 'SIGKILL' }
            )
        ).rejects.toThrow(/timed out after 150ms/);
    }, 10000);

    it('getUpdateInstallStatus reports idle and clears orphan markers', () => {
        const updateService = loadUpdateService({ dataDir });
        const marker = path.join(dataDir, '.update_in_progress.json');
        fs.writeFileSync(marker, JSON.stringify({ startedAt: new Date().toISOString(), sha: 'abc' }));
        const status = updateService.getUpdateInstallStatus();
        expect(status.inProgress).toBe(false);
        expect(status.marker).toBeNull();
        expect(fs.existsSync(marker)).toBe(false);
        expect(updateService.isUpdateInProgress()).toBe(false);
    });
});
