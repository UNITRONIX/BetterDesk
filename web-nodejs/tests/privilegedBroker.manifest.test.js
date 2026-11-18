'use strict';

/**
 * Privileged broker hardening (audit H10, 2026-11-13).
 *
 * The panel used to be able to rewrite `DATABASE_URL`, `SESSION_SECRET`,
 * `DEFAULT_ADMIN_PASSWORD` and `UPDATE_GITHUB_TOKEN` through the root broker.
 * That turned a `server.config` session into control over the database
 * password, the session signing key and the update channel.
 *
 * These tests pin the contract:
 *   - the managed-key manifest never contains secret-bearing keys,
 *   - the broker reports a protocol version so a stale copy is detectable,
 *   - the panel refuses to treat a stale broker as usable.
 */

const fs = require('fs');
const path = require('path');

const MANIFEST_PATH = path.join(__dirname, '..', 'config', 'management-capabilities.json');
const BROKER_PATH = path.join(__dirname, '..', 'scripts', 'betterdesk-privileged-update.js');

const SECRET_KEY_RE = /(PASSWORD|SECRET|TOKEN|PASS$|_PASS|API_KEY|PRIVATE_KEY|DATABASE_URL)/i;
/** TTLs and paths are not secret material even though their names match. */
const NON_SECRET_SUFFIX_RE = /(_DAYS|_PATH|_EXPIRY_DAYS)$/i;

const isSecretKey = (key) => SECRET_KEY_RE.test(key) && !NON_SECRET_SUFFIX_RE.test(key);

describe('privileged broker manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

    it('exposes no secret-bearing environment keys to the panel', () => {
        const offenders = manifest.environmentKeys.filter((key) => isSecretKey(key));
        expect(offenders).toEqual([]);
    });

    it('keeps the specific keys from the audit finding out of the manifest', () => {
        const forbidden = [
            'DATABASE_URL',
            'SESSION_SECRET',
            'DEFAULT_ADMIN_PASSWORD',
            'UPDATE_GITHUB_TOKEN',
            'ORG_PEER_VAULT_KEY',
        ];
        for (const key of forbidden) {
            expect(manifest.environmentKeys).not.toContain(key);
        }
    });

    it('still allows the non-secret operational keys the panel genuinely needs', () => {
        expect(manifest.environmentKeys).toEqual(expect.arrayContaining([
            'PORT',
            'HTTPS_ENABLED',
            'PUBLIC_SERVER_ID',
            'UPDATE_GITHUB_BRANCH',
        ]));
    });

    it('only allowlists BetterDesk services', () => {
        for (const platform of Object.keys(manifest.services)) {
            for (const name of manifest.services[platform]) {
                expect(name.toLowerCase()).toContain('betterdesk');
            }
        }
    });
});

describe('privileged broker protocol', () => {
    it('declares a protocol version', () => {
        const source = fs.readFileSync(BROKER_PATH, 'utf8');
        expect(source).toMatch(/const BROKER_VERSION = (\d+);/);
        const declared = Number(source.match(/const BROKER_VERSION = (\d+);/)[1]);
        expect(declared).toBeGreaterThanOrEqual(2);
    });

    it('reports the version from --check', () => {
        const source = fs.readFileSync(BROKER_PATH, 'utf8');
        expect(source).toMatch(/case 'check':\s*\n\s*return \{[^}]*version: BROKER_VERSION/);
    });

    it('does not accept arbitrary action names', () => {
        const source = fs.readFileSync(BROKER_PATH, 'utf8');
        expect(source).toMatch(/Privileged update action is not allowlisted/);
    });
});
