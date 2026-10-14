'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('clientBuilderService', () => {
    let dataDir;
    let builder;

    beforeEach(() => {
        jest.resetModules();
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-client-builder-'));
        jest.doMock('../config/config', () => ({ dataDir }));
        builder = require('../services/clientBuilderService');
    });

    afterEach(() => {
        jest.dontMock('../config/config');
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    test('creates stable, distinct generation keys', () => {
        const fingerprint = 'a'.repeat(64);
        const first = builder.generationKey(fingerprint, '1'.repeat(40));
        const same = builder.generationKey(fingerprint, '1'.repeat(40));
        const changed = builder.generationKey(fingerprint, '2'.repeat(40));

        expect(first).toMatch(/^[a-f0-9]{64}$/);
        expect(same).toBe(first);
        expect(changed).not.toBe(first);
    });

    test('rejects unsafe repository and ref values', () => {
        expect(() => builder.normalizeRepo('https://github.com/example/repo')).toThrow(
            'betterdesk_client_repo_invalid'
        );
        expect(() => builder.normalizeRepo('example/repo/extra')).toThrow(
            'betterdesk_client_repo_invalid'
        );
        expect(() => builder.clientRef('master\r\nTOKEN=leak')).toThrow(
            'betterdesk_client_ref_invalid'
        );
    });

    test('writes state atomically outside the project checkout', async () => {
        const state = await builder.writeState({
            repo: 'UNITRONIX/BetterDesk-Client',
            ref: 'master',
            installedCommit: 'a'.repeat(40),
            status: 'ready',
        });

        expect(state.installedCommit).toBe('a'.repeat(40));
        expect(fs.existsSync(builder.statePath())).toBe(true);
        expect(builder.statePath()).toContain(path.join('modules', 'betterdesk-client-builder'));
        expect(fs.readdirSync(builder.dataRoot()).some((name) => name.endsWith('.tmp'))).toBe(false);
    });

    test('generates an instance signing seed without exposing it in state', () => {
        const key = builder.ensureSigningKeySync();
        const seedPath = path.join(
            dataDir,
            'modules',
            'betterdesk-support-generator',
            'custom-client-signing.seed'
        );
        expect(key.generated).toBe(true);
        expect(key.publicKey).toMatch(/^[A-Za-z0-9+/]+=*$/);
        expect(fs.readFileSync(seedPath, 'utf8').trim()).toMatch(/^[A-Za-z0-9+/]+=*$/);
        expect(JSON.stringify(builder.readState())).not.toContain(key.seed);
    });

    test('loads the installer environment without overriding explicit process values', () => {
        const envDir = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-build-env-'));
        const envFile = path.join(envDir, 'build.env');
        const previousFile = process.env.BETTERDESK_BUILD_ENV_FILE;
        const previousCargo = process.env.BETTERDESK_CLIENT_CARGO;
        const previousVcpkg = process.env.VCPKG_ROOT;
        try {
            fs.writeFileSync(envFile, [
                'BETTERDESK_CLIENT_CARGO=/opt/cargo/bin/cargo',
                'VCPKG_ROOT=/opt/vcpkg',
            ].join('\n'));
            process.env.BETTERDESK_BUILD_ENV_FILE = envFile;
            process.env.BETTERDESK_CLIENT_CARGO = '/explicit/cargo';
            delete process.env.VCPKG_ROOT;
            jest.resetModules();
            const reloaded = require('../services/clientBuilderService');
            expect(process.env.BETTERDESK_CLIENT_CARGO).toBe('/explicit/cargo');
            expect(process.env.VCPKG_ROOT).toBe('/opt/vcpkg');
            expect(reloaded.getBuildCapabilities).toBeDefined();
        } finally {
            if (previousFile === undefined) delete process.env.BETTERDESK_BUILD_ENV_FILE;
            else process.env.BETTERDESK_BUILD_ENV_FILE = previousFile;
            if (previousCargo === undefined) delete process.env.BETTERDESK_CLIENT_CARGO;
            else process.env.BETTERDESK_CLIENT_CARGO = previousCargo;
            if (previousVcpkg === undefined) delete process.env.VCPKG_ROOT;
            else process.env.VCPKG_ROOT = previousVcpkg;
            fs.rmSync(envDir, { recursive: true, force: true });
        }
    });

    test('reports only explicitly configured targets for a remote provider', () => {
        const previousCommand = process.env.BETTERDESK_CLIENT_BUILD_COMMAND;
        const previousTargets = process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON;
        try {
            process.env.BETTERDESK_CLIENT_BUILD_COMMAND = 'trusted-remote-provider';
            process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON = JSON.stringify({
                targets: [
                    { platform: 'windows', arch: 'x64', format: 'portable' },
                    { platform: 'linux', arch: 'arm64', format: 'deb' },
                    { platform: 'not-supported', arch: 'x64', format: 'portable' },
                ],
            });

            expect(builder.getBuildCapabilities()).toMatchObject({
                mode: 'remote',
                provider: 'command',
                buildReady: true,
                targets: [
                    { platform: 'windows', arch: 'x64', format: 'portable' },
                    { platform: 'linux', arch: 'arm64', format: 'deb' },
                ],
            });
        } finally {
            if (previousCommand === undefined) delete process.env.BETTERDESK_CLIENT_BUILD_COMMAND;
            else process.env.BETTERDESK_CLIENT_BUILD_COMMAND = previousCommand;
            if (previousTargets === undefined) delete process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON;
            else process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON = previousTargets;
        }
    });

    test('does not advertise a remote provider without target capabilities', () => {
        const previousCommand = process.env.BETTERDESK_CLIENT_BUILD_COMMAND;
        const previousTargets = process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON;
        try {
            process.env.BETTERDESK_CLIENT_BUILD_COMMAND = 'trusted-remote-provider';
            delete process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON;

            expect(builder.getBuildCapabilities()).toMatchObject({
                mode: 'remote',
                buildReady: false,
                targets: [],
                reason: 'provider_targets_missing',
            });
        } finally {
            if (previousCommand === undefined) delete process.env.BETTERDESK_CLIENT_BUILD_COMMAND;
            else process.env.BETTERDESK_CLIENT_BUILD_COMMAND = previousCommand;
            if (previousTargets === undefined) delete process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON;
            else process.env.BETTERDESK_CLIENT_PROVIDER_TARGETS_JSON = previousTargets;
        }
    });
});
