'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
const mockGetBuildCapabilities = jest.fn(() => ({
    mode: 'local',
    toolchain: { ready: true, missing: [] },
    targets: [{ platform: 'linux', arch: 'x64', format: 'portable' }],
}));
jest.mock('../services/clientBuilderService', () => ({
    isReady: () => true,
    getBuildCapabilities: () => mockGetBuildCapabilities(),
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
        mockGetBuildCapabilities.mockReturnValue({
            mode: 'local',
            toolchain: { ready: true, missing: [] },
            targets: [{ platform: 'linux', arch: 'x64', format: 'portable' }],
        });
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

    test('reports unavailable catalog targets without exposing them as buildable', () => {
        expect(worker.getPlatformStatus()).toEqual([
            {
                platform: 'windows',
                arch: 'x64',
                format: 'portable',
                label: 'Windows x64',
                available: false,
                reason: 'provider_host_only',
                provider: 'local',
            },
            {
                platform: 'linux',
                arch: 'x64',
                format: 'portable',
                label: 'Linux x64',
                available: true,
                reason: null,
                provider: 'local',
            },
        ]);
    });

    test('exposes the complete catalog for a remote provider', () => {
        mockGetBuildCapabilities.mockReturnValue({
            mode: 'remote',
            toolchain: { ready: true, missing: [] },
            targets: [
                { platform: 'windows', arch: 'x64', format: 'portable' },
                { platform: 'linux', arch: 'x64', format: 'portable' },
            ],
        });
        expect(worker.getAvailablePlatforms()).toHaveLength(2);
        expect(worker.getPlatformStatus().every((platform) => platform.available)).toBe(true);
    });

    test('keeps a remote provider without declared targets non-buildable', () => {
        mockGetBuildCapabilities.mockReturnValue({
            mode: 'remote',
            toolchain: { ready: false, missing: ['provider_targets_missing'] },
            targets: [],
            reason: 'provider_targets_missing',
        });
        expect(worker.getAvailablePlatforms()).toEqual([]);
        expect(worker.getPlatformStatus().every((platform) => (
            platform.available === false
            && platform.reason === 'provider_targets_missing'
        ))).toBe(true);
        expect(worker.validatePlatformSelection()).toMatchObject({
            valid: false,
            error: 'local_builder_no_supported_targets',
        });
    });

    test('keeps an empty local provider non-buildable', () => {
        mockGetBuildCapabilities.mockReturnValue({
            mode: 'local',
            toolchain: { ready: false, missing: ['cargo', 'flutter', 'VCPKG_ROOT'] },
            targets: [],
        });
        expect(worker.getAvailablePlatforms()).toEqual([]);
        expect(worker.getPlatformStatus().every((platform) => (
            platform.available === false
            && platform.reason === 'local_builder_toolchain_missing:cargo,flutter,VCPKG_ROOT'
        ))).toBe(true);
        expect(worker.validatePlatformSelection()).toMatchObject({
            valid: false,
            error: 'local_builder_no_supported_targets',
        });
    });

    test('requires checksummed assets for every requested target', async () => {
        const output = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-worker-manifest-'));
        const artifact = path.join(output, 'support-windows-x86_64.zip');
        fs.writeFileSync(artifact, 'verified artifact');
        const sha256 = crypto.createHash('sha256').update('verified artifact').digest('hex');
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({
            schema_version: 1,
            sku: 'betterdesk-support',
            external_config: false,
            assets: [{
                name: path.basename(artifact),
                platform: 'windows',
                arch: 'x86_64',
                format: 'portable',
                size: fs.statSync(artifact).size,
                sha256,
            }],
        }));
        await expect(worker._internals.validateEmbeddedManifest(
            output,
            {},
            [{ platform: 'windows', arch: 'x64', format: 'portable' }],
        )).resolves.toMatchObject({ sku: 'betterdesk-support' });

        const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));
        delete manifest.assets[0].sha256;
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest));
        await expect(worker._internals.validateEmbeddedManifest(output, {}, [
            { platform: 'windows', arch: 'x64', format: 'portable' },
        ])).rejects.toThrow('embedded_manifest_asset_checksum_missing');
        fs.rmSync(output, { recursive: true, force: true });
    });

    test('rejects an empty or unavailable platform selection', () => {
        expect(worker.validatePlatformSelection([])).toMatchObject({
            valid: false,
            error: 'platforms_required',
        });
        expect(worker.validatePlatformSelection([
            { platform: 'windows', arch: 'x64', format: 'portable' },
        ])).toMatchObject({
            valid: false,
            error: 'unsupported_platform',
            details: ['windows/x64/portable'],
        });
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
