'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../config/config', () => ({
    dataDir: 'C:\\betterdesk-worker-test-data',
}));
jest.mock('../services/database', () => ({}));
jest.mock('../services/agentBundleService', () => ({
    PLATFORMS: [
        { platform: 'windows', arch: 'x64', format: 'portable', label: 'Windows x64' },
        { platform: 'linux', arch: 'x64', format: 'portable', label: 'Linux x64' },
    ],
}));
jest.mock('../services/supportGeneratorModule', () => ({
    isReady: () => false,
    templatesExist: () => false,
    templatesDir: () => '',
    resolveTemplateDir: () => null,
}));
jest.mock('../services/clientBuilderService', () => ({
    isReady: () => true,
    getBuildCapabilities: () => ({
        mode: 'local',
        targets: [{ platform: 'linux', arch: 'x64', format: 'portable' }],
    }),
}));
jest.mock('../services/windowsSupportInstaller', () => ({
    hasWindowsSupportInstallers: () => false,
}));
jest.mock('../services/customTxtBuilder', () => ({}));
jest.mock('../services/keyService', () => ({}));
jest.mock('../services/agentBundleConnection', () => ({}));
jest.mock('../services/platformSupportInstaller', () => ({}));

const worker = require('../services/clientTemplateWorker');

describe('clientTemplateWorker embedded artifacts', () => {
    let root;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-worker-artifacts-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('selects the manifest asset when unrelated archives are also present', () => {
        const selected = path.join(root, 'betterdesk-support-linux-x86_64.tar.gz');
        fs.writeFileSync(selected, 'selected');
        fs.writeFileSync(path.join(root, 'unrelated-linux-x86_64.tar.gz'), 'unrelated');

        expect(worker._internals.findManifestArtifact(
            root,
            {
                assets: [{
                    name: 'betterdesk-support-linux-x86_64.tar.gz',
                    platform: 'linux',
                    arch: 'x86_64',
                }],
            },
            'linux',
            'x64',
        )).toBe(selected);
    });

    test('selects a package asset by target and format', () => {
        const selected = path.join(root, 'betterdesk-support-linux-x86_64.deb');
        fs.writeFileSync(selected, 'selected');
        fs.writeFileSync(path.join(root, 'betterdesk-support-linux-x86_64.tar.gz'), 'portable');

        expect(worker._internals.findManifestArtifact(
            root,
            {
                assets: [
                    {
                        name: 'betterdesk-support-linux-x86_64.tar.gz',
                        platform: 'linux',
                        arch: 'x86_64',
                        format: 'portable',
                    },
                    {
                        name: 'betterdesk-support-linux-x86_64.deb',
                        platform: 'linux',
                        arch: 'x86_64',
                        format: 'deb',
                    },
                ],
            },
            'linux',
            'x64',
            'deb',
        )).toBe(selected);
    });

    test('exposes only locally supported target platforms', () => {
        expect(worker.getAvailablePlatforms()).toEqual([
            { platform: 'linux', arch: 'x64', format: 'portable', label: 'Linux x64' },
        ]);
    });

    test('does not copy a local provider failure to every platform row', () => {
        expect(worker._internals.failedPlatformsForError(
            'betterdesk_client_build_failed:1:toolchain error',
            { platform: 'linux', arch: 'x64', format: 'portable' },
        )).toEqual([
            { platform: 'linux', arch: 'x64', format: 'portable' },
        ]);
    });
});
