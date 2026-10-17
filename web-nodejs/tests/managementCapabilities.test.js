'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const management = require('../lib/managementCapabilities');

describe('management capabilities and configuration contract', () => {
    let root;
    let paths;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'betterdesk-management-'));
        const consolePath = path.join(root, 'console');
        const serverPath = path.join(root, 'server');
        const dataPath = path.join(root, 'data');
        const backupPath = path.join(root, 'backups');
        fs.mkdirSync(consolePath, { recursive: true });
        fs.mkdirSync(serverPath, { recursive: true });
        fs.mkdirSync(dataPath, { recursive: true });
        fs.mkdirSync(backupPath, { recursive: true });
        fs.writeFileSync(
            path.join(consolePath, '.env.example'),
            'PORT=5000\nSESSION_SECRET=\nDB_PATH=/tmp/db.sqlite3\n',
        );
        fs.writeFileSync(path.join(consolePath, '.env'), 'PORT=5000\nSESSION_SECRET=old-secret\n');
        paths = {
            consolePath,
            serverPath,
            dataPath,
            backupPath,
            envPath: path.join(consolePath, '.env'),
            examplePath: path.join(consolePath, '.env.example'),
        };
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    test('only accepts keys present in the .env.example allowlist', () => {
        expect(management.validateEnvChanges({ PORT: '5443' }, paths)).toEqual({ PORT: '5443' });
        expect(() => management.validateEnvChanges({ UNKNOWN_SETTING: 'x' }, paths))
            .toThrow(/not allowlisted/);
    });

    test('validates ports and rejects newline injection', () => {
        expect(() => management.validateEnvChanges({ PORT: '65536' }, paths))
            .toThrow(/Invalid port/);
        expect(() => management.validateEnvChanges({ PORT: '5000\nExecStart=evil' }, paths))
            .toThrow(/control character/);
    });

    test('keeps managed filesystem paths inside BetterDesk roots', () => {
        expect(management.validateEnvChanges({
            DB_PATH: path.join(paths.serverPath, 'db_v2.sqlite3'),
        }, paths)).toEqual({
            DB_PATH: path.join(paths.serverPath, 'db_v2.sqlite3'),
        });
        expect(() => management.validateEnvChanges({ DB_PATH: '/etc/passwd' }, paths))
            .toThrow(/outside BetterDesk roots/);
    });

    test('writes allowlisted values atomically and restores the backup', () => {
        const result = management.applyEnvChanges({ PORT: '5443' }, paths);
        expect(result.changed).toEqual(['PORT']);
        expect(fs.readFileSync(paths.envPath, 'utf8')).toContain('PORT=5443');
        expect(result.backupPath).toMatch(/\.bak\./);

        management.restoreEnvBackup(result.backupPath, paths);
        expect(fs.readFileSync(paths.envPath, 'utf8')).toContain('PORT=5000');
    });

    test('masks sensitive values in output', () => {
        expect(management.maskValue('SESSION_SECRET', 'secret')).toBe('********');
        expect(management.maskValue('PORT', '5000')).toBe('5000');
    });

    test('reports writable paths and grouped capabilities', () => {
        const report = management.getCapabilityReport(paths);
        expect(report.success).toBe(true);
        expect(report.groups).toHaveProperty('update');
        expect(report.groups).toHaveProperty('config');
        expect(report.groups).toHaveProperty('restart');
        expect(report.paths.envPath).toBe(paths.envPath);
    });
});
