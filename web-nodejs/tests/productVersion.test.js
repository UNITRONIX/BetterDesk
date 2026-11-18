'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { readProductVersion, readEmbeddedServerVersion } = require('../lib/productVersion');

describe('productVersion', () => {
    let tmpRoot;

    beforeEach(() => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-version-'));
    });

    afterEach(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    test('reads semver from repo-root VERSION', () => {
        fs.writeFileSync(path.join(tmpRoot, 'VERSION'), '4.1.2\n');
        expect(readProductVersion({ rootDir: tmpRoot })).toBe('4.1.2');
    });

    test('falls back to package.json when VERSION is missing', () => {
        const consoleDir = path.join(tmpRoot, 'web-nodejs');
        fs.mkdirSync(consoleDir, { recursive: true });
        fs.writeFileSync(
            path.join(consoleDir, 'package.json'),
            JSON.stringify({ version: '3.9.8' })
        );
        expect(readProductVersion({ rootDir: tmpRoot, consoleDir })).toBe('3.9.8');
    });

    test('prefers VERSION over package.json', () => {
        const consoleDir = path.join(tmpRoot, 'web-nodejs');
        fs.mkdirSync(consoleDir, { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, 'VERSION'), '2.0.1\n');
        fs.writeFileSync(
            path.join(consoleDir, 'package.json'),
            JSON.stringify({ version: '9.9.9' })
        );
        expect(readProductVersion({ rootDir: tmpRoot, consoleDir })).toBe('2.0.1');
    });

    test('reads VERSION from console dir when repo root VERSION is missing', () => {
        const consoleDir = path.join(tmpRoot, 'console');
        fs.mkdirSync(consoleDir, { recursive: true });
        fs.writeFileSync(path.join(consoleDir, 'VERSION'), '3.3.0\n');
        fs.writeFileSync(
            path.join(consoleDir, 'package.json'),
            JSON.stringify({ version: '3.2.0' })
        );
        expect(readProductVersion({ rootDir: tmpRoot, consoleDir })).toBe('3.3.0');
    });

    test('prefers console package.json when consoleDir is the flat install root', () => {
        const consoleDir = path.join(tmpRoot, 'BetterDeskConsole');
        fs.mkdirSync(consoleDir, { recursive: true });
        fs.writeFileSync(path.join(tmpRoot, 'VERSION'), '3.3.1\n');
        fs.writeFileSync(
            path.join(consoleDir, 'package.json'),
            JSON.stringify({ version: '3.5.108' })
        );
        expect(readProductVersion({ rootDir: consoleDir, consoleDir })).toBe('3.5.108');
    });

    test('reads the version embedded into the Go server source tree', () => {
        const serverDir = path.join(tmpRoot, 'betterdesk-server');
        fs.mkdirSync(path.join(serverDir, 'internal', 'productversion'), { recursive: true });
        fs.writeFileSync(
            path.join(serverDir, 'internal', 'productversion', 'VERSION'),
            '3.5.218\n'
        );
        expect(readEmbeddedServerVersion(serverDir)).toBe('3.5.218');
    });

    test('embedded server version wins over a stale root VERSION at build time', () => {
        // Regression: applyUpdate() writes the root VERSION after the Go build,
        // so the root file still holds the previous release when buildGoServer()
        // runs. Using it produced a freshly compiled server reporting the old
        // version on /api/health while the panel showed the new one.
        const serverDir = path.join(tmpRoot, 'betterdesk-server');
        fs.mkdirSync(path.join(serverDir, 'internal', 'productversion'), { recursive: true });
        fs.writeFileSync(
            path.join(serverDir, 'internal', 'productversion', 'VERSION'),
            '3.5.218\n'
        );
        fs.writeFileSync(path.join(tmpRoot, 'VERSION'), '3.5.217\n');

        expect(readProductVersion({ rootDir: tmpRoot, consoleDir: tmpRoot })).toBe('3.5.217');
        expect(readEmbeddedServerVersion(serverDir)).toBe('3.5.218');
        // buildGoServer() picks the embedded value first.
        expect(readEmbeddedServerVersion(serverDir)
            || readProductVersion({ rootDir: tmpRoot, consoleDir: tmpRoot })).toBe('3.5.218');
    });

    test('readEmbeddedServerVersion returns null when the file is absent or malformed', () => {
        const serverDir = path.join(tmpRoot, 'betterdesk-server');
        fs.mkdirSync(path.join(serverDir, 'internal', 'productversion'), { recursive: true });
        const embedded = path.join(serverDir, 'internal', 'productversion', 'VERSION');

        expect(readEmbeddedServerVersion(serverDir)).toBeNull();
        expect(readEmbeddedServerVersion(null)).toBeNull();

        fs.writeFileSync(embedded, 'not-a-version\n');
        expect(readEmbeddedServerVersion(serverDir)).toBeNull();
    });
});
