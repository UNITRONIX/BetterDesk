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
});
