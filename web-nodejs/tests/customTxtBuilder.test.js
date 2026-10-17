'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
    buildSupportCustomTxt,
    signCustomTxt,
    buildAndSignSupportCustomTxt,
} = require('../services/customTxtBuilder');

describe('customTxtBuilder', () => {
    test('builds Support Agent shaped JSON', () => {
        const json = buildSupportCustomTxt({
            appName: 'Acme Support',
            host: 'desk.example.com',
            relay: 'relay.example.com',
            api: 'http://desk.example.com:21114',
            key: 'PUBKEY',
            disableSettings: true,
        });
        expect(json['app-name']).toBe('Acme Support');
        expect(json['conn-type']).toBe('incoming');
        expect(json['disable-settings']).toBe('Y');
        expect(json['override-settings']['custom-rendezvous-server']).toBe('desk.example.com');
        expect(json['override-settings']['relay-server']).toBe('relay.example.com');
        expect(json['override-settings'].key).toBe('PUBKEY');
    });

    test('rejects unsigned Support Agent builds', () => {
        const json = buildSupportCustomTxt({
            host: 'h',
            api: 'http://h:21114',
            key: 'k',
        });
        expect(() => buildAndSignSupportCustomTxt({
            host: 'h',
            api: 'http://h:21114',
            key: 'k',
        }, '')).toThrow('custom_client_signing_seed_required');
        expect(signCustomTxt(json, '').signed).toBe(false);
    });

    test('signs with 32-byte seed', () => {
        const seed = Buffer.alloc(32, 7).toString('base64');
        const result = buildAndSignSupportCustomTxt({
            host: 'desk.example.com',
            api: 'http://desk.example.com:21114',
            key: 'k',
        }, seed);
        expect(result.signed).toBe(true);
        expect(result.content.startsWith('{')).toBe(false);
        expect(Buffer.from(result.content, 'base64').length).toBeGreaterThan(64);
    });
});

describe('supportGeneratorModule state', () => {
    let moduleDir;
    let supportModule;
    let prevDataDir;

    beforeEach(() => {
        moduleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-gen-mod-'));
        prevDataDir = process.env.BETTERDESK_DATA_DIR;
        // config.dataDir is resolved at require-time in many places; stub via rewriting
        // the module after setting a temp data dir through config mock is heavy —
        // instead exercise helpers through a fresh require with DATA override when possible.
        jest.resetModules();
        jest.doMock('../config/config', () => ({
            dataDir: moduleDir,
        }));
        supportModule = require('../services/supportGeneratorModule');
    });

    afterEach(() => {
        jest.resetModules();
        jest.dontMock('../config/config');
        if (prevDataDir === undefined) delete process.env.BETTERDESK_DATA_DIR;
        else process.env.BETTERDESK_DATA_DIR = prevDataDir;
        fs.rmSync(moduleDir, { recursive: true, force: true });
    });

    test('starts not ready until terms + templates', async () => {
        const status = await supportModule.getStatus();
        expect(status.status).toBe('not_installed');
        expect(status.ready).toBe(false);
        await supportModule.acceptTerms();
        const after = await supportModule.getStatus();
        expect(after.termsAccepted).toBe(true);
        expect(after.ready).toBe(false);
    });

    test('isReady when terms accepted, status ready, templates present', async () => {
        await supportModule.acceptTerms();
        const templates = supportModule.templatesDir();
        const platforms = [
            'windows-x86_64', 'windows-aarch64',
            'linux-x86_64', 'linux-aarch64',
            'macos-x86_64', 'macos-aarch64',
        ];
        const entries = platforms.map((platform) => {
            const dir = path.join(templates, platform);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, '.custom-txt-here'), 'marker\n');
            fs.writeFileSync(path.join(dir, 'betterdesk'), Buffer.alloc(100 * 1024, 1));
            fs.writeFileSync(path.join(templates, `${platform}.tar.gz`), 'archive');
            return {
                platform: platform.split('-')[0],
                arch: platform.endsWith('x86_64') ? 'x86_64' : 'aarch64',
                format: 'portable',
                template_path: platform,
                binary_path: 'betterdesk',
                archive: `${platform}.tar.gz`,
                sha256: 'a'.repeat(64),
            };
        });
        fs.writeFileSync(path.join(templates, 'manifest.json'), JSON.stringify({
            schema_version: 2,
            sku: 'generator-templates',
            required_platforms: platforms,
            templates: entries,
        }));
        fs.writeFileSync(
            path.join(supportModule.moduleDir(), 'custom-client-signing.seed'),
            Buffer.alloc(32, 7).toString('base64'),
        );
        const statePath = path.join(supportModule.moduleDir(), 'state.json');
        fs.writeFileSync(statePath, JSON.stringify({
            termsAccepted: true,
            installedVersion: '1.0.0',
            status: 'ready',
            error: null,
            installedAt: new Date().toISOString(),
        }));
        expect(supportModule.isReady()).toBe(true);
        expect(supportModule.resolveTemplateDir('windows', 'x64')).toContain('windows-x86_64');
    });
});
