'use strict';

/**
 * Signed update manifest (audit H8, 2026-11-13).
 *
 * In-app updates overwrite console files from a GitHub tree. Without a
 * signature the only integrity guarantee is TLS + GitHub. These tests pin the
 * verification contract and the fail-closed behaviour an operator can opt into.
 */

const crypto = require('crypto');
const {
    ENV_PUBLIC_KEY,
    ENV_REQUIRE,
    canonicalPayload,
    configuredPublicKey,
    evaluateUpdateTrust,
    isSignatureRequired,
    verifyManifestSignature,
} = require('../lib/updateManifestSignature');

function createKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
    return { publicKeyB64: raw.toString('base64'), privateKey };
}

function signManifest(manifest, privateKey) {
    return crypto.sign(null, canonicalPayload(manifest), privateKey).toString('base64');
}

const MANIFEST = {
    owner: 'UNITRONIX',
    repo: 'BetterDesk',
    branch: 'dev',
    sha: 'abc1234',
    files: [
        { path: 'web-nodejs/server.js', sha256: 'a'.repeat(64) },
        { path: 'web-nodejs/routes/auth.routes.js', sha256: 'b'.repeat(64) },
    ],
};

describe('canonicalPayload', () => {
    it('is stable regardless of file order and separators', () => {
        const reordered = { ...MANIFEST, files: [...MANIFEST.files].reverse() };
        expect(canonicalPayload(MANIFEST).equals(canonicalPayload(reordered))).toBe(true);
    });

    it('normalises windows separators', () => {
        const winPaths = {
            ...MANIFEST,
            files: MANIFEST.files.map((f) => ({ ...f, path: f.path.replace(/\//g, '\\') })),
        };
        expect(canonicalPayload(winPaths).equals(canonicalPayload(MANIFEST))).toBe(true);
    });

    it('changes when a file hash changes (tamper detection)', () => {
        const tampered = { ...MANIFEST, files: [{ path: MANIFEST.files[0].path, sha256: 'c'.repeat(64) }] };
        expect(canonicalPayload(tampered).equals(canonicalPayload(MANIFEST))).toBe(false);
    });
});

describe('verifyManifestSignature', () => {
    const key = createKeypair();

    it('accepts a signature made by the matching key', () => {
        const sig = signManifest(MANIFEST, key.privateKey);
        expect(verifyManifestSignature(MANIFEST, sig, Buffer.from(key.publicKeyB64, 'base64'))).toBe(true);
    });

    it('rejects a signature over a different manifest', () => {
        const other = { ...MANIFEST, sha: 'deadbee' };
        const sig = signManifest(other, key.privateKey);
        expect(verifyManifestSignature(MANIFEST, sig, Buffer.from(key.publicKeyB64, 'base64'))).toBe(false);
    });

    it('rejects a signature from a different key', () => {
        const attacker = createKeypair();
        const sig = signManifest(MANIFEST, attacker.privateKey);
        expect(verifyManifestSignature(MANIFEST, sig, Buffer.from(key.publicKeyB64, 'base64'))).toBe(false);
    });

    it('rejects malformed signatures', () => {
        expect(verifyManifestSignature(MANIFEST, 'not-base64!!', Buffer.from(key.publicKeyB64, 'base64'))).toBe(false);
        expect(verifyManifestSignature(MANIFEST, Buffer.alloc(4).toString('base64'), Buffer.from(key.publicKeyB64, 'base64'))).toBe(false);
    });
});

describe('evaluateUpdateTrust', () => {
    const originalKey = process.env[ENV_PUBLIC_KEY];
    const originalRequire = process.env[ENV_REQUIRE];
    const key = createKeypair();

    afterEach(() => {
        if (originalKey === undefined) delete process.env[ENV_PUBLIC_KEY];
        else process.env[ENV_PUBLIC_KEY] = originalKey;
        if (originalRequire === undefined) delete process.env[ENV_REQUIRE];
        else process.env[ENV_REQUIRE] = originalRequire;
    });

    it('verifies a correctly signed update', () => {
        process.env[ENV_PUBLIC_KEY] = key.publicKeyB64;
        const result = evaluateUpdateTrust({
            manifest: MANIFEST,
            signature: signManifest(MANIFEST, key.privateKey),
        });
        expect(result).toMatchObject({ ok: true, verified: true });
    });

    it('refuses a tampered manifest even when a key is configured', () => {
        process.env[ENV_PUBLIC_KEY] = key.publicKeyB64;
        const signature = signManifest(MANIFEST, key.privateKey);
        const tampered = { ...MANIFEST, files: [{ path: 'web-nodejs/server.js', sha256: 'f'.repeat(64) }] };

        const result = evaluateUpdateTrust({ manifest: tampered, signature });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('signature_invalid');
    });

    it('refuses an unsigned update when signatures are required', () => {
        process.env[ENV_REQUIRE] = 'true';
        const result = evaluateUpdateTrust({ manifest: MANIFEST, signature: null });
        expect(result.ok).toBe(false);
        expect(result.code).toBe('signature_required');
    });

    it('allows an unsigned update but reports the gap when nothing is configured', () => {
        delete process.env[ENV_PUBLIC_KEY];
        delete process.env[ENV_REQUIRE];
        const result = evaluateUpdateTrust({ manifest: null, signature: null });
        expect(result.ok).toBe(true);
        expect(result.verified).toBe(false);
        expect(result.code).toBe('manifest_absent_unsigned');
    });

    it('reads the strict flag and public key from configuration', () => {
        process.env[ENV_REQUIRE] = '1';
        process.env[ENV_PUBLIC_KEY] = key.publicKeyB64;
        expect(isSignatureRequired()).toBe(true);
        expect(configuredPublicKey()).toHaveLength(32);
    });

    it('ignores a public key of the wrong length', () => {
        process.env[ENV_PUBLIC_KEY] = Buffer.alloc(16).toString('base64');
        expect(configuredPublicKey()).toBeNull();
    });
});
